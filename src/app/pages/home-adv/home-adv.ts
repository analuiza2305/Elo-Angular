import { Component, OnDestroy, OnInit, signal, computed, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { LembreteService } from '../../services/lembrete';
import { carregarReputacao, Reputacao, REPUTACAO_VAZIA } from '../../services/reputacao';

import {
  doc, getDoc, collection, query, where, getDocs, updateDoc, addDoc, onSnapshot, orderBy, limit,
  serverTimestamp, Timestamp, arrayUnion, arrayRemove, getCountFromServer, writeBatch, setDoc,
} from 'firebase/firestore';
import { AlertaService } from '../../core/services/alerta.service';
import { carregarIdsFavoritosAdv, definirFavoritoAdv } from '../../services/artigo-utils';
import { avisarMensagemChat } from '../../services/avisos-profissional';
import { cartaoDoLembrete } from '../../services/lembrete-chat';
import { PlanoService, Assinatura, Plano, PLANOS_PADRAO_POR_PUBLICO, formatarBRL, sufixoPeriodicidade } from '../../services/plano';
import { MODELOS_JURIDICOS, ModeloJuridico } from '../../services/modelos-juridicos';
import { gerarDocumentoJuridico, gerarRelatorioAtendimentos, formatarHoras, ConsultaRelatorio, gerarProntuario } from '../../services/documentos-pdf';

import { AnuncioEspacoComponent } from '../../components/anuncio-espaco/anuncio-espaco';
type SecaoHomeAdv = 'dashboard' | 'agenda' | 'artigos' | 'consultas' | 'forum' | 'pacientes' | 'chats' | 'documentos' | 'planos';
type AbaConsultas = 'Pendentes' | 'Agendadas' | 'Realizadas' | 'Negadas';
type CategoriaArtigo = 'posts' | 'legislativos' | 'educacionais' | 'dicas';
type FiltroArtigo = 'todos' | CategoriaArtigo | 'meus' | 'favoritos';
const CHAVE_FILTRO_ARTIGO = 'advFiltroArtigo';

interface MenuItem { target: SecaoHomeAdv; label: string; icon: string; }
interface CelulaCalendario {
  passado?: boolean; dia: number | null; isHoje: boolean; temDisponibilidade: boolean; }
interface EventoAgenda { titulo: string; descricao: string; local: string; data: Date; }
type StatusHorario = 'livre' | 'ocupado' | 'passado';
interface HorarioSlot { horario: string; status: StatusHorario; selecionado: boolean; publicado: boolean; pacienteNome?: string; }
interface ConsultaView {
  id: string;
  maeId: string;
  nome: string;
  avatar: string;
  dataObj: Date | null;
  data: string;
  horario: string;
  motivo: string;
  statusRaw: string;
  status: 'Pendente' | 'Agendada' | 'Realizada' | 'Negada';
  /** true quando a consulta já estava aceita e foi desmarcada depois */
  canceladaAposAceite?: boolean;
  /** Fim real da consulta (gravado ao encerrar a chamada); usado para calcular a duração nos relatórios. */
  realizadoEm: Date | null;
}
interface DocFormJuridico {
  pacienteId: string;
  interessado: string;
  solicitante: string;
  finalidade: string;
  cidade: string;
  secoes: Record<string, string>;
  atendimentosIds: string[];
}
const DOC_JURIDICO_VAZIO: DocFormJuridico = {
  pacienteId: '', interessado: '', solicitante: '', finalidade: '', cidade: '', secoes: {}, atendimentosIds: [],
};
interface ArtigoForm {
  titulo: string; descricao: string; resumo: string; categoria: CategoriaArtigo; img: string; link: string;
}

const CHAVE_ULTIMA_SECAO = 'homeadv_lastSection';
const CHAVE_RASCUNHO_ARTIGO = 'homeadv_draft_artigo';
const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const STATUS_LABEL: Record<string, ConsultaView['status']> = {
  pendente: 'Pendente',
  aceito: 'Agendada', aceita: 'Agendada', agendada: 'Agendada',
  realizado: 'Realizada', realizada: 'Realizada',
  negado: 'Negada', negada: 'Negada',
};
const CHAVE_DURACAO = 'adv_duracao_sessao';
const CHAVE_EXPEDIENTE = 'adv_expediente';

/** localStorage pode não existir (SSR) ou estar bloqueado: nunca deixa a página quebrar. */
function lerLocal(chave: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(chave) : null; } catch { return null; }
}
const EXPEDIENTE_SALVO: { inicio?: string; fim?: string } = (() => {
  try { return JSON.parse(lerLocal(CHAVE_EXPEDIENTE) || '{}'); } catch { return {}; }
})();
const ARTIGO_VAZIO: ArtigoForm = { titulo: '', descricao: '', resumo: '', categoria: 'posts', img: '', link: '' };

@Component({
  selector: 'app-home-adv',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AnuncioEspacoComponent],
  templateUrl: './home-adv.html',
  styleUrls: ['./home-adv.css', './home-adv-premium.css'],
})
export class HomeAdv implements OnInit, OnDestroy {
  public router = inject(Router);
  private readonly alerta = inject(AlertaService);
  private lembreteService = inject(LembreteService);
  private planoService = inject(PlanoService);
  private readonly isBrowser: boolean;

  readonly menuItems: MenuItem[] = [
    { target: 'dashboard', label: 'Painel de controle', icon: 'fa-solid fa-chart-line' },
    { target: 'agenda', label: 'Agenda', icon: 'fa-solid fa-calendar-days' },
    { target: 'artigos', label: 'Comunidade', icon: 'fa-solid fa-newspaper' },
    { target: 'consultas', label: 'Consultas', icon: 'fa-solid fa-hands-helping' },
    { target: 'forum', label: 'Fórum', icon: 'fa-solid fa-comments' },
    { target: 'pacientes', label: 'Clientes', icon: 'fa-solid fa-user-group' },
    { target: 'chats', label: 'Chats', icon: 'fa-solid fa-message' },
    { target: 'documentos', label: 'Documentos', icon: 'fa-solid fa-file-signature' },
    { target: 'planos', label: 'Planos', icon: 'fa-solid fa-crown' },
  ];

  readonly activeSection = signal<SecaoHomeAdv>('dashboard');
  readonly sidebarOpen = signal(false);
  readonly accessibilityMenuOpen = signal(false);
  readonly isDarkMode = signal(false);
  readonly nomeCompleto = signal('Advogado(a)');
  readonly primeiroNome = computed(() => this.nomeCompleto().split(' ')[0]);
  readonly avatarUrl = signal('./img/account_icon.png');
  readonly heroMouseX = signal('50%');
  readonly heroMouseY = signal('50%');

  readonly carregandoStats = signal(true);
  readonly reputacao = signal<Reputacao>(REPUTACAO_VAZIA);
  readonly carregandoReputacao = signal(true);
  readonly carregandoConsultasHoje = signal(true);
  private uidAtual: string | null = null;
  private advDocId: string | null = null;
  readonly oab = signal('');
  /** status do cadastro em advogados/{id}: só 'aprovado' aparece para as mães */
  readonly statusCadastro = signal<string>('');
  readonly cadastroAprovado = computed(() => this.statusCadastro() === 'aprovado');
  readonly cidadeProfissional = signal('');
  readonly isPremium = signal(false);
  readonly assinatura = signal<Assinatura | null>(null);

  // Passo a passo da agenda: 1) período do dia  2) duração da consulta  3) escolher os horários
  readonly modalConfigPeriodoAberto = signal(false);
  readonly horaInicioExpediente = signal<string>(EXPEDIENTE_SALVO.inicio || '08:00');
  readonly horaFimExpediente = signal<string>(EXPEDIENTE_SALVO.fim || '18:00');
  readonly erroPeriodo = signal('');
  readonly modalConfigTempoAberto = signal(false);
  readonly duracaoSessao = signal<number>(Number(lerLocal(CHAVE_DURACAO) || '30'));
  readonly manterProximosDias = signal<boolean>(true);
  /** Dia que está sendo configurado (hoje pelo botão, ou o dia clicado no calendário). */
  private diaEmConfiguracao: Date | null = null;

  readonly todasConsultas = signal<ConsultaView[]>([]);
  readonly abaConsultas = signal<AbaConsultas>('Pendentes');
  private unsubConsultas: (() => void) | null = null;
  private cacheMaes = new Map<string, { nome: string; avatar: string }>();

  /** Consulta aceita cujo dia já acabou: não está mais "agendada", falta confirmar se aconteceu. */
  consultaPassou(c: ConsultaView): boolean {
    if (c.status !== 'Agendada' || !c.dataObj) return false;
    const inicioDeHoje = new Date();
    inicioDeHoje.setHours(0, 0, 0, 0);
    return c.dataObj.getTime() < inicioDeHoje.getTime();
  }

  rotuloStatus(c: ConsultaView): string {
    if (this.consultaPassou(c)) return 'A confirmar';
    if (c.status === 'Negada' && c.canceladaAposAceite) return 'Cancelada';
    return c.status;
  }
  classeStatus(c: ConsultaView): string { return this.consultaPassou(c) ? 'confirmar' : c.status.toLowerCase(); }

