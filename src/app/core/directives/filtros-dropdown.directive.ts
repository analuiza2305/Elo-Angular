import { AfterViewInit, Directive, ElementRef, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

let contador = 0;

/**
 * Filtros em dropdown no celular.
 *
 * Vai no container dos filtros (`<div class="elo-filtros" appFiltrosDropdown>`).
 * No computador nada muda: os botões continuam lado a lado.
 * Até 900px (ver "FILTROS EM DROPDOWN" no styles.css) aparece um botão
 * com o filtro escolhido; ao tocar, a lista abre embaixo da barra.
 *
 * Os botões são os mesmos do computador, então o estado (qual está ativo)
 * continua num lugar só: o botão do topo só copia o que estiver com .active/.ativo.
 */
@Directive({ selector: '[appFiltrosDropdown]', standalone: true })
export class FiltrosDropdownDirective implements AfterViewInit, OnDestroy {
  private readonly el: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly noNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private gatilho?: HTMLButtonElement;
  private rotulo?: HTMLSpanElement;
  private observador?: MutationObserver;
  private readonly limpar: (() => void)[] = [];

  ngAfterViewInit() {
    if (!this.noNavegador) return;
    const lista = this.el.nativeElement;
    const pai = lista.parentElement;
    if (!pai) return;

    if (!lista.id) lista.id = 'elo-filtros-' + (++contador);

    const gatilho = document.createElement('button');
    gatilho.type = 'button';
    gatilho.className = 'elo-filtros-gatilho';
    gatilho.setAttribute('aria-expanded', 'false');
    gatilho.setAttribute('aria-controls', lista.id);
    const nomeGrupo = lista.getAttribute('aria-label');
    if (nomeGrupo) gatilho.setAttribute('title', nomeGrupo);

    const rotulo = document.createElement('span');
    rotulo.className = 'elo-filtros-gatilho-rotulo';
    const seta = document.createElement('i');
    seta.className = 'fa-solid fa-chevron-down elo-filtros-gatilho-seta';
    seta.setAttribute('aria-hidden', 'true');
    gatilho.append(rotulo, seta);
    pai.insertBefore(gatilho, lista);
    pai.classList.add('tem-dropdown');

    this.gatilho = gatilho;
    this.rotulo = rotulo;
    this.atualizarRotulo();

    const aoClicarGatilho = (e: Event) => { e.stopPropagation(); this.alternar(); };
    gatilho.addEventListener('click', aoClicarGatilho);
    this.limpar.push(() => gatilho.removeEventListener('click', aoClicarGatilho));

    // Escolheu um filtro: fecha e devolve o foco para o botão do topo
    const aoClicarLista = (e: Event) => {
      if ((e.target as HTMLElement).closest('.elo-filtro') && this.aberto) {
        this.fechar();
        gatilho.focus();
      }
    };
    lista.addEventListener('click', aoClicarLista);
    this.limpar.push(() => lista.removeEventListener('click', aoClicarLista));

    // Saiu da lista com o Tab: fecha
    const aoSairFoco = (e: FocusEvent) => {
      const destino = e.relatedTarget as Node | null;
      if (this.aberto && destino && !lista.contains(destino) && destino !== gatilho) this.fechar();
    };
    lista.addEventListener('focusout', aoSairFoco);
    this.limpar.push(() => lista.removeEventListener('focusout', aoSairFoco));

    const aoClicarFora = (e: Event) => {
      if (this.aberto && !lista.contains(e.target as Node) && e.target !== gatilho) this.fechar();
    };
    document.addEventListener('click', aoClicarFora);
    this.limpar.push(() => document.removeEventListener('click', aoClicarFora));

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.aberto) { this.fechar(); gatilho.focus(); }
    };
    document.addEventListener('keydown', aoTeclar);
    this.limpar.push(() => document.removeEventListener('keydown', aoTeclar));

    // Filtro trocado (por clique, rota ou código): atualiza o texto do botão
    this.observador = new MutationObserver(() => this.atualizarRotulo());
    this.observador.observe(lista, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  private get aberto() { return this.el.nativeElement.classList.contains('aberto'); }

  private alternar() {
    if (this.aberto) { this.fechar(); return; }
    this.el.nativeElement.classList.add('aberto');
    this.gatilho?.classList.add('aberto');
    this.gatilho?.setAttribute('aria-expanded', 'true');
    const ativo = this.el.nativeElement.querySelector<HTMLElement>('.elo-filtro.active, .elo-filtro.ativo')
      ?? this.el.nativeElement.querySelector<HTMLElement>('.elo-filtro');
    ativo?.focus({ preventScroll: true });
  }

  private fechar() {
    this.el.nativeElement.classList.remove('aberto');
    this.gatilho?.classList.remove('aberto');
    this.gatilho?.setAttribute('aria-expanded', 'false');
  }

  private atualizarRotulo() {
    if (!this.rotulo) return;
    const lista = this.el.nativeElement;
    const ativo = lista.querySelector<HTMLElement>('.elo-filtro.active, .elo-filtro.ativo')
      ?? lista.querySelector<HTMLElement>('.elo-filtro');
    if (!ativo) return;
    const assinatura = ativo.innerHTML;
    if (this.rotulo.dataset['de'] === assinatura) return;
    this.rotulo.dataset['de'] = assinatura;
    this.rotulo.replaceChildren(...Array.from(ativo.childNodes).map(n => n.cloneNode(true)));
    const nomeGrupo = lista.getAttribute('aria-label');
    this.gatilho?.setAttribute('aria-label', (nomeGrupo ? nomeGrupo + ': ' : '') + (ativo.textContent || '').trim().replace(/\s+/g, ' '));
  }

  ngOnDestroy() {
    this.observador?.disconnect();
    this.limpar.forEach(f => f());
    this.gatilho?.remove();
  }
}
