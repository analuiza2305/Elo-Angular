/**
 * PlanoService — VERSÃO PROVISÓRIA (Samy + Emily)
 *
 * Mesmos nomes do plano da equipe: temPremium() e temSelo().
 * Quando a Ana e a Michelly entregarem o motor de planos, basta trocar o
 * conteúdo destes métodos; as telas que usam o serviço não mudam.
 *
 * Onde o plano fica gravado (combinar com a equipe):
 *   assinaturas/{uidDoProfissional} = {
 *     plano: 'premium' | 'gratuito',
 *     ativo: true,
 *     validoAte: Timestamp (opcional),
 *     selos: ['destaque', ...] (opcional, selos pagos à parte)
 *   }
 * Fica separado do documento do psicólogo porque hoje qualquer pessoa logada
 * consegue editar `psicologos/*`.
 */
import { Injectable } from '@angular/core';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../core/firebase';

export interface Assinatura {
  plano: 'premium' | 'gratuito';
  ativo: boolean;
  validoAte?: Date | null;
  selos?: string[];
}

@Injectable({ providedIn: 'root' })
export class PlanoService {
  private cache = new Map<string, Assinatura | null>();

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

  private estaAtiva(a: Assinatura | null, plano?: Assinatura['plano']): boolean {
    if (!a || !a.ativo) return false;
    if (plano && a.plano !== plano) return false;
    return !a.validoAte || a.validoAte.getTime() > Date.now();
  }

  private normalizar(d: any): Assinatura {
    const validade = d['validoAte'];
    return {
      plano: d['plano'] === 'premium' ? 'premium' : 'gratuito',
      ativo: d['ativo'] === true,
      validoAte: validade?.toDate ? validade.toDate() : validade ? new Date(validade) : null,
      selos: Array.isArray(d['selos']) ? d['selos'] : [],
    };
  }
}
