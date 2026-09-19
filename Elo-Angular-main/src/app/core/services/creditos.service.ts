import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  DocumentData,
  getDoc,
  onSnapshot,
  or,
  orderBy,
  query,
  runTransaction,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { db } from '../firebase';

/**
 * Serviço central da "carteira de moedas" do EloMaterno.
 *
 * Regras de negócio (alinhadas com o time em 19/09):
 * - Toda mãe recebe `CREDITO_MENSAL_PADRAO` créditos por mês, guardados em
 *   `creditoMensal`. Esse saldo NÃO acumula: no início de cada mês ele volta
 *   para o valor padrão, mesmo que não tenha sido usado.
 * - Créditos comprados pela mãe (compra de moedas extras) vão para
 *   `creditoComprado`. Esse saldo NUNCA é resetado — fica disponível pra
 *   sempre, usado ou não.
 * - Ao gastar (artigo, consulta, etc.), desconta primeiro do `creditoMensal`
 *   e só entra no `creditoComprado` se o mensal não cobrir o custo total.
 * - Parceiros têm `creditopremium` (coleção `parceiros`), que compram
 *   (simulado, sem gateway real por enquanto) e podem transferir para mães.
 *
 * Toda transação (renovação, compra, gasto, transferência) é registrada em
 * `transacoesMoedas` para dar histórico auditável pra carteira.
 */

export const CREDITO_MENSAL_PADRAO = 50;

export type TipoMoeda = 'creditoMensal' | 'creditoComprado' | 'creditopremium';
export type TipoTransacao = 'renovacao' | 'compra' | 'gasto' | 'transferencia';

export interface CarteiraMae {
  creditoMensal: number;
  creditoComprado: number;
  total: number;
}

export interface CarteiraParceiro {
  creditopremium: number;
}

export interface TransacaoMoeda {
  id: string;
  tipo: TipoTransacao;
  tipoMoeda: TipoMoeda;
  valor: number;
  descricao?: string;
  uidOrigem?: string;
  uidDestino?: string;
  data: number;
}

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function novaTransacaoRef() {
  return doc(collection(db, 'transacoesMoedas'));
}

@Injectable({ providedIn: 'root' })
export class CreditosService {
  // ==========================================
  // RENOVAÇÃO MENSAL (mãe)
  // ==========================================

