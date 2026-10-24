/**
 * Cloudflare Worker (plano gratuito, sem cartão) que gera o token da videochamada JaaS.
 *
 * Fluxo:
 * 1. O app manda o ID token do Firebase da pessoa logada + o id da consulta.
 * 2. O Worker confere que o ID token é verdadeiro (assinado pelo Google para o projeto).
 * 3. Lê a consulta no Firestore USANDO O TOKEN DA PRÓPRIA PESSOA, então as regras de
 *    segurança do Firestore continuam valendo (não precisa de chave de admin).
 * 4. Confere se ela é a profissional ou a mãe da consulta e se está "aceito".
 * 5. Devolve o token do JaaS (profissional = moderadora).
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { assinarTokenJaas, lerChavePrivada, nomeDaSala } from './jaas';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  JAAS_APP_ID: string;
  JAAS_KEY_ID: string;
  JAAS_PRIVATE_KEY: string;   // segredo (wrangler secret put)
  ALLOWED_ORIGINS: string;    // ex.: "http://localhost:4200,https://elo-materno.web.app"
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

class ErroApi extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origem = request.headers.get('Origin') || '';
    const permitidas = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    const cors: Record<string, string> = {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (permitidas.includes(origem)) cors['Access-Control-Allow-Origin'] = origem;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const responder = (status: number, corpo: unknown) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });

    try {
      if (request.method !== 'POST') throw new ErroApi(405, 'method-not-allowed', 'Use POST.');
      if (!permitidas.includes(origem)) throw new ErroApi(403, 'permission-denied', 'Origem não permitida.');
      return responder(200, await gerarToken(request, env));
    } catch (e: any) {
      if (e instanceof ErroApi) return responder(e.status, { code: e.code, message: e.message });
      console.error(e);
      return responder(500, { code: 'internal', message: 'Erro interno ao preparar a chamada.' });
    }
  },
};

async function gerarToken(request: Request, env: Env) {
  // 1. Quem está pedindo?
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) throw new ErroApi(401, 'unauthenticated', 'Faça login para entrar na chamada.');

  let uid: string;
  let nomeDoLogin = '';
  let email: string | undefined;
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    uid = String(payload.sub);
    nomeDoLogin = String(payload['name'] ?? '');
    email = payload['email'] ? String(payload['email']) : undefined;
  } catch {
    throw new ErroApi(401, 'unauthenticated', 'Sua sessão expirou. Faça login de novo.');
  }

  // 2. Qual consulta?
  const corpo: any = await request.json().catch(() => ({}));
  const consultaId = String(corpo?.consultaId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(consultaId)) {
    throw new ErroApi(400, 'invalid-argument', 'Link de consulta inválido.');
  }

  // 3. Lê a consulta com o token da própria pessoa (respeita as regras do Firestore)
  const consulta = await lerDocumento(env, idToken, `Consultas/${consultaId}`);
  if (consulta === 'negado') throw new ErroApi(403, 'permission-denied', 'Você não participa desta consulta.');
  if (!consulta) throw new ErroApi(404, 'not-found', 'Consulta não encontrada.');

  const profissionalId = consulta['profissionalId'];
  const maeId = consulta['maeId'] || consulta['Mae'];
  const ehProfissional = uid === profissionalId;
  if (!ehProfissional && uid !== maeId) {
    throw new ErroApi(403, 'permission-denied', 'Você não participa desta consulta.');
  }
  if (String(consulta['status'] ?? '').toLowerCase() !== 'aceito') {
    throw new ErroApi(409, 'failed-precondition', 'Esta consulta não está agendada no momento.');
  }

  // 4. Nome e foto: cadastro no Firestore → o que o app mandou → nome do login
  const nomeDoApp = String(corpo?.nome ?? '').replace(/[<>]/g, '').trim().slice(0, 80);
  const avatarDoApp = String(corpo?.avatar ?? '').trim().slice(0, 500);
  let nome = '';
  let avatar = '';
  const colecoes = ehProfissional ? ['psicologos', 'usuarios'] : ['usuarios'];
  for (const col of colecoes) {
    const perfil = await lerDocumento(env, idToken, `${col}/${uid}`).catch(() => null);
    if (perfil && perfil !== 'negado') {
      if (perfil['nome']) nome = String(perfil['nome']);
      if (perfil['avatar']) avatar = String(perfil['avatar']);
      break;
    }
  }
  if (!nome) nome = nomeDoApp || nomeDoLogin || (ehProfissional ? 'Profissional' : 'Mãe');
  if (!avatar) avatar = avatarDoApp;

  // 5. Assina o token do JaaS
  const sala = nomeDaSala(consultaId);
  const token = await assinarTokenJaas({
    appId: env.JAAS_APP_ID,
    keyId: env.JAAS_KEY_ID,
    chave: await lerChavePrivada(env.JAAS_PRIVATE_KEY),
    sala,
    usuario: { id: uid, nome, email, avatar, moderador: ehProfissional },
  });

  return { token, appId: env.JAAS_APP_ID, sala, moderador: ehProfissional, nome };
}

/** Lê um documento pela API REST do Firestore e devolve os campos como valores simples. */
async function lerDocumento(
  env: Env,
  idToken: string,
  caminho: string
): Promise<Record<string, any> | null | 'negado'> {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${caminho}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (resp.status === 404) return null;
  if (resp.status === 403) return 'negado';
  if (!resp.ok) throw new Error(`Firestore ${resp.status}: ${await resp.text()}`);
  const docJson: any = await resp.json();
  const campos: Record<string, any> = {};
  for (const [k, v] of Object.entries<any>(docJson.fields || {})) campos[k] = valorSimples(v);
  return campos;
}

function valorSimples(v: any): any {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  // Referência (ex.: Mae como /usuarios/abc) → só o id
  if ('referenceValue' in v) return String(v.referenceValue).split('/').pop();
  return null;
}