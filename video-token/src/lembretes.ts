/**
 * Lembretes de consulta por e-mail (Mailjet, plano gratuito: 200 e-mails/dia).
 *
 * Roda sozinho a cada 10 minutos (Cron Trigger da Cloudflare, gratuito):
 * - 24 h antes: "sua consulta é amanhã"
 * - 1 h antes:  "sua consulta começa em 1 hora"
 * Vai para a mãe e para o profissional. Cada lembrete é marcado na consulta
 * (lembrete24hEnviado / lembrete1hEnviado) para nunca sair duplicado.
 */
import { Firestore, tokenDoGoogle } from './google';

export interface EnvLembretes {
  FIREBASE_PROJECT_ID: string;
  GOOGLE_SERVICE_ACCOUNT: string; // segredo: JSON da conta de serviço
  MAILJET_API_KEY: string;        // segredo
  MAILJET_API_SECRET: string;     // segredo
  MAILJET_FROM_EMAIL: string;     // remetente verificado no Mailjet
  MAILJET_FROM_NAME?: string;
  APP_URL?: string;               // ex.: http://localhost:4200 ou o site publicado
}

type Tipo = '24h' | '1h';

const MIN = 60 * 1000;
const JANELA_1H = 70 * MIN;          // até 70 min antes conta como "1 hora antes"
const JANELA_24H = 24 * 60 * MIN;
const MIN_PARA_24H = 3 * 60 * MIN;   // consulta marcada em cima da hora só recebe o de 1 h
const MAX_CONSULTAS_POR_RODADA = 8;  // o plano gratuito da Cloudflare permite 50 chamadas por execução

export interface Resumo { analisadas: number; enviados: number; erros: string[] }

export async function enviarLembretes(env: EnvLembretes, agora = Date.now()): Promise<Resumo> {
  const resumo: Resumo = { analisadas: 0, enviados: 0, erros: [] };
  if (!env.GOOGLE_SERVICE_ACCOUNT || !env.MAILJET_API_KEY || !env.MAILJET_API_SECRET || !env.MAILJET_FROM_EMAIL) {
    resumo.erros.push('Faltam segredos: GOOGLE_SERVICE_ACCOUNT, MAILJET_API_KEY, MAILJET_API_SECRET ou MAILJET_FROM_EMAIL.');
    return resumo;
  }

  const db = new Firestore(env.FIREBASE_PROJECT_ID, await tokenDoGoogle(env.GOOGLE_SERVICE_ACCOUNT));

  // Consultas confirmadas que começam nas próximas 24 h
  // (precisa do índice composto Consultas: status ↑ + Datahora ↑; o erro do Firestore traz o link para criar)
  const consultas = await db.consultar({
    from: [{ collectionId: 'Consultas' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'aceito' } } },
          { fieldFilter: { field: { fieldPath: 'Datahora' }, op: 'GREATER_THAN', value: { timestampValue: new Date(agora).toISOString() } } },
          { fieldFilter: { field: { fieldPath: 'Datahora' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: new Date(agora + JANELA_24H).toISOString() } } },
        ],
      },
    },
    orderBy: [{ field: { fieldPath: 'Datahora' }, direction: 'ASCENDING' }],
    limit: 40,
  });

  const pendentes = consultas
    .map((c) => ({ ...c, tipo: tipoDeLembrete(c.dados, agora) }))
    .filter((c): c is typeof c & { tipo: Tipo } => c.tipo !== null)
    .slice(0, MAX_CONSULTAS_POR_RODADA);

  const cachePerfis = new Map<string, Record<string, any> | null>();

  for (const c of pendentes) {
    resumo.analisadas++;
    try {
      const maeId = c.dados['maeId'] || c.dados['Mae'];
      const profId = c.dados['profissionalId'];
      const tipoProf = c.dados['tipoProfissional'] === 'advogado' ? 'advogado' : 'psicologo';

      const mae = maeId ? await perfil(db, cachePerfis, 'usuarios', maeId) : null;
      const prof = profId ? await perfil(db, cachePerfis, tipoProf === 'advogado' ? 'advogados' : 'psicologos', profId) : null;

      const quando = new Date(c.dados['Datahora']);
      const nomeMae = primeiroNome(mae?.['nome']) || 'mamãe';
      const nomeProf = prof?.['nome'] ? String(prof['nome']) : 'seu profissional';
      const area = tipoProf === 'advogado' ? 'Direito' : 'Psicologia';
      const app = (env.APP_URL || 'http://localhost:4200').replace(/\/$/, '');

      const mensagens: any[] = [];
      if (mae?.['email']) {
        mensagens.push(montarEmail(env, {
          para: String(mae['email']), nomePara: String(mae['nome'] || ''),
          saudacao: nomeMae, tipo: c.tipo, quando,
          comQuem: `${nomeProf} (${area})`,
          link: `${app}/consultas`, textoBotao: 'Ver minhas consultas',
        }));
      }
      if (prof?.['email']) {
        mensagens.push(montarEmail(env, {
          para: String(prof['email']), nomePara: String(prof['nome'] || ''),
          saudacao: primeiroNome(prof['nome']) || 'Dr(a).', tipo: c.tipo, quando,
          comQuem: String(mae?.['nome'] || 'uma mãe da comunidade'),
          link: `${app}/${tipoProf === 'advogado' ? 'home-adv' : 'home-psi'}`, textoBotao: 'Abrir meu painel',
        }));
      }

      if (mensagens.length) {
        await enviarMailjet(env, mensagens);
        resumo.enviados += mensagens.length;
      }
      // Marca mesmo se ninguém tinha e-mail, para não tentar de novo a cada 10 min
      const campo = c.tipo === '1h' ? 'lembrete1hEnviado' : 'lembrete24hEnviado';
      const marcar: Record<string, boolean> = { [campo]: true };
      if (c.tipo === '1h') marcar['lembrete24hEnviado'] = true; // não manda o de 24 h depois do de 1 h
      await db.marcar(`Consultas/${c.id}`, marcar);
    } catch (e: any) {
      resumo.erros.push(`${c.id}: ${e?.message || e}`);
    }
  }
  return resumo;
}

