/**
 * SelosAutorService
 *
 * Responde, para qualquer uid, "quais selos essa pessoa/empresa tem agora?".
 * É o que as telas públicas (fórum, comentários, artigos, eventos) usam para
 * mostrar o selo ao lado do nome de quem publicou.
 *
 *   destaque     → psicólogo/advogado com Premium ativo OU cortesia do ADM
 *   apoiador     → empresa parceira com Premium ativo OU cortesia do ADM
 *   bemAvaliado  → mérito pelas avaliações das mães (nunca é pago)
 *
 * Para não ler o Firestore a cada post, calcula tudo de uma vez (3 leituras)
 * e guarda por 5 minutos. Se alguma leitura falhar, a pessoa simplesmente
 * aparece sem selo: a tela nunca quebra por causa disso.
 */
import { Injectable, inject } from '@angular/core';
import { PlanoService } from './plano';
import { SeloService } from './selo';
import { carregarReputacoesDeTodos, Reputacao } from './reputacao';

export interface SelosAutor {
  destaque: boolean;
  apoiador: boolean;
  bemAvaliado: boolean;
}

export const SEM_SELOS: SelosAutor = { destaque: false, apoiador: false, bemAvaliado: false };

const VALIDADE_CACHE_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SelosAutorService {
  private readonly planos = inject(PlanoService);
  private readonly selos = inject(SeloService);
  private cache: { em: number; mapa: Promise<Map<string, SelosAutor>> } | null = null;

  /** Selos de todo mundo que tem algum (uid → selos). */
  mapa(forcar = false): Promise<Map<string, SelosAutor>> {
    if (!forcar && this.cache && Date.now() - this.cache.em < VALIDADE_CACHE_MS) return this.cache.mapa;
    const mapa = this.montar();
    this.cache = { em: Date.now(), mapa };
    return mapa;
  }

  /** Selos de uma pessoa. */
  async de(uid: string | null | undefined): Promise<SelosAutor> {
    if (!uid || uid === 'anonimo') return SEM_SELOS;
    return (await this.mapa()).get(uid) ?? SEM_SELOS;
  }

  /** Esquece o cache (use depois de alguém assinar ou cancelar um plano). */
  invalidar(): void {
    this.cache = null;
  }

  private async montar(): Promise<Map<string, SelosAutor>> {
    const [premium, publicos, reputacoes] = await Promise.all([
      this.planos.premiumAtivosPorTipo().catch(() => new Map()),
      this.selos.publicosDeTodos().catch(() => new Map()),
      carregarReputacoesDeTodos().catch(() => new Map<string, Reputacao>()),
    ]);

    const resultado = new Map<string, SelosAutor>();
    const atual = (uid: string) => resultado.get(uid) ?? { ...SEM_SELOS };

    premium.forEach((tipo, uid) => {
      const s = atual(uid);
      if (tipo === 'parceiro') s.apoiador = true; else s.destaque = true;
      resultado.set(uid, s);
    });
    publicos.forEach((p, uid) => {
      const s = atual(uid);
      if (p.destaque) s.destaque = true;
      if (p.apoiador) s.apoiador = true;
      resultado.set(uid, s);
    });
    reputacoes.forEach((r, uid) => {
      if (!r.bemAvaliado) return;
      const s = atual(uid);
      s.bemAvaliado = true;
      resultado.set(uid, s);
    });
    return resultado;
  }
}
