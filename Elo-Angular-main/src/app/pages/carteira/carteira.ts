import { Component, OnDestroy, OnInit, WritableSignal, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { auth, db } from '../../core/firebase';
import { HeaderComponent } from '../../components/header/header';
import {
  CarteiraMae,
  CarteiraParceiro,
  CreditosService,
  TransacaoMoeda,
} from '../../core/services/creditos.service';

type TipoUsuario = 'mae' | 'parceiro' | 'advogado' | 'psicologo' | 'desconhecido';

interface PacoteCredito {
  quantidade: number;
  precoExibicao: string; // fictício, só pra dar contexto visual no protótipo
  destaque?: boolean;
  bonus?: number; // créditos extras de brinde (só visual/simulado)
  etiqueta?: string;
}

/** Sugestão de onde gastar os créditos — puxa pro resto da plataforma. */
interface Recomendacao {
  icone: string;
  titulo: string;
  descricao: string;
  custo: number;
  rota: string;
  cor: string;
}

type EtapaCheckout = 'metodo' | 'dados' | 'processando' | 'sucesso';
type MetodoPagamento = 'pix' | 'cartao';

@Component({
  selector: 'app-carteira',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent],
  templateUrl: './carteira.html',
  styleUrls: ['./carteira.css'],
})
export class Carteira implements OnInit, OnDestroy {
  currentUser = signal<User | null>(null);
  tipoUsuario = signal<TipoUsuario>('desconhecido');
  carregandoUsuario = signal<boolean>(true);

  carteiraMae = signal<CarteiraMae | null>(null);
  carteiraParceiro = signal<CarteiraParceiro | null>(null);
  historico = signal<TransacaoMoeda[]>([]);

  processando = signal<boolean>(false);
  mensagem = signal<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // ===== Números que "sobem" na tela (contador animado) =====
  saldoAnimadoMensal = signal<number>(0);
  saldoAnimadoComprado = signal<number>(0);
  saldoAnimadoTotal = signal<number>(0);
  saldoAnimadoPremium = signal<number>(0);
  saldoPulsando = signal<boolean>(false);

  // ===== Checkout simulado =====
  checkoutAberto = signal<boolean>(false);
  etapaCheckout = signal<EtapaCheckout>('metodo');
  metodoPagamento = signal<MetodoPagamento>('pix');
  pacoteSelecionado = signal<PacoteCredito | null>(null);
  pixCopiado = signal<boolean>(false);
  creditadoAgora = signal<number>(0);
  mostrarConfete = signal<boolean>(false);

  // Dados fictícios do "cartão" — nada disso sai da tela, é só encenação.
  cartaoForm = { numero: '', nome: '', validade: '', cvv: '' };

  readonly codigoPixFake =
    '00020126580014BR.GOV.BCB.PIX0136elomaterno-prototipo-sem-cobranca5204000053039865802BR6009SAO PAULO62070503***6304E1F0';

  // Pacotes fictícios pro protótipo — sem gateway de pagamento ainda.
  readonly pacotesMae: PacoteCredito[] = [
    { quantidade: 20, precoExibicao: 'R$ 9,90', etiqueta: 'Pra experimentar' },
    { quantidade: 50, precoExibicao: 'R$ 19,90', destaque: true, bonus: 5, etiqueta: 'Mais escolhido' },
    { quantidade: 120, precoExibicao: 'R$ 39,90', bonus: 20, etiqueta: 'Melhor custo' },
  ];

  readonly pacotesParceiro: PacoteCredito[] = [
    { quantidade: 100, precoExibicao: 'R$ 199,00', etiqueta: 'Apoio inicial' },
    { quantidade: 300, precoExibicao: 'R$ 499,00', destaque: true, bonus: 30, etiqueta: 'Mais escolhido' },
    { quantidade: 1000, precoExibicao: 'R$ 1.499,00', bonus: 150, etiqueta: 'Impacto máximo' },
  ];