/** Qual lembrete essa consulta ainda precisa agora (ou null). */
export function tipoDeLembrete(dados: Record<string, any>, agora: number): Tipo | null {
  const inicio = new Date(dados['Datahora']).getTime();
  if (isNaN(inicio)) return null;
  const falta = inicio - agora;
  if (falta <= 0) return null;
  if (falta <= JANELA_1H) return dados['lembrete1hEnviado'] ? null : '1h';
  if (falta <= JANELA_24H) {
    if (dados['lembrete24hEnviado']) return null;
    // Consulta marcada em cima da hora (menos de 3 h): pula o de 24 h
    const criadoEm = dados['criadoEm'] ? new Date(dados['criadoEm']).getTime() : 0;
    if (criadoEm && inicio - criadoEm < MIN_PARA_24H) return null;
    return '24h';
  }
  return null;
}

async function perfil(
  db: Firestore,
  cache: Map<string, Record<string, any> | null>,
  colecao: string,
  id: string
): Promise<Record<string, any> | null> {
  const chave = `${colecao}/${id}`;
  if (cache.has(chave)) return cache.get(chave)!;
  let dados = await db.ler(chave);
  if (!dados && colecao !== 'usuarios') {
    // cadastros antigos: documento com id aleatório e campo uid
    const achados = await db.consultar({
      from: [{ collectionId: colecao }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: id } } },
      limit: 1,
    });
    dados = achados[0]?.dados ?? null;
  }
  cache.set(chave, dados);
  return dados;
}

function primeiroNome(nome: unknown): string {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export function montarEmail(env: EnvLembretes, o: {
  para: string; nomePara: string; saudacao: string; tipo: Tipo; quando: Date;
  comQuem: string; link: string; textoBotao: string;
}) {
  const diaBruto = o.quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' });
  const dia = diaBruto.charAt(0).toUpperCase() + diaBruto.slice(1);
  const hora = o.quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const assunto = o.tipo === '1h'
    ? `Sua consulta começa em 1 hora (${hora})`
    : `Lembrete: sua consulta é amanhã às ${hora}`;
  const chamada = o.tipo === '1h'
    ? `Sua consulta com <strong>${escapar(o.comQuem)}</strong> começa em cerca de 1 hora.`
    : `Passando para lembrar da sua consulta com <strong>${escapar(o.comQuem)}</strong> amanhã.`;
  const dica = o.tipo === '1h'
    ? 'Procure um lugar tranquilo, confira a internet e entre pela página de consultas uns minutinhos antes.'
    : 'Se não puder comparecer, cancele pela plataforma para liberar o horário para outra mãe.';

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#F6F2FF;font-family:Arial,Helvetica,sans-serif;color:#2D1E4E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F2FF;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #EEE8FA">
<tr><td style="padding:22px 28px;border-bottom:1px solid #EEE8FA;font-size:20px;font-weight:bold;color:#4B2C82">elomaterno</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:17px">Olá, ${escapar(o.saudacao)}!</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55">${chamada}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F4ECFF;border-radius:12px;margin:0 0 18px"><tr><td style="padding:14px 18px;font-size:15px;line-height:1.6">
<span style="color:#7B6AAE;font-size:12px;font-weight:bold;letter-spacing:.04em">DATA E HORA</span><br>
<strong>${escapar(dia)}</strong>, às <strong>${hora}</strong>
</td></tr></table>
<p style="margin:0 0 22px;font-size:14px;line-height:1.55;color:#5C5478">${dica}</p>
<a href="${escapar(o.link)}" style="display:inline-block;background:#5B3D99;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:12px">${escapar(o.textoBotao)}</a>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEE8FA;font-size:12px;color:#8A82A6">Você recebeu este e-mail porque tem uma consulta agendada no EloMaterno.</td></tr>
</table></td></tr></table></body></html>`;

  const texto = `Olá, ${o.saudacao}!\n\n${chamada.replace(/<[^>]+>/g, '')}\n\nData e hora: ${dia}, às ${hora}\n\n${dica}\n\n${o.textoBotao}: ${o.link}`;

  return {
    From: { Email: env.MAILJET_FROM_EMAIL, Name: env.MAILJET_FROM_NAME || 'EloMaterno' },
    To: [{ Email: o.para, Name: o.nomePara }],
    Subject: assunto,
    TextPart: texto,
    HTMLPart: html,
  };
}

async function enviarMailjet(env: EnvLembretes, mensagens: any[]): Promise<void> {
  const resp = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_API_SECRET}`),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Messages: mensagens }),
  });
  if (!resp.ok) throw new Error(`Mailjet ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
}
