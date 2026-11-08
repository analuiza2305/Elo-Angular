import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TRANSLATIONS, Idioma } from './translations';

const STORAGE_KEY = 'preferredLanguage';
const IDIOMAS: Idioma[] = ['pt', 'en', 'es'];

/**
 * Idioma do site (um único para todas as páginas).
 *
 * - O idioma escolhido fica salvo no localStorage, então continua igual
 *   ao trocar de página (ex.: da landing para "Sou Profissional") e ao voltar ao site.
 * - Como é um signal, todo texto que usa o pipe `t` se atualiza sozinho na hora da troca.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly idioma = signal<Idioma>('pt');

  readonly bandeiraUrl = computed(() => {
    const codigo = { pt: 'br', en: 'us', es: 'es' }[this.idioma()];
    return `https://flagcdn.com/w20/${codigo}.png`;
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const salvo = localStorage.getItem(STORAGE_KEY) as Idioma | null;
      if (salvo && IDIOMAS.includes(salvo)) this.idioma.set(salvo);
      this.atualizarAtributoLang();
    }
  }

  setIdioma(idioma: Idioma): void {
    const valido = IDIOMAS.includes(idioma) ? idioma : 'pt';
    this.idioma.set(valido);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, valido);
      this.atualizarAtributoLang();
    }
  }

  /** Texto traduzido da chave; se faltar no idioma atual, usa o português. */
  t(chave: string): string {
    return TRANSLATIONS[this.idioma()][chave] ?? TRANSLATIONS.pt[chave] ?? chave;
  }

  private atualizarAtributoLang(): void {
    document.documentElement.lang = this.idioma() === 'pt' ? 'pt-BR' : this.idioma();
  }
}
