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
  serverTimestamp, Timestamp, arrayUnion, arrayRemove, getCountFromServer, writeBatch,
} from 'firebase/firestore';

type SecaoHomePsi = 'dashboard' | 'agenda' | 'artigos' | 'consultas' | 'forum' | 'pacientes' | 'chats' | 'informacoes';
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
  aceito: 'Agendada',
  realizado: 'Realizada',
  negado: 'Negada',
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
  private lembreteService = inject(LembreteService);
  private readonly isBrowser: boolean;

  readonly menuItems: MenuItem[] = [
    { target: 'dashboard', label: 'Painel de controle', icon: 'fa-solid fa-chart-line' },
    { target: 'agenda', label: 'Agenda', icon: 'fa-solid fa-calendar-days' },
    { target: 'artigos', label: 'Artigos', icon: 'fa-solid fa-newspaper' },
    { target: 'consultas', label: 'Consultas', icon: 'fa-solid fa-hands-helping' },
    { target: 'forum', label: 'Fórum', icon: 'fa-solid fa-comments' },
    { target: 'pacientes', label: 'Pacientes', icon: 'fa-solid fa-user-group' },
    { target: 'chats', label: 'Chats', icon: 'fa-solid fa-message' },
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

  // Modais e Periodicidade da Agenda com o novo passo a passo de horário de atendimento
  readonly modalConfigPeriodoAberto = signal(false);
  readonly horaInicioExpediente = signal<string>('08:00');
  readonly horaFimExpediente = signal<string>('18:00');
  readonly modalConfigTempoAberto = signal(false);
  readonly duracaoSessaoPsi = signal<number>(Number(localStorage.getItem('psi_duracao_sessao') || '45'));
  readonly manterProximosDias = signal<boolean>(true);

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
      alert('Houve um erro ao aceitar a consulta.');
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
      alert('Houve um erro ao recusar a consulta.');
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
      await updateDoc(doc(db, 'Consultas', c.id), { status: 'realizado' });
    } catch (err: any) {
      console.error(err);
      alert('Não foi possível marcar como realizada.');
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

  adicionarConsulta(): void {
    this.modalConfigPeriodoAberto.set(true);
  }

  avancarParaDuracaoSessao() {
    this.modalConfigPeriodoAberto.set(false);
    this.modalConfigTempoAberto.set(true);
  }

  ajustarMinutosPsi(delta: number) {
    const novo = this.duracaoSessaoPsi() + delta;
    if (novo >= 1 && novo <= 60) {
      this.duracaoSessaoPsi.set(novo);
    }
  }

  confirmarConfiguracaoTempo() {
    if (this.manterProximosDias()) {
      localStorage.setItem('psi_duracao_sessao', String(this.duracaoSessaoPsi()));
    } else {
      localStorage.removeItem('psi_duracao_sessao');
    }
    this.modalConfigTempoAberto.set(false);
    this.abrirSelecaoHorarios(new Date().getDate());
  }

  abrirConfiguracaoNovamente() {
    this.fecharModalHorarios();
    this.modalConfigPeriodoAberto.set(true);
  }

  abrirSelecaoHorarios(dia: number | null): void {
    if (dia === null) return;
    const dataClicada = new Date(this.currentYear(), this.currentMonth(), dia);
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

    const [hInicio, mInicio] = this.horaInicioExpediente().split(':').map(Number);
    const [hFim, mFim] = this.horaFimExpediente().split(':').map(Number);

    const horariosDinamicos: string[] = [];
    let horaAtual = hInicio;
    let minAtual = mInicio;
    const limiteMinutos = hFim * 60 + mFim;

    while (horaAtual * 60 + minAtual <= limiteMinutos) {
      const hh = String(horaAtual).padStart(2, '0');
      const mm = String(minAtual).padStart(2, '0');
      horariosDinamicos.push(`${hh}:${mm}`);
      minAtual += duracaoMinutos;
      while (minAtual >= 60) {
        minAtual -= 60;
        horaAtual++;
      }
    }

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
      alert('Não encontramos seu cadastro para salvar os horários.');
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
      alert('Erro ao salvar os horários. Tente novamente.');
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
    const validas: SecaoHomePsi[] = ['dashboard', 'agenda', 'artigos', 'consultas', 'forum', 'pacientes', 'chats', 'informacoes'];
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