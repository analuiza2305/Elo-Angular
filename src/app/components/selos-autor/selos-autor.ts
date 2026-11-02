import { ChangeDetectionStrategy, Component, PLATFORM_ID, effect, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SelosAutor, SelosAutorService } from '../../services/selos-autor';

/**
 * Selos ao lado do nome de quem publicou (post, comentário, artigo, evento...).
 *
 *   <app-selos-autor [uid]="post.autorId" />
 *   <app-selos-autor [uid]="evento.parceiroId" [compacto]="true" />   (só os ícones)
 *
 * Mostra: Premium (psicólogo/advogado), Apoiador (empresa parceira) e Bem avaliado.
 * Se a pessoa não tem selo, não desenha nada.
 */
@Component({
  selector: 'app-selos-autor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selos(); as s) {
      @if (s.destaque) {
        <span class="sa sa-destaque" title="Perfil em destaque na plataforma (Premium)">
          <i class="fa-solid fa-star" aria-hidden="true"></i>@if (!compacto()) { Premium }
        </span>
      }
      @if (s.apoiador) {
        <span class="sa sa-apoiador" title="Empresa apoiadora da plataforma">
          <i class="fa-solid fa-handshake-angle" aria-hidden="true"></i>@if (!compacto()) { Apoiador }
        </span>
      }
      @if (s.bemAvaliado) {
        <span class="sa sa-bem" title="Bem avaliado pelas mães">
          <i class="fa-solid fa-heart" aria-hidden="true"></i>@if (!compacto()) { Bem avaliado }
        </span>
      }
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; vertical-align: middle; margin-left: 6px; }
    :host:empty { display: none; }
    .sa {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
      font-size: .68rem; font-weight: 700; line-height: 1.5; white-space: nowrap; cursor: help;
    }
    .sa i { font-size: .62rem; }
    .sa-destaque { background: linear-gradient(135deg, #7C69A9, #52427D); color: #fff; }
    .sa-destaque i { color: #F5C66B; }
    .sa-apoiador { background: #FFF4E0; color: #9A6410; border: 1px solid #FCE3B8; }
    .sa-bem { background: #E7F8F1; color: #0F7A55; border: 1px solid #A7F3D0; }
    :host-context(body[data-theme="dark"]) .sa-apoiador { background: rgba(251, 191, 36, .14); color: #FBBF24; border-color: rgba(251, 191, 36, .3); }
    :host-context(body[data-theme="dark"]) .sa-bem { background: rgba(16, 185, 129, .14); color: #6EE7B7; border-color: rgba(110, 231, 183, .35); }
  `],
})
export class SelosAutorComponent {
  private readonly svc = inject(SelosAutorService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** uid de quem publicou (autorId, parceiroId...). Vazio ou 'anonimo' = sem selo. */
  readonly uid = input<string | null | undefined>('');
  /** true = só os ícones (para cartões apertados). */
  readonly compacto = input(false);

  protected readonly selos = signal<SelosAutor | null>(null);

  constructor() {
    effect((onCleanup) => {
      const uid = (this.uid() || '').trim();
      if (!this.isBrowser || !uid || uid === 'anonimo') {
        this.selos.set(null);
        return;
      }
      let ativo = true;
      onCleanup(() => { ativo = false; });
      this.svc.de(uid).then((s) => {
        if (ativo) this.selos.set(s.destaque || s.apoiador || s.bemAvaliado ? s : null);
      });
    });
  }
}
