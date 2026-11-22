import { Component, ElementRef, OnDestroy, OnInit, PLATFORM_ID, ViewChild, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { onAuthStateChanged, Unsubscribe } from 'firebase/auth';
import { auth } from '../../core/firebase';
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
export class AssistenteIaComponent implements OnInit, OnDestroy {
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

  /**
   * A conversa fica salva no navegador SEPARADA POR CONTA (elo_assistente_conversa:<uid>).
   * Antes era uma chave só: quem entrava com outra conta na mesma aba via o histórico da anterior.
   */
  private readonly PREFIXO_CONVERSA = 'elo_assistente_conversa';
  private uidAtual: string | null = null;
  private pararDeOuvirLogin?: Unsubscribe;
  private readonly BOAS_VINDAS: MensagemAssistente = {
    autor: 'assistente',
    origem: 'ia',
    texto: 'Oi, eu sou a Elô 💜 Tô aqui pra te ajudar a usar o EloMaterno, no seu tempo. Posso te ajudar a marcar consulta, entrar na chamada, usar o fórum… O que você quer fazer?',
  };

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    lerPreferenciaLocal();   // acende o signal com o que está salvo no navegador
    // Limpa a chave antiga (sem conta), que misturava as conversas
    try { sessionStorage.removeItem(this.PREFIXO_CONVERSA); } catch { /* sem storage */ }

    // Troca de conta (ou saída) → carrega a conversa só daquela mãe
    this.pararDeOuvirLogin = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      if (uid === this.uidAtual && this.mensagens().length) return;
      if (!uid) this.apagarConversasSalvas();   // saiu da conta: não deixa nada para a próxima pessoa
      this.uidAtual = uid;
      this.carregarConversa();
    });
  }

  ngOnDestroy() { this.pararDeOuvirLogin?.(); }

  private get chaveConversa(): string | null {
    return this.uidAtual ? `${this.PREFIXO_CONVERSA}:${this.uidAtual}` : null;
  }

  /** A conversa continua ao trocar de página (some quando fecha a aba ou sai da conta). */
  private carregarConversa() {
    const chave = this.chaveConversa;
    try {
      const salva = chave ? JSON.parse(sessionStorage.getItem(chave) || 'null') : null;
      this.mensagens.set(Array.isArray(salva) && salva.length ? salva : [this.BOAS_VINDAS]);
    } catch {
      this.mensagens.set([this.BOAS_VINDAS]);
    }
  }

  private apagarConversasSalvas() {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(this.PREFIXO_CONVERSA))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch { /* sem storage */ }
  }

  alternar() {
    this.aberto.update((v) => !v);
    if (this.aberto()) this.rolarParaFim(true);
  }

  fechar() { this.aberto.set(false); }

  // ---------- brincadeira ao tocar na foto da Elô ----------
  /** Animação que está rodando agora (cada toque passa para a próxima). */
  brincadeira = signal<'' | 'pulo' | 'giro' | 'coracoes'>('');
  private readonly BRINCADEIRAS = ['pulo', 'giro', 'coracoes'] as const;
  private proximaBrincadeira = 0;
  private fimBrincadeira?: ReturnType<typeof setTimeout>;

  /** Cara da Elô no topo: pensando enquanto responde; durante a brincadeira, uma cara divertida. */
  readonly expressaoTopo = computed<ExpressaoElo>(() => {
    if (this.pensando()) return 'pensando';
    switch (this.brincadeira()) {
      case 'pulo': return 'oi';
      case 'giro': return 'piscadinha';
      case 'coracoes': return 'acolhendo';
      default: return 'normal';
    }
  });

  brincar() {
    clearTimeout(this.fimBrincadeira);
    this.brincadeira.set('');   // reinicia a animação mesmo com toques seguidos
    const atual = this.BRINCADEIRAS[this.proximaBrincadeira];
    this.proximaBrincadeira = (this.proximaBrincadeira + 1) % this.BRINCADEIRAS.length;
    requestAnimationFrame(() => this.brincadeira.set(atual));
    this.fimBrincadeira = setTimeout(() => this.brincadeira.set(''), 1300);
  }

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
    const chave = this.chaveConversa;
    if (!chave) return;   // sem conta: não guarda nada
    try { sessionStorage.setItem(chave, JSON.stringify(this.mensagens())); } catch { /* sem storage */ }
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
