/**
 * PlanoService
 *
 * Concentra tudo o que é "plano" no EloMaterno:
 *  - catálogo de planos (coleção `planos`, gerenciado pelo ADM);
 *  - assinatura atual de cada profissional (`assinaturas/{uid}`);
 *  - histórico de compras (`pagamentosPlanos`), que alimenta os relatórios do ADM;
 *  - custos mensais informados pelo ADM (`custosPlataforma/{yyyy-MM}`).
 *
 * Os métodos antigos (temPremium, temSelo, assinatura, premiumAtivos) continuam
 * com a mesma assinatura: as telas que já usam o serviço não mudam.
 *
 * Onde fica gravado:
 *   planos/{id}                = { nome, descricao, publico: 'psicologo' | 'advogado' | 'parceiro',
 *                                  nivel: 'gratuito' | 'premium', preco, periodicidade,
 *                                  duracaoDias, beneficios[], ativo, destaque, ordem, criadoEm, atualizadoEm }
 *   assinaturas/{uid}          = { plano: 'premium' | 'gratuito', ativo, validoAte, selos[],
 *                                  planoId, planoNome, valor, periodicidade, nome, email, tipo,
 *                                  iniciadaEm, canceladaEm, pagamento, atualizadoEm }
 *   pagamentosPlanos/{auto}    = { uid, nome, email, tipo, planoId, planoNome, valor, periodicidade,
 *                                  duracaoDias, status: 'pago', origem: 'simulado', criadoEm, validoAte }
 *   custosPlataforma/{yyyy-MM} = { valor, atualizadoEm }
 *
 * Fica separado do documento do psicólogo porque hoje qualquer pessoa logada
 * consegue editar `psicologos/*`.
 */
import { Injectable } from '@angular/core';
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, writeBatch,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../core/firebase';

// ============================================================
// TIPOS
// ============================================================

export type NivelPlano = 'gratuito' | 'premium';
export type Periodicidade = 'mensal' | 'trimestral' | 'semestral' | 'anual';
export type TipoProfissional = 'psicologo' | 'advogado';

/**
 * Para quem o plano é. Cada público tem o seu próprio catálogo (gratuito + pagos):
 * psicólogos e advogados (profissionais) e empresas parceiras.
 * Planos antigos, gravados antes deste campo existir, valem para 'psicologo'.
 */
export type PublicoPlano = 'psicologo' | 'advogado' | 'parceiro';

export const PUBLICOS_PLANO: { valor: PublicoPlano; rotulo: string; singular: string }[] = [
  { valor: 'psicologo', rotulo: 'Psicólogos', singular: 'Psicólogo(a)' },
  { valor: 'advogado', rotulo: 'Advogados', singular: 'Advogado(a)' },
  { valor: 'parceiro', rotulo: 'Parceiros', singular: 'Empresa parceira' },
];

export function rotuloPublico(p: string): string {
  return PUBLICOS_PLANO.find((x) => x.valor === p)?.singular ?? 'Psicólogo(a)';
}

export function ehPublicoPlano(v: unknown): v is PublicoPlano {
  return v === 'psicologo' || v === 'advogado' || v === 'parceiro';
}

export const PERIODICIDADES: { valor: Periodicidade; rotulo: string; dias: number; sufixo: string }[] = [
  { valor: 'mensal', rotulo: 'Mensal', dias: 30, sufixo: '/mês' },
  { valor: 'trimestral', rotulo: 'Trimestral', dias: 90, sufixo: '/trimestre' },
  { valor: 'semestral', rotulo: 'Semestral', dias: 180, sufixo: '/semestre' },
  { valor: 'anual', rotulo: 'Anual', dias: 365, sufixo: '/ano' },
];

export function sufixoPeriodicidade(p: Periodicidade): string {
  return PERIODICIDADES.find((x) => x.valor === p)?.sufixo ?? '/mês';
}

export function formatarBRL(valor: number): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export interface Assinatura {
  plano: 'premium' | 'gratuito';
  ativo: boolean;
  validoAte?: Date | null;
  selos?: string[];
  planoId?: string;
  planoNome?: string;
  valor?: number;
  periodicidade?: Periodicidade;
  iniciadaEm?: Date | null;
  canceladaEm?: Date | null;
}

