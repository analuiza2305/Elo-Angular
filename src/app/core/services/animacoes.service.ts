import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// Elementos que entram com animação ao aparecer na tela (classes terminadas em "card", títulos, linhas de tabela ou opt-in via data-reveal)
const SELETOR_REVELAR = '[class*="card"], [class*="Card"], h1, h2, tbody > tr, [data-reveal]';
// Regiões que nunca recebem a animação de entrada (navegação, modais, landing page, que tem animação própria)
const SELETOR_IGNORAR = [
  '[data-no-reveal]', 'app-header', 'header', 'nav', 'footer', 'app-footer-simples', 'app-alerta', 'app-landing-page',
  '[role="dialog"]', 'dialog', '[class*="modal"]', '[class*="drawer"]', '[class*="overlay"]', '.fade-in',
].join(', ');
const SELETOR_BOTAO = 'button, [role="button"], .btn, [class*="btn"], input[type="submit"]';
// Números que contam do valor antigo até o novo (estatísticas, contadores)
const SELETOR_NUMERO = '.stat-number, .counter, [class*="numero"], [class*="-number"], [class*="contador"], [data-contar]';

const ATRASO_ENTRE_ITENS = 70;
const MAX_ITENS_ESCALONADOS = 8;
const DURACAO_ENTRADA = 650;
const DURACAO_CONTAGEM = 1100;

// Texto curto com um único número, opcionalmente com prefixo/sufixo (ex.: "R$ 1.234", "98%", "4,8")
const RE_TEXTO_NUMERICO = /^(\D{0,4}?)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(\D{0,4})$/;

interface NumeroLido {
  prefixo: string;
  sufixo: string;
  valor: number;
  casas: number;
  sepDecimal: string;
  milhar: boolean;
}

/**
 * Camada global de animações e microinterações do site.
 * - Revela cards, títulos e linhas de tabela conforme entram na tela (com efeito cascata)
 * - Números de estatísticas contam até o valor (e animam de novo quando o dado muda)
 * - Efeito "ripple" ao clicar em botões
 * - Fade nas imagens ao carregar
 * - Sombra no header e barra de progresso ao rolar a página
 * Tudo respeita o "reduzir movimento" do sistema. Para desligar num elemento: data-no-reveal / data-no-ripple.
 */
@Injectable({
  providedIn: 'root'
})
export class AnimacoesService {
  private platformId = inject(PLATFORM_ID);
  private iniciado = false;
  private observadorRevelar: IntersectionObserver | null = null;
  private observadorNumeros: IntersectionObserver | null = null;
  // Último texto escrito pela contagem em cada nó, para ignorar as próprias mutações
  private textoEscrito = new WeakMap<Text, string>();

