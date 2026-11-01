/**
 * Lembretes de consulta por e-mail.
 * Provedor: Brevo (300 e-mails/dia grátis) se o segredo BREVO_API_KEY existir;
 * senão, Mailjet (200 e-mails/dia grátis). Para voltar ao Mailjet:
 *   npx wrangler secret delete BREVO_API_KEY
 *
 * Roda sozinho a cada 10 minutos (Cron Trigger da Cloudflare, gratuito):
 * - 24 h antes: "sua consulta é amanhã"
 * - 1 h antes:  "sua consulta começa em 1 hora"
 * Vai para a mãe e para o profissional, por e-mail e também como mensagem no chat
 * dos dois (com o botão "Entrar na chamada"). Cada lembrete é marcado na consulta
 * (lembrete24hEnviado / lembrete1hEnviado) para nunca sair duplicado.
 */
import { Firestore, tokenDoGoogle } from './google';
import { verificarAvisosDeHorario } from './avisos-horario';

export interface EnvLembretes {
  FIREBASE_PROJECT_ID: string;
  GOOGLE_SERVICE_ACCOUNT: string; // segredo: JSON da conta de serviço
  MAILJET_API_KEY?: string;       // segredo (Mailjet)
  MAILJET_API_SECRET?: string;    // segredo (Mailjet)
  BREVO_API_KEY?: string;         // segredo (Brevo). Se existir, o Brevo é usado no lugar do Mailjet
  MAILJET_FROM_EMAIL: string;     // remetente (precisa estar verificado no provedor em uso)
  MAILJET_FROM_NAME?: string;
  APP_URL?: string;               // ex.: http://localhost:4200 ou o site publicado
}

type Tipo = '24h' | '1h';

const MIN = 60 * 1000;
const JANELA_1H = 70 * MIN;          // até 70 min antes conta como "1 hora antes"
const JANELA_24H = 24 * 60 * MIN;
const MIN_PARA_24H = 3 * 60 * MIN;   // consulta marcada em cima da hora só recebe o de 1 h
const MAX_CONSULTAS_POR_RODADA = 4;  // o plano gratuito da Cloudflare permite 50 chamadas por execução (cada consulta usa ~9)

export interface Resumo {
  encontradas: number;   // consultas "aceito" nas próximas 24 h
  analisadas: number;    // dessas, quantas precisavam de lembrete agora
  enviados: number;
  chat?: number;         // mensagens de lembrete postadas no chat
  erros: string[];
  detalhes: string[];    // diagnóstico legível (aparece no teste manual e no wrangler tail)
}

