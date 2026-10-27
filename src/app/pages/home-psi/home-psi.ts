import { Component, OnDestroy, OnInit, signal, computed, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { LembreteService } from '../../services/lembrete';
import { carregarReputacao, Reputacao, REPUTACAO_VAZIA } from '../../services/reputacao';
import { PlanoService, Assinatura } from '../../services/plano';
import { MODELOS_PSICOLOGIA, ModeloDocumento, IdModelo, modeloPorId } from '../../services/modelos-psicologia';
import { gerarCertificadoHoras, gerarDocumentoPsicologico, formatarHoras, SessaoCertificado } from '../../services/documentos-pdf';

import {
  doc, getDoc, collection, query, where, getDocs, updateDoc, addDoc, onSnapshot, orderBy, limit,
  serverTimestamp, Timestamp, arrayUnion, arrayRemove, getCountFromServer, writeBatch,
} from 'firebase/firestore';
import { AlertaService } from '../../core/services/alerta.service';

type SecaoHomePsi = 'dashboard' | 'agenda' | 'artigos' | 'consultas' | 'forum' | 'pacientes' | 'chats' | 'documentos' | 'planos' | 'informacoes';
type AbaConsultas = 'Pendentes' | 'Agendadas' | 'Realizadas' | 'Negadas';
type CategoriaArtigo = 'posts' | 'legislativos' | 'educacionais' | 'dicas';

interface MenuItem { target: SecaoHomePsi; label: string; icon: string; }
interface CelulaCalendario { dia: number | null; isHoje: boolean; temDisponibilidade: boolean; }
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
  realizadoEm: Date | null;
  statusRaw: string;
  status: 'Pendente' | 'Agendada' | 'Realizada' | 'Negada';
}
interface ArtigoForm {
  titulo: string; descricao: string; resumo: string; categoria: CategoriaArtigo; img: string; link: string;
}

const CHAVE_ULTIMA_SECAO = 'homepsi_lastSection';
const CHAVE_RASCUNHO_ARTIGO = 'homepsi_draft_artigo';
const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const STATUS_LABEL: Record<string, ConsultaView['status']> = {
  pendente: 'Pendente',
  aceito: 'Agendada', aceita: 'Agendada', agendada: 'Agendada',
  realizado: 'Realizada', realizada: 'Realizada',
  negado: 'Negada', negada: 'Negada',
};
const CHAVE_DURACAO = 'psi_duracao_sessao';
const CHAVE_EXPEDIENTE = 'psi_expediente';

/** localStorage pode não existir (SSR) ou estar bloqueado: nunca deixa a página quebrar. */
function lerLocal(chave: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(chave) : null; } catch { return null; }
}
const EXPEDIENTE_SALVO: { inicio?: string; fim?: string } = (() => {
  try { return JSON.parse(lerLocal(CHAVE_EXPEDIENTE) || '{}'); } catch { return {}; }
})();
interface DocForm {
  pacienteId: string;
  interessado: string;
  solicitante: string;
  finalidade: string;
  validade: string;
  cidade: string;
  secoes: Record<string, string>;
  atendimentosIds: string[];
}
const DOC_VAZIO: DocForm = {
  pacienteId: '', interessado: '', solicitante: '', finalidade: '', validade: '30 dias', cidade: '', secoes: {}, atendimentosIds: [],
};

const ARTIGO_VAZIO: ArtigoForm = { titulo: '', descricao: '', resumo: '', categoria: 'posts', img: '', link: '' };

@Component({
  selector: 'app-home-psi',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './home-psi.html',
  styleUrl: './home-psi.css',
})
export class HomePsi implements OnInit, OnDestroy {
  public router = inject(Router);
  private readonly alerta = inject(AlertaService);
  private lembreteService = inject(LembreteService);
  private planoService = inject(PlanoService);
  private readonly isBrowser: boolean;

