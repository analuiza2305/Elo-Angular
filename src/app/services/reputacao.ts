/**
 * Reputação do profissional calculada a partir das avaliações das mães.
 *
 * As avaliações públicas ficam em `avaliacoes/{consultaId}_mae` e NÃO têm o id da mãe:
 * só nota, elogios e se recomendaria. Assim dá para calcular a reputação no navegador
 * sem expor quem foi paciente de quem.
 *
 * O selo "Bem avaliado pelas mães" é só por mérito: nenhum plano pago concede esse selo.
 */
import { collection, getDocs, query, where, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../core/firebase';

/** Elogios rápidos que a mãe pode marcar no pós-consulta (máx. 3). */
export const ELOGIOS = [
  'Acolhimento',
  'Escuta atenta',
  'Sem julgamentos',
  'Pontualidade',
  'Explicou com clareza',
  'Me senti segura',
  'Ajudou de verdade',
] as const;

export const MAX_ELOGIOS = 3;

/** Abaixo disso a média não é exibida (uma nota isolada não define ninguém). */
export const MINIMO_AVALIACOES = 3;

/** Critério do selo "Bem avaliado pelas mães" (ajuste aqui se a equipe decidir outro). */
export const SELO_BEM_AVALIADO = {
  mediaMinima: 4.5,
  avaliacoesMinimas: 5,
  recomendacaoMinimaPct: 80,
};

export interface Reputacao {
  total: number;                 // quantas mães avaliaram
  media: number;                 // 0 a 5
  mediaTexto: string;            // "4,8"
  recomendamPct: number | null;  // % que recomendariam (entre quem respondeu)
  distribuicao: number[];        // índice 0 = 1 estrela ... índice 4 = 5 estrelas
  elogiosTop: { elogio: string; qtd: number }[];
  novo: boolean;                 // menos que MINIMO_AVALIACOES
  bemAvaliado: boolean;          // conquistou o selo
}

export const REPUTACAO_VAZIA: Reputacao = {
  total: 0, media: 0, mediaTexto: '–', recomendamPct: null,
  distribuicao: [0, 0, 0, 0, 0], elogiosTop: [], novo: true, bemAvaliado: false,
};

/** Reputação de um profissional. */
export async function carregarReputacao(profissionalUid: string): Promise<Reputacao> {
  if (!profissionalUid) return REPUTACAO_VAZIA;
  const snap = await getDocs(query(
    collection(db, 'avaliacoes'),
    where('avaliadoId', '==', profissionalUid),
    where('tipoAvaliador', '==', 'mae'),
  ));
  return calcularReputacao(snap.docs);
}

/** Reputação de todos os profissionais em uma única leitura (para listas). */
export async function carregarReputacoesDeTodos(): Promise<Map<string, Reputacao>> {
  const snap = await getDocs(query(collection(db, 'avaliacoes'), where('tipoAvaliador', '==', 'mae')));
  const porProfissional = new Map<string, QueryDocumentSnapshot[]>();
  for (const d of snap.docs) {
    const id = String(d.data()['avaliadoId'] || '');
    if (!id) continue;
    if (!porProfissional.has(id)) porProfissional.set(id, []);
    porProfissional.get(id)!.push(d);
  }
  const resultado = new Map<string, Reputacao>();
  porProfissional.forEach((docs, id) => resultado.set(id, calcularReputacao(docs)));
  return resultado;
}

export function ehBemAvaliado(r: Pick<Reputacao, 'total' | 'media' | 'recomendamPct'>): boolean {
  return r.total >= SELO_BEM_AVALIADO.avaliacoesMinimas
    && r.media >= SELO_BEM_AVALIADO.mediaMinima
    && (r.recomendamPct ?? 0) >= SELO_BEM_AVALIADO.recomendacaoMinimaPct;
}

function calcularReputacao(docs: QueryDocumentSnapshot[]): Reputacao {
  let soma = 0;
  let total = 0;
  let respostasRecomenda = 0;
  let recomendam = 0;
  const distribuicao = [0, 0, 0, 0, 0];
  const contagemElogios = new Map<string, number>();

  for (const d of docs) {
    const a = d.data();
    const nota = Number(a['nota']);
    if (!(nota >= 1 && nota <= 5)) continue;

    total++;
    soma += nota;
    distribuicao[Math.round(nota) - 1]++;

    if (typeof a['recomenda'] === 'boolean') {
      respostasRecomenda++;
      if (a['recomenda']) recomendam++;
    }

    for (const e of (a['elogios'] || []) as string[]) {
      if ((ELOGIOS as readonly string[]).includes(e)) {
        contagemElogios.set(e, (contagemElogios.get(e) || 0) + 1);
      }
    }
  }

  const media = total ? soma / total : 0;
  const recomendamPct = respostasRecomenda ? Math.round((recomendam / respostasRecomenda) * 100) : null;
  return {
    total,
    media,
    mediaTexto: total ? media.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–',
    recomendamPct,
    distribuicao,
    elogiosTop: [...contagemElogios.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([elogio, qtd]) => ({ elogio, qtd })),
    novo: total < MINIMO_AVALIACOES,
    bemAvaliado: ehBemAvaliado({ total, media, recomendamPct }),
  };
}
