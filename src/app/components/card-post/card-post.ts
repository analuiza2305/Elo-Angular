import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DenunciarComponent } from '../denunciar/denunciar';
import { SelosAutorComponent } from '../selos-autor/selos-autor';

/**
 * Card de um post do fórum. Usado na página do Fórum e na home da mãe,
 * para os dois ficarem sempre iguais. Os dados vêm de services/forum-dados.ts.
 */
@Component({
  selector: 'app-card-post',
  standalone: true,
  imports: [CommonModule, DenunciarComponent, SelosAutorComponent],
  templateUrl: './card-post.html',
  styleUrls: ['./card-post.css'],
})
export class CardPostComponent {
  @Input({ required: true }) post: any;
  /** mostra "Denunciar" (logada e o post não é dela) */
  @Input() podeDenunciar = false;
  @Output() abrir = new EventEmitter<string>();
  @Output() curtir = new EventEmitter<any>();
  @Output() editar = new EventEmitter<Event>();
  @Output() excluir = new EventEmitter<Event>();

  aoCurtir(e: Event) { e.stopPropagation(); this.curtir.emit(this.post); }
}
