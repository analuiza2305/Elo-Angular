import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { AlertaService } from '../../core/services/alerta.service';

/**
 * Modal global de avisos. Fica montado no `app.html` e exibe o que o
 * `AlertaService` colocar em `atual`.
 */
@Component({
  selector: 'app-alerta',
  standalone: true,
  templateUrl: './alerta.html',
  styleUrls: ['./alerta.css'],
  host: { '(document:keydown)': 'onTecla($event)' },
})
export class AlertaComponent {
  readonly alerta = inject(AlertaService);

  private readonly botaoOk = viewChild<ElementRef<HTMLButtonElement>>('botaoOk');
  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');

  constructor() {
    // Foca o campo (entrada) ou o botão principal assim que o modal abre.
    effect(() => {
      if (!this.alerta.atual()) return;
      const alvo = this.campo() ?? this.botaoOk();
      queueMicrotask(() => alvo?.nativeElement.focus());
    });
  }

  confirmar(): void {
    const atual = this.alerta.atual();
    if (!atual) return;
    if (atual.tipo === 'entrada') {
      this.alerta.responder(this.campo()?.nativeElement.value ?? '');
    } else {
      this.alerta.responder(true);
    }
  }

  cancelar(): void {
    const atual = this.alerta.atual();
    if (!atual) return;
    this.alerta.responder(atual.tipo === 'entrada' ? null : false);
  }

  onTecla(e: KeyboardEvent): void {
    if (!this.alerta.atual()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelar();
    } else if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
      e.preventDefault();
      this.confirmar();
    }
  }

  temCancelar(): boolean {
    const tipo = this.alerta.atual()?.tipo;
    return tipo === 'confirmar' || tipo === 'entrada';
  }
}
