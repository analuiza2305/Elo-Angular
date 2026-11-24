import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { auth } from '../../core/firebase';
import { SelosAutorComponent } from '../selos-autor/selos-autor';
import { InscricoesEventosService } from '../../services/eventos-dados';

/**
 * Modal de detalhes do evento (com inscrição, cancelamento e compartilhar).
 * O mesmo modal abre na página de Eventos e na home da mãe.
 *
 * Uso: <app-evento-detalhes [evento]="eventoAberto()" (fechar)="eventoAberto.set(null)" />
 * Fica sempre na tela (o modal aparece quando [evento] tem valor), assim os avisos
 * de "inscrição feita" continuam aparecendo depois que o modal fecha.
 */
@Component({
  selector: 'app-evento-detalhes',
  standalone: true,
  imports: [CommonModule, SelosAutorComponent],
  templateUrl: './evento-detalhes.html',
  styleUrls: ['./evento-detalhes.css'],
})
export class EventoDetalhesComponent {
  readonly inscricoes = inject(InscricoesEventosService);

  @Input() evento: any = null;
  /** painel do parceiro: só prévia, sem inscrição */
  @Input() embutido = false;
  @Output() fechar = new EventEmitter<void>();

  readonly showModalAviso = signal(false);
  readonly avisoInfo = signal({ titulo: '', mensagem: '', isConfirm: false, acao: () => {} });

  abrirAviso(titulo: string, mensagem: string) {
    this.avisoInfo.set({ titulo, mensagem, isConfirm: false, acao: () => {} });
    this.showModalAviso.set(true);
  }

  private abrirConfirmacao(titulo: string, mensagem: string, acao: () => void) {
    this.avisoInfo.set({ titulo, mensagem, isConfirm: true, acao });
    this.showModalAviso.set(true);
  }

  fecharAviso() { this.showModalAviso.set(false); }

  compartilhar(evento: any) {
    if (navigator.share) {
      navigator.share({
        title: evento.titulo,
        text: evento.descricao,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      this.abrirAviso('Link copiado!', 'O link deste evento foi copiado para a sua área de transferência.');
    }
  }

  async inscrever() {
    const user = auth.currentUser;
    if (!user) {
      this.abrirAviso('Login necessário', 'Você precisa estar logada para se inscrever em um evento.');
      return;
    }
    const evento = this.evento;
    if (evento?.encerrado) {
      this.abrirAviso('Evento encerrado', 'Esse evento já aconteceu, então as inscrições foram encerradas.');
      return;
    }
    if (this.inscricoes.isInscrito(evento.id)) {
      this.abrirAviso('Atenção', 'Você já está inscrita nesse evento.');
      return;
    }
    try {
      await this.inscricoes.inscrever(user.uid, evento);
      this.fechar.emit();
      this.abrirAviso('Sucesso!', 'Sua inscrição foi realizada com sucesso.');
    } catch (err) {
      console.error(err);
      this.abrirAviso('Erro', 'Ocorreu um erro ao realizar a inscrição. Tente novamente.');
    }
  }

  cancelarInscricao() {
    const user = auth.currentUser;
    const evento = this.evento;
    if (!user) {
      this.abrirAviso('Atenção', 'Você precisa estar logada para realizar essa ação.');
      return;
    }
    if (!evento) return;

    this.abrirConfirmacao(
      'Cancelar Inscrição',
      'Tem certeza que deseja cancelar sua inscrição neste evento?',
      async () => {
        try {
          await this.inscricoes.cancelar(user.uid, evento);
          this.fecharAviso();
          this.fechar.emit();
          setTimeout(() => this.abrirAviso('Inscrição Cancelada', 'Sua inscrição foi cancelada com sucesso!'), 300);
        } catch (error) {
          console.error('Erro ao cancelar a inscrição:', error);
          this.abrirAviso('Erro', 'Ocorreu um erro ao cancelar. Tente novamente.');
        }
      }
    );
  }
}
