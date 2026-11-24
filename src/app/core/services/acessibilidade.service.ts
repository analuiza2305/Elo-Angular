import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { I18nService } from '../i18n/i18n.service';

/**
 * Acessibilidade do site inteiro, num lugar só.
 *
 * Antes cada tela (header, login, cadastro, painéis dos profissionais...) tinha a sua
 * própria versão das funções, e cada uma guardava o estado do seu jeito. Por isso:
 * - ao trocar de página os contadores zeravam (ex.: "Diminuir fonte" pulava de 20px para 14px);
 * - nas telas profissionais as funções estavam vazias;
 * - o F5 perdia tudo.
 *
 * Agora todas as telas chamam este serviço. O estado fica salvo no localStorage e é
 * reaplicado quando o site abre (ver AppComponent).
 *
 * Filtros (daltonismo e alto contraste) vão no <html>, e não no <body>: um filtro no body
 * faz os elementos `position: fixed` (máscara de leitura, modais, avisos) passarem a se
 * posicionar pela página inteira, e eles "somem" ao rolar. No <html> isso não acontece.
 */

const STORAGE_KEY = 'eloAcessibilidade';

const FONTE_PADRAO = 16;
const FONTE_MIN = 12;
const FONTE_MAX = 24;
const PASSO_FONTE = 2;

/** Valores de line-height; cada clique em aumentar/diminuir anda um passo (vale para parágrafos, listas e rótulos). */
const ESPACAMENTOS = [1.2, 1.5, 1.8, 2.0];
const ESPACAMENTO_PADRAO = -1; // -1 = deixa o line-height original de cada tela

const FILTROS_DALTONISMO = ['', 'protanopia', 'deuteranopia', 'tritanopia', 'Acromatopsia'];

interface EstadoAcessibilidade {
  fonte: number;
  espacamento: number;
  daltonismo: number;
  negrito: boolean;
  contraste: boolean;
  mascara: boolean;
}

const ESTADO_INICIAL: EstadoAcessibilidade = {
  fonte: FONTE_PADRAO,
  espacamento: ESPACAMENTO_PADRAO,
  daltonismo: 0,
  negrito: false,
  contraste: false,
  mascara: false,
};

const VOZ_POR_IDIOMA = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' } as const;

/** O que nunca deve ser lido em voz alta (menus, ícones, a própria barra de acessibilidade). */
const IGNORAR_NA_LEITURA = [
  'script', 'style', 'noscript', 'svg', 'nav',
  '[aria-hidden="true"]', '[data-acc-ignorar]',
  '#accessibility-menu', '.accessibility-selector', '.acc-menu', '#language-menu',
  '.auth-top-actions', '#reading-mask-overlay', '[vw]',
].join(',');