  // Onde a mãe pode usar os créditos dela.
  readonly recomendacoes: Recomendacao[] = [
    {
      icone: 'fa-solid fa-heart-pulse',
      titulo: 'Consulta com psicóloga',
      descricao: 'Uma sessão de escuta e acolhimento, no horário que couber na sua rotina.',
      custo: 30,
      rota: '/consultoria',
      cor: '#7c69a9',
    },
    {
      icone: 'fa-solid fa-scale-balanced',
      titulo: 'Orientação jurídica',
      descricao: 'Tire dúvidas sobre pensão, licença-maternidade e guarda com uma advogada.',
      custo: 30,
      rota: '/consultoria',
      cor: '#4b2c82',
    },
    {
      icone: 'fa-solid fa-bullhorn',
      titulo: 'Vaga em evento',
      descricao: 'Garanta seu lugar em rodas de conversa, oficinas e feiras de empregabilidade.',
      custo: 15,
      rota: '/eventos',
      cor: '#c1667f',
    },
    {
      icone: 'fa-solid fa-book-open',
      titulo: 'Artigo premium',
      descricao: 'Conteúdos aprofundados escritos por especialistas da nossa rede.',
      custo: 5,
      rota: '/artigos',
      cor: '#3f8f7c',
    },
  ];

  /** Quanto do saldo mensal já foi usado (pra barra de progresso). */
  progressoMensal = computed(() => {
    const c = this.carteiraMae();
    if (!c) return 0;
    const teto = 50; // CREDITO_MENSAL_PADRAO
    return Math.min(100, Math.round((c.creditoMensal / teto) * 100));
  });

  /** Total disponível pra mãe (usado nas recomendações). */
  saldoDisponivel = computed(() => this.carteiraMae()?.total ?? 0);

  /** Quantos créditos entraram este mês (só pra dar vida ao resumo). */
  entradasDoMes = computed(() =>
    this.historico()
      .filter((t) => this.ehEntrada(t) && this.mesmoMes(t.data))
      .reduce((soma, t) => soma + t.valor, 0),
  );

  /** Quantos créditos saíram este mês. */
  saidasDoMes = computed(() =>
    this.historico()
      .filter((t) => !this.ehEntrada(t) && this.mesmoMes(t.data))
      .reduce((soma, t) => soma + t.valor, 0),
  );

  // Formulário de transferência do parceiro
  transferenciaForm = { email: '', valor: 10 };

  private authSub?: () => void;
  private carteiraSub?: Subscription;
  private historicoSub?: Subscription;
  private timers: any[] = [];

  constructor(private creditosService: CreditosService) {}

  ngOnInit() {
    this.authSub = onAuthStateChanged(auth, async (firebaseUser) => {
      this.currentUser.set(firebaseUser);

      if (!firebaseUser) {
        this.tipoUsuario.set('desconhecido');
        this.carregandoUsuario.set(false);
        return;
      }

      await this.carregarTipoUsuario(firebaseUser.uid);
    });
  }

  ngOnDestroy() {
    this.authSub?.();
    this.carteiraSub?.unsubscribe();
    this.historicoSub?.unsubscribe();
    this.timers.forEach((t) => clearTimeout(t));
  }

  private async carregarTipoUsuario(uid: string) {
    try {
      const snap = await getDoc(doc(db, 'usuarios', uid));
      const tipo = (snap.exists() ? snap.data()['tipo'] : null) as TipoUsuario | null;
      this.tipoUsuario.set(tipo ?? 'desconhecido');

      if (tipo === 'mae') {
        await this.creditosService.garantirRenovacaoMensal(uid);
        this.carteiraSub = this.creditosService.carteiraMae$(uid).subscribe((c) => {
          const anterior = this.carteiraMae();
          this.carteiraMae.set(c);
          this.animarNumero(this.saldoAnimadoMensal, c.creditoMensal);
          this.animarNumero(this.saldoAnimadoComprado, c.creditoComprado);
          this.animarNumero(this.saldoAnimadoTotal, c.total);
          if (anterior && c.total > anterior.total) this.pulsarSaldo();
        });
        this.historicoSub = this.creditosService.historico$(uid).subscribe((h) => this.historico.set(h));
      } else if (tipo === 'parceiro') {
        this.carteiraSub = this.creditosService.carteiraParceiro$(uid).subscribe((c) => {
          const anterior = this.carteiraParceiro();
          this.carteiraParceiro.set(c);
          this.animarNumero(this.saldoAnimadoPremium, c.creditopremium);
          if (anterior && c.creditopremium > anterior.creditopremium) this.pulsarSaldo();
        });
        this.historicoSub = this.creditosService.historico$(uid).subscribe((h) => this.historico.set(h));
      }
    } finally {
      this.carregandoUsuario.set(false);
    }
  }

