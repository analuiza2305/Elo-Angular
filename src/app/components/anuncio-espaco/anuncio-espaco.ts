import { ChangeDetectionStrategy, Component, PLATFORM_ID, effect, inject, input, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Anuncio, DivulgacaoService } from '../../services/divulgacao';

/**
 * Espaço estratégico de anúncio.
 *
 *   <app-anuncio-espaco posicao="forum"></app-anuncio-espaco>
 *
 * Mostra UM anúncio no ar daquele espaço, sempre com a etiqueta "Anúncio" (transparência).
 * Se não houver anúncio no ar, ou se der qualquer erro, não desenha nada: o espaço some
 * e a tela fica limpa. Os espaços são definidos em POSICOES_ANUNCIO (services/divulgacao.ts).
 *
 * Regra de ouro: no máximo UM espaço por tela, e nunca em chat, videochamada,
 * questionário ou telas de saúde.
 */
@Component({
  selector: 'app-anuncio-espaco',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (anuncio(); as a) {
      <aside class="ad" role="complementary" aria-label="Anúncio">
        <span class="ad-etiqueta">Anúncio<span class="ad-empresa" *ngIf="a.nomeEmpresa"> · {{ a.nomeEmpresa }}</span></span>

        @if (linkSeguro(a.link); as url) {
          <a class="ad-corpo" [href]="url" target="_blank" rel="noopener noreferrer sponsored" (click)="aoClicar(a)">
            <ng-container *ngTemplateOutlet="conteudo; context: { $implicit: a }"></ng-container>
          </a>
        } @else {
          <div class="ad-corpo">
            <ng-container *ngTemplateOutlet="conteudo; context: { $implicit: a }"></ng-container>
          </div>
        }
      </aside>
    }

    <ng-template #conteudo let-a>
      @if (imagemSeguro(a.imagem) && !semImagem()) {
        <img class="ad-img" [src]="imagemSeguro(a.imagem)" alt="" loading="lazy" (error)="semImagem.set(true)">
      }
      <span class="ad-texto">
        <strong>{{ a.titulo }}</strong>
        @if (a.texto) { <span class="ad-desc">{{ a.texto }}</span> }
        @if (linkSeguro(a.link)) { <span class="ad-cta">Saiba mais <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span> }
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: block; grid-column: 1 / -1; margin: 18px 0; position: relative; z-index: 5; pointer-events: auto; }
    :host:empty { display: none; }
    .ad {
      position: relative; max-width: 920px; margin: 0 auto; padding: 22px 16px 14px;
      background: #FBF8FF; border: 1px solid #E8DEFA; border-radius: 18px;
      box-shadow: 0 6px 20px rgba(91, 61, 153, .07);
    }
    .ad-etiqueta {
      position: absolute; top: 8px; left: 16px; font-size: .64rem; font-weight: 800; letter-spacing: .06em;
      text-transform: uppercase; color: #8B7DB8; pointer-events: none;
    }
    .ad-empresa { text-transform: none; letter-spacing: 0; font-weight: 700; }
    .ad-corpo { display: flex; align-items: center; gap: 16px; color: inherit; text-decoration: none; }
    a.ad-corpo { cursor: pointer; position: relative; z-index: 1; }
    a.ad-corpo:hover .ad-cta { text-decoration: underline; }
    .ad-img { width: 96px; height: 72px; object-fit: cover; border-radius: 12px; flex: none; background: #EFE9FB; }
    .ad-texto { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .ad-texto strong { font-size: 1rem; color: #24164A; }
    .ad-desc { font-size: .88rem; color: #6E5FA0; }
    .ad-cta { font-size: .82rem; font-weight: 800; color: #5B3D99; margin-top: 2px; }
    .ad-cta i { font-size: .7rem; }
    @media (max-width: 520px) { .ad-corpo { flex-direction: column; align-items: flex-start; } .ad-img { width: 100%; height: 130px; } }
    :host-context(body[data-theme="dark"]) .ad { background: #1B2336; border-color: rgba(255, 255, 255, .1); box-shadow: none; }
    :host-context(body[data-theme="dark"]) .ad-etiqueta { color: #B9AEE0; }
    :host-context(body[data-theme="dark"]) .ad-texto strong { color: #F5F0FF; }
    :host-context(body[data-theme="dark"]) .ad-desc { color: #B9AEE0; }
    :host-context(body[data-theme="dark"]) .ad-cta { color: #BDAFFC; }
  `],
})
export class AnuncioEspacoComponent {
  private readonly svc = inject(DivulgacaoService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Id do espaço (ver POSICOES_ANUNCIO): 'forum', 'artigos', 'eventos', 'home-mae'... */
  readonly posicao = input.required<string>();

  protected readonly anuncio = signal<Anuncio | null>(null);
  protected readonly semImagem = signal(false);

  constructor() {
    effect((onCleanup) => {
      const posicao = this.posicao();
      if (!this.isBrowser || !posicao) return;
      let ativo = true;
      onCleanup(() => { ativo = false; });
      this.semImagem.set(false);
      console.log(`[Anúncio] espaço "${posicao}": está na tela, buscando anúncio…`);
      this.svc.anuncioParaExibir(posicao).then((a) => {
        if (!ativo) return;
        this.anuncio.set(a);
        if (a) void this.svc.registrarImpressao(a);
      });
    });
  }

  protected aoClicar(a: Anuncio): void {
    void this.svc.registrarClique(a);
  }

  /** Só links http(s): bloqueia `javascript:` e parecidos. */
  protected linkSeguro(url: string | null | undefined): string | null {
    return url && /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : null;
  }

  protected imagemSeguro(url: string | null | undefined): string | null {
    return this.linkSeguro(url);
  }
}
