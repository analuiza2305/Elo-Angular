/**
 * DivulgacaoService
 *
 * Tudo o que a empresa parceira pode CONTRATAR para ganhar visibilidade, e o que a
 * ADM controla sobre isso. Pagamentos 100% SIMULADOS (nenhuma cobrança real).
 *
 * Três tipos de item no catálogo (`modelo`):
 *   - 'pacote'  → visibilidade em TODAS as publicações (artigos e eventos) durante o período.
 *   - 'evento'  → impulsiona UM evento, com cobrança única por evento.
 *   - 'anuncio' → anúncio em um espaço estratégico da plataforma, com cobrança RECORRENTE.
 *
 * Níveis de visibilidade: 'basico' (todo mundo, grátis) < 'destaque' < 'premium'.
 * Nas listas, quem tem nível maior aparece primeiro e ganha um selo na publicação.
 *
 * Onde fica gravado:
 *   pacotesDivulgacao/{id}   = catálogo, gerenciado pela ADM
 *                              { modelo, nome, descricao, visibilidade, preco, periodicidade, duracaoDias,
 *                                beneficios[], posicoes[], ativo, destaque, ordem, criadoEm, atualizadoEm }
 *   pacotesContratados/{id}  = { parceiroId, nomeEmpresa, email, itemId, itemNome, visibilidade, valor,
 *                                periodicidade, duracaoDias, status: 'ativo' | 'cancelado', origem: 'simulado',
 *                                criadoEm, validoAte }
 *   eventos/{id}             = ganha { visibilidade, visibilidadeAte } (pacote ativo na hora de publicar,
 *                              ou impulsionamento). Artigos ganham os mesmos campos.
 *   anuncios/{id}            = { parceiroId, nomeEmpresa, itemId, itemNome, titulo, texto, imagem, link, posicao,
 *                                status: 'ativo' | 'pausado' | 'encerrado', inicio, fim, recorrente, valor,
 *                                periodicidade, duracaoDias, renovacoes, impressoes, cliques, criadoEm, atualizadoEm }
 *                              (os espaços estratégicos leem esta coleção e somam impressoes/cliques)
 *   pagamentosPlanos/{auto}  = cada cobrança simulada, com `categoria: 'pacote' | 'evento' | 'anuncio'`,
 *                              para entrar nos relatórios financeiros da ADM.
 */
import { Injectable } from '@angular/core';
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, writeBatch,
  serverTimestamp, increment, Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../core/firebase';
import { PERIODICIDADES, Periodicidade } from './plano';

// ============================================================
// TIPOS
// ============================================================

export type Visibilidade = 'basico' | 'destaque' | 'premium';
export type ModeloDivulgacao = 'pacote' | 'evento' | 'anuncio';
export type StatusAnuncio = 'ativo' | 'pausado' | 'encerrado';

export const VISIBILIDADES: { valor: Visibilidade; rotulo: string; icone: string; prioridade: number }[] = [
  { valor: 'basico', rotulo: 'Básico', icone: 'fa-seedling', prioridade: 0 },
  { valor: 'destaque', rotulo: 'Destaque', icone: 'fa-star', prioridade: 1 },
  { valor: 'premium', rotulo: 'Premium', icone: 'fa-crown', prioridade: 2 },
];

export const MODELOS_DIVULGACAO: { valor: ModeloDivulgacao; rotulo: string; singular: string; icone: string }[] = [
  { valor: 'pacote', rotulo: 'Pacotes de publicação', singular: 'Pacote', icone: 'fa-box-open' },
  { valor: 'evento', rotulo: 'Divulgação de eventos', singular: 'Evento', icone: 'fa-calendar-check' },
  { valor: 'anuncio', rotulo: 'Anúncios', singular: 'Anúncio', icone: 'fa-bullhorn' },
];

/** Espaços estratégicos onde um anúncio pode aparecer. */
export const POSICOES_ANUNCIO: { valor: string; rotulo: string; descricao: string }[] = [
  { valor: 'pos-avaliacao-mae', rotulo: 'Depois da avaliação (mãe)', descricao: 'Na tela que a mãe vê logo depois de avaliar o profissional.' },
  { valor: 'forum', rotulo: 'Fórum', descricao: 'Entre os posts da lista do fórum.' },
  { valor: 'artigos', rotulo: 'Comunidade', descricao: 'Entre os cartões da Comunidade e na página da postagem.' },
  { valor: 'eventos', rotulo: 'Eventos', descricao: 'Entre os cartões da lista de eventos.' },
  { valor: 'home-mae', rotulo: 'Home da mãe', descricao: 'Na página inicial da mãe.' },
  { valor: 'pos-avaliacao-profissional', rotulo: 'Depois da avaliação (psicólogo e advogado)', descricao: 'Na tela do profissional depois das consultas e da avaliação.' },
  { valor: 'painel-profissional', rotulo: 'Painel do profissional', descricao: 'No painel de psicólogos e advogados.' },
  { valor: 'painel-parceiro', rotulo: 'Painel do parceiro', descricao: 'No painel das empresas, depois de uma publicação.' },
];

