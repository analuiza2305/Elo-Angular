import { auth } from '../core/firebase';

/**
 * Conversa com o assistente virtual "Elo".
 *
 * 1. Se a mensagem parece um pedido de socorro, responde NA HORA com os telefones de ajuda
 *    (não manda para a IA: é mais rápido e o texto não sai do celular da mãe).
 * 2. Senão, manda para o nosso Worker (assistente-ia/), que fala com o Gemini.
 * 3. Se o Worker não responder (sem internet, cota grátis acabou, Worker não publicado),
 *    responde pelas perguntas frequentes daqui de baixo. Assim o assistente nunca fica mudo.
 */

/** Endereço do Worker. Aparece no terminal depois do `npx wrangler deploy` dentro de assistente-ia/. */
export const URL_ASSISTENTE = 'https://elo-materno-assistente.elomaterno-ia.workers.dev';

/** Limite do lado do site (o Worker também confere). */
export const LIMITE_DIARIO_LOCAL = 30;

export interface MensagemAssistente {
  autor: 'mae' | 'assistente';
  texto: string;
  /** De onde veio a resposta: 'ia', 'faq' (perguntas frequentes) ou 'apoio' (telefones de ajuda). */
  origem?: 'ia' | 'faq' | 'apoio';
  /** Link opcional para a tela citada na resposta. */
  link?: { rotulo: string; rota: string };
}

