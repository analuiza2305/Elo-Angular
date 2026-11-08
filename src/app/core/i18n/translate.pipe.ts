import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Uso no HTML:
 *   {{ 'chave' | t }}                     -> texto simples
 *   <h1 [innerHTML]="'chave' | t"></h1>   -> texto com <span>/<strong>
 *
 * É "impuro" para reler o idioma atual a cada atualização da tela.
 * Como o idioma é um signal, a troca de idioma já redesenha a página sozinha.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(chave: string): string {
    return this.i18n.t(chave);
  }
}