export interface Plano {
  id: string;
  nome: string;
  descricao: string;
  /** Para quem o plano é (psicólogo, advogado ou parceiro). */
  publico: PublicoPlano;
  nivel: NivelPlano;
  preco: number;
  periodicidade: Periodicidade;
  duracaoDias: number;
  beneficios: string[];
  ativo: boolean;
  destaque: boolean;
  ordem: number;
  criadoEm?: Date | null;
  atualizadoEm?: Date | null;
  /** true quando o catálogo ainda está vazio e a tela usa os planos padrão (não gravados). */
  padrao?: boolean;
}

/** Campos que o ADM edita no formulário. */
export type PlanoForm = Pick<Plano, 'nome' | 'descricao' | 'publico' | 'nivel' | 'preco' | 'periodicidade' | 'beneficios' | 'ativo' | 'destaque'>;

export interface PerfilProfissional {
  uid: string;
  nome: string;
  email: string;
  tipo: PublicoPlano;
  aprovado: boolean;
}

export interface PagamentoPlano {
  id: string;
  uid: string;
  nome: string;
  email: string;
  tipo: PublicoPlano;
  planoId: string;
  planoNome: string;
  valor: number;
  periodicidade: Periodicidade;
  status: 'pago';
  origem: string;
  /** 'plano' (assinatura) ou uma cobrança de divulgação (pacote, evento, anúncio). */
  categoria?: 'plano' | 'pacote' | 'evento' | 'anuncio';
  criadoEm: Date | null;
  validoAte: Date | null;
}

export type SituacaoAssinante = 'ativa' | 'expirada' | 'cancelada';

/** Uma linha da lista "quem adquiriu cada plano" no ADM. */
export interface Assinante {
  uid: string;
  nome: string;
  email: string;
  tipo: PublicoPlano;
  planoId: string;
  planoNome: string;
  valor: number;
  periodicidade: Periodicidade;
  adquiridoEm: Date | null;
  validoAte: Date | null;
  situacao: SituacaoAssinante;
  compras: number;
  totalPago: number;
}

export interface MesFinanceiro {
  chave: string;        // 'yyyy-MM'
  rotulo: string;       // 'Novembro 2026'
  rotuloCurto: string;  // 'nov/26'
  receita: number;
  custos: number;
  lucro: number;
  vendas: number;
}

export interface RelatorioFinanceiro {
  meses: MesFinanceiro[];                 // últimos meses terminando no selecionado (para o gráfico)
  atual: MesFinanceiro;
  anterior: MesFinanceiro | null;
  porPlano: { planoId: string; planoNome: string; receita: number; vendas: number }[];
  assinantesPorPlano: { planoId: string; planoNome: string; ativos: number }[];
  assinaturasAtivas: number;
  custosInformados: boolean;
  pagamentosDoMes: PagamentoPlano[];
}

// ============================================================
// PLANOS PADRÃO (um par Gratuito + Premium para cada público)
// ============================================================

type PlanoPadrao = Omit<Plano, 'id' | 'criadoEm' | 'atualizadoEm'>;

const BENEFICIOS_GRATUITO = [
  'Perfil na busca de profissionais',
  'Agenda, videochamada e chat com as mães',
  'Lembretes de consulta por e-mail',
  'Certificado de horas mensal',
  'Declaração de comparecimento (CFP)',
];

const BENEFICIOS_PREMIUM = [
  'Tudo do plano gratuito',
  'Destaque na busca e selo Premium no perfil',
  'Modelos de atestado, relatório, laudo e parecer (Resolução CFP 06/2019)',
  'Preenchimento automático com os dados das consultas',
  'Relatório de atendimentos em PDF',
];

const BENEFICIOS_GRATUITO_ADV = [
  'Perfil na busca de profissionais',
  'Agenda, videochamada e chat com as mães',
  'Lembretes de consulta por e-mail',
  'Declaração de comparecimento a atendimento jurídico',
];

const BENEFICIOS_PREMIUM_ADV = [
  'Tudo do plano gratuito',
  'Destaque na busca e selo Premium no perfil',
  'Modelos de procuração, contrato de honorários, notificação extrajudicial, parecer e termo de consentimento',
  'Preenchimento automático com os dados das consultas',
  'Relatório de atendimentos em PDF',
];