  /**
   * Confere se o saldo mensal da mãe já foi renovado este mês; se não,
   * reseta `creditoMensal` para o padrão e grava o registro no histórico.
   * `creditoComprado` nunca é tocado aqui.
   *
   * Chamar isso ao entrar na home-mãe (login / boot da página) — é a
   * estratégia "lazy" combinada com o time: sem Cloud Function agendada
   * por enquanto, o reset acontece na próxima vez que a mãe abrir o app.
   *
   * Também serve como migração automática: usuárias antigas que só tinham
   * o campo `credito` (formato antigo) ganham os campos novos na primeira
   * passada por aqui.
   */
  async garantirRenovacaoMensal(uid: string): Promise<void> {
    const ref = doc(db, 'usuarios', uid);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return;

      const data = snap.data();
      if (data['ultimoResetCredito'] === mesAtual()) return; // já renovado este mês

      const creditoComprado = data['creditoComprado'] ?? 0;

      transaction.update(ref, {
        creditoMensal: CREDITO_MENSAL_PADRAO,
        creditoComprado,
        ultimoResetCredito: mesAtual(),
      });

      transaction.set(novaTransacaoRef(), {
        tipo: 'renovacao',
        tipoMoeda: 'creditoMensal',
        valor: CREDITO_MENSAL_PADRAO,
        uidDestino: uid,
        descricao: 'Renovação mensal de créditos',
        data: Date.now(),
      });
    });
  }

  // ==========================================
  // LEITURA (tempo real, pra carteira e widget)
  // ==========================================

  /** Observable em tempo real do saldo da mãe (soma dos dois "potes"). */
  carteiraMae$(uid: string): Observable<CarteiraMae> {
    return new Observable((subscriber) => {
      const ref = doc(db, 'usuarios', uid);
      const unsub: Unsubscribe = onSnapshot(
        ref,
        (snap) => {
          const data = (snap.data() as DocumentData) || {};
          const creditoMensal = data['creditoMensal'] ?? data['credito'] ?? 0;
          const creditoComprado = data['creditoComprado'] ?? 0;
          subscriber.next({ creditoMensal, creditoComprado, total: creditoMensal + creditoComprado });
        },
        (err) => subscriber.error(err),
      );
      return unsub;
    });
  }

  /** Observable em tempo real do saldo premium do parceiro. */
  carteiraParceiro$(uid: string): Observable<CarteiraParceiro> {
    return new Observable((subscriber) => {
      const ref = doc(db, 'parceiros', uid);
      const unsub: Unsubscribe = onSnapshot(
        ref,
        (snap) => {
          const data = (snap.data() as DocumentData) || {};
          subscriber.next({ creditopremium: data['creditopremium'] ?? 0 });
        },
        (err) => subscriber.error(err),
      );
      return unsub;
    });
  }

  /**
   * Histórico de transações onde o uid é origem OU destino, mais recentes
   * primeiro. Necessita de um índice composto no Firestore (a própria
   * console do Firebase mostra o link pra criar automaticamente na primeira
   * vez que essa query rodar e der erro de índice faltando).
   */
  historico$(uid: string, max = 25): Observable<TransacaoMoeda[]> {
    return new Observable((subscriber) => {
      const q = query(
        collection(db, 'transacoesMoedas'),
        or(where('uidOrigem', '==', uid), where('uidDestino', '==', uid)),
        orderBy('data', 'desc'),
      );
      const unsub: Unsubscribe = onSnapshot(
        q,
        (snap) => {
          const itens = snap.docs
            .slice(0, max)
            .map((d) => ({ id: d.id, ...(d.data() as DocumentData) }) as TransacaoMoeda);
          subscriber.next(itens);
        },
        (err) => {
          console.error('Erro ao carregar histórico de moedas:', err);
          subscriber.next([]);
        },
      );
      return unsub;
    });
  }

  // ==========================================
  // COMPRA DE MOEDAS EXTRAS (simulada, sem gateway por enquanto)
  // ==========================================

  /**
   * Credita `quantidade` no saldo indicado. Por enquanto é 100% simulado —
   * não existe cobrança real nenhuma, é só pra validar o fluxo completo no
   * protótipo. Quando entrar um gateway de pagamento de verdade, é aqui que
   * a confirmação do pagamento deve chamar essa função (ou uma variante que
   * primeiro confere o pagamento antes de creditar).
   */
  async comprarCreditos(
    uid: string,
    colecao: 'usuarios' | 'parceiros',
    tipoMoeda: 'creditoComprado' | 'creditopremium',
    quantidade: number,
    descricao: string,
  ): Promise<void> {
    if (quantidade <= 0) throw new Error('Quantidade inválida.');
    const ref = doc(db, colecao, uid);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Usuário não encontrado.');

      const saldoAtual = snap.data()[tipoMoeda] || 0;
      transaction.update(ref, { [tipoMoeda]: saldoAtual + quantidade });

      transaction.set(novaTransacaoRef(), {
        tipo: 'compra',
        tipoMoeda,
        valor: quantidade,
        uidDestino: uid,
        descricao: descricao || 'Compra de créditos (simulada)',
        data: Date.now(),
      });
    });
  }

  // ==========================================
  // GASTO (mãe compra artigo/consulta/etc.)
  // ==========================================

  /**
   * Desconta `custo` do saldo da mãe: primeiro do `creditoMensal`, e só
   * entra no `creditoComprado` se o mensal não for suficiente. Retorna
   * `true`/`false` pra liberar (ou não) o acesso ao conteúdo.
   */
  async processarCompra(uid: string, custo: number, descricao = ''): Promise<boolean> {
    if (custo === 0) return true;

    const ref = doc(db, 'usuarios', uid);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw new Error('Usuário não encontrado.');

        const data = snap.data();
        const mensal = data['creditoMensal'] ?? data['credito'] ?? 0;
        const comprado = data['creditoComprado'] ?? 0;

        if (mensal + comprado < custo) throw new Error('Saldo insuficiente.');

        const gastoDoMensal = Math.min(mensal, custo);
        const gastoDoComprado = custo - gastoDoMensal;

        transaction.update(ref, {
          creditoMensal: mensal - gastoDoMensal,
          creditoComprado: comprado - gastoDoComprado,
        });

        transaction.set(novaTransacaoRef(), {
          tipo: 'gasto',
          tipoMoeda: gastoDoComprado > 0 ? 'creditoComprado' : 'creditoMensal',
          valor: custo,
          uidOrigem: uid,
          descricao,
          data: Date.now(),
        });
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  // ==========================================
  // PARCEIRO -> MÃE (premium)
  // ==========================================

  /** Parceiro transfere crédito premium para uma mãe. */
  async transferirCreditoPremium(uidParceiro: string, uidMae: string, valor: number): Promise<void> {
    if (valor <= 0) throw new Error('Valor inválido.');

    const parceiroRef = doc(db, 'parceiros', uidParceiro);
    const maeRef = doc(db, 'usuarios', uidMae);

    await runTransaction(db, async (transaction) => {
      const parceiroDoc = await transaction.get(parceiroRef);
      const maeDoc = await transaction.get(maeRef);

      if (!parceiroDoc.exists() || !maeDoc.exists()) {
        throw new Error('Usuário não encontrado.');
      }
      if (maeDoc.data()['tipo'] !== 'mae') {
        throw new Error('O destino precisa ser uma conta de mãe.');
      }

      const saldoParceiro = parceiroDoc.data()['creditopremium'] || 0;
      if (saldoParceiro < valor) {
        throw new Error('Saldo de crédito premium insuficiente.');
      }

      const saldoMaeAtual = maeDoc.data()['creditopremium'] || 0;

      transaction.update(parceiroRef, { creditopremium: saldoParceiro - valor });
      transaction.update(maeRef, { creditopremium: saldoMaeAtual + valor });

      transaction.set(novaTransacaoRef(), {
        tipo: 'transferencia',
        tipoMoeda: 'creditopremium',
        valor,
        uidOrigem: uidParceiro,
        uidDestino: uidMae,
        descricao: 'Transferência de crédito premium',
        data: Date.now(),
      });
    });
  }

  /** Busca básica de uma mãe pelo e-mail, pra tela de transferência do parceiro. */
  async buscarMaePorEmail(email: string): Promise<{ uid: string; nome: string } | null> {
    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo) return null;

    const q = query(collection(db, 'usuarios'), where('email', '==', emailLimpo), where('tipo', '==', 'mae'));
    const { getDocs } = await import('firebase/firestore');
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const d = snap.docs[0];
    return { uid: d.id, nome: (d.data()['nome'] as string) || 'Mãe' };
  }
}
