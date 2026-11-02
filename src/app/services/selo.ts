/**
 * SeloService
 *
 * Gerenciamento de selos do EloMaterno (usado pelo ADM).
 *
 * Regra de ouro: o que é PAGO e o que é MÉRITO nunca se misturam.
 *
 *   PAGO   (origem 'plano' ou 'cortesia')
 *     - 'destaque'  → psicólogos e advogados. Vem do plano Premium ativo
 *                     ou de uma cortesia dada pelo ADM (com validade).
 *     - 'apoiador'  → empresas parceiras. Vem do plano Premium ativo
 *                     (quando os planos de parceiros existirem) ou de cortesia.
 *
 *   MÉRITO (origem 'merito')
 *     - 'bem-avaliado' → calculado automaticamente pelas avaliações das mães
 *                        (services/reputacao.ts). Ninguém concede nem compra:
 *                        o ADM só pode SUSPENDER (ex.: infração) ou restaurar.
 *
 * Onde fica gravado:
 *   selosConcedidos/{uid}__{selo} = { uid, perfil, nome, email, selo, origem: 'cortesia' | 'merito',
 *                                     status: 'ativo' | 'revogado', concedidoEm, validoAte,
 *                                     concedidoPor, motivo, revogadoEm, revogadoPor, motivoRevogacao }
 *   - para 'destaque' e 'apoiador' o documento é uma cortesia (status 'ativo') ou uma revogação;
 *   - para 'bem-avaliado' o documento só existe quando o selo foi SUSPENDIDO (status 'revogado').
 *
 *   selosPublicos/{uid} = { uid, destaqueCortesia, destaqueAte, apoiadorCortesia, apoiadorAte,
 *                           meritoSuspenso, atualizadoEm }
 *   - espelho SEM dados sensíveis (sem motivo, e-mail ou quem concedeu), que as telas públicas leem.
 *     Quem escreve nele é só o ADM, sempre junto com `selosConcedidos`, na mesma operação.
 *
 * As assinaturas (`assinaturas/{uid}`) continuam sendo lidas, nunca alteradas aqui.
 */
import { Injectable } from '@angular/core';
import {
  collection, doc, getDoc, getDocs, serverTimestamp, Timestamp, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../core/firebase';
import { carregarReputacoesDeTodos, Reputacao, SELO_BEM_AVALIADO } from './reputacao';

// ============================================================
// TIPOS E CATÁLOGO
// ============================================================

export type TipoSelo = 'destaque' | 'apoiador' | 'bem-avaliado';
export type PerfilSelo = 'psicologo' | 'advogado' | 'parceiro';
export type OrigemSelo = 'plano' | 'cortesia' | 'merito';
export type SituacaoSelo = 'ativo' | 'expirado' | 'revogado' | 'suspenso' | 'em_progresso';

export interface DefinicaoSelo {
  tipo: TipoSelo;
  nome: string;
  icone: string;
  /** 'pago' = benefício de plano/cortesia. 'merito' = conquistado, nunca vendido. */
  natureza: 'pago' | 'merito';
  perfis: PerfilSelo[];
  descricao: string;
  /** O que a pessoa ganha com o selo (aparece na visão geral do ADM). */
  efeitos: string[];
}

export const SELOS: DefinicaoSelo[] = [
  {
    tipo: 'destaque', nome: 'Destaque', icone: 'fa-star', natureza: 'pago',
    perfis: ['psicologo', 'advogado'],
    descricao: 'Perfil em destaque na busca de profissionais.',
    efeitos: ['Aparece antes dos demais na busca', 'Selo Premium no perfil e nos cartões'],
  },
  {
    tipo: 'apoiador', nome: 'Apoiador', icone: 'fa-handshake-angle', natureza: 'pago',
    perfis: ['parceiro'],
    descricao: 'Reconhece a empresa parceira que apoia a plataforma.',
    efeitos: ['Selo de apoiador no perfil da empresa', 'Maior visibilidade nas divulgações'],
  },
  {
    tipo: 'bem-avaliado', nome: 'Bem avaliado pelas mães', icone: 'fa-heart', natureza: 'merito',
    perfis: ['psicologo', 'advogado'],
    descricao: 'Conquistado pelas avaliações das mães. Não pode ser comprado nem concedido.',
    efeitos: ['Selo no perfil e nos cartões', 'Filtro “Bem avaliados” na busca', 'Melhor posição por reputação'],
  },
];

export function definicaoSelo(tipo: TipoSelo): DefinicaoSelo {
  return SELOS.find((s) => s.tipo === tipo)!;
}

export function rotuloPerfil(p: PerfilSelo): string {
  return p === 'advogado' ? 'Advogado(a)' : p === 'parceiro' ? 'Empresa parceira' : 'Psicólogo(a)';
}

/** Opções de validade da cortesia (dias). `null` = sem data para acabar. */
export const VALIDADES_CORTESIA: { dias: number | null; rotulo: string }[] = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '3 meses' },
  { dias: 180, rotulo: '6 meses' },
  { dias: 365, rotulo: '1 ano' },
  { dias: null, rotulo: 'Sem data final' },
];

