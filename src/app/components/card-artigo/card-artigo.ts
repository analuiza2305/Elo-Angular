import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SelosAutorComponent } from '../selos-autor/selos-autor';

/**
 * Card de uma postagem da Comunidade (artigo). Usado na página de Comunidade,
 * no painel do parceiro e na home da mãe. Os dados vêm de services/artigos-dados.ts.
 */
@Component({
  selector: 'app-card-artigo',
  standalone: true,
  imports: [CommonModule, SelosAutorComponent],
  templateUrl: './card-artigo.html',
  styleUrls: ['./card-artigo.css'],
})
export class CardArtigoComponent {
  @Input({ required: true }) artigo: any;
  /** dentro do painel do parceiro: sem botão de salvar (e lixeira se for dele) */
  @Input() embutido = false;
  /** o artigo é da empresa logada (mostra a lixeira no modo embutido) */
  @Input() meu = false;
  @Output() ler = new EventEmitter<string>();
  @Output() favoritar = new EventEmitter<any>();
  @Output() excluir = new EventEmitter<string>();
}
