import { Component, HostBinding, HostListener, Input, OnDestroy, computed, signal } from '@angular/core';

/** Expressões da Elô (as mesmas da folha da mascote + as dos easter eggs). */
export type ExpressaoElo =
  | 'normal' | 'oi' | 'pensando' | 'acolhendo' | 'piscadinha'
  | 'risada' | 'tonta' | 'sonhando';

/** Efeitos especiais dos easter eggs. */
type Efeito = '' | 'cocegas' | 'cachecol' | 'orelhas' | 'pulo' | 'tonta' | 'noite' | 'abraco';

/** Parte do corpo tocada. */
export type ParteElo = 'olhos' | 'barriga' | 'asa' | 'cachecol' | 'orelhas' | 'bico' | 'pes' | 'corpo';

/**
 * Elô — a coruja que acompanha cada mãe no EloMaterno.
 * Desenhada em SVG (fica nítida em qualquer tamanho e não precisa de arquivo de imagem).
 *
 * Uso:
 *   <app-elo-coruja expressao="oi" [tamanho]="96"></app-elo-coruja>
 *   <app-elo-coruja expressao="pensando" [soRosto]="true" [tamanho]="40"></app-elo-coruja>
 *   <app-elo-coruja expressao="oi" [interativa]="true"></app-elo-coruja>   ← com easter eggs
 *
 * Expressões: normal, oi, pensando, acolhendo, piscadinha (e, nos easter eggs, risada, tonta, sonhando).
 *
 * EASTER EGGS (só com [interativa]="true"):
 * - olhos → piscadinha          - barriga → cócegas (ela ri e treme)
 * - asa → aceno                 - cachecol → o cachecol balança
 * - orelhas → orelhinhas mexem  - bico → "piu?"     - pezinhos → pulinho
 * - resto do corpo → carinho (ela fecha os olhos e cora)
 * - segurar apertado (~1s) → abraço quentinho com coraçõezinhos
 * - 5 toques rápidos → modo noite (lua e estrelas: "corujas ficam acordadas à noite… como as mães")
 * - 10 toques rápidos → ela fica tontinha (olhos em espiral)
 * - pelo teclado: Tab até ela e Enter/Espaço → uma reação surpresa
 */
@Component({
  selector: 'app-elo-coruja',
  standalone: true,
  templateUrl: './elo-coruja.html',
  styleUrls: ['./elo-coruja.css'],
  host: { '[style.width.px]': 'tamanho', '[style.height.px]': 'tamanho' },
})
export class EloCorujaComponent implements OnDestroy {
  private readonly _expressao = signal<ExpressaoElo>('normal');
  @Input() set expressao(v: ExpressaoElo) { this._expressao.set(v || 'normal'); }
  get expressao(): ExpressaoElo { return this._expressao(); }

  @Input() tamanho = 64;
  /** Só a cabeça, recortada num círculo (para avatares pequenos). */
  @Input() soRosto = false;
  /** Pequenos movimentos (asas, piscar). Desligados para quem pede menos animação no sistema. */
  @Input() animada = true;
  /** Liga os easter eggs (cliques em cada parte do corpo, segredos por toques seguidos). */
  @Input() interativa = false;

  /** Expressão momentânea de um easter egg (por cima da expressão normal). */
  private readonly exprTemp = signal<ExpressaoElo | null>(null);
  readonly exp = computed<ExpressaoElo>(() => this.exprTemp() ?? this._expressao());
  readonly efeito = signal<Efeito>('');
  readonly fala = signal('');

  private toques: number[] = [];
  private fimReacao?: ReturnType<typeof setTimeout>;
  private timerSegurar?: ReturnType<typeof setTimeout>;
  private segurou = false;

  // ---------- acessibilidade: só vira "botão" quando é interativa ----------
  @HostBinding('attr.role') get role() { return this.interativa ? 'button' : null; }
  @HostBinding('attr.tabindex') get tabindex() { return this.interativa ? 0 : null; }
  @HostBinding('attr.aria-label') get rotulo() { return this.interativa ? 'Elô, a coruja. Toque nela!' : null; }
  @HostBinding('attr.aria-hidden') get escondida() { return this.interativa ? null : 'true'; }
  @HostBinding('class.interativa') get classeInterativa() { return this.interativa; }