// Os benefícios das empresas parceiras serão refinados junto com a aba de Planos do parceiro.
const BENEFICIOS_GRATUITO_PARC = [
  'Perfil da empresa na plataforma',
  'Publicação de artigos e eventos',
];

const BENEFICIOS_PREMIUM_PARC = [
  'Tudo do plano gratuito',
  'Selo Apoiador no perfil da empresa',
  'Mais visibilidade nas publicações e nos eventos',
];

function par(publico: PublicoPlano, gratuito: string[], premium: string[], descGratuito: string, descPremium: string, preco: number): PlanoPadrao[] {
  return [
    {
      nome: 'Gratuito', descricao: descGratuito, publico, nivel: 'gratuito',
      preco: 0, periodicidade: 'mensal', duracaoDias: 30, beneficios: gratuito,
      ativo: true, destaque: false, ordem: 1,
    },
    {
      nome: 'Premium', descricao: descPremium, publico, nivel: 'premium',
      preco, periodicidade: 'mensal', duracaoDias: 30, beneficios: premium,
      ativo: true, destaque: true, ordem: 2,
    },
  ];
}

export const PLANOS_PADRAO_POR_PUBLICO: Record<PublicoPlano, PlanoPadrao[]> = {
  psicologo: par('psicologo', BENEFICIOS_GRATUITO, BENEFICIOS_PREMIUM,
    'Para começar a atender pela plataforma.', 'Mais visibilidade e ferramentas para o seu consultório.', 29.9),
  advogado: par('advogado', BENEFICIOS_GRATUITO_ADV, BENEFICIOS_PREMIUM_ADV,
    'Para começar a atender pela plataforma.', 'Mais visibilidade e documentos prontos para o seu escritório.', 29.9),
  parceiro: par('parceiro', BENEFICIOS_GRATUITO_PARC, BENEFICIOS_PREMIUM_PARC,
    'Para a sua empresa aparecer na plataforma.', 'Mais destaque e o selo Apoiador para a sua empresa.', 49.9),
};

/** Planos padrão dos psicólogos (mantido porque a tela do psicólogo já importa este nome). */
export const PLANOS_PADRAO: PlanoPadrao[] = PLANOS_PADRAO_POR_PUBLICO.psicologo;

/** Id "de mentira" dos planos padrão. Os do psicólogo mantêm os ids antigos. */
function idPadrao(publico: PublicoPlano, nivel: NivelPlano): string {
  const base = nivel === 'gratuito' ? 'padrao-gratuito' : 'padrao-premium';
  return publico === 'psicologo' ? base : `${base}-${publico}`;
}

// ============================================================
// SERVIÇO
// ============================================================

@Injectable({ providedIn: 'root' })
export class PlanoService {
  private cache = new Map<string, Assinatura | null>();

  // ----------------------------------------------------------
  // ASSINATURA DO PROFISSIONAL (API que já existia)
  // ----------------------------------------------------------

  /** Assinatura atual do profissional (ou null se nunca assinou). */
  async assinatura(uid: string): Promise<Assinatura | null> {
    if (!uid) return null;
    if (this.cache.has(uid)) return this.cache.get(uid)!;
    try {
      const snap = await getDoc(doc(db, 'assinaturas', uid));
      const a = snap.exists() ? this.normalizar(snap.data()) : null;
      this.cache.set(uid, a);
      return a;
    } catch (e) {
      console.warn('Não foi possível ler a assinatura', e);
      return null;
    }
  }

  async temPremium(uid: string): Promise<boolean> {
    return this.estaAtiva(await this.assinatura(uid), 'premium');
  }

  /** Selos pagos à parte (ex.: 'destaque'). O selo "Bem avaliado" NÃO vem daqui: é por mérito. */
  async temSelo(uid: string, selo: string): Promise<boolean> {
    const a = await this.assinatura(uid);
    return !!a && this.estaAtiva(a) && (a.selos || []).includes(selo);
  }

