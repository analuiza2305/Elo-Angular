import { Component, ElementRef, OnDestroy, PLATFORM_ID, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { VERSAO_DOCUMENTOS_LEGAIS } from '../../pages/documento-legal/documentos-legais';

/** Onde o aceite fica guardado no navegador. */
const CHAVE_ACEITE = 'eloAceiteTermos';

/** Guarda (só nesta visita) que a pessoa fechou a faixa da landing no X. */
const CHAVE_FAIXA_FECHADA = 'eloFaixaPrivacidadeFechada';

/** Nessas telas o aviso não aparece: a pessoa precisa conseguir LER o que vai aceitar. */
const ROTAS_LIVRES = new Set(['termos-de-uso', 'politica-de-privacidade']);

/**
 * Páginas de apresentação (landing): em vez da janela que bloqueia, aparece uma
 * faixa na parte de baixo, que chega deslizando e pode ser fechada no X.
 * Ao entrar na plataforma (login, cadastro e demais telas), a janela completa é exigida.
 */
const ROTAS_FAIXA = new Set(['', 'profissionais']);

/** Tempo da animação de saída da faixa (igual ao CSS). */
const DURACAO_SAIDA_MS = 320;

/**
 * Aviso de boas-vindas da primeira visita.
 * - Na landing: faixa de privacidade na parte de baixo (chega com animação, tem X para fechar).
 * - No resto da plataforma: janela que explica em linguagem simples os Termos, a
 *   Privacidade e os cookies, e só libera depois que a pessoa marca que leu e aceita.
 * O aceite (com a versão dos documentos) fica salvo no navegador; quando os
 * documentos mudarem de versão, o aviso aparece de novo.
 *
 * Acessível: janela de diálogo com foco preso dentro dela, botão para ouvir o
 * aviso, letras e botões grandes, e funciona no teclado.
 */
@Component({
  selector: 'app-aviso-termos',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './aviso-termos.html',
  styleUrls: ['./aviso-termos.css'],
})
export class AvisoTermosComponent implements OnDestroy {
  private router = inject(Router);
  private ehNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private caixa = viewChild<ElementRef<HTMLElement>>('caixa');
  private sub?: Subscription;

  /** Janela completa (bloqueia a plataforma até aceitar). */
  readonly visivel = signal(false);
  /** A janela foi aberta pelo "Entender melhor" da faixa: aí ela pode ser fechada. */
  readonly abertaPelaFaixa = signal(false);

  /** Faixa da landing. */
  readonly faixaVisivel = signal(false);
  readonly faixaSaindo = signal(false);

  readonly marcado = signal(false);
  readonly tentouSemMarcar = signal(false);
  readonly lendo = signal(false);
  readonly vozDisponivel = signal(false);

  private aceito = false;
  private focoAnterior: HTMLElement | null = null;
  private timerFaixa?: ReturnType<typeof setTimeout>;

  constructor() {
    afterNextRender(() => {
      this.aceito = this.lerAceite();
      this.vozDisponivel.set('speechSynthesis' in window);
      this.atualizarRota(this.router.url);
      this.sub = this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((e) => this.atualizarRota(e.urlAfterRedirects));
    });

    // Enquanto o aviso está aberto: trava a rolagem da página e leva o foco para ele.
    effect(() => {
      if (!this.ehNavegador) return;
      if (this.visivel()) {
        this.focoAnterior = document.activeElement as HTMLElement | null;
        document.body.style.overflow = 'hidden';
        setTimeout(() => this.caixa()?.nativeElement.focus(), 0);
      } else {
        document.body.style.overflow = '';
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    clearTimeout(this.timerFaixa);
    if (this.ehNavegador) {
      document.body.style.overflow = '';
      this.pararLeitura();
    }
  }

  private atualizarRota(url: string) {
    const rota = url.split(/[?#]/)[0].replace(/^\/+/, '').split('/')[0];
    clearTimeout(this.timerFaixa);
    this.abertaPelaFaixa.set(false);

    if (this.aceito || ROTAS_LIVRES.has(rota)) {
      this.visivel.set(false);
      this.faixaVisivel.set(false);
      return;
    }

    if (ROTAS_FAIXA.has(rota)) {
      // Landing: nada de bloquear; a faixa chega um pouquinho depois da página carregar.
      this.visivel.set(false);
      if (!this.faixaFoiFechada() && !this.faixaVisivel()) {
        this.timerFaixa = setTimeout(() => {
          this.faixaSaindo.set(false);
          this.faixaVisivel.set(true);
        }, 900);
      }
      return;
    }

    // Entrando na plataforma: a janela completa é obrigatória.
    this.faixaVisivel.set(false);
    this.visivel.set(true);
  }

  private faixaFoiFechada(): boolean {
    try { return sessionStorage.getItem(CHAVE_FAIXA_FECHADA) === '1'; } catch { return false; }
  }

  /** Esconde a faixa com a animação de saída. */
  private esconderFaixa() {
    this.faixaSaindo.set(true);
    setTimeout(() => {
      this.faixaVisivel.set(false);
      this.faixaSaindo.set(false);
    }, DURACAO_SAIDA_MS);
  }

  /** X da faixa: tira da tela só nesta visita (o aceite continua pendente). */
  fecharFaixa() {
    try { sessionStorage.setItem(CHAVE_FAIXA_FECHADA, '1'); } catch { /* sem armazenamento */ }
    this.esconderFaixa();
  }

  /** "Aceitar e continuar" direto na faixa. */
  aceitarPelaFaixa() {
    this.salvarAceite();
    this.esconderFaixa();
  }

  /** "Entender melhor": abre a janela completa, com os cartões explicativos. */
  abrirDetalhes() {
    this.faixaVisivel.set(false);
    this.abertaPelaFaixa.set(true);
    this.visivel.set(true);
  }

  /** Fechar a janela (só quando ela foi aberta pela faixa, na landing). */
  fecharJanela() {
    if (!this.abertaPelaFaixa()) return;
    this.pararLeitura();
    this.visivel.set(false);
    this.abertaPelaFaixa.set(false);
    if (!this.aceito && !this.faixaFoiFechada()) this.faixaVisivel.set(true);
    this.focoAnterior?.focus?.();
  }

  private salvarAceite() {
    try {
      localStorage.setItem(CHAVE_ACEITE, JSON.stringify({ versao: VERSAO_DOCUMENTOS_LEGAIS, aceitoEm: new Date().toISOString() }));
    } catch { /* navegador sem armazenamento: o aceite vale só para esta visita */ }
    this.aceito = true;
  }

  private lerAceite(): boolean {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_ACEITE) ?? 'null');
      return salvo?.versao === VERSAO_DOCUMENTOS_LEGAIS;
    } catch {
      return false;
    }
  }

  alternarMarcado(evento: Event) {
    this.marcado.set((evento.target as HTMLInputElement).checked);
    if (this.marcado()) this.tentouSemMarcar.set(false);
  }

  aceitar() {
    if (!this.marcado()) {
      this.tentouSemMarcar.set(true);
      return;
    }
    this.salvarAceite();
    this.pararLeitura();
    this.visivel.set(false);
    this.abertaPelaFaixa.set(false);
    this.focoAnterior?.focus?.();
  }

  /** Mantém o Tab circulando só dentro do aviso (ninguém "escapa" para a página por trás). */
  prenderFoco(evento: KeyboardEvent) {
    if (evento.key === 'Escape') { this.fecharJanela(); return; }
    if (evento.key !== 'Tab') return;
    const raiz = this.caixa()?.nativeElement;
    if (!raiz) return;
    const focaveis = Array.from(
      raiz.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'),
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (evento.shiftKey && (document.activeElement === primeiro || document.activeElement === raiz)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  /** Lê o aviso em voz alta. */
  alternarLeitura() {
    if (this.lendo()) { this.pararLeitura(); return; }
    const raiz = this.caixa()?.nativeElement;
    if (!raiz || !('speechSynthesis' in window)) return;
    const trechos = Array.from(raiz.querySelectorAll('[data-ler]'))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const voz = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt'));
    speechSynthesis.cancel();
    this.lendo.set(true);
    trechos.forEach((trecho, i) => {
      const fala = new SpeechSynthesisUtterance(trecho);
      fala.lang = 'pt-BR';
      fala.rate = 0.95;
      if (voz) fala.voice = voz;
      if (i === trechos.length - 1) fala.onend = () => this.lendo.set(false);
      fala.onerror = () => this.lendo.set(false);
      speechSynthesis.speak(fala);
    });
  }

  private pararLeitura() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.lendo.set(false);
  }
}
