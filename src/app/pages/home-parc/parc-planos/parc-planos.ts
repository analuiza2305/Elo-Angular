import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { onAuthStateChanged, Unsubscribe } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { auth, db } from '../../../core/firebase';
import {
  Assinatura, PLANOS_PADRAO_POR_PUBLICO, Plano, PlanoService, formatarBRL, sufixoPeriodicidade,
} from '../../../services/plano';
import { SelosAutorService } from '../../../services/selos-autor';

/** Avisa a página do parceiro (que usa DOM direto) que o plano mudou, para ela atualizar o selo da lateral. */
export const EVENTO_PLANO_ALTERADO = 'elo-plano-alterado';

/**
 * Aba "Planos" da empresa parceira (Premium simulado, sem cobrança real).
 *
 * Os planos vêm do catálogo que a ADM gerencia (PlanoService.planosParaOfertar('parceiro')).
 * Enquanto a ADM não cadastrar nenhum, aparecem os planos padrão.
 * O Premium dá o selo Apoiador: ele aparece no perfil, nos artigos e nos eventos da empresa.
 */
@Component({
  selector: 'app-parc-planos',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './parc-planos.html',
  styleUrl: './parc-planos.css',
})
export class ParcPlanosComponent implements OnInit, OnDestroy {
  private readonly planoService = inject(PlanoService);
  private readonly selosAutor = inject(SelosAutorService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private uid = '';
  private email = '';
  private nomeEmpresa = '';
  private unsubAuth: Unsubscribe | null = null;

  readonly brl = formatarBRL;
  readonly sufixo = sufixoPeriodicidade;

  readonly carregando = signal(true);
  readonly isPremium = signal(false);
  readonly assinatura = signal<Assinatura | null>(null);
  readonly planosOfertados = signal<Plano[]>([]);
  readonly planoGratuito = computed<Plano>(() =>
    this.planosOfertados().find((p) => p.nivel === 'gratuito')
      ?? { ...PLANOS_PADRAO_POR_PUBLICO.parceiro[0], id: 'padrao-gratuito-parceiro' });
  readonly planosPremium = computed(() => this.planosOfertados().filter((p) => p.nivel === 'premium'));

  readonly salvandoPlano = signal(false);
  /** Plano em que a pessoa clicou "Assinar" (a confirmação só aparece nele). */
  readonly confirmandoPlanoId = signal<string | null>(null);
  readonly msgPlano = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      this.uid = user.uid;
      this.email = user.email || '';
      await this.carregar();
    });
  }

  ngOnDestroy(): void {
    this.unsubAuth?.();
  }

  private async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      this.nomeEmpresa = await this.lerNomeEmpresa(this.uid);
      this.assinatura.set(await this.planoService.assinatura(this.uid));
      this.isPremium.set(await this.planoService.temPremium(this.uid));
      this.planosOfertados.set(await this.planoService.planosParaOfertar('parceiro'));
    } finally {
      this.carregando.set(false);
    }
  }

  /** O cadastro antigo do parceiro tem id aleatório; o novo usa o uid. Tenta os dois. */
  private async lerNomeEmpresa(uid: string): Promise<string> {
    try {
      let dados: any = null;
      const direto = await getDoc(doc(db, 'parceiros', uid));
      if (direto.exists()) dados = direto.data();
      else {
        const legado = await getDocs(query(collection(db, 'parceiros'), where('uid', '==', uid), limit(1)));
        if (!legado.empty) dados = legado.docs[0].data();
      }
      return String(dados?.['nomeEmpresa'] || dados?.['nome'] || '');
    } catch {
      return '';
    }
  }

  /** O plano pago em que a empresa está agora. */
  ehPlanoAtual(p: Plano): boolean {
    const a = this.assinatura();
    if (!this.isPremium() || !a) return false;
    if (a.planoId) return a.planoId === p.id;
    return p.id === this.planosPremium()[0]?.id; // assinatura anterior ao catálogo
  }

  validadePremiumTexto(): string {
    const v = this.assinatura()?.validoAte;
    return v ? v.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  }

  async assinarPremium(plano: Plano): Promise<void> {
    if (!this.uid || this.salvandoPlano()) return;
    this.salvandoPlano.set(true);
    this.msgPlano.set(null);
    try {
      const a = await this.planoService.assinarPlano(this.uid, plano, {
        nome: this.nomeEmpresa,
        email: this.email,
        tipo: 'parceiro',
      });
      this.assinatura.set(a);
      this.isPremium.set(true);
      this.confirmandoPlanoId.set(null);
      this.aposMudarPlano();
      this.msgPlano.set({ tipo: 'ok', texto: `${plano.nome} ativado! O selo Apoiador já aparece nos seus artigos e eventos.` });
    } catch (e) {
      console.error('Erro ao assinar:', e);
      this.msgPlano.set({ tipo: 'erro', texto: 'Não foi possível ativar agora. Tente de novo.' });
    } finally {
      this.salvandoPlano.set(false);
    }
  }

  async cancelarPremium(): Promise<void> {
    if (!this.uid || this.salvandoPlano()) return;
    this.salvandoPlano.set(true);
    this.msgPlano.set(null);
    try {
      const a = await this.planoService.cancelarPremium(this.uid);
      this.assinatura.set(a);
      this.isPremium.set(false);
      this.aposMudarPlano();
      this.msgPlano.set({ tipo: 'ok', texto: 'Você voltou para o plano gratuito. O selo Apoiador foi removido.' });
    } catch (e) {
      console.error('Erro ao cancelar:', e);
      this.msgPlano.set({ tipo: 'erro', texto: 'Não foi possível cancelar agora. Tente de novo.' });
    } finally {
      this.salvandoPlano.set(false);
    }
  }

  private aposMudarPlano(): void {
    this.selosAutor.invalidar();
    if (this.isBrowser) window.dispatchEvent(new CustomEvent(EVENTO_PLANO_ALTERADO));
  }
}
