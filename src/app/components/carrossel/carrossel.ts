import { AfterViewInit, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild, inject, signal } from '@angular/core';

/**
 * Carrossel simples com setinhas (anterior / próximo).
 *
 *   <app-carrossel rotulo="Dicas para ler">
 *     <div class="carrossel-item">…card…</div>
 *     …
 *   </app-carrossel>
 *
 * Computador: 3 itens por vez (tablet: 2) e setinhas dos lados.
 * Celular: um item inteiro e um pedacinho (25%) do próximo, pra mãe ver que dá pra arrastar.
 * As setinhas somem quando não há mais para onde ir.
 */
@Component({
  selector: 'app-carrossel',
  standalone: true,
  templateUrl: './carrossel.html',
  styleUrls: ['./carrossel.css'],
})
export class CarrosselComponent implements AfterViewInit, OnDestroy {
  @Input() rotulo = 'Itens';
  @ViewChild('trilho', { static: true }) trilho!: ElementRef<HTMLElement>;

  readonly podeVoltar = signal(false);
  readonly podeAvancar = signal(false);
  private readonly zone = inject(NgZone);
  private observador?: ResizeObserver;
  private mutacao?: MutationObserver;
  private readonly aoRolar = () => this.zone.run(() => this.atualizar());

  ngAfterViewInit() {
    const el = this.trilho.nativeElement;
    el.addEventListener('scroll', this.aoRolar, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.observador = new ResizeObserver(this.aoRolar);
      this.observador.observe(el);
    }
    if (typeof MutationObserver !== 'undefined') {
      this.mutacao = new MutationObserver(this.aoRolar);
      this.mutacao.observe(el, { childList: true });
    }
    setTimeout(() => this.atualizar());
  }

  private atualizar() {
    const el = this.trilho.nativeElement;
    this.podeVoltar.set(el.scrollLeft > 4);
    this.podeAvancar.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  /** Anda uma "página" (o tanto de itens que cabe na tela). */
  mover(direcao: 1 | -1) {
    const el = this.trilho.nativeElement;
    const item = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0;
    const passo = item ? item.getBoundingClientRect().width + gap : el.clientWidth;
    const porPagina = Math.max(1, Math.floor((el.clientWidth + gap) / passo));
    const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direcao * passo * porPagina, behavior: reduzir ? 'auto' : 'smooth' });
  }

  ngOnDestroy() {
    this.trilho?.nativeElement.removeEventListener('scroll', this.aoRolar);
    this.observador?.disconnect();
    this.mutacao?.disconnect();
  }
}
