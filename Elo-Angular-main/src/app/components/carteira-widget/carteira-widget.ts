import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CreditosService } from '../../core/services/creditos.service';

/**
 * Badge de saldo pra colocar em qualquer header (mãe ou parceiro).
 * Uso: <app-carteira-widget [uid]="currentUser()?.uid" tipo="mae" />
 *
 * Quando o saldo sobe (compra, transferência recebida, renovação mensal),
 * o badge pisca, solta umas moedinhas e mostra um "+N" subindo — a mãe vê
 * o crédito caindo na conta sem precisar procurar na página.
 */
@Component({
  selector: 'app-carteira-widget',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './carteira-widget.html',
  styleUrls: ['./carteira-widget.css'],
})
export class CarteiraWidgetComponent implements OnChanges, OnDestroy {
  @Input() uid: string | null = null;
  @Input() tipo: 'mae' | 'parceiro' = 'mae';

  saldo = signal<number | null>(null);
  carregando = signal<boolean>(true);

  /** Estado da animação de ganho. */
  ganhou = signal<boolean>(false);
  ganho = signal<number>(0);

  /** Moedinhas que sobem do badge. */
  readonly moedas = [0, 1, 2, 3, 4];

  private sub?: Subscription;
  private saldoAnterior: number | null = null;
  private timers: any[] = [];

  constructor(private creditosService: CreditosService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['uid'] || changes['tipo']) {
      this.assinar();
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.timers.forEach((t) => clearTimeout(t));
  }

  private assinar() {
    this.sub?.unsubscribe();
    this.saldo.set(null);
    this.saldoAnterior = null;

    if (!this.uid) {
      this.carregando.set(false);
      return;
    }

    this.carregando.set(true);

    if (this.tipo === 'parceiro') {
      this.sub = this.creditosService.carteiraParceiro$(this.uid).subscribe({
        next: (carteira) => this.aplicarSaldo(carteira.creditopremium),
        error: () => this.carregando.set(false),
      });
    } else {
      this.sub = this.creditosService.carteiraMae$(this.uid).subscribe({
        next: (carteira) => this.aplicarSaldo(carteira.total),
        error: () => this.carregando.set(false),
      });
    }
  }

  private aplicarSaldo(novo: number) {
    const anterior = this.saldoAnterior;
    this.saldo.set(novo);
    this.carregando.set(false);

    // Só comemora quando já existia um saldo antes (evita animar no primeiro load).
    if (anterior !== null && novo > anterior) {
      this.comemorar(novo - anterior);
    }
    this.saldoAnterior = novo;
  }

  private comemorar(quanto: number) {
    this.ganho.set(quanto);
    this.ganhou.set(true);
    this.timers.push(setTimeout(() => this.ganhou.set(false), 2200));
  }
}