  /** Uids de todos os profissionais Premium ativos (uma leitura, para listas). */
  async premiumAtivos(): Promise<Set<string>> {
    const ativos = new Set<string>();
    try {
      const snap = await getDocs(query(collection(db, 'assinaturas'), where('ativo', '==', true)));
      snap.docs.forEach((d) => {
        const a = this.normalizar(d.data());
        this.cache.set(d.id, a);
        if (this.estaAtiva(a, 'premium')) ativos.add(d.id);
      });
    } catch (e) {
      console.warn('Não foi possível ler as assinaturas', e);
    }
    return ativos;
  }

  /**
   * Uids com plano Premium ativo e o tipo de cada um (psicólogo, advogado ou parceiro).
   * Serve para decidir qual selo mostrar: Premium de profissional = "Destaque",
   * Premium de empresa parceira = "Apoiador". Assinaturas antigas, sem tipo, são de psicólogos.
   */
  async premiumAtivosPorTipo(): Promise<Map<string, PublicoPlano>> {
    const mapa = new Map<string, PublicoPlano>();
    try {
      const snap = await getDocs(query(collection(db, 'assinaturas'), where('ativo', '==', true)));
      snap.docs.forEach((d) => {
        const x = d.data();
        const a = this.normalizar(x);
        this.cache.set(d.id, a);
        if (this.estaAtiva(a, 'premium')) mapa.set(d.id, ehPublicoPlano(x['tipo']) ? x['tipo'] : 'psicologo');
      });
    } catch (e) {
      console.warn('Não foi possível ler as assinaturas', e);
    }
    return mapa;
  }

