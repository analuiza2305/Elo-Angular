import { Component, OnDestroy, OnInit, signal, computed, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router'; // <-- RouterModule ADICIONADO AQUI
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, addDoc, onSnapshot, orderBy } from 'firebase/firestore';

type SecaoHomePsi = 'dashboard' | 'agenda' | 'artigos' | 'consultas' | 'forum' | 'pacientes' | 'chats' | 'informacoes';

interface MenuItem { target: SecaoHomePsi; label: string; icon: string; }
interface ConsultaHojeView { id: string; maeId: string; nome: string; avatar: string; horario: string; }
interface CelulaCalendario { dia: number | null; isHoje: boolean; temDisponibilidade: boolean; }
interface EventoAgenda { titulo: string; descricao: string; local: string; data: Date; }
type StatusHorario = 'livre' | 'ocupado' | 'aceito' | 'realizado';
interface HorarioSlot { horario: string; status: StatusHorario; selecionado: boolean; pacienteNome?: string; }

const CHAVE_ULTIMA_SECAO = 'homepsi_lastSection';
const NOMES_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const HORARIOS_PADRAO = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

@Component({
  selector: 'app-home-psi',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule], // <-- RouterModule ADICIONADO AQUI
  templateUrl: './home-psi.html',
  styleUrl: './home-psi.css',
})
export class HomePsi implements OnInit, OnDestroy {
  private router = inject(Router);

  // NAVEGAÇÃO
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

  readonly nomeCompleto = signal('Psicólogo(a)');
  readonly primeiroNome = computed(() => this.nomeCompleto().split(' ')[0]);
  readonly avatarUrl = signal('./img/account_icon.png');
  readonly ultimasAtividades = signal<string[]>([]);

  readonly heroMouseX = signal('50%');
  readonly heroMouseY = signal('50%');

  // VARIÁVEIS ADICIONADAS NOVAMENTE
  readonly carregandoStats = signal(true);
  readonly carregandoConsultasHoje = signal(true);
  readonly consultasHoje = signal(0);
  readonly sessoesAgendadas = signal(0);
  readonly consultasDeHoje = signal<ConsultaHojeView[]>([]);

  // DADOS E LISTAS DO BANCO DE DADOS
  abaConsultas = signal<'Pendentes' | 'Agendadas' | 'Realizadas' | 'Negadas'>('Pendentes');
  todasConsultas = signal<any[]>([]);
  
  // Computa a lista de consultas baseada na aba ativa
  consultasFiltradas = computed(() => {
    const aba = this.abaConsultas();
    const statusDesejado = aba === 'Pendentes' ? 'Pendente' : 
                           aba === 'Agendadas' ? 'Agendada' : 
                           aba === 'Realizadas' ? 'Realizada' : 'Negada';
    return this.todasConsultas().filter(c => c.status === statusDesejado);
  });

  artigos = signal<any[]>([]);
  forumPosts = signal<any[]>([]);
  pacientes = signal<any[]>([]);
  
  // Chat
  chatUsers = signal<any[]>([]);
  chatSelecionado = signal<any>(null);
  novaMensagemStr = '';
  mensagensChat = signal<any[]>([]);
  chatUnsubscribe: any = null;

  // AGENDA
  readonly nomesMeses = NOMES_MESES;
  readonly diasSemana = DIAS_SEMANA;
  readonly anosSelecionaveis: number[];
  readonly currentMonth = signal(new Date().getMonth());
  readonly currentYear = signal(new Date().getFullYear());
  private readonly diasComDisponibilidade = signal<Set<number>>(new Set());

  readonly celulasCalendario = computed<CelulaCalendario[]>(() => {
    const ano = this.currentYear();
    const mes = this.currentMonth();
    const hoje = new Date();
    const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const marcados = this.diasComDisponibilidade();

    const celulas: CelulaCalendario[] = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push({ dia: null, isHoje: false, temDisponibilidade: false });
    for (let d = 1; d <= diasNoMes; d++) {
      const dataAtual = new Date(ano, mes, d);
      celulas.push({ dia: d, isHoje: dataAtual.toDateString() === hoje.toDateString(), temDisponibilidade: marcados.has(d) });
    }
    return celulas;
  });

  readonly eventosDoMes = signal<EventoAgenda[]>([]);
  readonly eventosDoMesOrdenados = computed(() => [...this.eventosDoMes()].sort((a, b) => a.data.getTime() - b.data.getTime()));
  readonly modalHorariosAberto = signal(false);
  readonly diaSelecionado = signal<Date | null>(null);
  readonly carregandoHorarios = signal(false);
  readonly horariosDoDia = signal<HorarioSlot[]>([]);
  readonly mensagemAgenda = signal('');

