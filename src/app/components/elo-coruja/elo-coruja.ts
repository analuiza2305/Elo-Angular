import { Component, Input } from '@angular/core';

/** Expressões da Elô (as mesmas da folha da mascote). */
export type ExpressaoElo = 'normal' | 'oi' | 'pensando' | 'acolhendo' | 'piscadinha';

/**
 * Elô — a coruja que acompanha cada mãe no EloMaterno.
 * Desenhada em SVG (fica nítida em qualquer tamanho e não precisa de arquivo de imagem).
 *
 * Uso:
 *   <app-elo-coruja expressao="oi" [tamanho]="96"></app-elo-coruja>
 *   <app-elo-coruja expressao="pensando" [soRosto]="true" [tamanho]="40"></app-elo-coruja>
 *
 * - normal: padrão (avatar do chat)
 * - oi: acenando, boas-vindas e começo da conversa
 * - pensando: enquanto busca a resposta
 * - acolhendo: quando a mãe conta algo difícil
 * - piscadinha: dicas e conquistas
 */
@Component({
  selector: 'app-elo-coruja',
  standalone: true,
  templateUrl: './elo-coruja.html',
  styleUrls: ['./elo-coruja.css'],
  host: { '[style.width.px]': 'tamanho', '[style.height.px]': 'tamanho', 'aria-hidden': 'true' },
})
export class EloCorujaComponent {
  @Input() expressao: ExpressaoElo = 'normal';
  @Input() tamanho = 64;
  /** Só a cabeça, recortada num círculo (para avatares pequenos). */
  @Input() soRosto = false;
  /** Pequeno movimento (aceno, piscar). Desligado para quem pede menos animação no sistema. */
  @Input() animada = true;
}