/** simular = true: faz tudo menos enviar e marcar (para conferir o que aconteceria). */
export async function enviarLembretes(env: EnvLembretes, agora = Date.now(), simular = false, dbPronto?: Firestore): Promise<Resumo> {
  const resumo: Resumo = { encontradas: 0, analisadas: 0, enviados: 0, erros: [], detalhes: [] };
  const temProvedor = !!env.BREVO_API_KEY || (!!env.MAILJET_API_KEY && !!env.MAILJET_API_SECRET);
  if (!env.GOOGLE_SERVICE_ACCOUNT || !temProvedor || !env.MAILJET_FROM_EMAIL) {
    resumo.erros.push('Faltam segredos: GOOGLE_SERVICE_ACCOUNT, BREVO_API_KEY (ou MAILJET_API_KEY + MAILJET_API_SECRET) ou MAILJET_FROM_EMAIL.');
    return resumo;
  }

  const db = dbPronto ?? new Firestore(env.FIREBASE_PROJECT_ID, await tokenDoGoogle(env.GOOGLE_SERVICE_ACCOUNT));

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

  resumo.encontradas = consultas.length;
  for (const c of consultas) {
    const quando = new Date(c.dados['Datahora']);
    const tipo = tipoDeLembrete(c.dados, agora);
    resumo.detalhes.push(
      `Consulta ${c.id} em ${quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: ` +
      (tipo ? `precisa do lembrete de ${tipo}` : 'nenhum lembrete pendente agora') +
      ` (24h: ${c.dados['lembrete24hEnviado'] ? 'já enviado' : 'não'}; 1h: ${c.dados['lembrete1hEnviado'] ? 'já enviado' : 'não'})`
    );
  }

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

      if (!mae?.['email']) resumo.detalhes.push(`Consulta ${c.id}: a mãe (${maeId}) não tem o campo "email" em usuarios.`);
      if (!prof?.['email']) resumo.detalhes.push(`Consulta ${c.id}: o profissional (${profId}) não tem o campo "email" em ${tipoProf === 'advogado' ? 'advogados' : 'psicologos'}.`);
      resumo.detalhes.push(`Consulta ${c.id}: ${mensagens.length} e-mail(s) para ${mensagens.map((m) => m.To[0].Email).join(', ') || 'ninguém'}.`);

      resumo.detalhes.push(`Consulta ${c.id}: mensagem de lembrete no chat da mãe com o profissional.`);
      if (simular) continue;

      if (mensagens.length) {
        const falhas = await enviarEmails(env, mensagens);
        resumo.enviados += mensagens.length - falhas.length;
        falhas.forEach((f) => resumo.erros.push(`${c.id}: ${f}`));
        // Se nenhum saiu (provedor fora do ar ou chave errada), tenta de novo na próxima rodada.
        // Se pelo menos um saiu, marca como enviado para ninguém receber o mesmo lembrete duas vezes.
        if (falhas.length === mensagens.length) continue;
      }
      // Mensagem no chat (se falhar, só registra: o e-mail já foi e o lembrete é marcado mesmo assim)
      try {
        await postarLembreteNoChat(db, {
          consultaId: c.id, maeId: String(maeId || ''), profId: String(profId || ''), tipo: c.tipo, quando,
          nomeMae, nomeProf,
        });
        resumo.chat = (resumo.chat || 0) + 1;
      } catch (e: any) {
        resumo.erros.push(`${c.id} (chat): ${e?.message || e}`);
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

/**
 * Tudo que o cron faz a cada 10 minutos: lembretes de consulta e avisos de horário.
 * Usa um único acesso ao Firestore e divide o limite de 50 chamadas por execução.
 */
export async function rodarTarefasAgendadas(env: EnvLembretes, agora = Date.now(), simular = false) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) {
    const lembretes = await enviarLembretes(env, agora, simular);
    return { provedor: provedorDeEmail(env), lembretes, avisosHorario: null };
  }
  const db = new Firestore(env.FIREBASE_PROJECT_ID, await tokenDoGoogle(env.GOOGLE_SERVICE_ACCOUNT));
  const lembretes = await enviarLembretes(env, agora, simular, db);
  const usadas = 2 + lembretes.analisadas * (provedorDeEmail(env) === 'brevo' ? 10 : 9);
  // Brevo manda um e-mail por chamada (Mailjet manda todos numa chamada só)
  const avisosHorario = await verificarAvisosDeHorario(env, db, 48 - usadas, agora, simular);
  return { provedor: provedorDeEmail(env), lembretes, avisosHorario };
}

/**
 * Posta o lembrete como mensagem do sistema no chat da mãe com o profissional
 * (cria a conversa se ainda não existir). O app mostra essa mensagem como um cartão
 * com o botão "Entrar na chamada".
 */
