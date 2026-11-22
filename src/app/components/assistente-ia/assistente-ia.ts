import { Component, ElementRef, OnInit, PLATFORM_ID, ViewChild, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { lerPreferenciaLocal, preferenciaSuporteAtual } from '../../services/preferencia-suporte';
import {
  AssistenteIndisponivel, LimiteAtingido, LIMITE_DIARIO_LOCAL, MensagemAssistente, RESPOSTA_APOIO,
  contarUso, linkCitado, pareceCrise, perguntarParaIa, responderPeloFaq, usoDeHoje,
} from '../../services/assistente-ia';
import { EloCorujaComponent, ExpressaoElo } from '../elo-coruja/elo-coruja';

/**
 * Botão flutuante da Elô (a coruja mascote) + janela de conversa com o assistente virtual.
 * Fica dentro do header da mãe, então aparece em todas as telas dela,
 * mas só para quem escolheu "Assistente virtual (IA)" no cadastro ou no perfil.
 */
@Component({
  selector: 'app-assistente-ia',
  standalone: true,
  imports: [EloCorujaComponent],
  templateUrl: './assistente-ia.html',
  styleUrls: ['./assistente-ia.css'],
})
export class AssistenteIaComponent implements OnInit {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  @ViewChild('lista') lista?: ElementRef<HTMLDivElement>;
  @ViewChild('campo') campo?: ElementRef<HTMLTextAreaElement>;

  /** Só aparece para quem escolheu o assistente. */
  readonly visivel = computed(() => preferenciaSuporteAtual() === 'ia');

  aberto = signal(false);
  texto = signal('');
  pensando = signal(false);
  mensagens = signal<MensagemAssistente[]>([]);

  readonly sugestoes = [
    'Como marco uma consulta?',
    'Como entro na chamada?',
    'Como posto no fórum?',
    'Onde vejo minhas consultas?',
  ];

  private readonly CHAVE_CONVERSA = 'elo_assistente_conversa';
  private readonly BOAS_VINDAS: MensagemAssistente = {
    autor: 'assistente',
    origem: 'ia',
    texto: 'Oi, eu sou a Elô 💜 Tô aqui pra te ajudar a usar o EloMaterno, no seu tempo. Posso te ajudar a marcar consulta, entrar na chamada, usar o fórum… O que você quer fazer?',
  };

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    lerPreferenciaLocal();   // acende o signal com o que está salvo no navegador
    // A conversa continua ao trocar de página (some quando fecha a aba)
    try {
      const salva = JSON.parse(sessionStorage.getItem(this.CHAVE_CONVERSA) || 'null');
      this.mensagens.set(Array.isArray(salva) && salva.length ? salva : [this.BOAS_VINDAS]);
    } catch {
      this.mensagens.set([this.BOAS_VINDAS]);
    }
  }

  alternar() {
    this.aberto.update((v) => !v);
    if (this.aberto()) this.rolarParaFim(true);
  }

  fechar() { this.aberto.set(false); }

  /**
   * Cara da Elô ao lado de cada resposta (mesmas expressões da folha da mascote):
   * acolhendo quando a mãe conta algo difícil, piscadinha nas dicas das perguntas
   * frequentes e "oi" na mensagem de boas-vindas.
   */
  expressaoDa(m: MensagemAssistente): ExpressaoElo {
    if (m.origem === 'apoio') return 'acolhendo';
    if (m.texto === this.BOAS_VINDAS.texto) return 'oi';
    if (m.origem === 'faq') return 'piscadinha';
    return 'normal';
  }

  limparConversa() {
    this.mensagens.set([this.BOAS_VINDAS]);
    this.salvar();
  }

  teclou(ev: KeyboardEvent) {
    // Enter envia; Shift+Enter pula linha
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); this.enviar(); }
    if (ev.key === 'Escape') this.fechar();
  }

  async enviar(textoPronto?: string) {
    const pergunta = (textoPronto ?? this.texto()).trim().slice(0, 600);
    if (!pergunta || this.pensando()) return;
    this.texto.set('');
    this.adicionar({ autor: 'mae', texto: pergunta });

    // 1. Pedido de socorro: responde na hora, sem IA
    if (pareceCrise(pergunta)) {
      this.adicionar({ autor: 'assistente', origem: 'apoio', texto: RESPOSTA_APOIO, link: { rotulo: 'Marcar com uma psicóloga', rota: '/consultas-lista-psi' } });
      return;
    }

    // Limite do dia: depois dele, só perguntas frequentes
    if (usoDeHoje() >= LIMITE_DIARIO_LOCAL) {
      this.adicionar(responderPeloFaq(pergunta));
      return;
    }

    // 2. IA (pelo Worker) · 3. se falhar, perguntas frequentes
    this.pensando.set(true);
    try {
      const resposta = await perguntarParaIa(this.mensagens());
      contarUso();
      this.adicionar({ autor: 'assistente', origem: 'ia', texto: resposta, link: linkCitado(resposta) });
    } catch (e) {
      // Cota do dia acabou, Worker fora do ar ou sem internet: responde pelas perguntas frequentes
      if (!(e instanceof LimiteAtingido) && !(e instanceof AssistenteIndisponivel)) console.warn('Assistente:', e);
      this.adicionar(responderPeloFaq(pergunta));
    } finally {
      this.pensando.set(false);
      setTimeout(() => this.campo?.nativeElement.focus(), 50);
    }
  }

  irPara(rota: string) {
    this.router.navigate([rota]);
    // no celular a janela cobre a tela: fecha para ela ver a página
    if (window.innerWidth < 700) this.fechar();
  }

  private adicionar(m: MensagemAssistente) {
    this.mensagens.update((l) => [...l, m].slice(-30));
    this.salvar();
    this.rolarParaFim();
  }

  private salvar() {
    try { sessionStorage.setItem(this.CHAVE_CONVERSA, JSON.stringify(this.mensagens())); } catch { /* sem storage */ }
  }

  private rolarParaFim(focar = false) {
    setTimeout(() => {
      const el = this.lista?.nativeElement;
      // Só com a mensagem de boas-vindas, fica no topo para a Elô aparecer inteira
      if (el) el.scrollTop = this.mensagens().length <= 1 ? 0 : el.scrollHeight;
      if (focar) this.campo?.nativeElement.focus();
    }, 30);
  }
}
