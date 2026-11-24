import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DenunciarComponent } from '../denunciar/denunciar';
import { SelosAutorComponent } from '../selos-autor/selos-autor';

/**
 * Card de um evento. Usado na página de Eventos e na home da mãe.
 * Os dados vêm de services/eventos-dados.ts e o "Ver e me inscrever"
 * abre o mesmo modal nas duas (components/evento-detalhes).
 */
@Component({
  selector: 'app-card-evento',
  standalone: true,
  imports: [CommonModule, DenunciarComponent, SelosAutorComponent],
  templateUrl: './card-evento.html',
  styleUrls: ['./card-evento.css'],
})
export class CardEventoComponent {
  @Input({ required: true }) ev: any;
  @Input() inscrito = false;
  @Output() detalhes = new EventEmitter<any>();
  @Output() compartilhar = new EventEmitter<any>();
}