/** Uma pessoa/empresa que pode receber selos. */
export interface PessoaSelo {
  uid: string;
  perfil: PerfilSelo;
  nome: string;
  email: string;
  /** Status do cadastro (aprovado, pendente...). */
  statusCadastro: string;
}

/** Uma linha das tabelas: um selo (ou a falta dele) para uma pessoa. */
export interface AtribuicaoSelo {
  chave: string;               // `${uid}__${selo}`
  pessoa: PessoaSelo;
  selo: TipoSelo;
  origem: OrigemSelo;
  situacao: SituacaoSelo;
  desde: Date | null;
  validoAte: Date | null;
  concedidoPor: string;
  motivo: string;              // motivo da cortesia ou da suspensão
  planoNome?: string;
  /** Só para mérito: números que explicam a conquista. */
  reputacao?: Reputacao;
}

export interface DadosSelos {
  pessoas: PessoaSelo[];
  atribuicoes: AtribuicaoSelo[];
}

/** O que as telas públicas precisam saber de um uid (já considera a validade da cortesia). */
export interface SelosPublicos {
  destaque: boolean;       // cortesia de destaque ativa (o plano Premium é lido à parte, pelo PlanoService)
  apoiador: boolean;       // cortesia de apoiador ativa
  meritoSuspenso: boolean; // ADM suspendeu o selo "Bem avaliado"
}

export const SELOS_PUBLICOS_VAZIO: SelosPublicos = { destaque: false, apoiador: false, meritoSuspenso: false };

interface Assinatura {
  ativo: boolean;
  plano: string;
  validoAte: Date | null;
  planoNome: string;
  iniciadaEm: Date | null;
}

interface Concessao {
  uid: string;
  selo: TipoSelo;
  origem: string;
  status: 'ativo' | 'revogado';
  concedidoEm: Date | null;
  validoAte: Date | null;
  concedidoPor: string;
  motivo: string;
  motivoRevogacao: string;
}

// ============================================================
// SERVIÇO
// ============================================================

@Injectable({ providedIn: 'root' })
export class SeloService {

  // ----------------------------------------------------------
  // LEITURA (ADM)
  // ----------------------------------------------------------

  /** Carrega tudo o que a tela de selos precisa em uma só passada. */
  async carregar(): Promise<DadosSelos> {
    const [psis, advs, parcs, assin, conc, reputacoes] = await Promise.all([
      getDocs(collection(db, 'psicologos')),
      getDocs(collection(db, 'advogados')),
      getDocs(collection(db, 'parceiros')),
      getDocs(collection(db, 'assinaturas')),
      getDocs(collection(db, 'selosConcedidos')),
      carregarReputacoesDeTodos().catch(() => new Map<string, Reputacao>()),
    ]);

    const pessoas: PessoaSelo[] = [];
    const juntar = (snap: typeof psis, perfil: PerfilSelo) => snap.docs.forEach((d) => {
      const x = d.data();
      const status = String(x['status'] || 'pendente');
      if (status === 'recusado') return;
      pessoas.push({
        uid: String(x['uid'] || d.id),
        perfil,
        nome: String(x['nomeEmpresa'] || x['nome'] || 'Sem nome'),
        email: String(x['email'] || ''),
        statusCadastro: status,
      });
    });
    juntar(psis, 'psicologo');
    juntar(advs, 'advogado');
    juntar(parcs, 'parceiro');
    pessoas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const assinaturas = new Map<string, Assinatura>();
    assin.docs.forEach((d) => {
      const x = d.data();
      assinaturas.set(d.id, {
        ativo: x['ativo'] === true,
        plano: String(x['plano'] || 'gratuito'),
        validoAte: this.data(x['validoAte']),
        planoNome: String(x['planoNome'] || 'Premium'),
        iniciadaEm: this.data(x['iniciadaEm']),
      });
    });

    const concessoes = new Map<string, Concessao>();
    conc.docs.forEach((d) => {
      const x = d.data();
      const selo = x['selo'] as TipoSelo;
      if (!SELOS.some((s) => s.tipo === selo)) return;
      concessoes.set(d.id, {
        uid: String(x['uid'] || ''),
        selo,
        origem: String(x['origem'] || 'cortesia'),
        status: x['status'] === 'revogado' ? 'revogado' : 'ativo',
        concedidoEm: this.data(x['concedidoEm']),
        validoAte: this.data(x['validoAte']),
        concedidoPor: String(x['concedidoPor'] || ''),
        motivo: String(x['motivo'] || ''),
        motivoRevogacao: String(x['motivoRevogacao'] || ''),
      });
    });

    const atribuicoes: AtribuicaoSelo[] = [];
    for (const pessoa of pessoas) {
      for (const def of SELOS) {
        if (!def.perfis.includes(pessoa.perfil)) continue;
        const chave = `${pessoa.uid}__${def.tipo}`;
        const a = def.tipo === 'bem-avaliado'
          ? this.montarMerito(pessoa, chave, reputacoes.get(pessoa.uid), concessoes.get(chave))
          : this.montarPago(pessoa, def.tipo, chave, assinaturas.get(pessoa.uid), concessoes.get(chave));
        if (a) atribuicoes.push(a);
      }
    }
    return { pessoas, atribuicoes };
  }