  iniciar() {
    if (!isPlatformBrowser(this.platformId) || this.iniciado) return;
    this.iniciado = true;

    this.observarRolagem();

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    document.addEventListener('pointerdown', e => this.criarRipple(e), { passive: true });

    if (!('IntersectionObserver' in window)) return;

    this.observadorRevelar = new IntersectionObserver(entradas => this.revelar(entradas), {
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.08,
    });
    this.observadorNumeros = new IntersectionObserver(entradas => this.numerosVisiveis(entradas), {
      threshold: 0.5,
    });

    // O que já está visível no primeiro carregamento não é escondido (evita "piscar" após a renderização do servidor)
    this.registrar(document.body, true);

    new MutationObserver(mutacoes => {
      for (const m of mutacoes) {
        if (m.type === 'characterData') {
          this.textoMudou(m.target as Text, m.oldValue ?? '');
          continue;
        }
        m.addedNodes.forEach(no => {
          if (no instanceof HTMLElement) this.registrar(no, false);
          else if (no instanceof Text) this.textoMudou(no, '');
        });
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
  }

  private registrar(raiz: HTMLElement, cargaInicial: boolean) {
    for (const el of this.buscar<HTMLElement>(raiz, SELETOR_REVELAR)) this.prepararRevelar(el, cargaInicial);
    for (const el of this.buscar<HTMLElement>(raiz, SELETOR_NUMERO)) this.prepararNumero(el);
    for (const img of this.buscar<HTMLImageElement>(raiz, 'img')) this.prepararImagem(img);
  }

  private buscar<T extends Element>(raiz: HTMLElement, seletor: string): T[] {
    const encontrados = Array.from(raiz.querySelectorAll<T>(seletor));
    if (raiz.matches(seletor)) encontrados.unshift(raiz as unknown as T);
    return encontrados;
  }

  // ---------- Entrada ao rolar ----------

  private prepararRevelar(el: HTMLElement, cargaInicial: boolean) {
    if (el.dataset['rv'] !== undefined) return;

    let tipo = '';
    if (el.matches('h1, h2')) tipo = 'titulo';
    else if (el.matches('tbody > tr')) tipo = 'linha';
    else if (!el.hasAttribute('data-reveal') && !Array.from(el.classList).some(c => /card$/i.test(c))) return;

    if (el.closest(SELETOR_IGNORAR)) return;
    // Só o elemento mais externo anima, senão os internos animam duas vezes
    if (el.parentElement?.closest('[data-rv]')) return;
    if (getComputedStyle(el).animationName !== 'none') return;

    if (cargaInicial && el.getBoundingClientRect().top < window.innerHeight) {
      el.dataset['rv'] = 'ok';
      return;
    }

    if (tipo) el.dataset['rvTipo'] = tipo;
    el.dataset['rv'] = 'oculto';
    this.observadorRevelar!.observe(el);
  }

  private revelar(entradas: IntersectionObserverEntry[]) {
    let indice = 0;
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      const el = entrada.target as HTMLElement;
      this.observadorRevelar!.unobserve(el);

      const atraso = Math.min(indice++, MAX_ITENS_ESCALONADOS) * ATRASO_ENTRE_ITENS;
      el.style.setProperty('--rv-atraso', `${atraso}ms`);
      el.dataset['rv'] = 'entrando';

      setTimeout(() => {
        el.dataset['rv'] = 'ok';
        el.style.removeProperty('--rv-atraso');
      }, atraso + DURACAO_ENTRADA);
    }
  }

  // ---------- Contagem de números ----------

  private prepararNumero(el: HTMLElement) {
    if (el.dataset['num'] !== undefined || el.closest('[data-no-reveal], app-landing-page')) return;
    el.dataset['num'] = 'aguardando';
    this.observadorNumeros!.observe(el);
  }

  private numerosVisiveis(entradas: IntersectionObserverEntry[]) {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      const el = entrada.target as HTMLElement;
      this.observadorNumeros!.unobserve(el);
      el.dataset['num'] = 'visto';
      const no = this.textoUnico(el);
      if (no) this.contar(no, 0);
    }
  }

  private textoMudou(no: Text, textoAnterior: string) {
    if (this.textoEscrito.get(no) === no.data) return;
    const el = no.parentElement;
    if (!el) return;

    if (el.dataset['num'] === 'visto' && this.textoUnico(el) === no) {
      const anterior = this.lerNumero(textoAnterior.trim());
      this.contar(no, anterior?.valor ?? 0);
    }
  }

  private textoUnico(el: HTMLElement): Text | null {
    return el.childNodes.length === 1 && el.firstChild instanceof Text ? el.firstChild : null;
  }

  private contar(no: Text, de: number) {
    const original = no.data;
    const espacoInicio = original.match(/^\s*/)![0];
    const espacoFim = original.match(/\s*$/)![0];
    const alvo = this.lerNumero(original.trim());
    if (!alvo || alvo.valor === de) return;

    const inicio = performance.now();
    const passo = (agora: number) => {
      // Se o Angular trocou o texto no meio da contagem, a nova mutação assume daqui
      const escrito = this.textoEscrito.get(no);
      if (escrito !== undefined && no.data !== escrito) return;

      const t = Math.min((agora - inicio) / DURACAO_CONTAGEM, 1);
      const suavizado = 1 - Math.pow(1 - t, 3);
      const texto = t < 1
        ? espacoInicio + alvo.prefixo + this.formatarNumero(de + (alvo.valor - de) * suavizado, alvo) + alvo.sufixo + espacoFim
        : original;

      this.textoEscrito.set(no, texto);
      no.data = texto;
      if (t < 1) requestAnimationFrame(passo);
      else this.textoEscrito.delete(no);
    };
    this.textoEscrito.delete(no);
    requestAnimationFrame(passo);
  }

  private lerNumero(texto: string): NumeroLido | null {
    const m = RE_TEXTO_NUMERICO.exec(texto);
    if (!m) return null;
    const bruto = m[2];
    // Formato pt-BR: "1.234" / "1.234,5" usam ponto como milhar
    const milhar = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(bruto);
    let sepDecimal = ',';
    let normalizado: string;
    if (milhar) {
      normalizado = bruto.replace(/\./g, '').replace(',', '.');
    } else if (bruto.includes(',')) {
      normalizado = bruto.replace(',', '.');
    } else {
      sepDecimal = '.';
      normalizado = bruto;
    }
    const casas = normalizado.includes('.') ? normalizado.split('.')[1].length : 0;
    return { prefixo: m[1], sufixo: m[3], valor: parseFloat(normalizado), casas, sepDecimal, milhar };
  }

  private formatarNumero(valor: number, formato: NumeroLido): string {
    let [inteiro, decimal] = valor.toFixed(formato.casas).split('.');
    if (formato.milhar) inteiro = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decimal ? inteiro + formato.sepDecimal + decimal : inteiro;
  }

  // ---------- Imagens ----------

  private prepararImagem(img: HTMLImageElement) {
    if (img.dataset['img'] !== undefined || img.complete) return;
    img.dataset['img'] = 'carregando';
    const concluir = () => { img.dataset['img'] = 'ok'; };
    img.addEventListener('load', concluir, { once: true });
    img.addEventListener('error', concluir, { once: true });
  }

  // ---------- Ripple ----------

  private criarRipple(e: PointerEvent) {
    if (e.button !== 0) return;
    const alvo = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELETOR_BOTAO);
    if (!alvo || alvo.closest('[data-no-ripple]') || alvo.matches(':disabled')) return;

    const estilo = getComputedStyle(alvo);
    if (estilo.display === 'inline' || estilo.display === 'contents') return;

    // O ripple precisa de um ancestral posicionado. Em botões "static" só ajusta se não houver
    // filhos absolutos (ex.: badges), que mudariam de referência.
    let restaurarPosicao = false;
    if (estilo.position === 'static') {
      const temFilhoAbsoluto = Array.from(alvo.children).some(f => getComputedStyle(f).position === 'absolute');
      if (temFilhoAbsoluto) return;
      alvo.style.position = 'relative';
      restaurarPosicao = true;
    }

    const rect = alvo.getBoundingClientRect();
    const tamanho = Math.max(rect.width, rect.height) * 2;

    const camada = document.createElement('span');
    camada.className = 'ripple-camada';
    const onda = document.createElement('span');
    onda.className = 'ripple-onda';
    onda.style.width = onda.style.height = `${tamanho}px`;
    onda.style.left = `${e.clientX - rect.left - tamanho / 2}px`;
    onda.style.top = `${e.clientY - rect.top - tamanho / 2}px`;
    camada.appendChild(onda);
    alvo.appendChild(camada);

    setTimeout(() => {
      camada.remove();
      if (restaurarPosicao) alvo.style.removeProperty('position');
    }, 650);
  }

  // ---------- Rolagem ----------

  private observarRolagem() {
    const barra = document.createElement('div');
    barra.className = 'progresso-rolagem';
    barra.setAttribute('aria-hidden', 'true');
    document.body.appendChild(barra);

    let agendado = false;
    const atualizar = () => {
      agendado = false;
      document.documentElement.toggleAttribute('data-rolou', window.scrollY > 8);

      const total = document.documentElement.scrollHeight - window.innerHeight;
      // Só aparece em páginas com bastante conteúdo para rolar
      barra.classList.toggle('visivel', total > 300);
      barra.style.transform = `scaleX(${total > 0 ? Math.min(window.scrollY / total, 1) : 0})`;
    };
    window.addEventListener('scroll', () => {
      if (!agendado) {
        agendado = true;
        requestAnimationFrame(atualizar);
      }
    }, { passive: true });
    // A altura da página muda ao trocar de rota ou quando os dados chegam
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(atualizar).observe(document.body);
    else window.addEventListener('resize', atualizar, { passive: true });
    atualizar();
  }
}