  readonly menuItems: MenuItem[] = [
    { target: 'dashboard', label: 'Painel de controle', icon: 'fa-solid fa-chart-line' },
    { target: 'agenda', label: 'Agenda', icon: 'fa-solid fa-calendar-days' },
    { target: 'artigos', label: 'Artigos', icon: 'fa-solid fa-newspaper' },
    { target: 'consultas', label: 'Consultas', icon: 'fa-solid fa-hands-helping' },
    { target: 'forum', label: 'Fórum', icon: 'fa-solid fa-comments' },
    { target: 'pacientes', label: 'Pacientes', icon: 'fa-solid fa-user-group' },
    { target: 'chats', label: 'Chats', icon: 'fa-solid fa-message' },
    { target: 'documentos', label: 'Documentos', icon: 'fa-solid fa-file-signature' },
    { target: 'planos', label: 'Planos', icon: 'fa-solid fa-crown' },
  ];

  readonly activeSection = signal<SecaoHomePsi>('dashboard');
  readonly sidebarOpen = signal(false);
  readonly accessibilityMenuOpen = signal(false);
  readonly isDarkMode = signal(false);
  readonly nomeCompleto = signal('Psicólogo(a)');
  readonly primeiroNome = computed(() => this.nomeCompleto().split(' ')[0]);
  readonly avatarUrl = signal('./img/account_icon.png');
  readonly heroMouseX = signal('50%');
  readonly heroMouseY = signal('50%');

  readonly carregandoStats = signal(true);
  readonly reputacao = signal<Reputacao>(REPUTACAO_VAZIA);
  readonly carregandoReputacao = signal(true);
  readonly carregandoConsultasHoje = signal(true);
  private uidAtual: string | null = null;
  private psiDocId: string | null = null;
  readonly crp = signal('');
  readonly cidadeProfissional = signal('');
  readonly isPremium = signal(false);
  readonly assinatura = signal<Assinatura | null>(null);

  // Passo a passo da agenda: 1) período do dia  2) duração da sessão  3) escolher os horários
  readonly modalConfigPeriodoAberto = signal(false);
  readonly horaInicioExpediente = signal<string>(EXPEDIENTE_SALVO.inicio || '08:00');
  readonly horaFimExpediente = signal<string>(EXPEDIENTE_SALVO.fim || '18:00');
  readonly erroPeriodo = signal('');
  readonly modalConfigTempoAberto = signal(false);
  readonly duracaoSessaoPsi = signal<number>(Number(lerLocal(CHAVE_DURACAO) || '45'));
  readonly manterProximosDias = signal<boolean>(true);
  /** Dia que está sendo configurado (hoje pelo botão, ou o dia aberto antes de "Alterar período"). */
  private diaEmConfiguracao: Date | null = null;

  readonly todasConsultas = signal<ConsultaView[]>([]);
  readonly abaConsultas = signal<AbaConsultas>('Pendentes');
  private unsubConsultas: (() => void) | null = null;
  private cacheMaes = new Map<string, { nome: string; avatar: string }>();

  readonly consultasFiltradas = computed(() => {
    const aba = this.abaConsultas();
    const alvo = aba === 'Pendentes' ? 'Pendente' : aba === 'Agendadas' ? 'Agendada' : aba === 'Realizadas' ? 'Realizada' : 'Negada';
    return this.todasConsultas()
      .filter((c) => c.status === alvo)
      .sort((a, b) => (a.dataObj?.getTime() ?? 0) - (b.dataObj?.getTime() ?? 0));
  });

  readonly consultasDeHoje = computed(() => {
    const hoje = new Date().toDateString();
    return this.todasConsultas().filter((c) => c.status === 'Agendada' && c.dataObj?.toDateString() === hoje);
  });

