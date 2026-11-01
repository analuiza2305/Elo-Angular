/**
 * Acesso ao Firestore com a conta de serviço do projeto (plano Spark, sem custo).
 *
 * Usado só pelas tarefas agendadas (cron), que não têm uma pessoa logada.
 * A conta de serviço ignora as regras do Firestore, então este arquivo só faz
 * as leituras e a marcação que os lembretes precisam.
 */
import { importPKCS8, SignJWT } from 'jose';

export interface ContaDeServico {
  client_email: string;
  private_key: string;
  project_id?: string;
}

let tokenEmCache: { valor: string; expiraEm: number } | null = null;

/** Troca a chave da conta de serviço por um token de acesso do Google (válido 1 h). */
export async function tokenDoGoogle(jsonDaConta: string): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenEmCache && tokenEmCache.expiraEm - 120 > agora) return tokenEmCache.valor;

  let conta: ContaDeServico;
  try {
    conta = JSON.parse(jsonDaConta);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT não é um JSON válido. Cole o arquivo inteiro da conta de serviço.');
  }
  const chave = await importPKCS8(conta.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(conta.client_email)
    .setSubject(conta.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(agora)
    .setExpirationTime(agora + 3600)
    .sign(chave);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) throw new Error(`Google OAuth ${resp.status}: ${await resp.text()}`);
  const dados: any = await resp.json();
  tokenEmCache = { valor: dados.access_token, expiraEm: agora + Number(dados.expires_in || 3600) };
  return tokenEmCache.valor;
}

export class Firestore {
  private base: string;

  constructor(private projeto: string, private token: string) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents`;
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  /** Lê um documento. Devolve null se não existir. */
  async ler(caminho: string): Promise<Record<string, any> | null> {
    const resp = await fetch(`${this.base}/${caminho}`, { headers: this.headers() });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Firestore ${resp.status}: ${await resp.text()}`);
    const doc: any = await resp.json();
    return camposSimples(doc.fields);
  }

  /** Consulta simples: devolve [{ id, dados }]. */
  async consultar(structuredQuery: unknown): Promise<{ id: string; dados: Record<string, any> }[]> {
    const resp = await fetch(`${this.base}:runQuery`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ structuredQuery }),
    });
    if (!resp.ok) throw new Error(`Firestore runQuery ${resp.status}: ${await resp.text()}`);
    const linhas: any[] = await resp.json();
    return linhas
      .filter((l) => l.document)
      .map((l) => ({ id: String(l.document.name).split('/').pop()!, dados: camposSimples(l.document.fields) }));
  }

  /** Cria um documento com id automático. */
  async criar(colecao: string, campos: Record<string, any>): Promise<string> {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(campos)) fields[k] = valorFirestore(v);
    const resp = await fetch(`${this.base}/${colecao}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!resp.ok) throw new Error(`Firestore POST ${resp.status}: ${await resp.text()}`);
    const doc: any = await resp.json();
    return String(doc.name).split('/').pop()!;
  }

  /** Apaga um documento (não dá erro se já não existir). */
  async apagar(caminho: string): Promise<void> {
    const resp = await fetch(`${this.base}/${caminho}`, { method: 'DELETE', headers: this.headers() });
    if (!resp.ok && resp.status !== 404) throw new Error(`Firestore DELETE ${resp.status}: ${await resp.text()}`);
  }

  /** Atualiza só os campos indicados, com qualquer tipo de valor (texto, data, número...). */
  async atualizar(caminho: string, campos: Record<string, any>): Promise<void> {
    const mascara = Object.keys(campos).map((c) => `updateMask.fieldPaths=${encodeURIComponent(c)}`).join('&');
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(campos)) fields[k] = valorFirestore(v);
    const resp = await fetch(`${this.base}/${caminho}?${mascara}&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!resp.ok) throw new Error(`Firestore PATCH ${resp.status}: ${await resp.text()}`);
  }

  /** Grava só os campos indicados (os outros ficam como estão). */
  async marcar(caminho: string, campos: Record<string, boolean | string>): Promise<void> {
    const mascara = Object.keys(campos).map((c) => `updateMask.fieldPaths=${encodeURIComponent(c)}`).join('&');
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(campos)) {
      fields[k] = typeof v === 'boolean' ? { booleanValue: v } : { stringValue: v };
    }
    const resp = await fetch(`${this.base}/${caminho}?${mascara}&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!resp.ok) throw new Error(`Firestore PATCH ${resp.status}: ${await resp.text()}`);
  }
}

export function camposSimples(fields: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries<any>(fields || {})) out[k] = valorSimples(v);
  return out;
}

function valorSimples(v: any): any {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return String(v.referenceValue).split('/').pop();
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorSimples);
  if ('mapValue' in v) return camposSimples(v.mapValue.fields);
  return null;
}

/** Valor JS -> formato da API REST do Firestore. */
function valorFirestore(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valorFirestore) } };
  if (typeof v === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) fields[k] = valorFirestore(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
