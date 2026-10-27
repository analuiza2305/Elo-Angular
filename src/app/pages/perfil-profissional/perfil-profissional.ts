import { Component, OnInit, signal, computed, inject, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, Location, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { db, auth } from '../../core/firebase';
import {
  doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp,
  runTransaction, arrayRemove, arrayUnion, Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { carregarReputacao, Reputacao, REPUTACAO_VAZIA } from '../../services/reputacao';
import { PlanoService } from '../../services/plano';
import { AlertaService } from '../../core/services/alerta.service';

@Component({
  selector: 'app-perfil-profissional',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './perfil-profissional.html',
  styleUrls: ['./perfil-profissional.css']
})
export class PerfilProfissionalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly alerta = inject(AlertaService);
  private location = inject(Location);
  private planoService = inject(PlanoService);
  isBrowser = false;

  profissional = signal<any>(null);
  isLoading = signal<boolean>(true);
  isPsicologo = signal<boolean>(false);
  isMae = signal<boolean>(false);
  isProprioPerfil = signal<boolean>(false);

  // Reputação (avaliações anônimas das mães)
  reputacao = signal<Reputacao>(REPUTACAO_VAZIA);
  carregandoReputacao = signal<boolean>(true);
  premium = signal<boolean>(false);

  /** Classes dos 5 ícones de estrela para a média (cheia, meia ou vazia). */
  estrelasMedia = computed(() => {
    const media = this.reputacao().media;
    return [1, 2, 3, 4, 5].map((i) =>
      media >= i - 0.25 ? 'fa-solid fa-star'
      : media >= i - 0.75 ? 'fa-solid fa-star-half-stroke'
      : 'fa-regular fa-star'
    );
  });

  /** Porcentagem de cada nota para as barrinhas (5 → 1). */
  barrasNotas = computed(() => {
    const { distribuicao, total } = this.reputacao();
    return [5, 4, 3, 2, 1].map((nota) => ({
      nota,
      qtd: distribuicao[nota - 1],
      pct: total ? Math.round((distribuicao[nota - 1] / total) * 100) : 0,
    }));
  });

  // Modais de Agendamento (Paciente)
  showAgendaModal = signal<boolean>(false);
  dataSelecionada = signal<string | null>(null);
  horarioSelecionado = signal<{ hora: string; instante: number } | null>(null);
  motivoConsulta = signal<string>('');
  agendando = signal<boolean>(false);
  erroAgenda = signal<string>('');
  agendadoOk = signal<string | null>(null);   // texto da data confirmada

  /** Dias com horários livres, em ordem de ano/mês/dia, só do futuro. */
  datasAgenda = computed(() => {
    const raw: any[] = this.profissional()?.disponibilidadeRaw || [];
    const agora = Date.now();
    const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const porDia = new Map<string, { key: string; diaSemana: string; diaMes: string; horarios: { hora: string; instante: number }[] }>();

    raw
      .map((t) => (t?.toDate ? t.toDate() : new Date(t)))
      .filter((d: Date) => !isNaN(d.getTime()) && d.getTime() > agora)
      .sort((a: Date, b: Date) => a.getTime() - b.getTime())
      .forEach((d: Date) => {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!porDia.has(key)) {
          porDia.set(key, {
            key,
            diaSemana: DIAS[d.getDay()],
            diaMes: `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]}`,
            horarios: []
          });
        }
        porDia.get(key)!.horarios.push({
          hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          instante: d.getTime()
        });
      });

    return [...porDia.values()];
  });

  horariosDaData = computed(() =>
    this.datasAgenda().find((d) => d.key === this.dataSelecionada())?.horarios || []
  );

  readonly avatarUrl = signal('./img/account_icon.png');
  readonly isDarkMode = signal(false);
  readonly accessibilityMenuOpen = signal(false);

  // Onboarding Modal Signals
  showOnboardingModal = signal<boolean>(false);
  onboardingStep = signal<number>(1);
  dontShowAgain = signal<boolean>(false);
  
  // Profile Edit Data
  editSobreMim = signal<string>('');
  editTags = signal<string[]>([]);
  availableTags = [
    'Depressão', 'Ansiedade', 'TEA', 'TDAH', 'Luto', 'Maternidade Atípica', 
    'Relacionamentos', 'Carreira', 'Saúde Mental', 'Acolhimento', 'Direito de Família', 'Divórcio', 'Pensão'
  ];
  isSavingProfile = signal<boolean>(false);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const paramUid = params['uid'];
      
      onAuthStateChanged(auth, (user) => {
        if (user) {
          // Verifica se quem está acessando é o próprio profissional
          if (paramUid) {
            const proprio = user.uid === paramUid;
            this.isProprioPerfil.set(proprio);
            // Quem está vendo o perfil de outra pessoa é a mãe (visão de agendamento)
            this.isMae.set(!proprio);
            this.carregarDadosProfissional(paramUid);
          } else {
            this.isProprioPerfil.set(true);
            this.isMae.set(false);
            this.carregarDadosProfissional(user.uid);
          }
        } else {
          this.isProprioPerfil.set(false);
          this.isMae.set(true); // Se não tá logado, assume visão de mãe/visitante
          if (paramUid) {
            this.carregarDadosProfissional(paramUid);
          } else {
            this.isLoading.set(false);
          }
        }
      });
    });
  }

  async carregarDadosProfissional(uid: string) {
    this.isLoading.set(true);
    try {
      let docRef = doc(db, 'psicologos', uid);
      let docSnap = await getDoc(docRef);
      let tipo = 'psicologo';

      if (!docSnap.exists()) {
        docRef = doc(db, 'advogados', uid);
        docSnap = await getDoc(docRef);
        tipo = 'advogado';
      }

      if (!docSnap.exists()) {
        const qPsi = query(collection(db, 'psicologos'), where('uid', '==', uid));
        const resPsi = await getDocs(qPsi);
        if (!resPsi.empty) {
          docSnap = resPsi.docs[0] as any;
          tipo = 'psicologo';
        } else {
          const qAdv = query(collection(db, 'advogados'), where('uid', '==', uid));
          const resAdv = await getDocs(qAdv);
          if (!resAdv.empty) {
            docSnap = resAdv.docs[0] as any;
            tipo = 'advogado';
          }
        }
      }

      if (docSnap && (docSnap as any).exists()) {
        const data = (docSnap as any).data();
        const isPsi = tipo === 'psicologo';
        this.isPsicologo.set(isPsi);
        
        const biografiaFallback = 'Profissional dedicado(a) a oferecer um atendimento humanizado, seguro e acolhedor.';
        
        this.profissional.set({
          id: (docSnap as any).id, // Firestore ID
          uid: data['uid'] || uid,
          tipo: tipo,
          nome: data['nome'] || (isPsi ? 'Psicólogo(a)' : 'Advogado(a)'),
          identificacao: isPsi ? (data['crp'] || 'CRP não informado') : (data['oab'] || 'OAB não informada'),
          cargoLabel: isPsi ? 'Psicólogo(a)' : 'Advogada',
          area: isPsi ? (data['area'] || 'Psicologia Clínica') : (data['atuacao'] || 'Direito de Família e Mulher'),
          biografia: data['biografia'] || data['sobreMim'] || data['sobre'] || biografiaFallback,
          sobreMim: data['sobreMim'] || data['biografia'] || '',
          especializacoes: data['especializacoes'] || data['tags'] || ['Acolhimento Materno', 'Saúde Mental'],
          tags: data['tags'] || data['especializacoes'] || [],
          foto: data['avatar'] || data['fotoURL'] || 'img/account_icon.png',
          disponibilidadeRaw: data['disponibilidade'] || [],
        });
        this.avatarUrl.set(this.profissional().foto);
        this.buscarReputacao(this.profissional().uid);
      } else {
          // Fallback caso não encontre
          this.isMae.set(true); 
      }
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
    } finally {
      this.isLoading.set(false);
      this.checkOnboarding();
    }
  }

  private async buscarReputacao(uid: string) {
    this.carregandoReputacao.set(true);
    try {
      const [rep, premium] = await Promise.all([
        carregarReputacao(uid),
        this.planoService.temPremium(uid)
      ]);
      this.reputacao.set(rep);
      this.premium.set(premium);
    } catch (e) {
      console.warn('Não foi possível carregar a reputação', e);
      this.reputacao.set(REPUTACAO_VAZIA);
    } finally {
      this.carregandoReputacao.set(false);
    }
  }

  checkOnboarding() {
    if (this.isBrowser && this.isProprioPerfil() && this.profissional()) {
      const profId = this.profissional().uid || this.profissional().id;
      const dontShow = localStorage.getItem(`onboarding_done_${profId}`);
      
      if (!dontShow) {
        if (!this.profissional().sobreMim || !this.profissional().tags?.length) {
            this.showOnboardingModal.set(true);
            this.editSobreMim.set(this.profissional().sobreMim || '');
            this.editTags.set(this.profissional().tags || []);
        }
      }
    }
  }

  nextStep() { this.onboardingStep.set(this.onboardingStep() + 1); }
  prevStep() { this.onboardingStep.set(this.onboardingStep() - 1); }
  
  closeOnboarding() {
    this.showOnboardingModal.set(false);
    if (this.dontShowAgain() && this.profissional()) {
      const profId = this.profissional().uid || this.profissional().id;
      localStorage.setItem(`onboarding_done_${profId}`, 'true');
    }
  }

  addTag(tag: string) {
    if (!this.editTags().includes(tag)) {
      this.editTags.update(tags => [...tags, tag]);
    }
  }

  removeTag(tag: string) {
    this.editTags.update(tags => tags.filter(t => t !== tag));
  }

  async saveProfileData() {
    this.isSavingProfile.set(true);
    try {
        const prof = this.profissional();
        if(prof && prof.id && prof.tipo) {
            const colecao = prof.tipo === 'psicologo' ? 'psicologos' : 'advogados';
            const ref = doc(db, colecao, prof.id);
            
            await updateDoc(ref, {
                sobreMim: this.editSobreMim(),
                tags: this.editTags(),
                especializacoes: this.editTags()
            });
            
            this.profissional.update(p => ({
                ...p, 
                sobreMim: this.editSobreMim(), 
                biografia: this.editSobreMim(),
                tags: this.editTags(),
                especializacoes: this.editTags()
            }));
            
            if (this.dontShowAgain()) {
                localStorage.setItem(`onboarding_done_${prof.uid || prof.id}`, 'true');
            }
            this.showOnboardingModal.set(false);
        }
    } catch (e) {
      console.error(e);
      this.alerta.erro('Não foi possível salvar o perfil. Tente novamente.');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  // ==========================================
  // AGENDAMENTO (agenda real do profissional)
  // ==========================================
  abrirAgendaModal() {
    if (!auth.currentUser) {
      this.router.navigate(['/login']);
      return;
    }
    this.erroAgenda.set('');
    this.agendadoOk.set(null);
    this.motivoConsulta.set('');
    this.horarioSelecionado.set(null);
    this.dataSelecionada.set(this.datasAgenda()[0]?.key || null);
    this.showAgendaModal.set(true);
  }

  fecharAgendaModal() {
    if (this.agendando()) return;
    this.showAgendaModal.set(false);
  }

  selecionarData(key: string) {
    this.dataSelecionada.set(key);
    this.horarioSelecionado.set(null);
    this.erroAgenda.set('');
  }

  selecionarHorario(h: { hora: string; instante: number }) {
    this.horarioSelecionado.set(h);
    this.erroAgenda.set('');
  }

  rolarDatas(container: HTMLElement, direcao: number) {
    container.scrollBy({ left: 240 * direcao, behavior: 'smooth' });
  }

  async confirmarAgendamentoPaciente() {
    const horario = this.horarioSelecionado();
    const motivo = this.motivoConsulta().trim();
    const user = auth.currentUser;
    const prof = this.profissional();

    if (!horario) { this.erroAgenda.set('Escolha um horário.'); return; }
    if (!motivo) { this.erroAgenda.set('Conte em poucas palavras o motivo da consulta.'); return; }
    if (!user) { this.erroAgenda.set('Entre na sua conta para agendar.'); return; }
    if (!prof?.id || !prof?.tipo) { this.erroAgenda.set('Não conseguimos identificar o profissional.'); return; }
    if (horario.instante <= Date.now()) { this.erroAgenda.set('Esse horário já passou. Escolha outro.'); return; }

    this.agendando.set(true);
    this.erroAgenda.set('');

    const colecao = prof.tipo === 'psicologo' ? 'psicologos' : 'advogados';
    const profRef = doc(db, colecao, prof.id);
    const consultaRef = doc(collection(db, 'Consultas'));
    const paraMs = (t: any) => (t?.toDate ? t.toDate() : new Date(t)).getTime();

    try {
      // Transação: só agenda se o horário ainda estiver livre (evita duas mães no mesmo horário)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(profRef);
        const disponiveis: any[] = snap.data()?.['disponibilidade'] || [];
        const original = disponiveis.find((t) => paraMs(t) === horario.instante);
        if (!original) throw new Error('HORARIO_OCUPADO');

        tx.set(consultaRef, {
          maeId: user.uid,                       // sempre o uid de login (videochamada e regras usam ele)
          profissionalId: prof.uid || prof.id,
          tipoProfissional: prof.tipo,
          Datahora: Timestamp.fromMillis(horario.instante),
          Motivo: motivo,
          status: 'pendente',
          criadoEm: serverTimestamp(),
          primeiraGratuita: true,
          relatorioGerado: false
        });
        tx.update(profRef, {
          disponibilidade: arrayRemove(original),
          agendados: arrayUnion(original)
        });
      });

      // Tira o horário da tela sem precisar recarregar
      this.profissional.update((p) => ({
        ...p,
        disponibilidadeRaw: (p.disponibilidadeRaw || []).filter((t: any) => paraMs(t) !== horario.instante)
      }));

      const quando = new Date(horario.instante);
      this.agendadoOk.set(
        quando.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) + ' às ' + horario.hora
      );
    } catch (e: any) {
      console.error('Erro ao agendar consulta:', e);
      if (e?.message === 'HORARIO_OCUPADO') {
        this.erroAgenda.set('Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
        this.profissional.update((p) => ({
          ...p,
          disponibilidadeRaw: (p.disponibilidadeRaw || []).filter((t: any) => paraMs(t) !== horario.instante)
        }));
        this.horarioSelecionado.set(null);
      } else {
        this.erroAgenda.set('Não foi possível agendar agora. Verifique sua conexão e tente de novo.');
      }
    } finally {
      this.agendando.set(false);
    }
  }

  irParaMinhasConsultas() {
    this.showAgendaModal.set(false);
    this.router.navigate(['/consultas']);
  }

  voltar() { this.location.back(); }
  irParaHome() { this.router.navigate(['/']); }
  logout() { auth.signOut().then(() => this.router.navigate(['/login-profissional'])); }

  toggleAccessibilityMenu() { this.accessibilityMenuOpen.set(!this.accessibilityMenuOpen()); }
  toggleTheme() { 
      this.isDarkMode.set(!this.isDarkMode()); 
      document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
  }
  aumentarFonte() {}
  diminuirFonte() {}
  redefinirAcessibilidade() {}
}