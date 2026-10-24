/**
 * Funções puras para montar o token do JaaS.
 * Ficam separadas do Worker para poderem ser testadas fora da Cloudflare.
 */
import { importPKCS8, SignJWT } from 'jose';

const VALIDADE_SEGUNDOS = 3 * 60 * 60;

/** Nome da sala no JaaS para uma consulta (o Jitsi trabalha com minúsculas). */
export function nomeDaSala(consultaId: string): string {
  return `elomaterno-${consultaId}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * Lê a chave privada colada no segredo. Aceita os dois formatos que costumam aparecer:
 * "BEGIN PRIVATE KEY" (PKCS#8) e "BEGIN RSA PRIVATE KEY" (PKCS#1, convertido aqui).
 */
export async function lerChavePrivada(pem: string): Promise<CryptoKey> {
  const texto = pem.replace(/\\n/g, '\n').trim();
  if (texto.includes('BEGIN RSA PRIVATE KEY')) {
    const pkcs1 = base64ParaBytes(texto.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    const pkcs8 = embrulharPkcs1EmPkcs8(pkcs1);
    const pemPkcs8 = `-----BEGIN PRIVATE KEY-----\n${bytesParaBase64(pkcs8).match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
    return importPKCS8(pemPkcs8, 'RS256') as Promise<CryptoKey>;
  }
  return importPKCS8(texto, 'RS256') as Promise<CryptoKey>;
}

export interface UsuarioToken {
  id: string;
  nome: string;
  email?: string;
  avatar?: string;
  moderador: boolean;
}

/** Monta e assina o JWT no formato exigido pelo JaaS. */
export async function assinarTokenJaas(opts: {
  appId: string;
  keyId: string;
  chave: CryptoKey;
  sala: string;
  usuario: UsuarioToken;
  agoraSeg?: number;
}): Promise<string> {
  const agora = opts.agoraSeg ?? Math.floor(Date.now() / 1000);
  const user: Record<string, string> = {
    id: opts.usuario.id,
    name: opts.usuario.nome,
    moderator: opts.usuario.moderador ? 'true' : 'false',
  };
  if (opts.usuario.email) user['email'] = opts.usuario.email;
  // O JaaS só aceita avatar com URL pública
  if (opts.usuario.avatar?.startsWith('https://')) user['avatar'] = opts.usuario.avatar;

  return new SignJWT({
    room: opts.sala,
    context: {
      user,
      features: {
        livestreaming: false,
        recording: false,
        transcription: false,
        'outbound-call': false,
        'sip-outbound-call': false,
      },
    },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: `${opts.appId}/${opts.keyId}` })
    .setAudience('jitsi')
    .setIssuer('chat')
    .setSubject(opts.appId)
    .setNotBefore(agora - 10)
    .setExpirationTime(agora + VALIDADE_SEGUNDOS)
    .sign(opts.chave);
}

// ---------- utilidades de bytes / ASN.1 ----------

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesParaBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function tamanhoDer(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, conteudo: Uint8Array): Uint8Array {
  const cab = [tag, ...tamanhoDer(conteudo.length)];
  const out = new Uint8Array(cab.length + conteudo.length);
  out.set(cab, 0);
  out.set(conteudo, cab.length);
  return out;
}

function concat(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}

/** PKCS#8 = SEQUENCE { INTEGER 0, AlgorithmIdentifier(rsaEncryption), OCTET STRING(pkcs1) } */
function embrulharPkcs1EmPkcs8(pkcs1: Uint8Array): Uint8Array {
  const versao = new Uint8Array([0x02, 0x01, 0x00]);
  const algRsa = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  return der(0x30, concat(versao, algRsa, der(0x04, pkcs1)));
}