  /**
   * Compra de um plano pelo profissional logado.
   * Pagamento SIMULADO (sem cobrança real): grava a assinatura e registra a
   * compra em `pagamentosPlanos` na mesma operação, para o ADM controlar quem
   * adquiriu o quê e para o relatório de lucros.
   * Se o Premium ainda está ativo, a nova validade soma em cima da atual.
   */
  async assinarPlano(
    uid: string,
    plano: Pick<Plano, 'id' | 'nome' | 'nivel' | 'preco' | 'periodicidade' | 'duracaoDias'> & { publico?: PublicoPlano },
    perfil: { nome?: string; email?: string; tipo?: PublicoPlano } = {},
  ): Promise<Assinatura> {
    if (plano.nivel !== 'premium') throw new Error('Só planos pagos podem ser assinados.');
    const atual = await this.assinatura(uid);
    const dias = plano.duracaoDias || 30;
    const base = atual && this.estaAtiva(atual, 'premium') && atual.validoAte && atual.validoAte.getTime() > Date.now()
      ? atual.validoAte.getTime()
      : Date.now();
    const validoAte = new Date(base + dias * 24 * 60 * 60 * 1000);

    const lote = writeBatch(db);
    lote.set(doc(db, 'assinaturas', uid), {
      plano: 'premium',
      ativo: true,
      validoAte: Timestamp.fromDate(validoAte),
      selos: atual?.selos || [],
      planoId: plano.id,
      planoNome: plano.nome,
      valor: plano.preco,
      periodicidade: plano.periodicidade,
      nome: perfil.nome || '',
      email: perfil.email || '',
      tipo: perfil.tipo || plano.publico || 'psicologo',
      iniciadaEm: serverTimestamp(),
      canceladaEm: null,
      pagamento: 'simulado',
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    lote.set(doc(collection(db, 'pagamentosPlanos')), {
      uid,
      nome: perfil.nome || '',
      email: perfil.email || '',
      tipo: perfil.tipo || plano.publico || 'psicologo',
      planoId: plano.id,
      planoNome: plano.nome,
      valor: plano.preco,
      periodicidade: plano.periodicidade,
      duracaoDias: dias,
      status: 'pago',
      origem: 'simulado',
      criadoEm: serverTimestamp(),
      validoAte: Timestamp.fromDate(validoAte),
    });
    await lote.commit();

    const nova: Assinatura = {
      plano: 'premium', ativo: true, validoAte, selos: atual?.selos || [],
      planoId: plano.id, planoNome: plano.nome, valor: plano.preco, periodicidade: plano.periodicidade,
      iniciadaEm: new Date(), canceladaEm: null,
    };
    this.cache.set(uid, nova);
    return nova;
  }

  /** @deprecated use assinarPlano(). Mantido para quem ainda chama o método antigo. */
  async assinarPremiumTeste(uid: string, dias = 30, publico: PublicoPlano = 'psicologo'): Promise<Assinatura> {
    const padrao = PLANOS_PADRAO_POR_PUBLICO[publico].find((p) => p.nivel === 'premium')!;
    return this.assinarPlano(uid, { ...padrao, id: idPadrao(publico, 'premium'), duracaoDias: dias }, { tipo: publico });
  }

  /** Volta para o plano gratuito (mantém o histórico no mesmo documento). */
  async cancelarPremium(uid: string): Promise<Assinatura> {
    const atual = await this.assinatura(uid);
    await setDoc(doc(db, 'assinaturas', uid), {
      plano: 'gratuito',
      ativo: false,
      validoAte: null,
      selos: atual?.selos || [],
      canceladaEm: serverTimestamp(),
      pagamento: 'simulado',
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    const nova: Assinatura = {
      plano: 'gratuito', ativo: false, validoAte: null, selos: atual?.selos || [],
      planoId: atual?.planoId, planoNome: atual?.planoNome, valor: atual?.valor,
      periodicidade: atual?.periodicidade, iniciadaEm: atual?.iniciadaEm ?? null, canceladaEm: new Date(),
    };
    this.cache.set(uid, nova);
    return nova;
  }

  // ----------------------------------------------------------
  // CATÁLOGO DE PLANOS
  // ----------------------------------------------------------

  /** Todos os planos (ativos e inativos) — uso do ADM. */
  async planos(): Promise<Plano[]> {
    const snap = await getDocs(collection(db, 'planos'));
    return snap.docs
      .map((d) => this.normalizarPlano(d.id, d.data()))
      .sort((a, b) => a.ordem - b.ordem || a.preco - b.preco);
  }

  /**
   * Planos que a área de cada público (psicólogo, advogado ou parceiro) deve mostrar.
   * Se o ADM ainda não cadastrou nenhum plano PARA ESSE PÚBLICO, usa os planos padrão,
   * para a tela não quebrar. Com planos cadastrados, só os ativos.
   */
  async planosParaOfertar(publico: PublicoPlano = 'psicologo'): Promise<Plano[]> {
    try {
      const doPublico = (await this.planos()).filter((p) => p.publico === publico);
      if (!doPublico.length) return this.planosPadraoComoLista(publico);
      return doPublico.filter((p) => p.ativo);
    } catch (e) {
      console.warn('Não foi possível ler os planos, usando os padrões', e);
      return this.planosPadraoComoLista(publico);
    }
  }

  /** Cria (id nulo) ou atualiza um plano. Devolve o id. */
  async salvarPlano(id: string | null, form: PlanoForm, ordem?: number): Promise<string> {
    const periodo = PERIODICIDADES.find((p) => p.valor === form.periodicidade) ?? PERIODICIDADES[0];
    const dados = {
      nome: form.nome.trim(),
      descricao: (form.descricao || '').trim(),
      nivel: form.nivel,
      preco: form.nivel === 'gratuito' ? 0 : Math.round((Number(form.preco) || 0) * 100) / 100,
      periodicidade: form.periodicidade,
      duracaoDias: periodo.dias,
      beneficios: form.beneficios.map((b) => b.trim()).filter(Boolean),
      ativo: form.nivel === 'gratuito' ? true : !!form.ativo,
      destaque: !!form.destaque,
      atualizadoEm: serverTimestamp(),
    };
    if (id) {
      await updateDoc(doc(db, 'planos', id), dados);
      return id;
    }
    const ref = doc(collection(db, 'planos'));
    await setDoc(ref, { ...dados, publico: ehPublicoPlano(form.publico) ? form.publico : 'psicologo', ordem: ordem ?? 99, criadoEm: serverTimestamp() });
    return ref.id;
  }

  /** Ativa/desativa um plano. Quem já assina continua com o plano até a validade acabar. */
  async definirAtivo(id: string, ativo: boolean): Promise<void> {
    await updateDoc(doc(db, 'planos', id), { ativo, atualizadoEm: serverTimestamp() });
  }

  /** Grava os planos padrão (Gratuito + Premium) de um público quando ele ainda não tem planos. */
  async criarPlanosPadrao(publico: PublicoPlano = 'psicologo'): Promise<void> {
    const lote = writeBatch(db);
    PLANOS_PADRAO_POR_PUBLICO[publico].forEach((p) => {
      lote.set(doc(collection(db, 'planos')), { ...p, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
    });
    await lote.commit();
  }

  // ----------------------------------------------------------
  // CONTROLE DE QUEM ADQUIRE CADA PLANO (ADM)
  // ----------------------------------------------------------

  /** Perfis de psicólogos e advogados, indexados por uid (para mostrar nome/e-mail do assinante). */
  async perfisProfissionais(): Promise<Map<string, PerfilProfissional>> {
    const mapa = new Map<string, PerfilProfissional>();
    const colecoes: { nome: string; tipo: PublicoPlano }[] = [
      { nome: 'psicologos', tipo: 'psicologo' },
      { nome: 'advogados', tipo: 'advogado' },
      { nome: 'parceiros', tipo: 'parceiro' },
    ];
    await Promise.all(colecoes.map(async (c) => {
      try {
        const snap = await getDocs(collection(db, c.nome));
        snap.docs.forEach((d) => {
          const x = d.data();
          const uid = (x['uid'] as string) || d.id;
          mapa.set(uid, {
            uid, tipo: c.tipo, nome: x['nomeEmpresa'] || x['nome'] || '', email: x['email'] || '',
            aprovado: x['status'] === 'aprovado',
          });
        });
      } catch (e) {
        console.warn(`Não foi possível ler ${c.nome}`, e);
      }
    }));
    return mapa;
  }

  /** Histórico de compras (mais recentes primeiro). `desde` limita o período lido. */
  async pagamentos(desde?: Date): Promise<PagamentoPlano[]> {
    const ref = collection(db, 'pagamentosPlanos');
    const snap = await getDocs(desde ? query(ref, where('criadoEm', '>=', Timestamp.fromDate(desde))) : ref);
    return snap.docs
      .map((d) => this.normalizarPagamento(d.id, d.data()))
      .sort((a, b) => (b.criadoEm?.getTime() ?? 0) - (a.criadoEm?.getTime() ?? 0));
  }

  /**
   * Todos os profissionais que já adquiriram algum plano pago, com situação,
   * plano e quanto já pagaram. Assinaturas antigas (sem planoId) são ligadas ao
   * primeiro plano Premium do catálogo.
   */
  async assinantes(planos?: Plano[]): Promise<Assinante[]> {
    const [snap, perfis, pagamentos, catalogo] = await Promise.all([
      getDocs(collection(db, 'assinaturas')),
      this.perfisProfissionais(),
      this.pagamentos(),
      planos ? Promise.resolve(planos) : this.planos(),
    ]);
    const premiumDoTipo = (tipo: PublicoPlano) => catalogo.find((p) => p.nivel === 'premium' && p.publico === tipo);
    const porUid = new Map<string, PagamentoPlano[]>();
    // só as compras de PLANO contam aqui (pacotes, eventos e anúncios têm a sua própria lista)
    pagamentos
      .filter((p) => (p.categoria ?? 'plano') === 'plano')
      .forEach((p) => porUid.set(p.uid, [...(porUid.get(p.uid) || []), p]));

    const linhas: Assinante[] = [];
    snap.docs.forEach((d) => {
      const x = d.data();
      const a = this.normalizar(x);
      const compras = porUid.get(d.id) || [];
      // só entra quem realmente adquiriu algo (Premium, cancelou ou tem compra registrada)
      if (a.plano !== 'premium' && !a.canceladaEm && !compras.length) return;

      const perfil = perfis.get(d.id);
      const tipo: PublicoPlano = ehPublicoPlano(x['tipo']) ? x['tipo'] : (perfil?.tipo || 'psicologo');
      const planoId = a.planoId || premiumDoTipo(tipo)?.id || '';
      const planoCat = catalogo.find((p) => p.id === planoId);
      let situacao: SituacaoAssinante;
      if (this.estaAtiva(a, 'premium')) situacao = 'ativa';
      else if (a.ativo && a.plano === 'premium') situacao = 'expirada';
      else if (a.canceladaEm) situacao = 'cancelada';
      else situacao = 'expirada';

      linhas.push({
        uid: d.id,
        nome: (x['nome'] as string) || perfil?.nome || 'Profissional sem nome',
        email: (x['email'] as string) || perfil?.email || '—',
        tipo,
        planoId,
        planoNome: a.planoNome || planoCat?.nome || 'Premium',
        valor: a.valor ?? planoCat?.preco ?? 0,
        periodicidade: a.periodicidade || planoCat?.periodicidade || 'mensal',
        adquiridoEm: a.iniciadaEm || compras[compras.length - 1]?.criadoEm || null,
        validoAte: a.validoAte || null,
        situacao,
        compras: compras.length,
        totalPago: compras.reduce((s, p) => s + p.valor, 0),
      });
    });
    return linhas.sort((a, b) => (b.adquiridoEm?.getTime() ?? 0) - (a.adquiridoEm?.getTime() ?? 0));
  }

  // ----------------------------------------------------------
  // RELATÓRIO FINANCEIRO (lucros)
  // ----------------------------------------------------------

  /** Custos informados pelo ADM, por mês ('yyyy-MM' → valor). */
  async custosMensais(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    try {
      const snap = await getDocs(collection(db, 'custosPlataforma'));
      snap.docs.forEach((d) => { out[d.id] = Number(d.data()['valor']) || 0; });
    } catch (e) {
      console.warn('Não foi possível ler os custos', e);
    }
    return out;
  }

  async salvarCustoMensal(chave: string, valor: number): Promise<void> {
    await setDoc(doc(db, 'custosPlataforma', chave), {
      valor: Math.max(0, Math.round((Number(valor) || 0) * 100) / 100),
      atualizadoEm: serverTimestamp(),
    });
  }

  /** Meses para o seletor do relatório (mais recente primeiro). */
  mesesDisponiveis(quantidade = 12): { chave: string; rotulo: string }[] {
    const hoje = new Date();
    return Array.from({ length: quantidade }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      return { chave: this.chaveMes(d), rotulo: this.rotuloMes(d) };
    });
  }

  /** Quanto tempo de histórico precisamos ler para montar o gráfico de um mês. */
  inicioDoHistorico(chaveMes: string, meses = 7): Date {
    const [y, m] = chaveMes.split('-').map(Number);
    return new Date(y, m - 1 - (meses - 1), 1);
  }

  /** Agrega pagamentos + custos + assinantes no formato que a aba Relatórios exibe. */
  montarRelatorio(
    pagamentos: PagamentoPlano[],
    custos: Record<string, number>,
    assinantes: Assinante[],
    chaveMes: string,
    mesesNoGrafico = 6,
  ): RelatorioFinanceiro {
    const [y, m] = chaveMes.split('-').map(Number);
    const resumoDe = (data: Date): MesFinanceiro => {
      const chave = this.chaveMes(data);
      const doMes = pagamentos.filter((p) => p.criadoEm && this.chaveMes(p.criadoEm) === chave);
      const receita = doMes.reduce((s, p) => s + p.valor, 0);
      const c = custos[chave] ?? 0;
      return {
        chave, rotulo: this.rotuloMes(data), rotuloCurto: this.rotuloCurto(data),
        receita, custos: c, lucro: receita - c, vendas: doMes.length,
      };
    };

    const meses = Array.from({ length: mesesNoGrafico }, (_, i) =>
      resumoDe(new Date(y, m - 1 - (mesesNoGrafico - 1 - i), 1)));
    const atual = meses[meses.length - 1];
    const anterior = meses.length > 1 ? meses[meses.length - 2] : null;

    const pagamentosDoMes = pagamentos.filter((p) => p.criadoEm && this.chaveMes(p.criadoEm) === atual.chave);
    const agrupado = new Map<string, { planoId: string; planoNome: string; receita: number; vendas: number }>();
    pagamentosDoMes.forEach((p) => {
      const g = agrupado.get(p.planoId) || { planoId: p.planoId, planoNome: p.planoNome, receita: 0, vendas: 0 };
      g.receita += p.valor;
      g.vendas += 1;
      agrupado.set(p.planoId, g);
    });

    const ativos = assinantes.filter((a) => a.situacao === 'ativa');
    const porPlano = new Map<string, { planoId: string; planoNome: string; ativos: number }>();
    ativos.forEach((a) => {
      const g = porPlano.get(a.planoId) || { planoId: a.planoId, planoNome: a.planoNome, ativos: 0 };
      g.ativos += 1;
      porPlano.set(a.planoId, g);
    });

    return {
      meses, atual, anterior,
      porPlano: [...agrupado.values()].sort((a, b) => b.receita - a.receita),
      assinantesPorPlano: [...porPlano.values()].sort((a, b) => b.ativos - a.ativos),
      assinaturasAtivas: ativos.length,
      custosInformados: custos[atual.chave] !== undefined,
      pagamentosDoMes,
    };
  }

  // ----------------------------------------------------------
  // INTERNOS
  // ----------------------------------------------------------

  private planosPadraoComoLista(publico: PublicoPlano = 'psicologo'): Plano[] {
    return PLANOS_PADRAO_POR_PUBLICO[publico].map((p) => ({ ...p, id: idPadrao(publico, p.nivel), padrao: true }));
  }

  private estaAtiva(a: Assinatura | null, plano?: Assinatura['plano']): boolean {
    if (!a || !a.ativo) return false;
    if (plano && a.plano !== plano) return false;
    return !a.validoAte || a.validoAte.getTime() > Date.now();
  }

  private data(v: any): Date | null {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  private normalizar(d: any): Assinatura {
    return {
      plano: d['plano'] === 'premium' ? 'premium' : 'gratuito',
      ativo: d['ativo'] === true,
      validoAte: this.data(d['validoAte']),
      selos: Array.isArray(d['selos']) ? d['selos'] : [],
      planoId: d['planoId'] || undefined,
      planoNome: d['planoNome'] || undefined,
      valor: typeof d['valor'] === 'number' ? d['valor'] : undefined,
      periodicidade: d['periodicidade'] || undefined,
      iniciadaEm: this.data(d['iniciadaEm']),
      canceladaEm: this.data(d['canceladaEm']),
    };
  }

  private normalizarPlano(id: string, d: any): Plano {
    const periodicidade: Periodicidade = PERIODICIDADES.some((p) => p.valor === d['periodicidade']) ? d['periodicidade'] : 'mensal';
    return {
      id,
      nome: d['nome'] || 'Plano sem nome',
      descricao: d['descricao'] || '',
      publico: ehPublicoPlano(d['publico']) ? d['publico'] : 'psicologo',
      nivel: d['nivel'] === 'gratuito' ? 'gratuito' : 'premium',
      preco: Number(d['preco']) || 0,
      periodicidade,
      duracaoDias: Number(d['duracaoDias']) || PERIODICIDADES.find((p) => p.valor === periodicidade)!.dias,
      beneficios: Array.isArray(d['beneficios']) ? d['beneficios'] : [],
      ativo: d['ativo'] !== false,
      destaque: d['destaque'] === true,
      ordem: Number(d['ordem']) || 99,
      criadoEm: this.data(d['criadoEm']),
      atualizadoEm: this.data(d['atualizadoEm']),
    };
  }

  private normalizarPagamento(id: string, d: any): PagamentoPlano {
    return {
      id,
      uid: d['uid'] || '',
      nome: d['nome'] || '',
      email: d['email'] || '',
      tipo: ehPublicoPlano(d['tipo']) ? d['tipo'] : 'psicologo',
      planoId: d['planoId'] || '',
      planoNome: d['planoNome'] || 'Premium',
      valor: Number(d['valor']) || 0,
      periodicidade: d['periodicidade'] || 'mensal',
      status: 'pago',
      origem: d['origem'] || 'simulado',
      categoria: ['pacote', 'evento', 'anuncio'].includes(d['categoria']) ? d['categoria'] : 'plano',
      criadoEm: this.data(d['criadoEm']),
      validoAte: this.data(d['validoAte']),
    };
  }

  private chaveMes(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private rotuloMes(d: Date): string {
    const t = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1).replace(' de ', ' ');
  }

  private rotuloCurto(d: Date): string {
    const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    return `${mes}/${String(d.getFullYear()).slice(2)}`;
  }
}