async function postarLembreteNoChat(db: Firestore, o: {
  consultaId: string; maeId: string; profId: string; tipo: Tipo; quando: Date; nomeMae: string; nomeProf: string;
}): Promise<void> {
  if (!o.maeId || !o.profId) throw new Error('consulta sem maeId ou profissionalId');

  const conversas = await db.consultar({
    from: [{ collectionId: 'chats' }],
    where: { fieldFilter: { field: { fieldPath: 'participantes' }, op: 'ARRAY_CONTAINS', value: { stringValue: o.maeId } } },
    limit: 50,
  });
  let chatId = conversas.find((c) => Array.isArray(c.dados['participantes']) && c.dados['participantes'].includes(o.profId))?.id;
  const agora = new Date();
  if (!chatId) {
    chatId = await db.criar('chats', {
      participantes: [o.profId, o.maeId],
      criadoEm: agora,
      ultimoMensagem: '',
      ultimoEnviadoPor: '',
      ultimaAtualizacao: agora,
    });
  }

  const hora = o.quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const texto = o.tipo === '1h'
    ? `Olá, ${o.nomeMae} e ${o.nomeProf}! A consulta de vocês começa já já. Procurem um lugar tranquilo e confiram a internet antes de entrar.`
    : `Olá, ${o.nomeMae} e ${o.nomeProf}! A consulta de vocês é amanhã. Se precisar desmarcar, avise por aqui.`;

  await db.criar(`chats/${chatId}/mensagens`, {
    tipo: 'lembrete',
    lembrete: o.tipo,
    consultaId: o.consultaId,
    inicio: o.quando,
    texto,
    enviadoPor: 'sistema',
    enviadoEm: agora,
    lido: false,
  });
  await db.atualizar(`chats/${chatId}`, {
    ultimoMensagem: o.tipo === '1h' ? `Lembrete: consulta hoje às ${hora}` : `Lembrete: consulta amanhã às ${hora}`,
    ultimoEnviadoPor: 'sistema',
    ultimaAtualizacao: agora,
  });
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

export async function perfil(
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

export function primeiroNome(nome: unknown): string {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

export function escapar(t: string): string {
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

export function provedorDeEmail(env: EnvLembretes): 'brevo' | 'mailjet' {
  return env.BREVO_API_KEY ? 'brevo' : 'mailjet';
}

/**
 * Envia as mensagens (montadas no formato do Mailjet) pelo provedor em uso.
 * Devolve a lista de falhas (vazia = tudo enviado). Nunca lança erro.
 */
export async function enviarEmails(env: EnvLembretes, mensagens: any[]): Promise<string[]> {
  if (!mensagens.length) return [];
  try {
    if (provedorDeEmail(env) === 'brevo') await enviarBrevo(env, mensagens);
    else await enviarMailjet(env, mensagens);
    return [];
  } catch (e: any) {
    const texto = String(e?.message || e);
    // Brevo: uma falha por e-mail, separadas por " | ". Mailjet: a chamada inteira falhou.
    return provedorDeEmail(env) === 'brevo' ? texto.split(' | ') : mensagens.map(() => texto);
  }
}

/** Brevo (api.brevo.com): uma chamada por e-mail. */
async function enviarBrevo(env: EnvLembretes, mensagens: any[]): Promise<void> {
  const falhas: string[] = [];
  for (const m of mensagens) {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': String(env.BREVO_API_KEY),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: m.From.Email, name: m.From.Name },
        to: m.To.map((d: any) => ({ email: d.Email, ...(d.Name ? { name: d.Name } : {}) })),
        subject: m.Subject,
        htmlContent: m.HTMLPart,
        textContent: m.TextPart,
      }),
    });
    if (!resp.ok) falhas.push(`Brevo ${resp.status} para ${m.To[0]?.Email}: ${(await resp.text()).slice(0, 300)}`);
  }
  if (falhas.length) throw new Error(falhas.join(' | '));
}

async function enviarMailjet(env: EnvLembretes, mensagens: any[]): Promise<void> {
  // A resposta do Mailjet diz, mensagem por mensagem, se foi aceita

  const resp = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_API_SECRET}`),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Messages: mensagens }),
  });
  const corpo = await resp.text();
  if (!resp.ok) throw new Error(`Mailjet ${resp.status}: ${corpo.slice(0, 400)}`);
  try {
    const falhas = (JSON.parse(corpo).Messages || []).filter((m: any) => m.Status !== 'success');
    if (falhas.length) throw new Error(`Mailjet recusou: ${JSON.stringify(falhas).slice(0, 400)}`);
  } catch (e: any) {
    if (String(e?.message || '').startsWith('Mailjet recusou')) throw e;
  }
}