  private agendaInicializada = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(@Inject(PLATFORM_ID) private readonly platformId: Object) {
    const anoAtual = new Date().getFullYear();
    this.anosSelecionaveis = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];
  }

  // ==========================================================
  // INICIALIZAÇÃO FIREBASE 
  // ==========================================================
  ngOnInit(): void {
    this.activeSection.set(this.lerUltimaSecaoSalva());

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.carregandoStats.set(true);
        this.carregandoConsultasHoje.set(true);

        await this.carregarPerfilProfissional(user.uid);
        await this.carregarAgendaEClientes(user.uid);
        await this.carregarArtigos();
        await this.carregarForum();
        
        this.carregandoStats.set(false);
        this.carregandoConsultasHoje.set(false);
      } else {
        this.router.navigate(['/login-profissional']);
      }
    });
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    if (this.chatUnsubscribe) this.chatUnsubscribe();
  }

  // ==========================================================
  // BUSCA NO FIRESTORE
  // ==========================================================
  async carregarPerfilProfissional(uid: string) {
    try {
      // Antes só lia 'usuarios/{uid}'. Mas o cadastro de contas antigas
      // salvava o documento do psicólogo em 'psicologos' com um ID
      // aleatório (addDoc), diferente do uid — por isso o painel às vezes
      // não "puxava o banco" no login. Agora tenta primeiro achar o
      // documento certo em 'psicologos' (pelo id novo == uid, ou pelo
      // campo uid em contas antigas) e só cai para 'usuarios' se não achar
      // nada lá, igual ao que já era feito em home-adv.ts.
      let dados: any = null;

      const docPsiNovo = await getDoc(doc(db, 'psicologos', uid));
      if (docPsiNovo.exists()) {
        dados = docPsiNovo.data();
      } else {
        const q = query(collection(db, 'psicologos'), where('uid', '==', uid));
        const snapLegado = await getDocs(q);
        if (!snapLegado.empty) dados = snapLegado.docs[0].data();
      }

      if (!dados) {
        const docSnap = await getDoc(doc(db, 'usuarios', uid));
        if (docSnap.exists()) dados = docSnap.data();
      }

      if (dados) {
        this.nomeCompleto.set(dados['nome'] || 'Psicólogo(a)');
        if (dados['avatar']) this.avatarUrl.set(dados['avatar']);
      }
    } catch (err) { console.error(err); }
  }

  async carregarAgendaEClientes(uid: string) {
    try {
      const q = query(collection(db, 'consultas'), where('profissionalId', '==', uid));
      const snap = await getDocs(q);
      
      this.sessoesAgendadas.set(snap.size);
      
      const todas: any[] = [];
      const consultasHojeTemp: ConsultaHojeView[] = [];
      const dataHoje = new Date().toLocaleDateString('pt-BR');
      const pacientesMap = new Map();

      snap.forEach(docSnap => {
        const dados = docSnap.data();
        const consultaItem = {
          id: docSnap.id,
          maeId: dados['maeId'],
          nome: dados['nomeMae'] || 'Paciente Acolhida',
          avatar: dados['avatarMae'] || './img/avatar_usuario.png',
          horario: dados['horario'] || 'A definir',
          data: dados['data'] || 'Sem data',
          motivo: dados['motivo'] || 'Não informado',
          status: dados['status'] || 'Pendente'
        };

        todas.push(consultaItem);

        // Se for hoje e estiver agendada
        if (dados['data'] === dataHoje && consultaItem.status === 'Agendada') {
          consultasHojeTemp.push(consultaItem);
        }

        // Adiciona aos pacientes únicos (para a aba de pacientes e chat)
        if (dados['maeId'] && !pacientesMap.has(dados['maeId'])) {
            pacientesMap.set(dados['maeId'], {
                id: dados['maeId'],
                nome: consultaItem.nome,
                avatar: consultaItem.avatar,
                tag: 'Paciente',
                info: 'Acompanhamento',
                ultimaConsulta: consultaItem.data
            });
        }
      });

      this.todasConsultas.set(todas);
      this.consultasDeHoje.set(consultasHojeTemp);
      this.consultasHoje.set(consultasHojeTemp.length);

      const listaPacientes = Array.from(pacientesMap.values());
      this.pacientes.set(listaPacientes);
      
      // Cria a lista do chat com base nos pacientes que você atende
      this.chatUsers.set(listaPacientes.map((p: any) => ({
          id: p.id,
          nome: p.nome,
          avatar: p.avatar,
          email: 'Paciente vinculado',
          ativo: false
      })));

    } catch (err) { console.error('Erro ao buscar consultas:', err); }
  }

  async carregarArtigos() {
    try {
      const snap = await getDocs(collection(db, 'artigos'));
      if (!snap.empty) {
        this.artigos.set(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } else {
        // Se não tiver artigos no banco ainda, exibe o visual de teste
        this.artigos.set([
          { titulo: 'post de teste', data: '07 de Jun.', resumo: 'isso é um post teste', capa: './img/artigos/1.jpg' },
          { titulo: 'Dicas para mães solo!', data: '01 de Dez.', resumo: 'Crie uma rede de apoio...', capa: './img/artigos/3.jpg' }
        ]);
      }
    } catch (e) { console.error(e); }
  }

  async carregarForum() {
    try {
      const q = query(collection(db, 'posts'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        this.forumPosts.set(snap.docs.map(doc => {
            const data = doc.data();
            return {
                titulo: data['titulo'] || 'Post',
                autor: data['autorNome'] || 'Usuário',
                data: data['data'] || '',
                conteudo: data['conteudo'] || ''
            };
        }));
      } else {
        // Mock de emergência se o fórum estiver vazio
        this.forumPosts.set([
          { titulo: 'teste forum parceiro', autor: 'MERCADOLIVRE.COM', data: '03/07/2026, 20:17:14', conteudo: 'Como funciona?' },
        ]);
      }
    } catch (e) { console.error(e); }
  }

  // ==========================================================
  // FUNÇÕES DE AÇÃO NA TELA
  // ==========================================================
  setAbaConsultas(aba: 'Pendentes' | 'Agendadas' | 'Realizadas' | 'Negadas') {
    this.abaConsultas.set(aba);
  }

  async aceitarConsulta(consulta: any) {
    try {
      if (consulta.id) await updateDoc(doc(db, 'consultas', consulta.id), { status: 'Agendada' });
      this.todasConsultas.update(lista => lista.map(c => c.id === consulta.id ? { ...c, status: 'Agendada' } : c));
    } catch (err) { alert('Houve um erro ao aceitar a consulta.'); }
  }

  async recusarConsulta(consulta: any) {
    try {
      if (consulta.id) await updateDoc(doc(db, 'consultas', consulta.id), { status: 'Negada' });
      this.todasConsultas.update(lista => lista.map(c => c.id === consulta.id ? { ...c, status: 'Negada' } : c));
    } catch (err) { alert('Houve um erro ao recusar a consulta.'); }
  }

  abrirChatComPaciente(paciente: any) {
    const user = this.chatUsers().find(u => u.id === paciente.id);
    if(user) {
        this.selecionarChat(user);
        this.selecionarSecao('chats');
    }
  }

  abrirChatComMae(maeId: string): void {
    const user = this.chatUsers().find(u => u.id === maeId);
    if(user) {
        this.selecionarChat(user);
        this.selecionarSecao('chats');
    }
  }

  selecionarChat(user: any) {
    this.chatUsers.update(users => users.map(u => ({ ...u, ativo: u.id === user.id })));
    this.chatSelecionado.set(user);
    this.carregarMensagens(user.id);
  }

  carregarMensagens(maeId: string) {
    if (!auth.currentUser) return;
    const meuId = auth.currentUser.uid;

    if (this.chatUnsubscribe) this.chatUnsubscribe();

    try {
      this.chatUnsubscribe = onSnapshot(collection(db, 'mensagens'), (snap) => {
         const msgs: any[] = [];
         snap.forEach(d => {
             const data = d.data();
             const isDeMim = data['de'] === meuId && data['para'] === maeId;
             const isDela = data['de'] === maeId && data['para'] === meuId;

             if (isDeMim || isDela) {
                 msgs.push({
                     sender: isDeMim ? 'sent' : 'received',
                     text: data['texto'],
                     time: data['hora'] || '',
                     timestamp: data['timestamp'] || 0
                 });
             }
         });
         msgs.sort((a,b) => a.timestamp - b.timestamp);
         this.mensagensChat.set(msgs);
      });
    } catch (e) { console.error('Erro ao ler mensagens', e); }
  }

  async enviarMensagem() {
    const msgText = this.novaMensagemStr.trim();
    if (!msgText || !this.chatSelecionado() || !auth.currentUser) return;

    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    try {
      await addDoc(collection(db, 'mensagens'), {
          de: auth.currentUser.uid,
          para: this.chatSelecionado().id,
          texto: msgText,
          hora: timeStr,
          timestamp: now.getTime()
      });
      this.novaMensagemStr = '';
    } catch (e) { console.error('Erro ao enviar mensagem', e); }
  }

  // ==========================================================
  // NAVEGAÇÃO E SIDEBAR
  // ==========================================================
  selecionarSecao(secao: SecaoHomePsi): void {
    this.activeSection.set(secao);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(CHAVE_ULTIMA_SECAO, secao);
      if (window.innerWidth <= 1024) this.sidebarOpen.set(false);
    }
    if (secao === 'agenda') this.inicializarAgendaSeNecessario();
  }

  abrirInformacoes(): void { this.selecionarSecao('informacoes'); }
  toggleSidebar(): void { this.sidebarOpen.update((v) => !v); }
  closeSidebar(): void { this.sidebarOpen.set(false); }

  private lerUltimaSecaoSalva(): SecaoHomePsi {
    if (!isPlatformBrowser(this.platformId)) return 'dashboard';
    const salva = localStorage.getItem(CHAVE_ULTIMA_SECAO) as SecaoHomePsi | null;
    const validas: SecaoHomePsi[] = ['dashboard', 'agenda', 'artigos', 'consultas', 'forum', 'pacientes', 'chats', 'informacoes'];
    return salva && validas.includes(salva) ? salva : 'dashboard';
  }

  // ==========================================================
  // HEADER ACESSIBILIDADE E OUTROS
  // ==========================================================
  toggleAccessibilityMenu(): void { this.accessibilityMenuOpen.update((v) => !v); }
  aumentarFonte(): void { } diminuirFonte(): void { } alternarFiltroDaltonismo(): void { }
  alternarLeituraVoz(): void { } alternarMascaraLeitura(): void { } alternarTextoDestacado(): void { }
  alternarAltoContraste(): void { } aumentarEspacamentoLinhas(): void { } diminuirEspacamentoLinhas(): void { }
  redefinirAcessibilidade(): void { }
  toggleTheme(): void { if (isPlatformBrowser(this.platformId)) document.body.classList.toggle('dark-theme'); }
  logout(): void { this.router.navigateByUrl('/login-profissional'); }
  abrirTrocaAvatar(): void { }

  onHeroMouseMove(event: MouseEvent): void {
    const alvo = event.currentTarget as HTMLElement;
    const rect = alvo.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    this.heroMouseX.set(`${x}%`);
    this.heroMouseY.set(`${y}%`);
  }

  irParaAgenda(): void { this.selecionarSecao('agenda'); }

  // ==========================================================
  // LÓGICA DA AGENDA
  // ==========================================================
  private inicializarAgendaSeNecessario(): void {
    if (this.agendaInicializada) return;
    this.agendaInicializada = true;
  }

  mesAnterior(): void {
    if (this.currentMonth() === 0) { this.currentMonth.set(11); this.currentYear.update((y) => y - 1); } 
    else { this.currentMonth.update((m) => m - 1); }
    this.diasComDisponibilidade.set(new Set());
  }

  mesSeguinte(): void {
    if (this.currentMonth() === 11) { this.currentMonth.set(0); this.currentYear.update((y) => y + 1); } 
    else { this.currentMonth.update((m) => m + 1); }
    this.diasComDisponibilidade.set(new Set());
  }

  selecionarMes(valor: string): void { this.currentMonth.set(Number(valor)); this.diasComDisponibilidade.set(new Set()); }
  selecionarAno(valor: string): void { this.currentYear.set(Number(valor)); this.diasComDisponibilidade.set(new Set()); }

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
    this.modalHorariosAberto.set(true);
    this.carregandoHorarios.set(true);
    this.horariosDoDia.set([]);

    const timer = setTimeout(() => {
      this.horariosDoDia.set(HORARIOS_PADRAO.map((h) => ({ horario: h, status: 'livre', selecionado: false })));
      this.carregandoHorarios.set(false);
    }, 0);
    this.timers.push(timer);
  }

  fecharModalHorarios(): void {
    this.modalHorariosAberto.set(false);
    this.diaSelecionado.set(null);
    this.horariosDoDia.set([]);
  }

  alternarHorario(slot: HorarioSlot): void {
    if (slot.status !== 'livre') return;
    this.horariosDoDia.update((lista) => lista.map((h) => (h === slot ? { ...h, selecionado: !h.selecionado } : h)));
  }

  confirmarDisponibilidade(): void {
    const selecionados = this.horariosDoDia().filter((h) => h.selecionado);
    if (selecionados.length === 0) {
      this.mensagemAgenda.set('Selecione pelo menos um horário.');
      return;
    }
    const dia = this.diaSelecionado();
    if (dia) {
      const numeroDia = dia.getDate();
      this.diasComDisponibilidade.update((set) => { const novo = new Set(set); novo.add(numeroDia); return novo; });
    }
    this.mensagemAgenda.set('Horários marcados.');
    this.fecharModalHorarios();
  }

  adicionarConsulta(): void {
    const hoje = new Date();
    this.abrirSelecaoHorarios(hoje.getDate());
  }
}