  // ==========================================
  // ANIMAÇÕES DE SALDO
  // ==========================================

  /** Faz o número subir aos poucos em vez de trocar seco na tela. */
  private animarNumero(alvo: WritableSignal<number>, destino: number) {
    const inicio = alvo();
    if (inicio === destino) return;

    const passos = 18;
    const delta = (destino - inicio) / passos;
    let atual = 0;

    const tick = () => {
      atual++;
      if (atual >= passos) {
        alvo.set(destino);
        return;
      }
      alvo.set(Math.round(inicio + delta * atual));
      this.timers.push(setTimeout(tick, 28));
    };
    this.timers.push(setTimeout(tick, 28));
  }

  private pulsarSaldo() {
    this.saldoPulsando.set(true);
    this.timers.push(setTimeout(() => this.saldoPulsando.set(false), 1400));
  }

  // ==========================================
  // CHECKOUT SIMULADO
  // ==========================================

  abrirCheckout(pacote: PacoteCredito) {
    if (this.processando()) return;
    this.pacoteSelecionado.set(pacote);
    this.etapaCheckout.set('metodo');
    this.metodoPagamento.set('pix');
    this.pixCopiado.set(false);
    this.cartaoForm = { numero: '', nome: '', validade: '', cvv: '' };
    this.checkoutAberto.set(true);
    this.mensagem.set(null);
  }

  fecharCheckout() {
    if (this.etapaCheckout() === 'processando') return; // não deixa fechar no meio
    this.checkoutAberto.set(false);
    this.pacoteSelecionado.set(null);
    this.etapaCheckout.set('metodo');
  }

  escolherMetodo(metodo: MetodoPagamento) {
    this.metodoPagamento.set(metodo);
  }

  irParaDados() {
    this.etapaCheckout.set('dados');
  }

  voltarParaMetodo() {
    this.etapaCheckout.set('metodo');
  }

  copiarPix() {
    try {
      navigator.clipboard?.writeText(this.codigoPixFake);
    } catch {
      /* protótipo: se o navegador bloquear, segue o baile */
    }
    this.pixCopiado.set(true);
    this.timers.push(setTimeout(() => this.pixCopiado.set(false), 2500));
  }

  /** Só libera o botão de pagar quando o "cartão" está minimamente preenchido. */
  cartaoValido(): boolean {
    const f = this.cartaoForm;
    return (
      f.numero.replace(/\D/g, '').length >= 12 &&
      f.nome.trim().length >= 3 &&
      f.validade.trim().length >= 4 &&
      f.cvv.trim().length >= 3
    );
  }

  totalDoPacote(pacote: PacoteCredito | null): number {
    if (!pacote) return 0;
    return pacote.quantidade + (pacote.bonus ?? 0);
  }