  readonly consultasFiltradas = computed(() => {
    const aba = this.abaConsultas();
    const todas = this.todasConsultas();
    let lista: ConsultaView[];
    if (aba === 'Agendadas') {
      // só de hoje em diante
      lista = todas.filter((c) => c.status === 'Agendada' && !this.consultaPassou(c));
    } else if (aba === 'Realizadas') {
      // as realizadas + as aceitas cujo dia já passou (a psicóloga confirma por aqui)
      lista = todas.filter((c) => c.status === 'Realizada' || this.consultaPassou(c));
      const aConfirmar = lista.filter((c) => this.consultaPassou(c));
      const realizadas = lista.filter((c) => !this.consultaPassou(c))
        .sort((a, b) => (b.dataObj?.getTime() ?? 0) - (a.dataObj?.getTime() ?? 0));
      return [...aConfirmar, ...realizadas];
    } else {
      const alvo = aba === 'Pendentes' ? 'Pendente' : 'Negada';
      lista = todas.filter((c) => c.status === alvo);
    }
    return lista.sort((a, b) => (a.dataObj?.getTime() ?? 0) - (b.dataObj?.getTime() ?? 0));
  });


  readonly consultasDeHoje = computed(() => {
    const hoje = new Date().toDateString();
    return this.todasConsultas().filter((c) => c.status === 'Agendada' && c.dataObj?.toDateString() === hoje);
  });

  readonly consultasHoje = computed(() => this.consultasDeHoje().length);
  readonly sessoesAgendadas = computed(() => this.todasConsultas().filter((c) => c.status === 'Agendada' && !this.consultaPassou(c)).length);

  readonly ultimasAtividades = computed(() => {
    const agora = Date.now();
    return this.todasConsultas()
      .filter((c) => c.status === 'Agendada' && c.dataObj && c.dataObj.getTime() >= agora)
      .sort((a, b) => a.dataObj!.getTime() - b.dataObj!.getTime())
      .slice(0, 3)
      .map((c) => `${c.nome} • ${c.data.slice(0, 5)} às ${c.horario}`);
  });

  readonly pacientes = computed(() => {
    const mapa = new Map<string, any>();
    for (const c of this.todasConsultas()) {
      if ((c.status !== 'Agendada' && c.status !== 'Realizada') || !c.maeId) continue;
      const atual = mapa.get(c.maeId);
      if (!atual || (c.dataObj && atual.dataObj && c.dataObj > atual.dataObj)) {
        mapa.set(c.maeId, { id: c.maeId, nome: c.nome, avatar: c.avatar, ultimaConsulta: c.data, dataObj: c.dataObj });
      }
    }
    return Array.from(mapa.values());
  });

  readonly nomesMeses = NOMES_MESES;
  readonly diasSemana = DIAS_SEMANA;
  readonly anosSelecionaveis: number[];
  readonly currentMonth = signal(new Date().getMonth());
  readonly currentYear = signal(new Date().getFullYear());

  private readonly disponibilidade = signal<Date[]>([]);
  private readonly agendados = signal<Date[]>([]);