export function rotuloPosicao(valor: string): string {
  return POSICOES_ANUNCIO.find((p) => p.valor === valor)?.rotulo ?? valor;
}

export function rotuloVisibilidade(v: Visibilidade): string {
  return VISIBILIDADES.find((x) => x.valor === v)?.rotulo ?? 'Básico';
}

export function prioridadeVisibilidade(v: Visibilidade | undefined | null): number {
  return VISIBILIDADES.find((x) => x.valor === v)?.prioridade ?? 0;
}

/**
 * Arruma o link que a empresa digitou. Vazio continua vazio; "www.site.com" vira "https://www.site.com";
 * qualquer outro esquema (javascript:, data:...) ou texto sem cara de endereço é recusado (null).
 */
export function normalizarUrl(valor: string | null | undefined): string | null {
  const t = (valor || '').trim();
  if (!t) return '';
  if (/^https?:\/\/\S+\.\S+$/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  if (/^\S+\.\S+$/.test(t)) return 'https://' + t.replace(/^\/+/, '');
  return null;
}

function ehVisibilidade(v: unknown): v is Visibilidade {
  return v === 'basico' || v === 'destaque' || v === 'premium';
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Nível de visibilidade que um artigo/evento tem AGORA.
 * Quando o pacote ou o impulsionamento acaba (`visibilidadeAte`), volta para o básico sozinho.
 */
export function visibilidadeEfetiva(item: any): Visibilidade {
  const v = item?.visibilidade;
  if (!ehVisibilidade(v) || v === 'basico') return 'basico';
  const ate = toDate(item?.visibilidadeAte);
  return !ate || ate.getTime() > Date.now() ? v : 'basico';
}

export interface ItemDivulgacao {
  id: string;
  modelo: ModeloDivulgacao;
  nome: string;
  descricao: string;
  visibilidade: Visibilidade;
  preco: number;
  /** Só pacote e anúncio (cobrança por período). No evento a cobrança é única. */
  periodicidade: Periodicidade;
  /** Quanto tempo o benefício dura (pacote: período; evento: dias de destaque; anúncio: período). */
  duracaoDias: number;
  beneficios: string[];
  /** Só anúncio: espaços que o item permite. */
  posicoes: string[];
  ativo: boolean;
  destaque: boolean;
  ordem: number;
  /** true = ainda não está gravado (catálogo vazio, usando o padrão). */
  padrao?: boolean;
}

export type ItemDivulgacaoForm = Pick<ItemDivulgacao,
  'modelo' | 'nome' | 'descricao' | 'visibilidade' | 'preco' | 'periodicidade' | 'duracaoDias' | 'beneficios' | 'posicoes' | 'ativo' | 'destaque'>;

export interface PerfilContratante {
  nome?: string;
  email?: string;
}

export interface PacoteContratado {
  id: string;
  parceiroId: string;
  nomeEmpresa: string;
  itemId: string;
  itemNome: string;
  visibilidade: Visibilidade;
  valor: number;
  periodicidade: Periodicidade;
  status: 'ativo' | 'cancelado';
  criadoEm: Date | null;
  validoAte: Date | null;
  /** Calculado: 'ativo' só se não foi cancelado e ainda está no prazo. */
  situacao: 'ativo' | 'expirado' | 'cancelado';
}

export interface Anuncio {
  id: string;
  parceiroId: string;
  nomeEmpresa: string;
  itemId: string;
  itemNome: string;
  titulo: string;
  texto: string;
  imagem: string;
  link: string;
  posicao: string;
  status: StatusAnuncio;
  inicio: Date | null;
  fim: Date | null;
  recorrente: boolean;
  valor: number;
  periodicidade: Periodicidade;
  duracaoDias: number;
  renovacoes: number;
  /** Quantas vezes o anúncio foi exibido e clicado (por pessoas que não são a dona do anúncio). */
  impressoes: number;
  cliques: number;
  criadoEm: Date | null;
  /** Calculado: no ar agora (ativo e dentro do prazo). */
  noAr: boolean;
}

export interface DadosAnuncio {
  titulo: string;
  texto: string;
  imagem: string;
  link: string;
  posicao: string;
}

export interface EventoDoParceiro {
  id: string;
  titulo: string;
  data: Date | null;
  visibilidade: Visibilidade;
  visibilidadeAte: Date | null;
}

/** Uma cobrança simulada, para a lista "Contratações" da ADM. */
export interface CobrancaDivulgacao {
  id: string;
  parceiroId: string;
  empresa: string;
  categoria: 'pacote' | 'evento' | 'anuncio';
  descricao: string;
  valor: number;
  criadoEm: Date | null;
  validoAte: Date | null;
}

// ============================================================
// ITENS PADRÃO (usados enquanto a ADM não cadastrar os dela)
// ============================================================

type ItemPadrao = Omit<ItemDivulgacao, 'id' | 'padrao'>;

const TODAS_POSICOES = POSICOES_ANUNCIO.map((p) => p.valor);

export const ITENS_PADRAO: Record<ModeloDivulgacao, ItemPadrao[]> = {
  pacote: [
    {
      modelo: 'pacote', nome: 'Destaque', descricao: 'Suas publicações aparecem antes das básicas.',
      visibilidade: 'destaque', preco: 79.9, periodicidade: 'mensal', duracaoDias: 30,
      beneficios: ['Postagens e eventos aparecem antes dos básicos nas listas', 'Selo "Em destaque" nas publicações'],
      posicoes: [], ativo: true, destaque: false, ordem: 1,
    },
    {
      modelo: 'pacote', nome: 'Premium', descricao: 'A maior visibilidade da plataforma.',
      visibilidade: 'premium', preco: 149.9, periodicidade: 'mensal', duracaoDias: 30,
      beneficios: ['Tudo do Destaque', 'Primeiras posições nas listas de postagens e eventos', 'Selo "Destaque Premium" nas publicações'],
      posicoes: [], ativo: true, destaque: true, ordem: 2,
    },
  ],
  evento: [
    {
      modelo: 'evento', nome: 'Evento em destaque', descricao: 'Impulsiona um evento por 15 dias.',
      visibilidade: 'destaque', preco: 29.9, periodicidade: 'mensal', duracaoDias: 15,
      beneficios: ['Evento aparece antes dos básicos', 'Selo "Em destaque" no evento'],
      posicoes: [], ativo: true, destaque: false, ordem: 1,
    },
    {
      modelo: 'evento', nome: 'Evento Premium', descricao: 'Primeiras posições por 30 dias.',
      visibilidade: 'premium', preco: 59.9, periodicidade: 'mensal', duracaoDias: 30,
      beneficios: ['Evento nas primeiras posições da lista', 'Selo "Destaque Premium" no evento'],
      posicoes: [], ativo: true, destaque: true, ordem: 2,
    },
  ],
  anuncio: [
    {
      modelo: 'anuncio', nome: 'Anúncio mensal', descricao: 'Seu anúncio em um espaço estratégico, renovado todo mês.',
      visibilidade: 'basico', preco: 99.9, periodicidade: 'mensal', duracaoDias: 30,
      beneficios: ['Anúncio em um espaço à sua escolha', 'Renovação automática (simulada) até você cancelar'],
      posicoes: TODAS_POSICOES, ativo: true, destaque: true, ordem: 1,
    },
  ],
};

function idPadrao(modelo: ModeloDivulgacao, i: number): string {
  return `padrao-${modelo}-${i + 1}`;
}

// ============================================================
// SERVIÇO
// ============================================================

@Injectable({ providedIn: 'root' })
export class DivulgacaoService {
  // ----------------------------------------------------------
  // CATÁLOGO (ADM)
  // ----------------------------------------------------------

  /** Todos os itens (ativos e inativos) — uso da ADM. */
  async itens(): Promise<ItemDivulgacao[]> {
    const snap = await getDocs(collection(db, 'pacotesDivulgacao'));
    return snap.docs
      .map((d) => this.normalizarItem(d.id, d.data()))
      .sort((a, b) => a.ordem - b.ordem || a.preco - b.preco);
  }

  /**
   * Itens que a área do parceiro deve mostrar para um modelo.
   * Se a ADM ainda não cadastrou nada desse modelo, usa os padrão.
   */
  async itensParaOfertar(modelo: ModeloDivulgacao): Promise<ItemDivulgacao[]> {
    try {
      const doModelo = (await this.itens()).filter((i) => i.modelo === modelo);
      if (!doModelo.length) return this.padraoComoLista(modelo);
      return doModelo.filter((i) => i.ativo);
    } catch (e) {
      console.warn('Não foi possível ler o catálogo de divulgação, usando o padrão', e);
      return this.padraoComoLista(modelo);
    }
  }

  async salvarItem(id: string | null, form: ItemDivulgacaoForm, ordem?: number): Promise<string> {
    const periodo = PERIODICIDADES.find((p) => p.valor === form.periodicidade) ?? PERIODICIDADES[0];
    const dados = {
      nome: form.nome.trim(),
      descricao: (form.descricao || '').trim(),
      visibilidade: form.modelo === 'anuncio' ? 'basico' : form.visibilidade,
      preco: Math.max(0, Math.round((Number(form.preco) || 0) * 100) / 100),
      periodicidade: form.periodicidade,
      duracaoDias: form.modelo === 'evento' ? Math.max(1, Math.round(Number(form.duracaoDias) || 15)) : periodo.dias,
      beneficios: form.beneficios.map((b) => b.trim()).filter(Boolean),
      posicoes: form.modelo === 'anuncio' ? form.posicoes.filter((p) => TODAS_POSICOES.includes(p)) : [],
      ativo: !!form.ativo,
      destaque: !!form.destaque,
      atualizadoEm: serverTimestamp(),
    };
    if (id) {
      await updateDoc(doc(db, 'pacotesDivulgacao', id), dados);
      return id;
    }
    const ref = doc(collection(db, 'pacotesDivulgacao'));
    await setDoc(ref, { ...dados, modelo: form.modelo, ordem: ordem ?? 99, criadoEm: serverTimestamp() });
    return ref.id;
  }

  async definirAtivo(id: string, ativo: boolean): Promise<void> {
    await updateDoc(doc(db, 'pacotesDivulgacao', id), { ativo, atualizadoEm: serverTimestamp() });
  }

  /** Grava os itens padrão de um modelo (quando a ADM quer partir deles para editar). */
  async criarPadrao(modelo: ModeloDivulgacao): Promise<void> {
    const lote = writeBatch(db);
    ITENS_PADRAO[modelo].forEach((p) => {
      lote.set(doc(collection(db, 'pacotesDivulgacao')), { ...p, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
    });
    await lote.commit();
  }

  // ----------------------------------------------------------
  // PACOTES (parceiro)
  // ----------------------------------------------------------

  /**
   * Contrata um pacote (pagamento SIMULADO). Se já existe um pacote ativo do mesmo item,
   * o novo período soma em cima do que sobrou.
   */
  async contratarPacote(uid: string, perfil: PerfilContratante, item: ItemDivulgacao): Promise<PacoteContratado> {
    if (item.modelo !== 'pacote') throw new Error('Este item não é um pacote.');
    const atuais = await this.pacotesDo(uid);
    const mesmo = atuais.find((p) => p.situacao === 'ativo' && p.itemId === item.id && p.validoAte);
    const base = mesmo?.validoAte && mesmo.validoAte.getTime() > Date.now() ? mesmo.validoAte.getTime() : Date.now();
    const validoAte = new Date(base + item.duracaoDias * 86400000);

    const ref = doc(collection(db, 'pacotesContratados'));
    const lote = writeBatch(db);
    lote.set(ref, {
      parceiroId: uid, nomeEmpresa: perfil.nome || '', email: perfil.email || '',
      itemId: item.id, itemNome: item.nome, visibilidade: item.visibilidade,
      valor: item.preco, periodicidade: item.periodicidade, duracaoDias: item.duracaoDias,
      status: 'ativo', origem: 'simulado', criadoEm: serverTimestamp(), validoAte: Timestamp.fromDate(validoAte),
    });
    this.registrarPagamento(lote, uid, perfil, item, 'pacote', validoAte, `Pacote ${item.nome}`);
    await lote.commit();
    return {
      id: ref.id, parceiroId: uid, nomeEmpresa: perfil.nome || '', itemId: item.id, itemNome: item.nome,
      visibilidade: item.visibilidade, valor: item.preco, periodicidade: item.periodicidade,
      status: 'ativo', criadoEm: new Date(), validoAte, situacao: 'ativo',
    };
  }

  /** Pacotes da empresa, do mais recente para o mais antigo. */
  async pacotesDo(uid: string): Promise<PacoteContratado[]> {
    if (!uid) return [];
    const snap = await getDocs(query(collection(db, 'pacotesContratados'), where('parceiroId', '==', uid)));
    return snap.docs
      .map((d) => this.normalizarPacote(d.id, d.data()))
      .sort((a, b) => (b.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
  }

  /** Cancelar encerra o benefício na hora (e não há devolução: o pagamento é simulado). */
  async cancelarPacote(id: string): Promise<void> {
    await updateDoc(doc(db, 'pacotesContratados', id), { status: 'cancelado', canceladoEm: serverTimestamp() });
  }

  /**
   * Visibilidade que as NOVAS publicações da empresa recebem: a do melhor pacote ativo.
   * `ate` é quando esse pacote acaba (guardado na publicação para ela voltar ao básico depois).
   */
  async visibilidadeAtual(uid: string): Promise<{ visibilidade: Visibilidade; ate: Date | null }> {
    try {
      const ativos = (await this.pacotesDo(uid)).filter((p) => p.situacao === 'ativo');
      if (!ativos.length) return { visibilidade: 'basico', ate: null };
      const melhor = ativos.sort((a, b) =>
        prioridadeVisibilidade(b.visibilidade) - prioridadeVisibilidade(a.visibilidade)
        || (b.validoAte?.getTime() ?? 0) - (a.validoAte?.getTime() ?? 0))[0];
      return { visibilidade: melhor.visibilidade, ate: melhor.validoAte };
    } catch (e) {
      console.warn('Não foi possível ler os pacotes da empresa', e);
      return { visibilidade: 'basico', ate: null };
    }
  }

  // ----------------------------------------------------------
  // DIVULGAÇÃO DE EVENTOS (cobrança por evento)
  // ----------------------------------------------------------

  async eventosDo(uid: string, nomeEmpresa = ''): Promise<EventoDoParceiro[]> {
    if (!uid) return [];
    const mapa = new Map<string, EventoDoParceiro>();
    const ler = (d: any) => {
      const x = d.data();
      mapa.set(d.id, {
        id: d.id, titulo: x['titulo'] || 'Evento sem título', data: toDate(x['data'] ?? x['date']),
        visibilidade: visibilidadeEfetiva(x), visibilidadeAte: toDate(x['visibilidadeAte']),
      });
    };
    (await getDocs(query(collection(db, 'eventos'), where('parceiroId', '==', uid)))).docs.forEach(ler);
    if (nomeEmpresa) {
      // eventos antigos só têm o nome da empresa
      (await getDocs(query(collection(db, 'eventos'), where('enviadoPor', '==', nomeEmpresa)))).docs.forEach(ler);
    }
    return [...mapa.values()].sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0));
  }

  /** Impulsiona um evento da empresa (pagamento SIMULADO, cobrado uma vez por evento). */
  async impulsionarEvento(uid: string, perfil: PerfilContratante, eventoId: string, item: ItemDivulgacao): Promise<Date> {
    if (item.modelo !== 'evento') throw new Error('Este item não é de divulgação de evento.');
    const ref = doc(db, 'eventos', eventoId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Evento não encontrado.');
    const x = snap.data();
    const dono = x['parceiroId'] === uid || (!!perfil.nome && x['enviadoPor'] === perfil.nome);
    if (!dono) throw new Error('Este evento não é da sua empresa.');

    const atual = toDate(x['visibilidadeAte']);
    const mesmoNivelAtivo = visibilidadeEfetiva(x) === item.visibilidade && atual && atual.getTime() > Date.now();
    const base = mesmoNivelAtivo ? atual!.getTime() : Date.now();
    const ate = new Date(base + item.duracaoDias * 86400000);

    const lote = writeBatch(db);
    lote.update(ref, {
      visibilidade: item.visibilidade, visibilidadeAte: Timestamp.fromDate(ate), impulsionadoEm: serverTimestamp(),
    });
    this.registrarPagamento(lote, uid, perfil, item, 'evento', ate, `${item.nome} — ${x['titulo'] || 'evento'}`);
    await lote.commit();
    return ate;
  }

  // ----------------------------------------------------------
  // ANÚNCIOS (cobrança recorrente simulada)
  // ----------------------------------------------------------

  async contratarAnuncio(uid: string, perfil: PerfilContratante, item: ItemDivulgacao, d: DadosAnuncio): Promise<string> {
    if (item.modelo !== 'anuncio') throw new Error('Este item não é um anúncio.');
    if (item.posicoes.length && !item.posicoes.includes(d.posicao)) throw new Error('Espaço não disponível neste anúncio.');
    const inicio = new Date();
    const fim = new Date(inicio.getTime() + item.duracaoDias * 86400000);
    const ref = doc(collection(db, 'anuncios'));
    const lote = writeBatch(db);
    lote.set(ref, {
      parceiroId: uid, nomeEmpresa: perfil.nome || '', itemId: item.id, itemNome: item.nome,
      titulo: d.titulo.trim(), texto: d.texto.trim(), imagem: normalizarUrl(d.imagem) ?? '', link: normalizarUrl(d.link) ?? '', posicao: d.posicao,
      status: 'ativo', inicio: Timestamp.fromDate(inicio), fim: Timestamp.fromDate(fim),
      recorrente: true, valor: item.preco, periodicidade: item.periodicidade, duracaoDias: item.duracaoDias,
      renovacoes: 0, origem: 'simulado', criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
    });
    this.registrarPagamento(lote, uid, perfil, item, 'anuncio', fim, `Anúncio — ${d.titulo.trim()}`);
    await lote.commit();
    return ref.id;
  }

  /** Anúncios de uma empresa (ou de todas, sem `uid`) — mais recentes primeiro. */
  async anuncios(uid?: string): Promise<Anuncio[]> {
    const ref = collection(db, 'anuncios');
    const snap = await getDocs(uid ? query(ref, where('parceiroId', '==', uid)) : ref);
    return snap.docs
      .map((d) => this.normalizarAnuncio(d.id, d.data()))
      .sort((a, b) => (b.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
  }

  /** Todos os anúncios cadastrados em um espaço (qualquer situação). */
  private async anunciosDoEspaco(posicao: string): Promise<Anuncio[]> {
    const snap = await getDocs(query(collection(db, 'anuncios'), where('posicao', '==', posicao)));
    return snap.docs.map((d) => this.normalizarAnuncio(d.id, d.data()));
  }

  /** Anúncios no ar em um espaço (para os espaços estratégicos exibirem). */
  async anunciosNoAr(posicao: string): Promise<Anuncio[]> {
    return (await this.anunciosDoEspaco(posicao)).filter((a) => a.noAr);
  }

  private cacheEspacos = new Map<string, { em: number; lista: Promise<Anuncio[]> }>();
  private impressoesRegistradas = new Set<string>();

  /**
   * Escolhe UM anúncio no ar para exibir em um espaço (ou null, e então o espaço some).
   * A lista de cada espaço fica guardada por 2 minutos, para não ler o Firestore a cada tela.
   * Havendo vários anúncios no mesmo espaço, sorteia entre eles.
   *
   * Escreve no console (linhas "[Anúncio]") o que encontrou, para facilitar achar o motivo
   * quando um espaço fica vazio.
   */
  async anuncioParaExibir(posicao: string): Promise<Anuncio | null> {
    const rotulo = `[Anúncio] espaço "${posicao}":`;
    try {
      // Espera o Firebase terminar de reconhecer quem está logado. Sem isso, a busca sai no
      // carregamento da página ainda como "visitante" e o Firestore nega a leitura dos anúncios.
      await auth.authStateReady();
      if (!auth.currentUser) {
        console.log(rotulo, 'ninguém logado, então não busca anúncio.');
        return null;
      }

      const guardado = this.cacheEspacos.get(posicao);
      let lista: Promise<Anuncio[]>;
      if (guardado && Date.now() - guardado.em < 2 * 60 * 1000) lista = guardado.lista;
      else {
        // se a busca falhar, NÃO guarda a falha: a próxima tela tenta de novo
        lista = this.anunciosDoEspaco(posicao).catch((e) => {
          this.cacheEspacos.delete(posicao);
          throw e;
        });
        this.cacheEspacos.set(posicao, { em: Date.now(), lista });
      }
      const todos = await lista;
      const noAr = todos.filter((a) => a.noAr);
      console.log(rotulo, `${todos.length} anúncio(s) cadastrado(s) neste espaço, ${noAr.length} no ar.`,
        todos.map((a) => ({ titulo: a.titulo, status: a.status, ate: a.fim?.toLocaleString('pt-BR') ?? '—', noAr: a.noAr })));
      return noAr.length ? noAr[Math.floor(Math.random() * noAr.length)] : null;
    } catch (e) {
      // sem permissão ou sem rede: o espaço simplesmente não aparece
      console.warn(rotulo, 'não foi possível carregar o anúncio.', e);
      return null;
    }
  }

  /** Soma 1 exibição (uma vez por anúncio a cada visita ao site; a empresa dona não conta). */
  async registrarImpressao(a: Anuncio): Promise<void> {
    if (this.impressoesRegistradas.has(a.id) || a.parceiroId === auth.currentUser?.uid) return;
    this.impressoesRegistradas.add(a.id);
    try {
      await updateDoc(doc(db, 'anuncios', a.id), { impressoes: increment(1) });
    } catch (e) {
      console.warn('Não foi possível registrar a exibição', e);
    }
  }

  /** Soma 1 clique (a empresa dona não conta). */
  async registrarClique(a: Anuncio): Promise<void> {
    if (a.parceiroId === auth.currentUser?.uid) return;
    try {
      await updateDoc(doc(db, 'anuncios', a.id), { cliques: increment(1) });
    } catch (e) {
      console.warn('Não foi possível registrar o clique', e);
    }
  }

  /** A empresa corrige o texto, a imagem e o link do próprio anúncio (o espaço e o prazo continuam os mesmos). */
  async editarAnuncio(id: string, d: Omit<DadosAnuncio, 'posicao'>): Promise<void> {
    await updateDoc(doc(db, 'anuncios', id), {
      titulo: d.titulo.trim(), texto: d.texto.trim(),
      imagem: normalizarUrl(d.imagem) ?? '', link: normalizarUrl(d.link) ?? '',
      atualizadoEm: serverTimestamp(),
    });
  }

  /** Liga/desliga a renovação automática (simulada) do anúncio. */
  async definirRecorrencia(id: string, recorrente: boolean): Promise<void> {
    await updateDoc(doc(db, 'anuncios', id), { recorrente, atualizadoEm: serverTimestamp() });
  }

  async definirStatusAnuncio(id: string, status: StatusAnuncio): Promise<void> {
    await updateDoc(doc(db, 'anuncios', id), {
      status, atualizadoEm: serverTimestamp(),
      ...(status === 'encerrado' ? { recorrente: false, encerradoEm: serverTimestamp() } : {}),
    });
  }

  /** Uso da ADM: ajusta status, data final, espaço e recorrência do anúncio. */
  async ajustarAnuncio(id: string, ajustes: { status: StatusAnuncio; fim: Date | null; posicao: string; recorrente: boolean }): Promise<void> {
    await updateDoc(doc(db, 'anuncios', id), {
      status: ajustes.status,
      posicao: ajustes.posicao,
      recorrente: ajustes.status === 'encerrado' ? false : ajustes.recorrente,
      ...(ajustes.fim ? { fim: Timestamp.fromDate(ajustes.fim) } : {}),
      atualizadoEm: serverTimestamp(),
    });
  }

  /**
   * Cobrança recorrente SIMULADA: para cada anúncio ativo cujo período acabou,
   * renova (cobra de novo e estende o prazo) se a recorrência está ligada, ou encerra se não.
   * Roda quando a empresa abre a aba. Devolve quantos anúncios foram renovados.
   */
  async processarRecorrencias(uid: string, perfil: PerfilContratante): Promise<number> {
    let renovados = 0;
    const lista = await this.anuncios(uid);
    for (const a of lista) {
      if (a.status !== 'ativo' || !a.fim || a.fim.getTime() > Date.now()) continue;
      const ref = doc(db, 'anuncios', a.id);
      if (!a.recorrente) {
        await updateDoc(ref, { status: 'encerrado', encerradoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
        continue;
      }
      const dias = a.duracaoDias || 30;
      const novoFim = new Date(Date.now() + dias * 86400000);
      const lote = writeBatch(db);
      lote.update(ref, { fim: Timestamp.fromDate(novoFim), renovacoes: a.renovacoes + 1, atualizadoEm: serverTimestamp() });
      lote.set(doc(collection(db, 'pagamentosPlanos')), {
        uid, nome: perfil.nome || '', email: perfil.email || '', tipo: 'parceiro',
        planoId: a.itemId, planoNome: `Renovação — ${a.itemNome}`, valor: a.valor, periodicidade: a.periodicidade,
        duracaoDias: dias, status: 'pago', origem: 'simulado', categoria: 'anuncio',
        descricao: `Renovação do anúncio ${a.titulo}`, criadoEm: serverTimestamp(), validoAte: Timestamp.fromDate(novoFim),
      });
      await lote.commit();
      renovados++;
    }
    return renovados;
  }

  // ----------------------------------------------------------
  // PARA A ADM: tudo que foi contratado
  // ----------------------------------------------------------

  async todosPacotes(): Promise<PacoteContratado[]> {
    const snap = await getDocs(collection(db, 'pacotesContratados'));
    return snap.docs
      .map((d) => this.normalizarPacote(d.id, d.data()))
      .sort((a, b) => (b.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
  }

  /** Todas as cobranças simuladas de divulgação (pacotes, eventos, anúncios e renovações). */
  async cobrancas(): Promise<CobrancaDivulgacao[]> {
    const snap = await getDocs(query(collection(db, 'pagamentosPlanos'), where('categoria', 'in', ['pacote', 'evento', 'anuncio'])));
    return snap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id, parceiroId: x['uid'] || '', empresa: x['nome'] || '—',
          categoria: x['categoria'] as CobrancaDivulgacao['categoria'],
          descricao: x['descricao'] || x['planoNome'] || '',
          valor: Number(x['valor']) || 0, criadoEm: toDate(x['criadoEm']), validoAte: toDate(x['validoAte']),
        };
      })
      .sort((a, b) => (b.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
  }

  // ----------------------------------------------------------
  // INTERNOS
  // ----------------------------------------------------------

  private registrarPagamento(
    lote: ReturnType<typeof writeBatch>, uid: string, perfil: PerfilContratante, item: ItemDivulgacao,
    categoria: 'pacote' | 'evento' | 'anuncio', validoAte: Date, descricao: string,
  ): void {
    lote.set(doc(collection(db, 'pagamentosPlanos')), {
      uid, nome: perfil.nome || '', email: perfil.email || '', tipo: 'parceiro',
      planoId: item.id, planoNome: item.nome, valor: item.preco, periodicidade: item.periodicidade,
      duracaoDias: item.duracaoDias, status: 'pago', origem: 'simulado', categoria, descricao,
      criadoEm: serverTimestamp(), validoAte: Timestamp.fromDate(validoAte),
    });
  }

  private padraoComoLista(modelo: ModeloDivulgacao): ItemDivulgacao[] {
    return ITENS_PADRAO[modelo].map((p, i) => ({ ...p, id: idPadrao(modelo, i), padrao: true }));
  }

  private normalizarItem(id: string, d: any): ItemDivulgacao {
    const modelo: ModeloDivulgacao = d['modelo'] === 'evento' || d['modelo'] === 'anuncio' ? d['modelo'] : 'pacote';
    const periodicidade: Periodicidade = PERIODICIDADES.some((p) => p.valor === d['periodicidade']) ? d['periodicidade'] : 'mensal';
    return {
      id, modelo,
      nome: d['nome'] || 'Item sem nome',
      descricao: d['descricao'] || '',
      visibilidade: ehVisibilidade(d['visibilidade']) ? d['visibilidade'] : 'destaque',
      preco: Number(d['preco']) || 0,
      periodicidade,
      duracaoDias: Number(d['duracaoDias']) || PERIODICIDADES.find((p) => p.valor === periodicidade)!.dias,
      beneficios: Array.isArray(d['beneficios']) ? d['beneficios'] : [],
      posicoes: Array.isArray(d['posicoes']) ? d['posicoes'] : [],
      ativo: d['ativo'] !== false,
      destaque: d['destaque'] === true,
      ordem: Number(d['ordem']) || 99,
    };
  }

  private normalizarPacote(id: string, d: any): PacoteContratado {
    const validoAte = toDate(d['validoAte']);
    const status: 'ativo' | 'cancelado' = d['status'] === 'cancelado' ? 'cancelado' : 'ativo';
    const situacao: PacoteContratado['situacao'] =
      status === 'cancelado' ? 'cancelado' : !validoAte || validoAte.getTime() > Date.now() ? 'ativo' : 'expirado';
    return {
      id, parceiroId: d['parceiroId'] || '', nomeEmpresa: d['nomeEmpresa'] || '',
      itemId: d['itemId'] || '', itemNome: d['itemNome'] || 'Pacote',
      visibilidade: ehVisibilidade(d['visibilidade']) ? d['visibilidade'] : 'destaque',
      valor: Number(d['valor']) || 0, periodicidade: d['periodicidade'] || 'mensal',
      status, criadoEm: toDate(d['criadoEm']), validoAte, situacao,
    };
  }

  private normalizarAnuncio(id: string, d: any): Anuncio {
    const status: StatusAnuncio = d['status'] === 'pausado' || d['status'] === 'encerrado' ? d['status'] : 'ativo';
    const fim = toDate(d['fim']);
    const inicio = toDate(d['inicio']);
    return {
      id, parceiroId: d['parceiroId'] || '', nomeEmpresa: d['nomeEmpresa'] || '',
      itemId: d['itemId'] || '', itemNome: d['itemNome'] || 'Anúncio',
      titulo: d['titulo'] || '', texto: d['texto'] || '', imagem: d['imagem'] || '', link: d['link'] || '',
      posicao: d['posicao'] || '', status, inicio, fim,
      recorrente: d['recorrente'] === true, valor: Number(d['valor']) || 0,
      periodicidade: d['periodicidade'] || 'mensal', duracaoDias: Number(d['duracaoDias']) || 30,
      renovacoes: Number(d['renovacoes']) || 0,
      impressoes: Number(d['impressoes']) || 0, cliques: Number(d['cliques']) || 0,
      criadoEm: toDate(d['criadoEm']),
      noAr: status === 'ativo' && (!inicio || inicio.getTime() <= Date.now()) && (!fim || fim.getTime() > Date.now()),
    };
  }
}