export function normalizar(txt: string): string {
  return String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ------------------------------------------------------------------
// 1. Pedido de socorro
// ------------------------------------------------------------------
const SINAIS_DE_CRISE = [
  'me matar', 'suicid', 'quero morrer', 'nao quero mais viver', 'nao aguento mais viver', 'acabar com tudo',
  'acabar com a minha vida', 'me machucar', 'me cortar', 'tirar minha vida', 'sumir para sempre',
  'machucar meu filho', 'machucar o bebe', 'machucar minha filha', 'me bate', 'me agride', 'me ameaca',
  'violencia domestica', 'estou em perigo', 'corro perigo',
];

export function pareceCrise(texto: string): boolean {
  const t = normalizar(texto);
  return SINAIS_DE_CRISE.some((s) => t.includes(s));
}

export const RESPOSTA_APOIO =
  'Sinto muito que você esteja passando por isso. Você não está sozinha e merece ajuda agora:\n' +
  '• CVV: ligue 188 (24 horas, de graça) ou acesse cvv.org.br\n' +
  '• SAMU: 192 · Polícia: 190\n' +
  '• Central de Atendimento à Mulher: 180\n' +
  'Se puder, chame alguém de confiança para ficar com você. Quando se sentir segura, você também pode marcar uma conversa com uma psicóloga aqui, de graça.';

// ------------------------------------------------------------------
// 3. Perguntas frequentes (plano B, sem IA)
// ------------------------------------------------------------------
interface ItemFaq { palavras: string[]; resposta: string; link?: { rotulo: string; rota: string }; }

const FAQ: ItemFaq[] = [
  {
    palavras: ['marcar', 'agendar', 'consulta', 'psicolog', 'advogad', 'horario'],
    resposta: 'Para marcar: toque em "Marcar consulta" no Início, escolha a psicóloga ou advogada, toque no dia e depois no horário. Confira o perfil dela, escreva o motivo e toque em "Confirmar Consulta". É de graça!',
    link: { rotulo: 'Marcar consulta', rota: '/consultas-lista-psi' },
  },
  {
    palavras: ['entrar', 'chamada', 'video', 'camera', 'ligacao', 'link'],
    resposta: 'No dia e na hora, abra "Minhas consultas" e toque no botão verde "Entrar na chamada". Na tela de Início também aparece "Entrar agora" quando está na hora. Use fone de ouvido e uma internet boa.',
    link: { rotulo: 'Minhas consultas', rota: '/consultas' },
  },
  {
    palavras: ['confirm', 'esperando', 'pendente', 'resposta da profissional', 'aceitou'],
    resposta: 'A profissional tem até 2 dias para confirmar. Quando ela confirmar, aparece um aviso no sino lá em cima e na tela de Início. Se não confirmar no prazo, a consulta é cancelada e você pode marcar de novo.',
    link: { rotulo: 'Minhas consultas', rota: '/consultas' },
  },
  {
    palavras: ['cancelar', 'desmarcar', 'remarcar', 'reagendar', 'marcar de novo'],
    resposta: 'Em "Minhas consultas", na aba Agendadas, toque em "Cancelar consulta". Para remarcar, vá na aba Canceladas e toque em "Marcar de novo".',
    link: { rotulo: 'Minhas consultas', rota: '/consultas' },
  },
  {
    palavras: ['mensagem', 'chat', 'conversar com a', 'falar com a psicologa', 'audio'],
    resposta: 'Toque no balãozinho de mensagem lá em cima. Na lista, escolha a profissional da sua consulta, escreva embaixo e envie. Também dá para gravar áudio de até 1 minuto no microfone.',
    link: { rotulo: 'Mensagens', rota: '/chat' },
  },
  {
    palavras: ['forum', 'postar', 'post', 'outras maes', 'anonim', 'desabafar'],
    resposta: 'No Fórum você conversa com outras mães. Toque no botão de novo post, escolha a categoria e escreva. Se quiser, marque para postar sem mostrar seu nome.',
    link: { rotulo: 'Fórum', rota: '/forum' },
  },
  {
    palavras: ['evento', 'palestra', 'oficina', 'encontro', 'inscrev'],
    resposta: 'Em Eventos, toque em "Ver e me inscrever" e depois em "Quero me inscrever". Os eventos que já aconteceram ficam no botão "Ver eventos que já aconteceram".',
    link: { rotulo: 'Eventos', rota: '/eventos' },
  },
  {
    palavras: ['agenda', 'calendario'],
    resposta: 'O ícone de calendário lá em cima abre sua Agenda, com as consultas e os eventos em que você se inscreveu.',
    link: { rotulo: 'Agenda', rota: '/agenda-mae' },
  },
  {
    palavras: ['questionario', 'bem-estar', 'bem estar'],
    resposta: 'O questionário de bem-estar tem 8 perguntas rápidas (uns 2 minutos). Só as psicólogas das suas consultas veem. Você pode responder ou atualizar em "Meu perfil".',
    link: { rotulo: 'Questionário', rota: '/questionario' },
  },
  {
    palavras: ['emprego', 'vaga', 'curso', 'trabalho', 'carreira'],
    resposta: 'Em Carreiras ficam as vagas de emprego e os cursos das empresas parceiras.',
    link: { rotulo: 'Carreiras', rota: '/carreiras' },
  },
  {
    palavras: ['artigo', 'comunidade', 'dica', 'ler', 'salvar'],
    resposta: 'Na Comunidade ficam artigos e dicas de profissionais e empresas parceiras. Toque no marcador para salvar e ler depois em "Artigos salvos".',
    link: { rotulo: 'Comunidade', rota: '/artigos' },
  },
  {
    palavras: ['perfil', 'foto', 'nome', 'dados', 'excluir conta', 'apagar conta'],
    resposta: 'Toque na sua foto no canto de cima e depois em "Meu perfil". Lá você edita seus dados, vê o questionário e pode excluir a conta.',
    link: { rotulo: 'Meu perfil', rota: '/perfil' },
  },
  {
    palavras: ['libras', 'letra', 'fonte', 'contraste', 'acessibilidade', 'leitura', 'voz', 'escuro', 'tema'],
    resposta: 'No topo tem o menu de acessibilidade (aumentar letra, contraste, leitura em voz e mais) e a lua/sol para o tema escuro. O botão azul de Libras fica na lateral; para fechar, toque em "Fechar Libras".',
  },
  {
    palavras: ['senha', 'login', 'entrar na conta', 'esqueci'],
    resposta: 'Na tela de login, toque em "Esqueci minha senha" e siga o e-mail que chegar.',
  },
  {
    palavras: ['assistente', 'guia', 'manual', 'ajuda'],
    resposta: 'Em "Meu perfil", na parte "Ajuda para usar o site", você escolhe entre este assistente e os guias passo a passo.',
    link: { rotulo: 'Meu perfil', rota: '/perfil' },
  },
];

export function responderPeloFaq(pergunta: string): MensagemAssistente {
  const t = normalizar(pergunta);
  let melhor: ItemFaq | null = null;
  let pontos = 0;
  for (const item of FAQ) {
    // palavra maior vale mais ("remarcar" ganha de "marcar")
    const p = item.palavras.filter((w) => t.includes(normalizar(w))).reduce((soma, w) => soma + w.length, 0);
    if (p > pontos) { pontos = p; melhor = item; }
  }
  if (!melhor) {
    return {
      autor: 'assistente', origem: 'faq',
      texto: 'Não encontrei uma resposta para isso. Tente com outras palavras, por exemplo: "como marco consulta?", "como entro na chamada?" ou "como posto no fórum?". Você também pode usar a barra de pesquisa lá em cima.',
    };
  }
  return { autor: 'assistente', origem: 'faq', texto: melhor.resposta, link: melhor.link };
}

/** Acha um atalho para a tela citada na resposta da IA (vira um botão embaixo da mensagem). */
export function linkCitado(texto: string): { rotulo: string; rota: string } | undefined {
  const t = normalizar(texto);
  const telas: [string, string, string][] = [
    ['marcar consulta', 'Marcar consulta', '/consultas-lista-psi'],
    ['minhas consultas', 'Minhas consultas', '/consultas'],
    ['questionario', 'Questionário', '/questionario'],
    ['forum', 'Fórum', '/forum'],
    ['eventos', 'Eventos', '/eventos'],
    ['carreiras', 'Carreiras', '/carreiras'],
    ['meu perfil', 'Meu perfil', '/perfil'],
    ['agenda', 'Agenda', '/agenda-mae'],
  ];
  const achado = telas.find(([chave]) => t.includes(chave));
  return achado ? { rotulo: achado[1], rota: achado[2] } : undefined;
}

// ------------------------------------------------------------------
// 2. Pergunta para a IA (pelo Worker)
// ------------------------------------------------------------------
export class AssistenteIndisponivel extends Error {}
export class LimiteAtingido extends Error {}

export async function perguntarParaIa(historico: MensagemAssistente[]): Promise<string> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new AssistenteIndisponivel('sem login');

  const mensagens = historico
    .filter((m) => m.origem !== 'apoio')            // pedidos de socorro não vão para a IA
    .slice(-8)
    .map((m) => ({ autor: m.autor, texto: m.texto }));

  let resp: Response;
  try {
    resp = await fetch(URL_ASSISTENTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ mensagens }),
    });
  } catch {
    throw new AssistenteIndisponivel('rede');
  }
  const corpo: any = await resp.json().catch(() => ({}));
  if (resp.status === 429) throw new LimiteAtingido(corpo?.message || 'Limite do dia atingido.');
  if (!resp.ok || !corpo?.resposta) throw new AssistenteIndisponivel(corpo?.code || String(resp.status));
  return String(corpo.resposta);
}

// ------------------------------------------------------------------
// Limite do dia (lado do site)
// ------------------------------------------------------------------
const CHAVE_USO = 'elo_assistente_uso';

export function usoDeHoje(): number {
  try {
    const u = JSON.parse(localStorage.getItem(CHAVE_USO) || 'null');
    return u?.dia === new Date().toDateString() ? Number(u.total) || 0 : 0;
  } catch { return 0; }
}

export function contarUso() {
  try {
    localStorage.setItem(CHAVE_USO, JSON.stringify({ dia: new Date().toDateString(), total: usoDeHoje() + 1 }));
  } catch { /* sem storage */ }
}
