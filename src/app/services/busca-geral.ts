import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../core/firebase';

/**
 * Busca da barra de pesquisa do topo (área da mãe).
 * Junta páginas do site, artigos da Comunidade, posts do fórum, eventos e profissionais,
 * e filtra aqui no navegador (sem acento e sem diferenciar maiúscula/minúscula).
 * Os dados ficam guardados por 5 minutos para não ler o banco a cada letra digitada.
 */
export type TipoResultado = 'pagina' | 'artigo' | 'post' | 'evento' | 'profissional';

export interface ResultadoBusca {
  tipo: TipoResultado;
  titulo: string;
  detalhe: string;
  rota: string;
  queryParams?: Record<string, string>;
  /** Texto usado para comparar (título + detalhes, já normalizado). */
  chave: string;
}

export const ROTULO_TIPO: Record<TipoResultado, string> = {
  pagina: 'Páginas',
  artigo: 'Comunidade',
  post: 'Fórum',
  evento: 'Eventos',
  profissional: 'Profissionais',
};

export const ICONE_TIPO: Record<TipoResultado, string> = {
  pagina: 'fa-solid fa-compass',
  artigo: 'fa-regular fa-newspaper',
  post: 'fa-regular fa-comments',
  evento: 'fa-regular fa-calendar',
  profissional: 'fa-solid fa-user-doctor',
};

export function normalizar(txt: string): string {
  return String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const PAGINAS: Omit<ResultadoBusca, 'chave'>[] = [
  { tipo: 'pagina', titulo: 'Marcar consulta', detalhe: 'Psicóloga ou advogada, de graça', rota: '/consultas-lista-psi' },
  { tipo: 'pagina', titulo: 'Minhas consultas', detalhe: 'Entrar na chamada, histórico, cancelar', rota: '/consultas' },
  { tipo: 'pagina', titulo: 'Agenda', detalhe: 'Consultas e eventos no calendário', rota: '/agenda-mae' },
  { tipo: 'pagina', titulo: 'Fórum', detalhe: 'Conversar com outras mães', rota: '/forum' },
  { tipo: 'pagina', titulo: 'Eventos', detalhe: 'Palestras, oficinas e encontros', rota: '/eventos' },
  { tipo: 'pagina', titulo: 'Comunidade', detalhe: 'Artigos, dicas e conteúdos', rota: '/artigos' },
  { tipo: 'pagina', titulo: 'Carreiras', detalhe: 'Vagas de emprego e cursos', rota: '/carreiras' },
  { tipo: 'pagina', titulo: 'Mensagens (chat)', detalhe: 'Conversar com a profissional', rota: '/chat' },
  { tipo: 'pagina', titulo: 'Meu perfil', detalhe: 'Dados, questionário de bem-estar', rota: '/perfil' },
  { tipo: 'pagina', titulo: 'Questionário de bem-estar', detalhe: 'Contar como você está', rota: '/questionario' },
  { tipo: 'pagina', titulo: 'Artigos salvos', detalhe: 'Seus favoritos', rota: '/artigos-favoritos' },
];

let cache: { quando: number; itens: ResultadoBusca[] } | null = null;
let carregando: Promise<ResultadoBusca[]> | null = null;

function comChave(r: Omit<ResultadoBusca, 'chave'>): ResultadoBusca {
  return { ...r, chave: normalizar(`${r.titulo} ${r.detalhe}`) };
}

async function lerColecao(nome: string, ordenarPor?: string, max = 150) {
  try {
    const q = ordenarPor
      ? query(collection(db, nome), orderBy(ordenarPor, 'desc'), limit(max))
      : query(collection(db, nome), limit(max));
    return (await getDocs(q)).docs;
  } catch (e) {
    console.warn(`Busca: não foi possível ler "${nome}"`, e);
    return [];
  }
}

async function carregarTudo(): Promise<ResultadoBusca[]> {
  const [artigos, posts, eventos, psis, advs] = await Promise.all([
    lerColecao('artigos'),
    lerColecao('posts', 'data', 100),
    lerColecao('eventos'),
    lerColecao('psicologos'),
    lerColecao('advogados'),
  ]);

  const itens: ResultadoBusca[] = PAGINAS.map(comChave);
  const removido = (d: any) => !!d?.['moderacao']?.removido;

  artigos.forEach((s) => {
    const d: any = s.data();
    if (removido(d) || !d.titulo) return;
    itens.push(comChave({ tipo: 'artigo', titulo: d.titulo, detalhe: d.resumo || d.postadoPor || '', rota: '/artigo_ind', queryParams: { id: s.id } }));
  });
  posts.forEach((s) => {
    const d: any = s.data();
    if (removido(d)) return;
    const titulo = d.titulo || String(d.conteudo || d.texto || '').slice(0, 60);
    if (!titulo) return;
    itens.push(comChave({ tipo: 'post', titulo, detalhe: String(d.conteudo || d.texto || '').slice(0, 90), rota: '/comentResp', queryParams: { postId: s.id } }));
  });
  eventos.forEach((s) => {
    const d: any = s.data();
    if (removido(d) || !d.titulo) return;
    itens.push(comChave({ tipo: 'evento', titulo: d.titulo, detalhe: d.local || d.enviadoPor || '', rota: '/eventos' }));
  });
  const aprovado = (d: any) => String(d?.status || '').toLowerCase() === 'aprovado';
  psis.forEach((s) => {
    const d: any = s.data();
    if (!aprovado(d) || !d.nome) return;
    const esp = Array.isArray(d.especializacoes) ? d.especializacoes.join(', ') : '';
    itens.push(comChave({ tipo: 'profissional', titulo: d.nome, detalhe: `Psicóloga(o)${esp ? ' · ' + esp : ''}`, rota: '/perfil-psi', queryParams: { uid: d.uid || s.id } }));
  });
  advs.forEach((s) => {
    const d: any = s.data();
    if (!aprovado(d) || !d.nome) return;
    itens.push(comChave({ tipo: 'profissional', titulo: d.nome, detalhe: `Advogada(o)${d.atuacao ? ' · ' + d.atuacao : ''}`, rota: '/perfil-adv', queryParams: { uid: d.uid || s.id } }));
  });
  return itens;
}

/** Devolve até `max` resultados para o termo (páginas primeiro, depois o resto). */
export async function buscarNoSite(termo: string, max = 12): Promise<ResultadoBusca[]> {
  const t = normalizar(termo);
  if (t.length < 2) return [];

  if (!cache || Date.now() - cache.quando > 5 * 60 * 1000) {
    carregando ??= carregarTudo().finally(() => (carregando = null));
    cache = { quando: Date.now(), itens: await carregando };
  }

  const palavras = t.split(/\s+/).filter(Boolean);
  const ordem: TipoResultado[] = ['pagina', 'profissional', 'evento', 'artigo', 'post'];
  return cache.itens
    .filter((r) => palavras.every((p) => r.chave.includes(p)))
    .map((r) => ({ r, peso: ordem.indexOf(r.tipo) * 10 + (normalizar(r.titulo).startsWith(t) ? 0 : 5) }))
    .sort((a, b) => a.peso - b.peso)
    .slice(0, max)
    .map((x) => x.r);
}
