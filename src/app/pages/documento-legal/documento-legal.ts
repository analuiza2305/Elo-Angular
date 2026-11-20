import { Component, ElementRef, OnDestroy, PLATFORM_ID, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { Location, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { Bloco, DOCUMENTOS_LEGAIS } from './documentos-legais';

type Chave = 'termos' | 'privacidade';

/** Tamanhos de letra do texto (em rem). O botão A+ / A- anda por esta lista. */
const TAMANHOS = [0.95, 1.05, 1.15, 1.3, 1.45];

/**
 * Página pública dos documentos legais.
 * A mesma tela atende /termos-de-uso e /politica-de-privacidade: a rota diz qual
 * documento mostrar (data.documento). O texto vem de documentos-legais.ts.
 *
 * Acessibilidade: resumo em linguagem simples no topo, sumário que abre e fecha,
 * botão para ouvir o texto em voz alta e botões para aumentar/diminuir a letra.
 */
@Component({
  selector: 'app-documento-legal',
  standalone: true,
  imports: [RouterLink, HeaderComponent, FooterComponent],
  templateUrl: './documento-legal.html',
  styleUrls: ['./documento-legal.css'],
})
export class DocumentoLegal implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private ehNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private texto = viewChild<ElementRef<HTMLElement>>('texto');

  readonly chave = toSignal(
    this.route.data.pipe(map((d) => (d['documento'] === 'privacidade' ? 'privacidade' : 'termos') as Chave)),
    { initialValue: 'termos' as Chave },
  );

  readonly doc = computed(() => DOCUMENTOS_LEGAIS[this.chave()]);

  /** Título sem o " - EloMaterno" (o nome já aparece no header). */
  readonly tituloCurto = computed(() => this.doc().titulo.replace(/\s*-\s*EloMaterno$/, ''));

  /** O resumo vai para os cartões do topo; o restante vira o texto completo. */
  readonly resumo = computed(() =>
    this.doc().blocos.find((b): b is Extract<Bloco, { tipo: 'resumo' }> => b.tipo === 'resumo'),
  );
  readonly blocos = computed(() =>
    this.doc().blocos.filter((b): b is Exclude<Bloco, { tipo: 'resumo' }> => b.tipo !== 'resumo'),
  );

  readonly sumario = computed(() =>
    this.doc().blocos.filter((b): b is Extract<Bloco, { tipo: 'h1' }> => b.tipo === 'h1'),
  );

  /** Sumário aberto no computador e fechado no celular (para não empurrar o texto para baixo). */
  readonly sumarioAberto = signal(true);

  // ---------- tamanho da letra ----------
  readonly nivelFonte = signal(1);
  readonly tamanhoFonte = computed(() => TAMANHOS[this.nivelFonte()]);
  readonly podeAumentar = computed(() => this.nivelFonte() < TAMANHOS.length - 1);
  readonly podeDiminuir = computed(() => this.nivelFonte() > 0);

  // ---------- ouvir em voz alta ----------
  readonly vozDisponivel = signal(false);
  readonly lendo = signal(false);

  // ---------- voltar ao topo ----------
  readonly mostrarTopo = signal(false);
  private aoRolar = () => this.mostrarTopo.set(window.scrollY > 600);

  constructor() {
    afterNextRender(() => {
      this.vozDisponivel.set('speechSynthesis' in window);
      this.sumarioAberto.set(!window.matchMedia('(max-width: 900px)').matches);
      window.addEventListener('scroll', this.aoRolar, { passive: true });
    });
  }

  ngOnDestroy() {
    if (!this.ehNavegador) return;
    window.removeEventListener('scroll', this.aoRolar);
    this.pararLeitura();
  }

  aumentarLetra() { if (this.podeAumentar()) this.nivelFonte.update((n) => n + 1); }
  diminuirLetra() { if (this.podeDiminuir()) this.nivelFonte.update((n) => n - 1); }

  alternarSumario(evento: Event) {
    this.sumarioAberto.set((evento.target as HTMLDetailsElement).open);
  }

  irPara(id: string, evento: Event) {
    evento.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // No celular, fecha o sumário depois de escolher uma parte.
    if (window.matchMedia('(max-width: 900px)').matches) this.sumarioAberto.set(false);
  }

  /**
   * Volta para a tela de onde a pessoa veio. Se ela abriu os Termos direto
   * (link numa aba nova, por exemplo), não há para onde voltar: vai para o início.
   */
  voltar() {
    this.pararLeitura();
    const navegouDentroDoSite = (window.history.state?.navigationId ?? 1) > 1;
    if (navegouDentroDoSite) this.location.back();
    else this.router.navigateByUrl('/');
  }

  voltarAoTopo() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Lê o documento em voz alta, parágrafo por parágrafo
   * (textos muito longos de uma vez são cortados por alguns navegadores).
   */
  alternarLeitura() {
    if (this.lendo()) { this.pararLeitura(); return; }
    const raiz = this.texto()?.nativeElement;
    if (!raiz || !('speechSynthesis' in window)) return;

    const trechos = Array.from(raiz.querySelectorAll('h2, h3, p'))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!trechos.length) return;

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

  pararLeitura() {
    if (this.ehNavegador && 'speechSynthesis' in window) speechSynthesis.cancel();
    this.lendo.set(false);
  }
}