  readonly consultasHoje = computed(() => this.consultasDeHoje().length);
  readonly sessoesAgendadas = computed(() => this.todasConsultas().filter((c) => c.status === 'Agendada').length);

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
      celulas.push({ dia: d, isHoje: dataAtual.toDateString() === hoje.toDateString(), temDisponibilidade: marcados.has(d) });
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
  readonly filtroArtigo = signal<'todos' | CategoriaArtigo | 'meus'>('todos');
  readonly ordemArtigos = signal<'recentes' | 'antigos'>('recentes');

  readonly artigosFiltrados = computed(() => {
    const f = this.filtroArtigo();
    let lista = this.artigos();
    if (f === 'meus') lista = lista.filter((a) => a.autorId && a.autorId === this.uidAtual);
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
      this.lembreteService.iniciarListenerDeConsultas(user.uid, 'psicologo');
      this.carregarArtigos();
      this.carregarForum();
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.unsubConsultas?.();
    this.chatUnsubscribe?.();
  }

  irParaPerfil() {
    this.router.navigate(['/perfil-profissional']);
  }

  private async carregarPerfilProfissional(uid: string) {
    try {
      let dados: any = null;
      const docPsi = await getDoc(doc(db, 'psicologos', uid));
      if (docPsi.exists()) {
        this.psiDocId = docPsi.id;
        dados = docPsi.data();
      } else {
        const snapLegado = await getDocs(query(collection(db, 'psicologos'), where('uid', '==', uid)));
        if (!snapLegado.empty) {
          this.psiDocId = snapLegado.docs[0].id;
          dados = snapLegado.docs[0].data();
        }
      }
      if (!dados) {
        const docUser = await getDoc(doc(db, 'usuarios', uid));
        if (docUser.exists()) dados = docUser.data();
      }
      if (dados) {
        this.nomeCompleto.set(dados['nome'] || 'Psicólogo(a)');
        this.crp.set(String(dados['crp'] || '').trim());
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
              this.cacheMaes.set(id, { nome: d['nome'] || 'Paciente', avatar: d['avatar'] || './img/avatar_usuario.png' });
            } catch {
              this.cacheMaes.set(id, { nome: 'Paciente', avatar: './img/avatar_usuario.png' });
            }
          }),
        );
        const lista: ConsultaView[] = snap.docs.map((d) => {
          const raw: any = d.data();
          const dataObj: Date | null = raw['Datahora']?.toDate ? raw['Datahora'].toDate() : raw['Datahora'] ? new Date(raw['Datahora']) : null;
          const idDaMae = raw['maeId'] || raw['Mae'];
          const mae = this.cacheMaes.get(idDaMae) || { nome: 'Paciente', avatar: './img/avatar_usuario.png' };
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
            realizadoEm: raw['realizadoEm']?.toDate ? raw['realizadoEm'].toDate() : null,
            statusRaw,
            status: STATUS_LABEL[statusRaw] || 'Pendente',
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
        canceladoPor: 'psicologo',
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
  private async avisarMae(c: ConsultaView, decisao: 'aceita' | 'recusada') {
    if (!c.maeId) return;
    const quando = c.dataObj
      ? c.dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) + ' às ' + c.horario
      : 'a data combinada';
    try {
      await addDoc(collection(db, 'notificacoes'), {
        destinatarioId: c.maeId,
        tipo: decisao === 'aceita' ? 'consulta_confirmada' : 'consulta_recusada',
        titulo: decisao === 'aceita' ? 'Sua consulta foi confirmada!' : 'Sua consulta não pôde ser confirmada',
        mensagem: decisao === 'aceita'
          ? `${this.nomeCompleto()} confirmou sua consulta de ${quando}. No horário, entre pela página Minhas consultas.`
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

  async marcarRealizada(c: ConsultaView) {
    try {
      // realizadoEm = fim da sessão, usado no certificado de horas
      await updateDoc(doc(db, 'Consultas', c.id), { status: 'realizado', realizadoEm: serverTimestamp(), encerradoPor: 'profissional' });
    } catch (err: any) {
      console.error(err);
      this.alerta.erro('Não foi possível marcar a consulta como realizada.');
    }
  }

  private async liberarHorario(data: Date | null) {
    if (!data || !this.psiDocId || data.getTime() < Date.now()) return;
    try {
      const ts = Timestamp.fromDate(data);
      const ref = doc(db, 'psicologos', this.psiDocId);
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

  ajustarMinutosPsi(delta: number) {
    const novo = this.duracaoSessaoPsi() + delta;
    if (novo >= 15 && novo <= 120) this.duracaoSessaoPsi.set(novo);
  }

  confirmarConfiguracaoTempo() {
    if (this.isBrowser) {
      try {
        if (this.manterProximosDias()) {
          localStorage.setItem(CHAVE_DURACAO, String(this.duracaoSessaoPsi()));
          localStorage.setItem(CHAVE_EXPEDIENTE, JSON.stringify({ inicio: this.horaInicioExpediente(), fim: this.horaFimExpediente() }));
        } else {
          localStorage.removeItem(CHAVE_DURACAO);
          localStorage.removeItem(CHAVE_EXPEDIENTE);
        }
      } catch { /* sem armazenamento: vale só nesta sessão */ }
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
    const duracaoMinutos = this.duracaoSessaoPsi() || 45;
    const inicio = this.paraMinutos(this.horaInicioExpediente()) ?? 8 * 60;
    const fim = this.paraMinutos(this.horaFimExpediente()) ?? 18 * 60;

    // Só entra o horário em que a sessão inteira cabe antes do fim do expediente
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
    if (!this.psiDocId) {
      this.alerta.erro('Não encontramos seu cadastro para salvar os horários.', 'Cadastro não encontrado');
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
      const ref = doc(db, 'psicologos', this.psiDocId);
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
      const snap = await getDocs(collection(db, 'artigos'));
      this.artigos.set(
        snap.docs.map((d) => {
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

  salvandoRascunhoArtigo() {
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
        psicologoId: this.uidAtual,
        tipoAutor: 'psicologo',
      });
      if (this.isBrowser) { try { localStorage.removeItem(CHAVE_RASCUNHO_ARTIGO); } catch { /* ok */ } }
      this.artigoForm.set({ ...ARTIGO_VAZIO });
      this.fecharModalArtigo();
      await this.carregarArtigos();
    } catch (err: any) {
      console.error('Erro ao publicar artigo:', err);
      this.msgArtigo.set({ tipo: 'erro', texto: 'Erro ao publicar o artigo. Tente novamente.' });
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
        tipoAutor: 'psicologo',
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
      this.erroResposta.set('Não foi possível enviar sua resposta.');
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
  // DOCUMENTOS: certificado de horas + modelos do CFP
  // ==========================================================
  readonly abaDocumentos = signal<'certificado' | 'modelos'>('certificado');
  readonly gerandoPdf = signal(false);
  readonly erroDocumento = signal('');

  // ----- Certificado de horas -----
  readonly certMes = signal(new Date().getMonth());
  readonly certAno = signal(new Date().getFullYear());
  readonly certDuracaoPadrao = signal(50);

  /** Sessões realizadas no mês escolhido, com a duração real quando a chamada registrou o encerramento. */
  readonly sessoesCertificado = computed<SessaoCertificado[]>(() => {
    const mes = this.certMes();
    const ano = this.certAno();
    const padrao = this.certDuracaoPadrao() || 50;
    return this.todasConsultas()
      .filter((c) => c.status === 'Realizada' && c.dataObj && c.dataObj.getMonth() === mes && c.dataObj.getFullYear() === ano)
      .sort((a, b) => a.dataObj!.getTime() - b.dataObj!.getTime())
      .map((c) => {
        const real = c.realizadoEm ? Math.round((c.realizadoEm.getTime() - c.dataObj!.getTime()) / 60000) : NaN;
        const valida = real >= 10 && real <= 180;   // ignora encerramentos muito cedo ou esquecidos abertos
        return { data: c.dataObj!, duracaoMin: valida ? real : padrao, duracaoEstimada: !valida };
      });
  });
  readonly totalHorasCertificado = computed(() => formatarHoras(this.sessoesCertificado().reduce((s, x) => s + x.duracaoMin, 0)));

  async baixarCertificado() {
    if (!this.uidAtual || this.gerandoPdf()) return;
    this.erroDocumento.set('');
    if (!this.crp()) {
      this.erroDocumento.set('Cadastre seu CRP no perfil para emitir o certificado.');
      return;
    }
    this.gerandoPdf.set(true);
    try {
      await gerarCertificadoHoras({
        uid: this.uidAtual,
        nome: this.nomeCompleto(),
        profissao: 'Psicólogo(a)',
        registro: this.crp().toUpperCase().startsWith('CRP') ? this.crp() : `CRP ${this.crp()}`,
        ano: this.certAno(),
        mes: this.certMes(),
        duracaoPadraoMin: this.certDuracaoPadrao(),
        sessoes: this.sessoesCertificado(),
      });
    } catch (e) {
      console.error('Erro ao gerar certificado:', e);
      this.erroDocumento.set('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      this.gerandoPdf.set(false);
    }
  }

  // ----- Modelos de documentos (Resolução CFP 06/2019) -----
  readonly modelos = MODELOS_PSICOLOGIA;
  readonly modeloSelecionado = signal<ModeloDocumento | null>(null);
  readonly docForm = signal<DocForm>({ ...DOC_VAZIO });

  /** Sessões realizadas com a paciente escolhida (para a declaração). */
  readonly sessoesDoPaciente = computed(() => {
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
    if (!f.interessado.trim()) falta.push('Interessado(a)');
    if (!f.finalidade.trim()) falta.push('Finalidade');
    m.secoes.filter((s) => s.obrigatoria && !(f.secoes[s.id] || '').trim()).forEach((s) => falta.push(s.titulo));
    if (m.pedeValidade && !f.validade.trim()) falta.push('Validade');
    return falta;
  });

  podeUsarModelo(m: ModeloDocumento): boolean {
    return !m.premium || this.isPremium();
  }

  escolherModelo(m: ModeloDocumento) {
    if (!this.podeUsarModelo(m)) return;
    this.erroDocumento.set('');
    this.modeloSelecionado.set(m);
    this.docForm.set({ ...DOC_VAZIO, secoes: {}, cidade: this.cidadeProfissional() });
  }

  voltarParaModelos() {
    this.modeloSelecionado.set(null);
    this.erroDocumento.set('');
  }

  setCampoDoc<K extends keyof DocForm>(campo: K, valor: DocForm[K]) {
    this.docForm.update((f) => ({ ...f, [campo]: valor }));
  }

  setSecaoDoc(id: string, valor: string) {
    this.docForm.update((f) => ({ ...f, secoes: { ...f.secoes, [id]: valor } }));
  }

  /** Ao escolher a paciente, preenche o nome e (na declaração) já marca as sessões e sugere o texto. */
  escolherPacienteDoc(id: string) {
    const p = this.pacientes().find((x) => x.id === id);
    const nome = p?.nome || '';
    this.docForm.update((f) => ({ ...f, pacienteId: id, interessado: nome, atendimentosIds: [] }));
    const m = this.modeloSelecionado();
    if (m?.id === 'declaracao') {
      this.docForm.update((f) => ({
        ...f,
        atendimentosIds: this.sessoesDoPaciente().slice(0, 4).map((c) => c.id),
        secoes: f.secoes['texto']?.trim()
          ? f.secoes
          : { ...f.secoes, texto: `Declaro, para os devidos fins, que ${nome} compareceu a atendimento psicológico na modalidade on-line, por meio da plataforma EloMaterno, nos dias e horários abaixo.` },
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
    if (!this.crp()) { this.erroDocumento.set('Cadastre seu CRP no perfil: ele é obrigatório nos documentos (Resolução CFP 06/2019).'); return; }
    const falta = this.camposFaltando();
    if (falta.length) { this.erroDocumento.set(`Preencha: ${falta.join(', ')}.`); return; }

    const f = this.docForm();
    const atendimentos = this.todasConsultas()
      .filter((c) => f.atendimentosIds.includes(c.id) && c.dataObj)
      .map((c) => c.dataObj!)
      .sort((a, b) => a.getTime() - b.getTime());

    this.gerandoPdf.set(true);
    try {
      await gerarDocumentoPsicologico({
        modelo: m,
        profissional: { nome: this.nomeCompleto(), crp: this.crp().toUpperCase().startsWith('CRP') ? this.crp() : `CRP ${this.crp()}` },
        interessado: f.interessado.trim(),
        solicitante: f.solicitante.trim(),
        finalidade: f.finalidade.trim(),
        secoes: f.secoes,
        atendimentos,
        duracaoMin: this.duracaoSessaoPsi(),
        validade: m.pedeValidade ? f.validade.trim() : undefined,
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
  // PLANOS (Premium do psicólogo — pagamento simulado)
  // ==========================================================
  /** Valor exibido na tela. Pagamento simulado: nada é cobrado. Ajuste aqui se a equipe definir outro. */
  readonly precoPremium = 'R$ 29,90';
  readonly salvandoPlano = signal(false);
  readonly confirmandoAssinatura = signal(false);
  readonly msgPlano = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  readonly recursosGratuito = [
    'Perfil na busca de profissionais',
    'Agenda, videochamada e chat com as mães',
    'Lembretes de consulta por e-mail',
    'Certificado de horas mensal',
    'Declaração de comparecimento (CFP)',
  ];
  readonly recursosPremium = [
    'Tudo do plano gratuito',
    'Destaque na busca e selo Premium no perfil',
    'Modelos de atestado, relatório, laudo e parecer (Resolução CFP 06/2019)',
    'Preenchimento automático com os dados das consultas',
    'Relatórios de atendimento em PDF (em breve)',
  ];

  private async carregarPlano(uid: string) {
    const a = await this.planoService.assinatura(uid);
    this.assinatura.set(a);
    this.isPremium.set(await this.planoService.temPremium(uid));
  }

  validadePremiumTexto(): string {
    const v = this.assinatura()?.validoAte;
    return v ? v.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  }

  async assinarPremium() {
    if (!this.uidAtual || this.salvandoPlano()) return;
    this.salvandoPlano.set(true);
    this.msgPlano.set(null);
    try {
      const a = await this.planoService.assinarPremiumTeste(this.uidAtual);
      this.assinatura.set(a);
      this.isPremium.set(true);
      this.confirmandoAssinatura.set(false);
      this.msgPlano.set({ tipo: 'ok', texto: 'Premium ativado! Os modelos de documentos já estão liberados.' });
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

  selecionarSecao(secao: SecaoHomePsi): void {
    this.activeSection.set(secao);
    if (this.isBrowser) {
      localStorage.setItem(CHAVE_ULTIMA_SECAO, secao);
      if (window.innerWidth <= 1024) this.sidebarOpen.set(false);
    }
  }

  abrirInformacoes(): void { this.selecionarSecao('informacoes'); }
  toggleSidebar(): void { this.sidebarOpen.update((v) => !v); }
  closeSidebar(): void { this.sidebarOpen.set(false); }

  private lerUltimaSecaoSalva(): SecaoHomePsi {
    if (!this.isBrowser) return 'dashboard';
    const salva = localStorage.getItem(CHAVE_ULTIMA_SECAO) as SecaoHomePsi | null;
    const validas: SecaoHomePsi[] = ['dashboard', 'agenda', 'artigos', 'consultas', 'forum', 'pacientes', 'chats', 'documentos', 'planos', 'informacoes'];
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