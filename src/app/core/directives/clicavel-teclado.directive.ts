import { Directive, ElementRef, HostBinding, HostListener, Input, inject } from '@angular/core';

/**
 * Deixa um elemento que só tinha (click) — como os <li> dos menus de acessibilidade
 * e idioma — usável pelo teclado: entra no Tab e dispara o clique com Enter ou Espaço.
 *
 * Uso: <li appTeclado (click)="fazerAlgo()">...</li>
 */
@Directive({ selector: '[appTeclado]', standalone: true })
export class ClicavelTecladoDirective {
  private readonly el = inject(ElementRef<HTMLElement>);

  /** Papel lido pelo leitor de tela (padrão: item de menu). */
  @Input() appTeclado: string | '' = '';

  @HostBinding('attr.tabindex') readonly tabindex = 0;

  @HostBinding('attr.role') get role(): string {
    return this.appTeclado || 'menuitem';
  }

  @HostListener('keydown', ['$event'])
  aoTeclar(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.el.nativeElement.click();
    }
  }
}