  /** "Paga" o pacote: encena o processamento e só então credita de verdade no Firestore. */
  async confirmarPagamento() {
    const pacote = this.pacoteSelecionado();
    const user = this.currentUser();
    if (!pacote || !user || this.processando()) return;

    this.etapaCheckout.set('processando');
    this.processando.set(true);
    this.mensagem.set(null);

    // Delay proposital: dá a sensação de uma transação acontecendo.
    await new Promise((r) => setTimeout(r, 1800));

    const total = this.totalDoPacote(pacote);
    const rotulo = this.metodoPagamento() === 'pix' ? 'Pix' : 'cartão';

    try {
      if (this.tipoUsuario() === 'mae') {
        await this.creditosService.comprarCreditos(
          user.uid,
          'usuarios',
          'creditoComprado',
          total,
          `Compra simulada de ${total} créditos via ${rotulo} (${pacote.precoExibicao})`,
        );
      } else if (this.tipoUsuario() === 'parceiro') {
        await this.creditosService.comprarCreditos(
          user.uid,
          'parceiros',
          'creditopremium',
          total,
          `Compra simulada de ${total} créditos premium via ${rotulo} (${pacote.precoExibicao})`,
        );
      }

      this.creditadoAgora.set(total);
      this.etapaCheckout.set('sucesso');
      this.dispararConfete();
    } catch (err: any) {
      this.checkoutAberto.set(false);
      this.etapaCheckout.set('metodo');
      this.mensagem.set({ tipo: 'erro', texto: err?.message || 'Não foi possível concluir a compra.' });
    } finally {
      this.processando.set(false);
    }
  }

  private dispararConfete() {
    this.mostrarConfete.set(true);
    this.timers.push(setTimeout(() => this.mostrarConfete.set(false), 2600));
  }

  /** Array só pra gerar os confetes no template. */
  readonly confetes = Array.from({ length: 24 }, (_, i) => i);

  // ==========================================
  // TRANSFERÊNCIA (parceiro)
  // ==========================================

  async transferirParaMae() {
    const user = this.currentUser();
    if (!user || this.processando()) return;

    if (!this.transferenciaForm.email.trim() || this.transferenciaForm.valor <= 0) {
      this.mensagem.set({ tipo: 'erro', texto: 'Preencha o e-mail da mãe e um valor válido.' });
      return;
    }

    this.processando.set(true);
    this.mensagem.set(null);

    try {
      const mae = await this.creditosService.buscarMaePorEmail(this.transferenciaForm.email);
      if (!mae) {
        this.mensagem.set({ tipo: 'erro', texto: 'Nenhuma mãe encontrada com esse e-mail.' });
        return;
      }

      await this.creditosService.transferirCreditoPremium(user.uid, mae.uid, this.transferenciaForm.valor);
      this.mensagem.set({
        tipo: 'sucesso',
        texto: `${this.transferenciaForm.valor} créditos premium transferidos para ${mae.nome}.`,
      });
      this.transferenciaForm = { email: '', valor: 10 };
    } catch (err: any) {
      this.mensagem.set({ tipo: 'erro', texto: err?.message || 'Não foi possível transferir.' });
    } finally {
      this.processando.set(false);
    }
  }

  // ==========================================
  // HELPERS
  // ==========================================

  formatarData(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private mesmoMes(timestamp: number): boolean {
    const d = new Date(timestamp);
    const hoje = new Date();
    return d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
  }

  iconeTransacao(t: TransacaoMoeda): string {
    switch (t.tipo) {
      case 'renovacao':
        return 'fa-solid fa-rotate';
      case 'compra':
        return 'fa-solid fa-cart-shopping';
      case 'gasto':
        return 'fa-solid fa-arrow-up-right-from-square';
      case 'transferencia':
        return 'fa-solid fa-right-left';
      default:
        return 'fa-solid fa-coins';
    }
  }

  descricaoTransacao(t: TransacaoMoeda): string {
    switch (t.tipo) {
      case 'renovacao':
        return 'Renovação mensal';
      case 'compra':
        return t.descricao || 'Compra de créditos';
      case 'gasto':
        return t.descricao || 'Uso de créditos';
      case 'transferencia':
        return t.uidOrigem === this.currentUser()?.uid ? 'Transferência enviada' : 'Transferência recebida';
      default:
        return t.descricao || '—';
    }
  }

  ehEntrada(t: TransacaoMoeda): boolean {
    if (t.tipo === 'gasto') return false;
    if (t.tipo === 'transferencia') return t.uidDestino === this.currentUser()?.uid;
    return true;
  }

  podePagar(custo: number): boolean {
    return this.saldoDisponivel() >= custo;
  }

  faltam(custo: number): number {
    return Math.max(0, custo - this.saldoDisponivel());
  }
}