  @HostListener('keydown', ['$event'])
  teclou(ev: KeyboardEvent) {
    if (!this.interativa || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    const partes: ParteElo[] = ['olhos', 'barriga', 'asa', 'cachecol', 'orelhas', 'bico', 'pes'];
    this.tocar(partes[Math.floor(Math.random() * partes.length)]);
  }

  /** Clique com mouse não deixa o foco "preso" nela (o Chrome pintava um quadrado cinza). Pelo teclado continua focável. */
  @HostListener('mousedown', ['$event'])
  semFocoNoMouse(ev: MouseEvent) {
    if (this.interativa) ev.preventDefault();
  }

  // ---------- segurar apertado = abraço ----------
  @HostListener('pointerdown')
  apertou() {
    if (!this.interativa) return;
    this.segurou = false;
    clearTimeout(this.timerSegurar);
    this.timerSegurar = setTimeout(() => {
      this.segurou = true;
      this.reagir('acolhendo', 'abraco', 'Abraço quentinho pra você 💜', 2600);
    }, 900);
  }
  @HostListener('pointerup') @HostListener('pointerleave') @HostListener('pointercancel')
  soltou() { clearTimeout(this.timerSegurar); }

  /** Chamado pelos cliques nas partes do corpo (no SVG). */
  tocar(parte: ParteElo, ev?: Event) {
    if (!this.interativa) return;
    ev?.stopPropagation();
    if (this.segurou) { this.segurou = false; return; }   // foi abraço, não clique

    // Toques rápidos seguidos destravam os segredos
    const agora = Date.now();
    this.toques = [...this.toques.filter((t) => agora - t < 2500), agora];
    if (this.toques.length >= 10) {
      this.toques = [];
      this.reagir('tonta', 'tonta', 'Calma! Assim eu fico tontinha 😵‍💫', 3000);
      return;
    }
    if (this.toques.length === 5) {
      this.reagir('sonhando', 'noite', 'Corujas ficam acordadas à noite… como as mães. Eu entendo 🌙', 3800);
      return;
    }

    switch (parte) {
      case 'olhos':
        this.reagir('piscadinha', '', this.sortear(['Tô de olho em você 👀', 'Pisquei! 😉', 'Esses olhões são pra te ver melhor 💜']));
        break;
      case 'barriga':
        this.reagir('risada', 'cocegas', this.sortear(['Hihihi, cócegas não! 🤭', 'Aaai, para! Hihi 😆']));
        break;
      case 'asa':
        this.reagir('oi', '', this.sortear(['Oiê! 👋', 'Tchauzinho… brincadeira, tô aqui! 👋']));
        break;
      case 'cachecol':
        this.reagir('normal', 'cachecol', this.sortear(['Gostou do meu cachecol? 💗', 'É quentinho, foi feito com carinho 🧣']));
        break;
      case 'orelhas':
        this.reagir('piscadinha', 'orelhas', 'Psiu… minhas orelhas são só peninhas! 🦉');
        break;
      case 'bico':
        this.reagir('risada', 'pulo', 'Piu? 🐣');
        break;
      case 'corpo':
        this.reagir('acolhendo', 'cocegas', this.sortear(['Que carinho bom 🥰', 'Hmm, adoro um cafuné 💜']));
        break;
      case 'pes':
        this.reagir('oi', 'pulo', this.sortear(['Upa! 🦶', 'Tô pulando de alegria! ✨']));
        break;
    }
  }

  private reagir(expr: ExpressaoElo, efeito: Efeito, fala: string, duracao = 2200) {
    clearTimeout(this.fimReacao);
    this.efeito.set('');   // reinicia a animação mesmo em toques seguidos
    requestAnimationFrame(() => {
      this.exprTemp.set(expr);
      this.efeito.set(efeito);
      this.fala.set(fala);
    });
    this.fimReacao = setTimeout(() => {
      this.exprTemp.set(null);
      this.efeito.set('');
      this.fala.set('');
    }, duracao);
  }

  private sortear(opcoes: string[]): string {
    return opcoes[Math.floor(Math.random() * opcoes.length)];
  }

  ngOnDestroy() {
    clearTimeout(this.fimReacao);
    clearTimeout(this.timerSegurar);
  }
}
