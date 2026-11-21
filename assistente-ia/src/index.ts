/**
 * Cloudflare Worker (plano gratuito) do assistente virtual do Elo Materno.
 *
 * Por que existe: a chave do Gemini não pode ficar no Angular (qualquer pessoa veria no navegador).
 * Então o site manda a pergunta para cá, e só este Worker conhece a chave.
 *
 * Fluxo de cada pergunta:
 * 1. Confere se o pedido veio do nosso site (CORS / ALLOWED_ORIGINS).
 * 2. Confere se quem pergunta está logada (ID token do Firebase, igual ao Worker da videochamada).
 * 3. Confere o limite diário daquela mãe (protege a cota grátis).
 * 4. Limpa e encurta a conversa (só as últimas mensagens, sem dados pessoais óbvios).
 * 5. Manda para o Gemini junto com as instruções (src/conhecimento.ts) e devolve a resposta.
 *
 * Se o Gemini estiver fora do ar ou a cota acabar, devolve { code: 'indisponivel' } e o site
 * responde com as perguntas frequentes (que ficam no próprio Angular).
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { INSTRUCOES_DO_ASSISTENTE } from './conhecimento';

export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  GEMINI_MODELO: string;
  LIMITE_DIARIO: string;
  GEMINI_API_KEY: string;   // segredo: npx wrangler secret put GEMINI_API_KEY
}

interface Mensagem { autor: 'mae' | 'assistente'; texto: string; }

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const MAX_MENSAGENS = 8;        // só o fim da conversa vai para a IA
const MAX_CARACTERES = 600;     // por mensagem

class ErroApi extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/**
 * Contador simples de perguntas por mãe por dia, na memória do Worker.
 * É "melhor esforço": a Cloudflare pode reiniciar o Worker e zerar a conta. Para o projeto
 * isso basta, porque o site também conta do lado da mãe e o Gemini tem o próprio limite.
 */
const usoDoDia = new Map<string, { dia: string; total: number }>();

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
      new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    try {
      if (request.method !== 'POST') throw new ErroApi(405, 'method-not-allowed', 'Use POST.');
      if (!permitidas.includes(origem)) throw new ErroApi(403, 'permission-denied', 'Origem não permitida.');
      return responder(200, await responderPergunta(request, env));
    } catch (e: any) {
      if (e instanceof ErroApi) return responder(e.status, { code: e.code, message: e.message });
      console.error(e);
      return responder(503, { code: 'indisponivel', message: 'O assistente está indisponível agora.' });
    }
  },
};

async function responderPergunta(request: Request, env: Env) {
  // 1. Quem está perguntando? (precisa estar logada)
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) throw new ErroApi(401, 'unauthenticated', 'Faça login para usar o assistente.');
  let uid: string;
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    uid = String(payload.sub);
  } catch {
    throw new ErroApi(401, 'unauthenticated', 'Sua sessão expirou. Entre de novo.');
  }

  // 2. Limite diário
  const limite = Number(env.LIMITE_DIARIO) || 30;
  const hoje = new Date().toISOString().slice(0, 10);
  const uso = usoDoDia.get(uid);
  const total = uso && uso.dia === hoje ? uso.total : 0;
  if (total >= limite) throw new ErroApi(429, 'limite', `Você já fez ${limite} perguntas hoje. Amanhã o assistente volta!`);

  // 3. Conversa: valida, corta e esconde dados pessoais óbvios
  const corpo: any = await request.json().catch(() => ({}));
  const historico: Mensagem[] = (Array.isArray(corpo?.mensagens) ? corpo.mensagens : [])
    .filter((m: any) => m && (m.autor === 'mae' || m.autor === 'assistente') && typeof m.texto === 'string')
    .slice(-MAX_MENSAGENS)
    .map((m: any) => ({ autor: m.autor, texto: esconderDadosPessoais(m.texto.slice(0, MAX_CARACTERES)) }));
  if (!historico.length || historico[historico.length - 1].autor !== 'mae') {
    throw new ErroApi(400, 'invalid-argument', 'Mande uma pergunta.');
  }

  // 4. Pergunta ao Gemini
  if (!env.GEMINI_API_KEY) throw new ErroApi(503, 'indisponivel', 'Chave do Gemini não configurada.');
  const modelo = env.GEMINI_MODELO || 'gemini-flash-latest';
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCOES_DO_ASSISTENTE }] },
      contents: historico.map((m) => ({ role: m.autor === 'mae' ? 'user' : 'model', parts: [{ text: m.texto }] })),
      generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
    }),
  });

  if (!resp.ok) {
    // 429 = cota grátis acabou; outros = fora do ar ou modelo errado. Em todos, o site usa o FAQ.
    console.warn('Gemini respondeu', resp.status, (await resp.text()).slice(0, 300));
    throw new ErroApi(503, 'indisponivel', 'O assistente está indisponível agora.');
  }
  const dados: any = await resp.json();
  const texto = (dados?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '').join('').trim();
  if (!texto) throw new ErroApi(503, 'indisponivel', 'O assistente não conseguiu responder.');

  usoDoDia.set(uid, { dia: hoje, total: total + 1 });
  return { resposta: texto.slice(0, 2000), restantesHoje: limite - total - 1 };
}

/** Tira CPF, telefone e e-mail antes de mandar para a IA (no plano grátis o Google pode usar os textos). */
function esconderDadosPessoais(txt: string): string {
  return txt
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF removido]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail removido]')
    .replace(/(\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g, '[telefone removido]');
}