@Injectable({ providedIn: 'root' })
export class AcessibilidadeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly i18n = inject(I18nService);
  private readonly noBrowser = isPlatformBrowser(this.platformId);

  readonly estado = signal<EstadoAcessibilidade>({ ...ESTADO_INICIAL });
  readonly lendo = signal(false);

  private ouvindoMouse = false;

  constructor() {
    if (!this.noBrowser) return;
    try {
      const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (salvo && typeof salvo === 'object') {
        this.estado.set({ ...ESTADO_INICIAL, ...salvo });
      }
    } catch {
      /* localStorage indisponível ou valor inválido: começa do padrão */
    }
  }

  // ---------- ações do menu ----------

  aumentarFonte(): void {
    this.atualizar((e) => ({ ...e, fonte: Math.min(e.fonte + PASSO_FONTE, FONTE_MAX) }));
  }

  diminuirFonte(): void {
    this.atualizar((e) => ({ ...e, fonte: Math.max(e.fonte - PASSO_FONTE, FONTE_MIN) }));
  }

  aumentarEspacamento(): void {
    this.atualizar((e) => ({
      ...e,
      // do "original" vai direto para 1.8 (o 1.2 e o 1.5 ficam para quem quer diminuir)
      espacamento: e.espacamento < 0 ? 2 : Math.min(e.espacamento + 1, ESPACAMENTOS.length - 1),
    }));
  }

  diminuirEspacamento(): void {
    this.atualizar((e) => ({
      ...e,
      espacamento: e.espacamento < 0 ? 0 : Math.max(e.espacamento - 1, 0),
    }));
  }

  alternarDaltonismo(): void {
    this.atualizar((e) => ({ ...e, daltonismo: (e.daltonismo + 1) % FILTROS_DALTONISMO.length }));
  }

  alternarNegrito(): void {
    this.atualizar((e) => ({ ...e, negrito: !e.negrito }));
  }

  alternarContraste(): void {
    this.atualizar((e) => ({ ...e, contraste: !e.contraste }));
  }

  alternarMascara(): void {
    this.atualizar((e) => ({ ...e, mascara: !e.mascara }));
  }

  alternarLeitura(): void {
    if (!this.noBrowser || !('speechSynthesis' in window)) return;
    if (this.lendo()) {
      this.pararLeitura();
      return;
    }
    const texto = this.textoParaLer();
    if (!texto) return;

    window.speechSynthesis.cancel();
    const lang = VOZ_POR_IDIOMA[this.i18n.idioma()] ?? 'pt-BR';
    const voz = window.speechSynthesis.getVoices?.().find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2)));
    const trechos = this.dividirEmTrechos(texto);

    this.lendo.set(true);
    trechos.forEach((trecho, i) => {
      const fala = new SpeechSynthesisUtterance(trecho);
      fala.lang = lang;
      if (voz) fala.voice = voz;
      if (i === trechos.length - 1) {
        fala.onend = () => this.lendo.set(false);
        fala.onerror = () => this.lendo.set(false);
      }
      window.speechSynthesis.speak(fala);
    });
  }

  redefinir(): void {
    this.pararLeitura();
    this.atualizar(() => ({ ...ESTADO_INICIAL }));
  }

  // ---------- aplicar na página ----------

  /** Chamado ao abrir o site: reaplica o que a pessoa tinha escolhido. */
  aplicar(): void {
    if (!this.noBrowser) return;
    const e = this.estado();
    const html = document.documentElement;
    const body = document.body;

    // Fonte: tudo que usa rem acompanha o tamanho do <html>
    html.style.fontSize = e.fonte === FONTE_PADRAO ? '' : `${e.fonte}px`;
    // Com letra maior, os cabeçalhos podem quebrar em duas linhas (ver styles.css)
    html.classList.toggle('acc-fonte-grande', e.fonte > FONTE_PADRAO);

    // Espaçamento entre linhas: regra global em styles.css usa esta variável
    if (e.espacamento >= 0) {
      html.style.setProperty('--acc-line-height', String(ESPACAMENTOS[e.espacamento]));
      html.classList.add('acc-espacamento');
    } else {
      html.style.removeProperty('--acc-line-height');
      html.classList.remove('acc-espacamento');
    }

    // Filtros no <html> (ver comentário do topo). Daltonismo e contraste podem ficar juntos.
    const filtros: string[] = [];
    const dalton = FILTROS_DALTONISMO[e.daltonismo];
    if (dalton) filtros.push(`url(#${dalton})`);
    if (e.contraste) filtros.push('invert(1) hue-rotate(180deg) contrast(1.2)');
    html.style.filter = filtros.join(' ');
    html.classList.toggle('acc-contraste', e.contraste);

    // Classes antigas que o CSS das telas já conhece
    body.classList.toggle('acessibilidade-negrito', e.negrito);
    body.style.filter = '';
    body.style.lineHeight = '';
    body.classList.remove(
      'acessibilidade-alto-contraste', 'high-contrast-active', 'bold-text-active',
      'line-spacing-sm', 'line-spacing-lg',
      'colorblind-protanopia', 'colorblind-deuteranopia', 'colorblind-tritanopia', 'colorblind-Acromatopsia',
    );

    this.aplicarMascara(e.mascara);
  }

  // ---------- internos ----------

  private atualizar(fn: (e: EstadoAcessibilidade) => EstadoAcessibilidade): void {
    this.estado.update(fn);
    if (!this.noBrowser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.estado()));
    } catch {
      /* sem localStorage: funciona só nesta visita */
    }
    this.aplicar();
  }

  private aplicarMascara(ativa: boolean): void {
    document.querySelectorAll<HTMLElement>('#reading-mask-overlay').forEach((mask) => {
      mask.classList.toggle('hidden', !ativa);
      mask.style.display = ativa ? 'block' : 'none';
    });
    if (ativa && !this.ouvindoMouse) {
      this.ouvindoMouse = true;
      document.addEventListener('mousemove', this.moverMascara, { passive: true });
    } else if (!ativa && this.ouvindoMouse) {
      this.ouvindoMouse = false;
      document.removeEventListener('mousemove', this.moverMascara);
    }
  }

  private readonly moverMascara = (event: MouseEvent): void => {
    document.querySelectorAll<HTMLElement>('#reading-mask-overlay .highlight-window').forEach((faixa) => {
      const altura = faixa.offsetHeight || 120;
      faixa.style.transform = 'none';
      faixa.style.top = `${event.clientY - altura / 2}px`;
    });
  };

  private pararLeitura(): void {
    if (this.noBrowser && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    this.lendo.set(false);
  }

  /** Lê o texto selecionado; sem seleção, o conteúdo principal da tela (sem menus e botões de ícone). */
  private textoParaLer(): string {
    const selecionado = window.getSelection()?.toString().trim();
    if (selecionado) return selecionado;

    const raiz =
      document.querySelector('main') ??
      document.querySelector('[role="main"]') ??
      document.querySelector('router-outlet + *') ??
      document.body;

    const texto = this.textoSemMenus(raiz);
    // <main> vazio (ex.: ainda carregando): lê a página toda, sem os menus
    return texto || (raiz !== document.body ? this.textoSemMenus(document.body) : '');
  }

  private textoSemMenus(raiz: Element): string {
    const copia = raiz.cloneNode(true) as HTMLElement;
    copia.querySelectorAll(IGNORAR_NA_LEITURA).forEach((el) => el.remove());
    // innerText de nó fora do DOM não respeita quebras; textContent + limpeza resolve
    return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** O Chrome corta falas muito longas; mandamos em pedaços de até ~200 caracteres. */
  private dividirEmTrechos(texto: string): string[] {
    const frases = texto.match(/[^.!?…]+[.!?…]*/g) ?? [texto];
    const trechos: string[] = [];
    let atual = '';
    for (const frase of frases) {
      if ((atual + frase).length > 200 && atual) {
        trechos.push(atual.trim());
        atual = '';
      }
      atual += frase;
    }
    if (atual.trim()) trechos.push(atual.trim());
    return trechos;
  }
}