  // ----------------------------------------------------------
  // AÇÕES (ADM)
  // ----------------------------------------------------------

  /** Cortesia de um selo PAGO (destaque/apoiador). Mérito nunca é concedido. */
  async concederCortesia(
    pessoa: PessoaSelo, selo: TipoSelo, dias: number | null, motivo: string,
  ): Promise<void> {
    const def = definicaoSelo(selo);
    if (def.natureza !== 'pago') throw new Error('Selos por mérito não podem ser concedidos.');
    if (!def.perfis.includes(pessoa.perfil)) throw new Error('Este selo não existe para este perfil.');

    const validoAte = dias ? Timestamp.fromDate(new Date(Date.now() + dias * 24 * 60 * 60 * 1000)) : null;
    const lote = writeBatch(db);
    lote.set(doc(db, 'selosConcedidos', `${pessoa.uid}__${selo}`), {
      uid: pessoa.uid,
      perfil: pessoa.perfil,
      nome: pessoa.nome,
      email: pessoa.email,
      selo,
      origem: 'cortesia',
      status: 'ativo',
      concedidoEm: serverTimestamp(),
      validoAte,
      concedidoPor: auth.currentUser?.uid || '',
      motivo: motivo.trim(),
      revogadoEm: null,
      revogadoPor: '',
      motivoRevogacao: '',
    });
    lote.set(doc(db, 'selosPublicos', pessoa.uid), {
      uid: pessoa.uid,
      [`${selo}Cortesia`]: true,
      [`${selo}Ate`]: validoAte,
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    await lote.commit();
  }

  /** Encerra uma cortesia (o selo que vem de plano acaba pelo plano, não por aqui). */
  async revogarCortesia(pessoa: PessoaSelo, selo: TipoSelo, motivo: string): Promise<void> {
    if (definicaoSelo(selo).natureza !== 'pago') throw new Error('Use a suspensão para selos por mérito.');
    const lote = writeBatch(db);
    lote.set(doc(db, 'selosConcedidos', `${pessoa.uid}__${selo}`), {
      status: 'revogado',
      revogadoEm: serverTimestamp(),
      revogadoPor: auth.currentUser?.uid || '',
      motivoRevogacao: motivo.trim(),
    }, { merge: true });
    lote.set(doc(db, 'selosPublicos', pessoa.uid), {
      uid: pessoa.uid,
      [`${selo}Cortesia`]: false,
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    await lote.commit();
  }

  /** Suspende o selo por mérito (ex.: denúncia grave). A pessoa mantém as avaliações. */
  async suspenderMerito(pessoa: PessoaSelo, motivo: string): Promise<void> {
    const lote = writeBatch(db);
    lote.set(doc(db, 'selosConcedidos', `${pessoa.uid}__bem-avaliado`), {
      uid: pessoa.uid,
      perfil: pessoa.perfil,
      nome: pessoa.nome,
      email: pessoa.email,
      selo: 'bem-avaliado',
      origem: 'merito',
      status: 'revogado',
      concedidoEm: null,
      validoAte: null,
      concedidoPor: '',
      motivo: '',
      revogadoEm: serverTimestamp(),
      revogadoPor: auth.currentUser?.uid || '',
      motivoRevogacao: motivo.trim(),
    });
    lote.set(doc(db, 'selosPublicos', pessoa.uid), {
      uid: pessoa.uid,
      meritoSuspenso: true,
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    await lote.commit();
  }

  /** Remove a suspensão: o selo volta a depender só das avaliações. */
  async restaurarMerito(pessoa: PessoaSelo): Promise<void> {
    const lote = writeBatch(db);
    lote.delete(doc(db, 'selosConcedidos', `${pessoa.uid}__bem-avaliado`));
    lote.set(doc(db, 'selosPublicos', pessoa.uid), {
      uid: pessoa.uid,
      meritoSuspenso: false,
      atualizadoEm: serverTimestamp(),
    }, { merge: true });
    await lote.commit();
  }

  // ----------------------------------------------------------
  // PARA AS TELAS PÚBLICAS (lista de profissionais, perfil, painel do parceiro)
  // Leem só `selosPublicos` (nunca `selosConcedidos`, que tem motivos e e-mails).
  // ----------------------------------------------------------

  /** Selos de um uid. Se a leitura falhar, devolve "sem selos" para não quebrar a tela. */
  async publicosDe(uid: string): Promise<SelosPublicos> {
    if (!uid) return SELOS_PUBLICOS_VAZIO;
    try {
      const snap = await getDoc(doc(db, 'selosPublicos', uid));
      return snap.exists() ? this.lerPublicos(snap.data()) : SELOS_PUBLICOS_VAZIO;
    } catch (e) {
      console.warn('Não foi possível ler os selos', e);
      return SELOS_PUBLICOS_VAZIO;
    }
  }

  /** Selos de todos de uma vez (para listas). */
  async publicosDeTodos(): Promise<Map<string, SelosPublicos>> {
    const mapa = new Map<string, SelosPublicos>();
    try {
      const snap = await getDocs(collection(db, 'selosPublicos'));
      snap.docs.forEach((d) => mapa.set(d.id, this.lerPublicos(d.data())));
    } catch (e) {
      console.warn('Não foi possível ler os selos', e);
    }
    return mapa;
  }

  private lerPublicos(x: any): SelosPublicos {
    const vale = (ativo: unknown, ate: unknown) => {
      if (ativo !== true) return false;
      const d = this.data(ate);
      return !d || d.getTime() > Date.now();
    };
    return {
      destaque: vale(x['destaqueCortesia'], x['destaqueAte']),
      apoiador: vale(x['apoiadorCortesia'], x['apoiadorAte']),
      meritoSuspenso: x['meritoSuspenso'] === true,
    };
  }

  // ----------------------------------------------------------
  // INTERNOS
  // ----------------------------------------------------------

  /** Destaque/apoiador: o plano Premium ativo vale mais que cortesia (não há o que revogar). */
  private montarPago(
    pessoa: PessoaSelo, selo: TipoSelo, chave: string, ass: Assinatura | undefined, conc: Concessao | undefined,
  ): AtribuicaoSelo | null {
    const planoAtivo = !!ass && ass.ativo && ass.plano === 'premium'
      && (!ass.validoAte || ass.validoAte.getTime() > Date.now());
    if (planoAtivo) {
      return {
        chave, pessoa, selo, origem: 'plano', situacao: 'ativo',
        desde: ass!.iniciadaEm, validoAte: ass!.validoAte, concedidoPor: 'Plano Premium',
        motivo: '', planoNome: ass!.planoNome,
      };
    }
    if (!conc) return null;
    const expirou = !!conc.validoAte && conc.validoAte.getTime() <= Date.now();
    return {
      chave, pessoa, selo, origem: 'cortesia',
      situacao: conc.status === 'revogado' ? 'revogado' : expirou ? 'expirado' : 'ativo',
      desde: conc.concedidoEm, validoAte: conc.validoAte, concedidoPor: conc.concedidoPor || '—',
      motivo: conc.status === 'revogado' ? conc.motivoRevogacao : conc.motivo,
    };
  }

  /** Mérito: aparece para todo profissional, porque o ADM acompanha o progresso. */
  private montarMerito(
    pessoa: PessoaSelo, chave: string, rep: Reputacao | undefined, conc: Concessao | undefined,
  ): AtribuicaoSelo {
    const suspenso = !!conc && conc.status === 'revogado';
    const conquistou = !!rep && rep.bemAvaliado;
    return {
      chave, pessoa, selo: 'bem-avaliado', origem: 'merito',
      situacao: suspenso ? 'suspenso' : conquistou ? 'ativo' : 'em_progresso',
      desde: null, validoAte: null, concedidoPor: 'Avaliações das mães',
      motivo: suspenso ? conc!.motivoRevogacao : '',
      reputacao: rep,
    };
  }

  private data(v: any): Date | null {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
}

/** Critério exibido na aba de mérito (vem de reputacao.ts, que continua sendo a fonte da verdade). */
export const CRITERIO_MERITO = SELO_BEM_AVALIADO;