  readonly celulasCalendario = computed<CelulaCalendario[]>(() => {
    const ano = this.currentYear();
    const mes = this.currentMonth();
    const hoje = new Date();
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const marcados = new Set<number>();
    [...this.disponibilidade(), ...this.agendados()].forEach((d) => {
      if (d.getFullYear() === ano && d.getMonth() === mes) marcados.add(d.getDate());
    });
    const celulas: CelulaCalendario[] = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push({ dia: null, isHoje: false, temDisponibilidade: false });
    for (let d = 1; d <= diasNoMes; d++) {
      const dataAtual = new Date(ano, mes, d);
      celulas.push({ dia: d, isHoje: dataAtual.toDateString() === hoje.toDateString(), temDisponibilidade: marcados.has(d), passado: dataAtual < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) });
    }
    return celulas;
  });

  readonly eventosDoMesOrdenados = computed<EventoAgenda[]>(() => {
    const ano = this.currentYear();
    const mes = this.currentMonth();
    return this.todasConsultas()
      .filter((c) => (c.status === 'Agendada' || c.status === 'Realizada') && c.dataObj
        && c.dataObj.getFullYear() === ano && c.dataObj.getMonth() === mes)
      .map((c) => ({ titulo: c.nome, descricao: `Motivo: ${c.motivo}`, local: `às ${c.horario}`, data: c.dataObj! }))
      .sort((a, b) => a.data.getTime() - b.data.getTime());
  });

  readonly modalHorariosAberto = signal(false);
  readonly diaSelecionado = signal<Date | null>(null);
  readonly carregandoHorarios = signal(false);
  readonly salvandoHorarios = signal(false);
  readonly horariosDoDia = signal<HorarioSlot[]>([]);
  readonly mensagemAgenda = signal('');

  readonly artigos = signal<any[]>([]);
  readonly carregandoArtigos = signal(true);
  readonly filtroArtigo = signal<FiltroArtigo>('todos');
  readonly ordemArtigos = signal<'recentes' | 'antigos'>('recentes');
  /** ids dos artigos que o advogado salvou (advogados/{id}.favoritos) */
  readonly favoritosIds = signal<string[]>([]);

  readonly artigosFiltrados = computed(() => {
    const f = this.filtroArtigo();
    let lista = this.artigos();
    if (f === 'meus') lista = lista.filter((a) => a.autorId && a.autorId === this.uidAtual);
    else if (f === 'favoritos') lista = lista.filter((a) => this.favoritosIds().includes(a.id));
    else if (f !== 'todos') lista = lista.filter((a) => (a.categoria || '').toLowerCase() === f);
    const sinal = this.ordemArtigos() === 'recentes' ? -1 : 1;
    return [...lista].sort((a, b) => sinal * (a.tempo - b.tempo));
  });

  readonly categoriasArtigo: { valor: CategoriaArtigo; label: string }[] = [
    { valor: 'posts', label: 'Posts' },
    { valor: 'legislativos', label: 'Legislativos' },
    { valor: 'educacionais', label: 'Educacionais' },
    { valor: 'dicas', label: 'Dicas' },
  ];

  private readonly CATEGORIA_COR: Record<string, string> = {
    legislativos: '#e63946', educacionais: '#1d3557', dicas: '#2a9d8f', posts: '#6a4c93',
  };

  readonly modalArtigoAberto = signal(false);
  readonly artigoForm = signal<ArtigoForm>({ ...ARTIGO_VAZIO });
  readonly statusRascunho = signal('');
  readonly msgArtigo = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  readonly publicandoArtigo = signal(false);
  readonly imagemPreviaOk = signal(true);
  readonly dataHojeTexto = new Date().toLocaleDateString('pt-BR');
  readonly corCategoriaPreview = computed(() => this.CATEGORIA_COR[this.artigoForm().categoria] || '#7a5fe8');

  readonly carregandoForum = signal(true);
  readonly postAbertoId = signal<string | null>(null);
  readonly respostasDoPost = signal<any[]>([]);
  readonly carregandoRespostas = signal(false);
  readonly textoResposta = signal('');
  readonly enviandoResposta = signal(false);
  readonly erroResposta = signal('');
  readonly termoForum = signal('');
  readonly filtroForum = signal<'todos' | 'aguardando'>('todos');
  readonly forumPosts = signal<any[]>([]);

  readonly forumFiltrado = computed(() => {
    const termo = this.termoForum().toLowerCase().trim();
    const soAguardando = this.filtroForum() === 'aguardando';
    return this.forumPosts().filter((p) => {
      if (soAguardando && p.totalRespostas > 0) return false;
      if (!termo) return true;
      return [p.titulo, p.conteudo, p.autorNome].some((t: string) => (t || '').toLowerCase().includes(termo));
    });
  });

  readonly chatUsers = computed(() => {
    const ativoId = this.chatSelecionado()?.id;
    return this.pacientes().map((p) => ({ id: p.id, nome: p.nome, avatar: p.avatar, ativo: p.id === ativoId }));
  });

  readonly chatSelecionado = signal<any>(null);
  readonly mensagensChat = signal<any[]>([]);
  readonly novaMensagem = signal('');
  readonly isMobileChatActive = signal<boolean>(false);
  private chatId: string | null = null;
  private chatUnsubscribe: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(@Inject(PLATFORM_ID) private readonly platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
    const anoAtual = new Date().getFullYear();
    this.anosSelecionaveis = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];
  }

  ngOnInit(): void {
    this.activeSection.set(this.lerUltimaSecaoSalva());
    if (this.isBrowser) {
      const filtroSalvo = sessionStorage.getItem(CHAVE_FILTRO_ARTIGO) as FiltroArtigo | null;
      if (filtroSalvo) this.filtroArtigo.set(filtroSalvo);
    }
    if (this.isBrowser) {
      const temaSalvo = localStorage.getItem('theme');
      this.isDarkMode.set(temaSalvo === 'dark');
      document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
    }

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        this.router.navigate(['/login-profissional']);
        return;
      }
      if (this.uidAtual === user.uid) return;
      this.uidAtual = user.uid;
      this.carregandoStats.set(true);
      this.carregandoConsultasHoje.set(true);
      await this.carregarPerfilProfissional(user.uid);
      this.ouvirConsultas(user.uid);
      this.carregarMinhaReputacao(user.uid);
      this.carregarPlano(user.uid);
      this.lembreteService.iniciarListenerDeConsultas(user.uid, 'advogado');
      this.carregarArtigos();
      this.carregarForum();
      this.ouvirNotificacoes(user.uid);
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.unsubConsultas?.();
    this.chatUnsubscribe?.();
    this.unsubNotificacoes?.();
  }

  // ==========================================================
  // AVISOS (sino): novo pedido, mãe cancelou, cadastro aprovado...
  // Só filtra por destinatário e ordena aqui, sem precisar de índice no Firestore.
  // ==========================================================
  readonly notificacoes = signal<{ id: string; titulo: string; mensagem: string; tipo: string; consultaId: string | null; remetenteId: string | null; lida: boolean; criadoEm: Date | null }[]>([]);
  readonly naoLidas = computed(() => this.notificacoes().filter((n) => !n.lida).length);
  readonly notifAberto = signal(false);
  /** pedidos esperando resposta: aparece como número no item "Consultas" do menu */
  readonly pendentesCount = computed(() => this.todasConsultas().filter((c) => c.status === 'Pendente').length);
  private unsubNotificacoes: (() => void) | null = null;

  private ouvirNotificacoes(uid: string) {
    this.unsubNotificacoes?.();
    this.unsubNotificacoes = onSnapshot(
      query(collection(db, 'notificacoes'), where('destinatarioId', '==', uid)),
      (snap) => {
        const lista = snap.docs.map((d) => {
          const n: any = d.data();
          return {
            id: d.id,
            titulo: n['titulo'] || 'Aviso',
            mensagem: n['mensagem'] || '',
            tipo: n['tipo'] || '',
            consultaId: n['consultaId'] || null,
            remetenteId: n['remetenteId'] || null,
            lida: !!n['lida'],
            criadoEm: n['criadoEm']?.toDate ? n['criadoEm'].toDate() : null,
          };
        });
        lista.sort((a, b) => (b.criadoEm?.getTime() ?? Date.now()) - (a.criadoEm?.getTime() ?? Date.now()));
        this.notificacoes.set(lista.slice(0, 20));
      },
      (e) => console.warn('Avisos indisponíveis:', e),
    );
  }

  toggleNotificacoes() { this.notifAberto.update((v) => !v); }

  async marcarAvisosComoLidos() {
    const naoLidas = this.notificacoes().filter((n) => !n.lida);
    if (!naoLidas.length) return;
    try {
      const batch = writeBatch(db);
      naoLidas.forEach((n) => batch.update(doc(db, 'notificacoes', n.id), { lida: true }));
      await batch.commit();
    } catch (e) {
      console.warn('Não foi possível marcar os avisos como lidos:', e);
    }
  }

  iconeAviso(tipo: string): string {
    switch (tipo) {
      case 'consulta_nova': return 'fa-solid fa-calendar-plus';
      case 'consulta_cancelada_mae': return 'fa-solid fa-calendar-xmark';
      case 'chat_mensagem': return 'fa-solid fa-comment-dots';
      case 'aprovacao_profissional': return 'fa-solid fa-circle-check';
      default: return 'fa-solid fa-bell';
    }
  }

  async abrirAviso(n: { id: string; lida: boolean; tipo: string; consultaId: string | null; remetenteId: string | null }) {
    this.notifAberto.set(false);
    if (!n.lida) {
      try { await updateDoc(doc(db, 'notificacoes', n.id), { lida: true }); }
      catch (e) { console.warn('Não foi possível marcar como lida:', e); }
    }
    if (n.tipo === 'chat_mensagem') {
      this.selecionarSecao('chats');
      const conversa = this.chatUsers().find((u) => u.id === n.remetenteId);
      if (conversa) this.selecionarChat(conversa);
      return;
    }
    if (n.tipo === 'consulta_nova') { this.selecionarSecao('consultas'); this.setAbaConsultas('Pendentes'); }
    else if (n.tipo.startsWith('consulta_cancelada')) { this.selecionarSecao('consultas'); this.setAbaConsultas('Negadas'); }
    else if (n.consultaId) { this.selecionarSecao('consultas'); }
  }

  quandoAviso(d: Date | null): string {
    if (!d) return 'agora';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    const dias = Math.floor(h / 24);
    if (dias < 7) return dias === 1 ? 'ontem' : `há ${dias} dias`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  // ==========================================================
  // HISTÓRICO DO ATENDIMENTO: todas as consultas e anotações de uma cliente
  // ==========================================================
  readonly prontuarioAberto = signal<{ id: string; nome: string; avatar: string } | null>(null);
  readonly sessoesProntuario = signal<{ consulta: ConsultaView; texto: string }[]>([]);
  readonly carregandoProntuario = signal(false);
  readonly gerandoProntuarioPdf = signal(false);

  async abrirProntuario(p: { id: string; nome: string; avatar: string }) {
    this.prontuarioAberto.set(p);
    this.carregandoProntuario.set(true);
    const sessoes = this.todasConsultas()
      .filter((c) => c.maeId === p.id && (c.status === 'Realizada' || this.consultaPassou(c)))
      .sort((a, b) => (b.dataObj?.getTime() ?? 0) - (a.dataObj?.getTime() ?? 0));
    this.sessoesProntuario.set(sessoes.map((consulta) => ({ consulta, texto: '' })));
    try {
      if (this.uidAtual) {
        const snap = await getDocs(query(
          collection(db, 'anotacoesAtendimento'),
          where('profissionalUid', '==', this.uidAtual),
          where('maeId', '==', p.id),
        ));
        const porConsulta = new Map(snap.docs.map((d) => [d.id, String(d.data()['texto'] || '')]));
        this.sessoesProntuario.set(sessoes.map((consulta) => ({ consulta, texto: porConsulta.get(consulta.id) || '' })));
      }
    } catch (e) {
      console.error('Erro ao abrir prontuário:', e);
      this.alerta.erro('Não foi possível carregar as anotações agora.');
    } finally {
      this.carregandoProntuario.set(false);
    }
  }

  fecharProntuario() { this.prontuarioAberto.set(null); }

  editarDoProntuario(c: ConsultaView) {
    this.prontuarioAberto.set(null);
    this.abrirAnotacao(c);
  }

  async baixarProntuarioPdf() {
    const p = this.prontuarioAberto();
    if (!p) return;
    this.gerandoProntuarioPdf.set(true);
    try {
      await gerarProntuario({
        tipo: 'advogado',
        profissional: { nome: this.nomeCompleto(), crp: this.oab() ? `OAB ${this.oab()}` : '' },
        pacientes: [{
          nome: p.nome,
          sessoes: this.sessoesProntuario().map((s) => ({ data: s.consulta.dataObj, texto: s.texto })),
        }],
        nomeArquivo: `atendimentos-${p.nome}`,
      });
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      this.alerta.erro('Não foi possível gerar o PDF agora.');
    } finally {
      this.gerandoProntuarioPdf.set(false);
    }
  }

  irParaPerfil() {
    this.router.navigate(['/perfil-profissional']);
  }

  private async carregarPerfilProfissional(uid: string) {
    try {
      let dados: any = null;
      const docAdv = await getDoc(doc(db, 'advogados', uid));
      if (docAdv.exists()) {
        this.advDocId = docAdv.id;
        dados = docAdv.data();
      } else {
        const snapLegado = await getDocs(query(collection(db, 'advogados'), where('uid', '==', uid)));
        if (!snapLegado.empty) {
          this.advDocId = snapLegado.docs[0].id;
          dados = snapLegado.docs[0].data();
        }
      }
      if (!dados) {
        const docUser = await getDoc(doc(db, 'usuarios', uid));
        if (docUser.exists()) dados = docUser.data();
      }
      if (dados) {
        this.nomeCompleto.set(dados['nome'] || 'Advogado(a)');
        this.oab.set(String(dados['oab'] || '').trim());
        this.statusCadastro.set(String(dados['status'] || 'pendente').toLowerCase());
        this.cidadeProfissional.set(String(dados['cidade'] || '').trim());
        if (dados['avatar']) this.avatarUrl.set(dados['avatar']);
        this.disponibilidade.set(this.paraDatas(dados['disponibilidade']));
        this.agendados.set(this.paraDatas(dados['agendados']));
      }
    } catch (err: any) {
      console.error('Erro ao carregar perfil:', err);
    }
  }

  private async carregarMinhaReputacao(uid: string) {
    this.carregandoReputacao.set(true);
    try {
      this.reputacao.set(await carregarReputacao(uid));
    } catch (e) {
      console.warn('Não foi possível carregar a reputação', e);
    } finally {
      this.carregandoReputacao.set(false);
    }
  }

  private paraDatas(lista: any): Date[] {
    return (lista || [])
      .map((t: any) => (t?.toDate ? t.toDate() : new Date(t)))
      .filter((d: Date) => !isNaN(d.getTime()));
  }

  private ouvirConsultas(uid: string) {
    this.unsubConsultas?.();
    const q = query(collection(db, 'Consultas'), where('profissionalId', '==', uid));
    this.unsubConsultas = onSnapshot(
      q,
      async (snap) => {
        const idsNovos = [...new Set(snap.docs.map((d) => (d.data()['maeId'] || d.data()['Mae']) as string).filter((id) => id && !this.cacheMaes.has(id)))];
        await Promise.all(
          idsNovos.map(async (id) => {
            try {
              const s = await getDoc(doc(db, 'usuarios', id));
              const d: any = s.exists() ? s.data() : {};
              this.cacheMaes.set(id, { nome: d['nome'] || 'Cliente', avatar: d['avatar'] || './img/avatar_usuario.png' });
            } catch {
              this.cacheMaes.set(id, { nome: 'Cliente', avatar: './img/avatar_usuario.png' });
            }
          }),
        );
        const lista: ConsultaView[] = snap.docs.map((d) => {
          const raw: any = d.data();
          const dataObj: Date | null = raw['Datahora']?.toDate ? raw['Datahora'].toDate() : raw['Datahora'] ? new Date(raw['Datahora']) : null;
          const idDaMae = raw['maeId'] || raw['Mae'];
          const mae = this.cacheMaes.get(idDaMae) || { nome: 'Cliente', avatar: './img/avatar_usuario.png' };
          const statusRaw = String(raw['status'] || 'pendente').toLowerCase();
          return {
            id: d.id,
            maeId: idDaMae,
            nome: mae.nome,
            avatar: mae.avatar,
            dataObj,
            data: dataObj ? dataObj.toLocaleDateString('pt-BR') : 'Sem data',
            horario: dataObj ? dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'A definir',
            motivo: raw['Motivo'] || 'Não informado',
            statusRaw,
            status: STATUS_LABEL[statusRaw] || 'Pendente',
            canceladaAposAceite: !!raw['canceladaAposAceite'],
            realizadoEm: raw['realizadoEm']?.toDate ? raw['realizadoEm'].toDate() : null,
          };
        });
        this.todasConsultas.set(lista);
        this.carregandoStats.set(false);
        this.carregandoConsultasHoje.set(false);
      },
      (err) => {
        console.error('Erro ao ouvir consultas:', err);
        this.carregandoStats.set(false);
        this.carregandoConsultasHoje.set(false);
      },
    );
  }

  setAbaConsultas(aba: AbaConsultas) { this.abaConsultas.set(aba); }

  async aceitarConsulta(c: ConsultaView) {
    try {
      await updateDoc(doc(db, 'Consultas', c.id), { status: 'aceito', confirmadoEm: serverTimestamp() });
      await this.avisarMae(c, 'aceita');
    } catch (err: any) {
      console.error(err);
      this.alerta.erro('Houve um erro ao aceitar a consulta. Tente novamente.');
    }
  }

  async recusarConsulta(c: ConsultaView) {
    try {
      await updateDoc(doc(db, 'Consultas', c.id), {
        status: 'negado',
        canceladoPor: 'advogado',
        canceladoEm: serverTimestamp(),
      });
      await this.liberarHorario(c.dataObj);
      await this.avisarMae(c, 'recusada');
    } catch (err: any) {
      console.error(err);
      this.alerta.erro('Houve um erro ao recusar a consulta. Tente novamente.');
    }
  }

  /**
   * Aviso para a mãe na coleção `notificacoes` (mesmo formato que o painel do admin usa).
   * Falhar aqui nunca desfaz a confirmação.
   */
  private async avisarMae(c: ConsultaView, decisao: 'aceita' | 'recusada' | 'cancelada', motivo = '') {
    if (!c.maeId) return;
    const quando = c.dataObj
      ? c.dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) + ' às ' + c.horario
      : 'a data combinada';
    try {
      await addDoc(collection(db, 'notificacoes'), {
        destinatarioId: c.maeId,
        tipo: decisao === 'aceita' ? 'consulta_confirmada' : decisao === 'cancelada' ? 'consulta_cancelada' : 'consulta_recusada',
        titulo: decisao === 'aceita' ? 'Sua consulta foi confirmada!'
          : decisao === 'cancelada' ? 'Sua consulta foi desmarcada' : 'Sua consulta não pôde ser confirmada',
        mensagem: decisao === 'aceita'
          ? `${this.nomeCompleto()} confirmou sua consulta de ${quando}. No horário, entre pela página Minhas consultas.`
          : decisao === 'cancelada'
            ? `${this.nomeCompleto()} precisou desmarcar a consulta de ${quando}.${motivo ? ' Motivo: ' + motivo + '.' : ''} Você pode escolher outro horário quando quiser.`
            : `${this.nomeCompleto()} não poderá atender em ${quando}. Que tal escolher outro horário?`,
        consultaId: c.id,
        link: '/consultas',
        lida: false,
        criadoEm: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Aviso para a mãe não gravado:', e);
    }
  }

  /** Desmarca uma consulta que já tinha sido aceita: libera o horário e avisa a mãe. */
  async desmarcarConsulta(c: ConsultaView) {
    const motivo = await this.alerta.solicitar(
      `Desmarcar a consulta com ${c.nome} em ${c.data} às ${c.horario}? A mãe recebe um aviso. Se quiser, conte o motivo (opcional):`,
      { titulo: 'Desmarcar consulta', textoOk: 'Desmarcar', textoCancelar: 'Voltar', perigo: true, placeholder: 'Ex.: imprevisto de saúde' },
    );
    if (motivo === null) return; // fechou sem confirmar
    try {
      await updateDoc(doc(db, 'Consultas', c.id), {
        status: 'negado',
        canceladoPor: 'advogado',
        canceladoEm: serverTimestamp(),
        canceladaAposAceite: true,
        motivoCancelamento: motivo.trim(),
      });
      await this.liberarHorario(c.dataObj);
      await this.avisarMae(c, 'cancelada', motivo.trim());
      this.alerta.sucesso('Consulta desmarcada. A mãe foi avisada.');
    } catch (err: any) {
      console.error(err);
      this.alerta.erro('Não foi possível desmarcar a consulta. Tente novamente.');
    }
  }

  // ---------- Anotações do atendimento (sigilo profissional) ----------
  // Ficam em anotacoesAtendimento/{consultaId} e só o próprio advogado lê e escreve.
  readonly anotacaoAberta = signal<ConsultaView | null>(null);
  readonly textoAnotacao = signal('');
  readonly carregandoAnotacao = signal(false);
  readonly salvandoAnotacao = signal(false);
  readonly msgAnotacao = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  readonly anotacaoAtualizadaEm = signal<Date | null>(null);

  async abrirAnotacao(c: ConsultaView) {
    this.anotacaoAberta.set(c);
    this.textoAnotacao.set('');
    this.msgAnotacao.set(null);
    this.anotacaoAtualizadaEm.set(null);
    this.carregandoAnotacao.set(true);
    try {
      const snap = await getDoc(doc(db, 'anotacoesAtendimento', c.id));
      if (snap.exists()) {
        const d: any = snap.data();
        this.textoAnotacao.set(d['texto'] || '');
        this.anotacaoAtualizadaEm.set(d['atualizadoEm']?.toDate ? d['atualizadoEm'].toDate() : null);
      }
    } catch (e) {
      console.error('Erro ao abrir anotação:', e);
      this.msgAnotacao.set({ tipo: 'erro', texto: 'Não foi possível abrir as anotações agora.' });
    } finally {
      this.carregandoAnotacao.set(false);
    }
  }

  fecharAnotacao() { if (!this.salvandoAnotacao()) this.anotacaoAberta.set(null); }

  async salvarAnotacao() {
    const c = this.anotacaoAberta();
    if (!c || !this.uidAtual) return;
    this.salvandoAnotacao.set(true);
    this.msgAnotacao.set(null);
    try {
      await setDoc(doc(db, 'anotacoesAtendimento', c.id), {
        profissionalUid: this.uidAtual,
        consultaId: c.id,
        maeId: c.maeId || '',
        maeNome: c.nome || '',
        dataAtendimento: c.dataObj ? Timestamp.fromDate(c.dataObj) : null,
        texto: this.textoAnotacao(),
        atualizadoEm: serverTimestamp(),
      }, { merge: true });
      this.anotacaoAtualizadaEm.set(new Date());
      this.msgAnotacao.set({ tipo: 'ok', texto: 'Anotações salvas.' });
    } catch (e) {
      console.error('Erro ao salvar anotação:', e);
      this.msgAnotacao.set({ tipo: 'erro', texto: 'Não foi possível salvar. Tente de novo.' });
    } finally {
      this.salvandoAnotacao.set(false);
    }
  }

  async marcarRealizada(c: ConsultaView) {
    try {
      // realizadoEm = fim da consulta, usado na duração do relatório de atendimentos
      await updateDoc(doc(db, 'Consultas', c.id), { status: 'realizado', realizadoEm: serverTimestamp(), encerradoPor: 'profissional' });
    } catch (err: any) {
      console.error(err);
      this.alerta.erro('Não foi possível marcar a consulta como realizada.');
    }
  }

  private async liberarHorario(data: Date | null) {
    if (!data || !this.advDocId || data.getTime() < Date.now()) return;
    try {
      const ts = Timestamp.fromDate(data);
      const ref = doc(db, 'advogados', this.advDocId);
      await updateDoc(ref, { agendados: arrayRemove(ts) });
      await updateDoc(ref, { disponibilidade: arrayUnion(ts) });
      const mesmo = (d: Date) => d.getTime() === data.getTime();
      this.agendados.update((l) => l.filter((d) => !mesmo(d)));
      this.disponibilidade.update((l) => [...l, data]);
    } catch (err: any) {
      console.error('Não foi possível liberar o horário:', err);
    }
  }

  mesAnterior(): void {
    if (this.currentMonth() === 0) { this.currentMonth.set(11); this.currentYear.update((y) => y - 1); }
    else { this.currentMonth.update((m) => m - 1); }
  }

  mesSeguinte(): void {
    if (this.currentMonth() === 11) { this.currentMonth.set(0); this.currentYear.update((y) => y + 1); }
    else { this.currentMonth.update((m) => m + 1); }
  }

  selecionarMes(valor: string): void { this.currentMonth.set(Number(valor)); }
  selecionarAno(valor: string): void { this.currentYear.set(Number(valor)); }

  /** Botão "Definir horários de hoje": começa pelo período de atendimento. */
  adicionarConsulta(): void {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    this.diaEmConfiguracao = hoje;
    this.erroPeriodo.set('');
    this.modalConfigPeriodoAberto.set(true);
  }

  avancarParaDuracaoSessao() {
    const inicio = this.paraMinutos(this.horaInicioExpediente());
    const fim = this.paraMinutos(this.horaFimExpediente());
    if (inicio === null || fim === null) { this.erroPeriodo.set('Preencha os dois horários.'); return; }
    if (fim <= inicio) { this.erroPeriodo.set('O horário final precisa ser depois do inicial.'); return; }
    this.erroPeriodo.set('');
    this.modalConfigPeriodoAberto.set(false);
    this.modalConfigTempoAberto.set(true);
  }

  ajustarMinutos(delta: number) {
    const novo = this.duracaoSessao() + delta;
    if (novo >= 15 && novo <= 120) this.duracaoSessao.set(novo);
  }

  confirmarConfiguracaoTempo() {
    if (this.isBrowser) {
      try {
        if (this.manterProximosDias()) {
          localStorage.setItem(CHAVE_DURACAO, String(this.duracaoSessao()));
          localStorage.setItem(CHAVE_EXPEDIENTE, JSON.stringify({ inicio: this.horaInicioExpediente(), fim: this.horaFimExpediente() }));
        } else {
          localStorage.removeItem(CHAVE_DURACAO);
          localStorage.removeItem(CHAVE_EXPEDIENTE);
        }
      } catch { /* sem armazenamento: segue só nesta sessão */ }
    }
    this.modalConfigTempoAberto.set(false);
    const dia = this.diaEmConfiguracao || new Date();
    this.abrirHorariosDoDia(new Date(dia.getFullYear(), dia.getMonth(), dia.getDate()));
  }

  abrirConfiguracaoNovamente() {
    this.diaEmConfiguracao = this.diaSelecionado();
    this.fecharModalHorarios();
    this.erroPeriodo.set('');
    this.modalConfigPeriodoAberto.set(true);
  }

  private paraMinutos(h: string): number | null {
    if (!h || !h.includes(':')) return null;
    const [hh, mm] = h.split(':').map(Number);
    return isNaN(hh) || isNaN(mm) ? null : hh * 60 + mm;
  }

  /** Clique num dia do calendário. */
  abrirSelecaoHorarios(dia: number | null): void {
    if (dia === null) return;
    this.abrirHorariosDoDia(new Date(this.currentYear(), this.currentMonth(), dia));
  }

  private abrirHorariosDoDia(dataClicada: Date): void {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (dataClicada < hoje) {
      this.mensagemAgenda.set('Você não pode selecionar datas anteriores a hoje.');
      return;
    }
    this.mensagemAgenda.set('');
    this.diaSelecionado.set(dataClicada);
    this.carregandoHorarios.set(true);
    this.modalHorariosAberto.set(true);

    const mesmoSlot = (d: Date, h: string) =>
      d.toDateString() === dataClicada.toDateString() &&
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` === h;

    const agora = new Date();
    const duracaoMinutos = this.duracaoSessao() || 30;
    const inicio = this.paraMinutos(this.horaInicioExpediente()) ?? 8 * 60;
    const fim = this.paraMinutos(this.horaFimExpediente()) ?? 18 * 60;

    // Só entra o horário em que a consulta inteira cabe antes do fim do expediente
    const horariosDinamicos: string[] = [];
    for (let m = inicio; m + duracaoMinutos <= fim; m += duracaoMinutos) {
      horariosDinamicos.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }

    // Horários já publicados/ocupados nesse dia que não batem com a grade atual continuam aparecendo
    const doDia = (d: Date) => d.toDateString() === dataClicada.toDateString();
    const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    [...this.disponibilidade(), ...this.agendados()].filter(doDia).forEach((d) => {
      if (!horariosDinamicos.includes(hm(d))) horariosDinamicos.push(hm(d));
    });
    horariosDinamicos.sort();

    const slots: HorarioSlot[] = horariosDinamicos.map((h) => {
      const [hh, mm] = h.split(':').map(Number);
      const jaPassou = new Date(dataClicada.getFullYear(), dataClicada.getMonth(), dataClicada.getDate(), hh, mm) < agora;
      const ocupado = this.agendados().some((d) => mesmoSlot(d, h));
      const publicado = this.disponibilidade().some((d) => mesmoSlot(d, h));
      const consulta = this.todasConsultas().find(
        (c) => c.dataObj && mesmoSlot(c.dataObj, h) && (c.status === 'Agendada' || c.status === 'Pendente'),
      );
      return {
        horario: h,
        status: ocupado || consulta ? 'ocupado' : jaPassou ? 'passado' : 'livre',
        selecionado: publicado && !ocupado,
        publicado,
        pacienteNome: consulta?.nome,
      };
    });

    this.horariosDoDia.set(slots);
    this.carregandoHorarios.set(false);
  }

  fecharModalHorarios(): void {
    this.modalHorariosAberto.set(false);
    this.diaSelecionado.set(null);
    this.horariosDoDia.set([]);
  }

  alternarHorario(slot: HorarioSlot): void {
    if (slot.status !== 'livre') return;
    this.horariosDoDia.update((lista) => lista.map((h) => (h.horario === slot.horario ? { ...h, selecionado: !h.selecionado } : h)));
  }

  async confirmarDisponibilidade(): Promise<void> {
    const dia = this.diaSelecionado();
    if (!dia) return;
    if (!this.advDocId) {
      this.alerta.erro('Não encontramos seu cadastro de advogado(a) para salvar os horários.', 'Cadastro não encontrado');
      this.fecharModalHorarios();
      return;
    }
    const paraData = (h: string) => {
      const [hh, mm] = h.split(':').map(Number);
      return new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hh, mm, 0, 0);
    };
    const slots = this.horariosDoDia();
    const adicionar = slots.filter((s) => s.selecionado && !s.publicado).map((s) => paraData(s.horario));
    const remover = slots.filter((s) => !s.selecionado && s.publicado && s.status === 'livre').map((s) => paraData(s.horario));

    if (adicionar.length === 0 && remover.length === 0) {
      this.fecharModalHorarios();
      return;
    }

    this.salvandoHorarios.set(true);
    try {
      const ref = doc(db, 'advogados', this.advDocId);
      if (adicionar.length) await updateDoc(ref, { disponibilidade: arrayUnion(...adicionar.map((d) => Timestamp.fromDate(d))) });
      if (remover.length) await updateDoc(ref, { disponibilidade: arrayRemove(...remover.map((d) => Timestamp.fromDate(d))) });
      const chaves = new Set(remover.map((d) => d.getTime()));
      this.disponibilidade.update((l) => [...l.filter((d) => !chaves.has(d.getTime())), ...adicionar]);
      this.mensagemAgenda.set('');
      this.fecharModalHorarios();
    } catch (err: any) {
      console.error('Erro ao salvar disponibilidade:', err);
      this.alerta.erro('Não foi possível salvar os horários. Tente novamente.');
    } finally {
      this.salvandoHorarios.set(false);
    }
  }

  irParaAgenda(): void { this.selecionarSecao('agenda'); }

  async carregarArtigos() {
    try {
      this.carregandoArtigos.set(true);
      const [snap, favoritos] = await Promise.all([
        getDocs(collection(db, 'artigos')),
        this.uidAtual ? carregarIdsFavoritosAdv(this.uidAtual) : Promise.resolve([] as string[]),
      ]);
      this.favoritosIds.set(favoritos);
      this.artigos.set(
        snap.docs.filter((d) => !d.data()?.['moderacao']?.removido).map((d) => {
          const a: any = d.data();
          const quando = a['datahorapost'] ?? a['data'] ?? null;
          const tempo = quando?.toDate ? quando.toDate().getTime() : quando ? new Date(quando).getTime() || 0 : 0;
          return { id: d.id, ...a, tempo };
        }),
      );
    } catch (e: any) {
      console.error('Erro ao carregar artigos:', e);
    } finally {
      this.carregandoArtigos.set(false);
    }
  }

  /** Troca a aba de artigos e lembra dela (para voltar do artigo na mesma aba). */
  filtrarArtigos(f: FiltroArtigo) {
    this.filtroArtigo.set(f);
    if (this.isBrowser) sessionStorage.setItem(CHAVE_FILTRO_ARTIGO, f);
  }

  ehFavorito(id: string): boolean { return this.favoritosIds().includes(id); }

  /** Salva/remove dos favoritos direto pelo card, sem abrir o artigo. */
  async alternarFavorito(artigo: any, ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.uidAtual) return;
    const salvar = !this.ehFavorito(artigo.id);
    const antes = this.favoritosIds();
    this.favoritosIds.set(salvar ? [...antes, artigo.id] : antes.filter((id) => id !== artigo.id));
    try {
      await definirFavoritoAdv(this.uidAtual, artigo.id, salvar);
    } catch (e) {
      console.error('Erro ao atualizar favorito:', e);
      this.favoritosIds.set(antes); // desfaz se não salvou
      this.alerta.erro('Não foi possível atualizar seus favoritos. Tente de novo.');
    }
  }

  alternarOrdemArtigos() { this.ordemArtigos.update((o) => (o === 'recentes' ? 'antigos' : 'recentes')); }
  corCategoria(cat: string | undefined): string { return this.CATEGORIA_COR[(cat || '').toLowerCase()] || '#6a4c93'; }
  imagemDoArtigo(a: any): string { return a.img || a.capa || a.imagem || ''; }

  abrirModalArtigo() {
    this.msgArtigo.set(null);
    this.artigoForm.set({ ...ARTIGO_VAZIO });
    this.imagemPreviaOk.set(true);
    this.statusRascunho.set('');
    this.recuperarRascunho();
    this.modalArtigoAberto.set(true);
  }

  fecharModalArtigo() { this.modalArtigoAberto.set(false); }

  setCampoArtigo<K extends keyof ArtigoForm>(campo: K, valor: ArtigoForm[K]) {
    this.artigoForm.update((f) => ({ ...f, [campo]: valor }));
    if (campo === 'img') this.imagemPreviaOk.set(true);
  }

  salvarRascunhoArtigo() {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(CHAVE_RASCUNHO_ARTIGO, JSON.stringify(this.artigoForm()));
      this.statusRascunho.set('Rascunho salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.');
    } catch {
      this.statusRascunho.set('Não foi possível salvar o rascunho.');
    }
  }

  private recuperarRascunho() {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem(CHAVE_RASCUNHO_ARTIGO);
      if (!raw) return;
      this.artigoForm.set({ ...ARTIGO_VAZIO, ...JSON.parse(raw) });
      this.statusRascunho.set('Rascunho recuperado.');
    } catch { /* sem rascunho */ }
  }

  async publicarArtigo() {
    const f = this.artigoForm();
    const titulo = f.titulo.trim();
    const descricao = f.descricao.trim();
    if (!titulo || !descricao) {
      this.msgArtigo.set({ tipo: 'erro', texto: 'Preencha o título e a descrição curta.' });
      return;
    }
    if (!this.uidAtual) return;
    this.publicandoArtigo.set(true);
    try {
      await addDoc(collection(db, 'artigos'), {
        titulo,
        descricao,
        resumo: f.resumo.trim() || descricao,
        img: f.img.trim(),
        link: f.link.trim(),
        categoria: f.categoria,
        postadoPor: this.nomeCompleto(),
        fonte: this.nomeCompleto(),
        datahorapost: new Date(),
        custoMoedas: 0,
        autorId: this.uidAtual,
        advogadoId: this.uidAtual,
        tipoAutor: 'advogado',
      });
      if (this.isBrowser) { try { localStorage.removeItem(CHAVE_RASCUNHO_ARTIGO); } catch { /* ok */ } }
      this.artigoForm.set({ ...ARTIGO_VAZIO });
      this.fecharModalArtigo();
      await this.carregarArtigos();
    } catch (err: any) {
      console.error('Erro ao publicar artigo:', err);
      this.msgArtigo.set({ tipo: 'erro', texto: 'Erro ao publicar a postagem. Tente novamente.' });
    } finally {
      this.publicandoArtigo.set(false);
    }
  }

  async carregarForum() {
    try {
      this.carregandoForum.set(true);
      const snap = await getDocs(query(collection(db, 'posts'), orderBy('data', 'desc'), limit(30)));
      const lista = await Promise.all(
        snap.docs.map(async (d) => {
          const p: any = d.data();
          let totalRespostas = 0;
          try {
            totalRespostas = (await getCountFromServer(collection(db, 'posts', d.id, 'comentarios'))).data().count;
          } catch { /* sem contagem */ }
          const anonimo = p['autorId'] === 'anonimo';
          return {
            id: d.id,
            titulo: p['titulo'] || 'Sem título',
            conteudo: p['conteudo'] || '',
            categoria: p['categoria'] || '',
            autorNome: anonimo ? 'Anônimo' : p['autorNome'] || 'Usuária',
            autorFoto: anonimo ? './img/account_icon.png' : p['autorFoto'] || './img/account_icon.png',
            dataTexto: p['data']?.toDate ? p['data'].toDate().toLocaleString('pt-BR') : '',
            removido: !!p['moderacao']?.removido,
            totalRespostas,
          };
        }),
      );
      this.forumPosts.set(lista.filter((p) => !p.removido));
    } catch (e: any) {
      console.error('Erro ao carregar fórum:', e);
    } finally {
      this.carregandoForum.set(false);
    }
  }

  async alternarPost(post: any) {
    if (this.postAbertoId() === post.id) {
      this.postAbertoId.set(null);
      return;
    }
    this.postAbertoId.set(post.id);
    this.textoResposta.set('');
    this.erroResposta.set('');
    await this.carregarRespostas(post.id);
  }

  private async carregarRespostas(postId: string) {
    this.carregandoRespostas.set(true);
    try {
      const snap = await getDocs(query(collection(db, 'posts', postId, 'comentarios'), orderBy('data', 'asc')));
      this.respostasDoPost.set(
        snap.docs.map((d) => {
          const c: any = d.data();
          return {
            id: d.id,
            autorNome: c['autorNome'] || 'Especialista',
            autorFoto: c['autorFoto'] || './img/account_icon.png',
            conteudo: c['conteudo'] || '',
            profissional: !!c['tipoAutor'],
            dataTexto: c['data']?.toDate ? c['data'].toDate().toLocaleString('pt-BR') : 'Agora',
          };
        }),
      );
    } catch (err: any) {
      console.error('Erro ao carregar respostas:', err);
      this.respostasDoPost.set([]);
    } finally {
      this.carregandoRespostas.set(false);
    }
  }

  async enviarResposta(post: any) {
    const texto = this.textoResposta().trim();
    if (!texto || !this.uidAtual || this.enviandoResposta()) return;
    this.enviandoResposta.set(true);
    this.erroResposta.set('');
    try {
      await addDoc(collection(db, 'posts', post.id, 'comentarios'), {
        autorId: this.uidAtual,
        autorNome: this.nomeCompleto(),
        autorFoto: this.avatarUrl(),
        tipoAutor: 'advogado',
        conteudo: texto,
        likes: 0,
        data: serverTimestamp(),
      });
      try { await updateDoc(doc(db, 'posts', post.id), { respondido: true }); } catch (e: any) { console.warn(e); }
      this.textoResposta.set('');
      this.forumPosts.update((l) => l.map((p) => (p.id === post.id ? { ...p, totalRespostas: p.totalRespostas + 1 } : p)));
      await this.carregarRespostas(post.id);
    } catch (err: any) {
      console.error(err);
      this.erroResposta.set('Não foi possível enviar sua resposta. Verifique sua conexão e tente de novo.');
    } finally {
      this.enviandoResposta.set(false);
    }
  }

  abrirChatComPaciente(paciente: any) { this.abrirChatComMae(paciente.id); }

  abrirChatComMae(maeId: string): void {
    const user = this.chatUsers().find((u) => u.id === maeId);
    if (!user) return;
    this.selecionarSecao('chats');
    this.selecionarChat(user);
  }

  async selecionarChat(user: any) {
    this.isMobileChatActive.set(true);
    if (!this.uidAtual) return;
    this.chatSelecionado.set(user);
    this.mensagensChat.set([]);
    this.chatUnsubscribe?.();
    try {
      const snap = await getDocs(query(collection(db, 'chats'), where('participantes', 'array-contains', this.uidAtual)));
      let existente = snap.docs.find((d) => (d.data()['participantes'] || []).includes(user.id));
      if (!existente) {
        const novo = await addDoc(collection(db, 'chats'), {
          participantes: [this.uidAtual, user.id],
          criadoEm: serverTimestamp(),
          ultimoMensagem: '',
          ultimoEnviadoPor: '',
        });
        this.chatId = novo.id;
      } else {
        this.chatId = existente.id;
      }
      const meuId = this.uidAtual;
      this.chatUnsubscribe = onSnapshot(
        query(collection(db, 'chats', this.chatId!, 'mensagens'), orderBy('enviadoEm', 'asc')),
        (s) => {
          this.mensagensChat.set(
            s.docs.map((d) => {
              const m: any = d.data();
              return {
                id: d.id,
                sender: m['enviadoPor'] === meuId ? 'sent' : 'received',
                text: m['texto'] || '',
                audio: m['audio'] || null,
                lembrete: cartaoDoLembrete(m),
                time: m['enviadoEm']?.toDate ? m['enviadoEm'].toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Agora',
              };
            }),
          );
          const naoLidas = s.docs.filter((d) => d.data()['enviadoPor'] !== meuId && d.data()['lido'] === false);
          if (naoLidas.length) {
            const batch = writeBatch(db);
            naoLidas.forEach((d) => batch.update(d.ref, { lido: true }));
            batch.commit().catch(() => {});
          }
        },
        (err) => console.error(err),
      );
    } catch (e: any) {
      console.error(e);
    }
  }

  async enviarMensagem() {
    const texto = this.novaMensagem().trim();
    if (!texto || !this.chatId || !this.uidAtual) return;
    this.novaMensagem.set('');
    try {
      // resumo do chat antes desta mensagem (para o aviso não repetir a cada mensagem)
      const antes: any = (await getDoc(doc(db, 'chats', this.chatId))).data() || {};
      const outro = (antes['participantes'] || []).find((p: string) => p !== this.uidAtual)
        || this.chatSelecionado()?.id;
      avisarMensagemChat({
        chatId: this.chatId, remetenteId: this.uidAtual, remetenteNome: this.nomeCompleto(),
        destinatarioId: outro, texto, link: `/chat?uid=${this.uidAtual}`,
        ultimoEnviadoPor: antes['ultimoEnviadoPor'],
        ultimaAtualizacao: antes['ultimaAtualizacao']?.toDate ? antes['ultimaAtualizacao'].toDate() : null,
      });
      await addDoc(collection(db, 'chats', this.chatId, 'mensagens'), {
        texto,
        enviadoPor: this.uidAtual,
        enviadoEm: serverTimestamp(),
        lido: false,
      });
      await updateDoc(doc(db, 'chats', this.chatId), {
        ultimoMensagem: texto,
        ultimoEnviadoPor: this.uidAtual,
        ultimaAtualizacao: serverTimestamp(),
      });
    } catch (e: any) {
      console.error(e);
      this.novaMensagem.set(texto);
    }
  }

  // ==========================================================
  // DOCUMENTOS: relatório de atendimentos + modelos jurídicos
  // (tudo é gerado no navegador: nada fica salvo na plataforma)
  // ==========================================================
  readonly abaDocumentos = signal<'modelos' | 'relatorio'>('modelos');
  readonly gerandoPdf = signal(false);
  readonly erroDocumento = signal('');

  /** "OAB 123456/SP" — acrescenta o prefixo quando o cadastro guardou só o número. */
  private oabFormatada(): string {
    const o = this.oab();
    return o.toUpperCase().startsWith('OAB') ? o : `OAB ${o}`;
  }

  // ----- Relatório de atendimentos (Premium) -----
  readonly relPeriodo = signal<'mes' | 'mes-passado' | '3m' | '6m' | 'ano'>('mes');
  readonly opcoesPeriodoRelatorio = [
    { valor: 'mes', rotulo: 'Este mês' },
    { valor: 'mes-passado', rotulo: 'Mês passado' },
    { valor: '3m', rotulo: 'Últimos 3 meses' },
    { valor: '6m', rotulo: 'Últimos 6 meses' },
    { valor: 'ano', rotulo: 'Este ano' },
  ] as const;

  /** Início e fim do período escolhido. */
  readonly intervaloRelatorio = computed(() => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth();
    const fimDoMes = (a: number, m: number) => new Date(a, m + 1, 0, 23, 59, 59, 999);
    switch (this.relPeriodo()) {
      case 'mes-passado': return { inicio: new Date(ano, mes - 1, 1), fim: fimDoMes(ano, mes - 1) };
      case '3m': return { inicio: new Date(ano, mes - 2, 1), fim: fimDoMes(ano, mes) };
      case '6m': return { inicio: new Date(ano, mes - 5, 1), fim: fimDoMes(ano, mes) };
      case 'ano': return { inicio: new Date(ano, 0, 1), fim: new Date(ano, 11, 31, 23, 59, 59, 999) };
      default: return { inicio: new Date(ano, mes, 1), fim: fimDoMes(ano, mes) };
    }
  });

  readonly periodoRelatorioTexto = computed(() => {
    const { inicio, fim } = this.intervaloRelatorio();
    const m = (d: Date) => NOMES_MESES[d.getMonth()].toLowerCase();
    if (inicio.getMonth() === fim.getMonth() && inicio.getFullYear() === fim.getFullYear()) return `${m(inicio)} de ${inicio.getFullYear()}`;
    if (inicio.getFullYear() === fim.getFullYear()) return `${m(inicio)} a ${m(fim)} de ${fim.getFullYear()}`;
    return `${m(inicio)} de ${inicio.getFullYear()} a ${m(fim)} de ${fim.getFullYear()}`;
  });

  readonly consultasRelatorio = computed<ConsultaRelatorio[]>(() => {
    const { inicio, fim } = this.intervaloRelatorio();
    const padrao = this.duracaoSessao() || 30;
    const situacao: Record<ConsultaView['status'], ConsultaRelatorio['situacao']> = {
      Realizada: 'Realizada', Agendada: 'Agendada', Pendente: 'Pendente', Negada: 'Recusada',
    };
    return this.todasConsultas()
      .filter((c) => c.dataObj && c.dataObj >= inicio && c.dataObj <= fim)
      .map((c) => {
        let duracaoMin: number | null = null;
        let estimada = false;
        if (c.status === 'Realizada') {
          const real = c.realizadoEm ? Math.round((c.realizadoEm.getTime() - c.dataObj!.getTime()) / 60000) : NaN;
          const valida = real >= 10 && real <= 180;   // ignora encerramentos muito cedo ou esquecidos abertos
          duracaoMin = valida ? real : padrao;
          estimada = !valida;
        }
        const iniciais = String(c.nome || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
          .map((p) => p.charAt(0).toUpperCase() + '.').join(' ');
        return { data: c.dataObj!, situacao: situacao[c.status] || 'Pendente', duracaoMin, duracaoEstimada: estimada, iniciais };
      });
  });

  readonly resumoRelatorio = computed(() => {
    const l = this.consultasRelatorio();
    const realizadas = l.filter((c) => c.situacao === 'Realizada');
    const recusadas = l.filter((c) => c.situacao === 'Recusada').length;
    const decididas = l.filter((c) => c.situacao !== 'Pendente').length;
    return {
      pedidos: l.length,
      realizadas: realizadas.length,
      horas: formatarHoras(realizadas.reduce((s, c) => s + (c.duracaoMin || 0), 0)),
      taxa: decididas ? Math.round(((decididas - recusadas) / decididas) * 100) + '%' : '–',
    };
  });

  async baixarRelatorio() {
    if (!this.uidAtual || this.gerandoPdf()) return;
    this.erroDocumento.set('');
    if (!this.isPremium()) {
      this.erroDocumento.set('O relatório de atendimentos faz parte do Premium.');
      return;
    }
    if (!this.oab()) {
      this.erroDocumento.set('Cadastre sua OAB no perfil para emitir o relatório.');
      return;
    }
    this.gerandoPdf.set(true);
    try {
      const { inicio, fim } = this.intervaloRelatorio();
      const r = this.reputacao();
      await gerarRelatorioAtendimentos({
        nome: this.nomeCompleto(),
        profissao: 'Advogado(a)',
        registro: this.oabFormatada(),
        periodoTexto: this.periodoRelatorioTexto(),
        inicio,
        fim,
        consultas: this.consultasRelatorio(),
        duracaoPadraoMin: this.duracaoSessao() || 30,
        reputacao: { media: r.mediaTexto, total: r.total, recomendamPct: r.recomendamPct, bemAvaliado: r.bemAvaliado },
      });
    } catch (e) {
      console.error('Erro ao gerar relatório:', e);
      this.erroDocumento.set('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  // ----- Modelos de documentos jurídicos -----
  readonly modelos = MODELOS_JURIDICOS;
  readonly modeloSelecionado = signal<ModeloJuridico | null>(null);
  readonly docForm = signal<DocFormJuridico>({ ...DOC_JURIDICO_VAZIO });

  /** Atendimentos realizados com o(a) cliente escolhido(a) (para a declaração). */
  readonly sessoesDoCliente = computed(() => {
    const id = this.docForm().pacienteId;
    if (!id) return [];
    return this.todasConsultas()
      .filter((c) => c.maeId === id && c.status === 'Realizada' && c.dataObj)
      .sort((a, b) => b.dataObj!.getTime() - a.dataObj!.getTime());
  });

  readonly camposFaltando = computed(() => {
    const m = this.modeloSelecionado();
    const f = this.docForm();
    if (!m) return [];
    const falta: string[] = [];
    if (!f.interessado.trim()) falta.push(m.papelCliente);
    if (m.rotuloSolicitante && m.solicitanteObrigatorio && !f.solicitante.trim()) falta.push(m.rotuloSolicitante);
    if (m.rotuloFinalidade && !f.finalidade.trim()) falta.push(m.rotuloFinalidade);
    m.secoes.filter((s) => s.obrigatoria && !(f.secoes[s.id] || '').trim()).forEach((s) => falta.push(s.titulo));
    return falta;
  });

  podeUsarModelo(m: ModeloJuridico): boolean {
    return !m.premium || this.isPremium();
  }

  escolherModelo(m: ModeloJuridico) {
    if (!this.podeUsarModelo(m)) return;
    this.erroDocumento.set('');
    this.modeloSelecionado.set(m);
    this.docForm.set({ ...DOC_JURIDICO_VAZIO, secoes: {}, atendimentosIds: [], cidade: this.cidadeProfissional() });
  }

  voltarParaModelos() {
    this.modeloSelecionado.set(null);
    this.erroDocumento.set('');
  }

  setCampoDoc<K extends keyof DocFormJuridico>(campo: K, valor: DocFormJuridico[K]) {
    this.docForm.update((f) => ({ ...f, [campo]: valor }));
  }

  setSecaoDoc(id: string, valor: string) {
    this.docForm.update((f) => ({ ...f, secoes: { ...f.secoes, [id]: valor } }));
  }

  /** Ao escolher o(a) cliente, preenche o nome e (na declaração) já marca os atendimentos e sugere o texto. */
  escolherClienteDoc(id: string) {
    const p = this.pacientes().find((x) => x.id === id);
    const nome = p?.nome || '';
    this.docForm.update((f) => ({ ...f, pacienteId: id, interessado: nome, atendimentosIds: [] }));
    const m = this.modeloSelecionado();
    if (m?.id === 'declaracao') {
      this.docForm.update((f) => ({
        ...f,
        atendimentosIds: this.sessoesDoCliente().slice(0, 4).map((c) => c.id),
        secoes: f.secoes['texto']?.trim()
          ? f.secoes
          : { ...f.secoes, texto: `Declaro, para os devidos fins, que ${nome} compareceu a atendimento jurídico na modalidade on-line, por meio da plataforma EloMaterno, nos dias e horários abaixo.` },
      }));
    }
  }

  alternarAtendimentoDoc(id: string) {
    this.docForm.update((f) => ({
      ...f,
      atendimentosIds: f.atendimentosIds.includes(id) ? f.atendimentosIds.filter((x) => x !== id) : [...f.atendimentosIds, id],
    }));
  }

  async baixarDocumento() {
    const m = this.modeloSelecionado();
    if (!m || this.gerandoPdf()) return;
    this.erroDocumento.set('');
    if (!this.podeUsarModelo(m)) { this.erroDocumento.set('Este modelo faz parte do plano Premium.'); return; }
    if (!this.oab()) { this.erroDocumento.set('Cadastre sua OAB no perfil: ela é obrigatória nos documentos.'); return; }
    const falta = this.camposFaltando();
    if (falta.length) { this.erroDocumento.set(`Preencha: ${falta.join(', ')}.`); return; }

    const f = this.docForm();
    const atendimentos = this.todasConsultas()
      .filter((c) => f.atendimentosIds.includes(c.id) && c.dataObj)
      .map((c) => c.dataObj!)
      .sort((a, b) => a.getTime() - b.getTime());

    this.gerandoPdf.set(true);
    try {
      await gerarDocumentoJuridico({
        modelo: m,
        profissional: { nome: this.nomeCompleto(), oab: this.oabFormatada() },
        interessado: f.interessado.trim(),
        solicitante: f.solicitante.trim(),
        finalidade: f.finalidade.trim(),
        secoes: f.secoes,
        atendimentos,
        duracaoMin: this.duracaoSessao(),
        cidade: f.cidade.trim(),
        data: new Date(),
      });
    } catch (e) {
      console.error('Erro ao gerar documento:', e);
      this.erroDocumento.set('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  conhecerPremium() {
    this.selecionarSecao('planos');
  }

  // ==========================================================
  // PLANOS (Premium do advogado — pagamento simulado)
  // ==========================================================
  /** Planos vêm do catálogo gerenciado pelo ADM (PlanoService.planosParaOfertar('advogado')). */
  readonly planosOfertados = signal<Plano[]>([]);
  readonly planoGratuito = computed<Plano>(() =>
    this.planosOfertados().find((p) => p.nivel === 'gratuito')
      ?? { ...PLANOS_PADRAO_POR_PUBLICO.advogado[0], id: 'padrao-gratuito-advogado' });
  readonly planosPremium = computed(() => this.planosOfertados().filter((p) => p.nivel === 'premium'));
  readonly brl = formatarBRL;
  readonly sufixo = sufixoPeriodicidade;

  readonly salvandoPlano = signal(false);
  /** Plano em que a pessoa clicou "Assinar" (a confirmação só aparece nele). */
  readonly confirmandoPlanoId = signal<string | null>(null);
  readonly msgPlano = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  /** O plano pago em que o(a) advogado(a) está agora. */
  ehPlanoAtual(p: Plano): boolean {
    const a = this.assinatura();
    if (!this.isPremium() || !a) return false;
    if (a.planoId) return a.planoId === p.id;
    return p.id === this.planosPremium()[0]?.id; // assinatura anterior ao catálogo
  }

  private async carregarPlano(uid: string) {
    const a = await this.planoService.assinatura(uid);
    this.assinatura.set(a);
    this.isPremium.set(await this.planoService.temPremium(uid));
    this.planosOfertados.set(await this.planoService.planosParaOfertar('advogado'));
  }

  validadePremiumTexto(): string {
    const v = this.assinatura()?.validoAte;
    return v ? v.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  }

  async assinarPremium(plano: Plano) {
    if (!this.uidAtual || this.salvandoPlano()) return;
    this.salvandoPlano.set(true);
    this.msgPlano.set(null);
    try {
      const a = await this.planoService.assinarPlano(this.uidAtual, plano, {
        nome: this.nomeCompleto(),
        email: auth.currentUser?.email || '',
        tipo: 'advogado',
      });
      this.assinatura.set(a);
      this.isPremium.set(true);
      this.confirmandoPlanoId.set(null);
      this.msgPlano.set({ tipo: 'ok', texto: `${plano.nome} ativado! Os modelos de documentos já estão liberados.` });
    } catch (e) {
      console.error('Erro ao assinar:', e);
      this.msgPlano.set({ tipo: 'erro', texto: 'Não foi possível ativar agora. Tente de novo.' });
    } finally {
      this.salvandoPlano.set(false);
    }
  }

  async cancelarPremium() {
    if (!this.uidAtual || this.salvandoPlano()) return;
    this.salvandoPlano.set(true);
    this.msgPlano.set(null);
    try {
      const a = await this.planoService.cancelarPremium(this.uidAtual);
      this.assinatura.set(a);
      this.isPremium.set(false);
      this.msgPlano.set({ tipo: 'ok', texto: 'Você voltou para o plano gratuito.' });
    } catch (e) {
      console.error('Erro ao cancelar:', e);
      this.msgPlano.set({ tipo: 'erro', texto: 'Não foi possível cancelar agora. Tente de novo.' });
    } finally {
      this.salvandoPlano.set(false);
    }
  }

  selecionarSecao(secao: SecaoHomeAdv): void {
    this.activeSection.set(secao);
    if (this.isBrowser) {
      localStorage.setItem(CHAVE_ULTIMA_SECAO, secao);
      if (window.innerWidth <= 1024) this.sidebarOpen.set(false);
    }
  }

  toggleSidebar(): void { this.sidebarOpen.update((v) => !v); }
  closeSidebar(): void { this.sidebarOpen.set(false); }

  private lerUltimaSecaoSalva(): SecaoHomeAdv {
    if (!this.isBrowser) return 'dashboard';
    const salva = localStorage.getItem(CHAVE_ULTIMA_SECAO) as SecaoHomeAdv | null;
    const validas: SecaoHomeAdv[] = ['dashboard', 'agenda', 'artigos', 'consultas', 'forum', 'pacientes', 'chats', 'documentos', 'planos'];
    return salva && validas.includes(salva) ? salva : 'dashboard';
  }

  toggleAccessibilityMenu(): void { this.accessibilityMenuOpen.update((v) => !v); }
  aumentarFonte(): void { } diminuirFonte(): void { } alternarFiltroDaltonismo(): void { }
  alternarLeituraVoz(): void { } alternarMascaraLeitura(): void { } alternarTextoDestacado(): void { }
  alternarAltoContraste(): void { } aumentarEspacamentoLinhas(): void { } diminuirEspacamentoLinhas(): void { }
  redefinirAcessibilidade(): void { }

  toggleTheme(): void {
    if (!this.isBrowser) return;
    this.isDarkMode.update((v) => !v);
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
    localStorage.setItem('theme', this.isDarkMode() ? 'dark' : 'light');
  }

  async logout(): Promise<void> {
    try { await signOut(auth); } catch (e: any) { console.error(e); }
    this.router.navigateByUrl('/login-profissional');
  }

  onHeroMouseMove(event: MouseEvent): void {
    const alvo = event.currentTarget as HTMLElement;
    const rect = alvo.getBoundingClientRect();
    this.heroMouseX.set(`${((event.clientX - rect.left) / rect.width) * 100}%`);
    this.heroMouseY.set(`${((event.clientY - rect.top) / rect.height) * 100}%`);
  }
}
