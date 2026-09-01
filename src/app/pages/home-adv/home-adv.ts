import { Component, OnInit, signal, computed, inject, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';

@Component({
  selector: 'app-home-adv',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './home-adv.html',
  styleUrl: './home-adv.css',
  encapsulation: ViewEncapsulation.None
})
export class HomeAdv implements OnInit {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  isLoading = signal<boolean>(true);
  isDarkMode = signal<boolean>(false);
  activeSection = signal<string>('dashboard');

  advogadoAtual = signal<any>(null);
  nomeExibicao = computed(() => {
    const nome = this.advogadoAtual()?.nome || 'Advogado(a)';
    return nome.split(' ')[0];
  });
  avatarUrl = computed(() => this.advogadoAtual()?.avatar || './img/avatar_usuario.png');

  // Controle de Consultas
  consultas = signal<any[]>([]);
  abaConsultasStatus = signal<string>('pendente');

  consultasHoje = computed(() => {
    const hojeStr = new Date().toLocaleDateString('pt-BR');
    return this.consultas().filter(c => c.status === 'aceito' && this.formatarData(c.Datahora) === hojeStr);
  });
  sessoesAgendadas = computed(() => this.consultas().filter(c => c.status === 'aceito').length);
  consultasFiltradas = computed(() => this.consultas().filter(c => (c.status || '').toLowerCase() === this.abaConsultasStatus()));

  // Controle do Paciente
  pacientesUnicos = computed(() => {
    const pMap = new Map();
    this.consultas().forEach(c => {
      if (c.maeInfo && !pMap.has(c.maeInfo.id)) {
        pMap.set(c.maeInfo.id, { ...c.maeInfo, ultimaData: c.Datahora });
      }
    });
    return Array.from(pMap.values());
  });

  // Controle de Modais e Chat
  showModalDetalhes = signal<boolean>(false);
  consultaSelecionada = signal<any>(null);
  chatAtivo = signal<any>(null);

  // =========================================
  // CONTROLE DO CALENDÁRIO E DISPONIBILIDADE
  // =========================================
  mesAtualOff = signal<number>(new Date().getMonth());
  anoAtualOff = signal<number>(new Date().getFullYear());

  nomeMesAtual = computed(() => {
    const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    return meses[this.mesAtualOff()];
  });

  anoAtual = computed(() => this.anoAtualOff());

  diasCalendario = computed(() => {
    const dias = [];
    const primeiroDiaMes = new Date(this.anoAtualOff(), this.mesAtualOff(), 1).getDay();
    const qtdDiasMes = new Date(this.anoAtualOff(), this.mesAtualOff() + 1, 0).getDate();
    const hoje = new Date();
    hoje.setHours(0,0,0,0);

    const adv = this.advogadoAtual();
    const disponibilidades = (adv?.disponibilidade || []).map((t: any) => t.toDate ? t.toDate() : new Date(t));
    const agendados = (adv?.agendados || []).map((t: any) => t.toDate ? t.toDate() : new Date(t));

    for (let i = 0; i < primeiroDiaMes; i++) dias.push({ valor: null, hoje: false, temConsulta: false, passado: false });

    for (let d = 1; d <= qtdDiasMes; d++) {
      const dataAtual = new Date(this.anoAtualOff(), this.mesAtualOff(), d);
      const isHoje = dataAtual.getTime() === hoje.getTime();
      const isPassado = dataAtual < hoje;

      const temDisp = disponibilidades.some((dt: Date) => dt.toDateString() === dataAtual.toDateString());
      const temAgend = agendados.some((dt: Date) => dt.toDateString() === dataAtual.toDateString());

      dias.push({ valor: d, hoje: isHoje, temConsulta: temDisp || temAgend, passado: isPassado });
    }
    return dias;
  });

  // Estado do Modal de Disponibilidade
  showModalDisponibilidade = signal<boolean>(false);
  diaSelecionadoObj = signal<Date | null>(null);
  horariosDoDia = signal<{hora: string, status: string, selecionado: boolean}[]>([]);

  artigos = signal<any[]>([]);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const lastSection = localStorage.getItem('homeadv_lastSection') || 'dashboard';
    this.activeSection.set(lastSection);

    // Modo escuro: mesma convenção usada no resto do site (atributo
    // data-theme no <body> + localStorage). Antes o botão "Modo Escuro"
    // dessa página nem tinha um (click) associado a ele.
    const temaSalvo = localStorage.getItem('theme');
    this.isDarkMode.set(temaSalvo === 'dark');
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        await this.carregarPerfil(user.uid);
        await this.carregarConsultas(user.uid);
        await this.carregarArtigosMock();
        this.isLoading.set(false);
      } else {
        this.router.navigate(['/login-profissional']);
      }
    });
  }

  async carregarPerfil(uid: string) {
    try {
      const q = query(collection(db, 'advogados'), where('uid', '==', uid));
      const snap = await getDocs(q);
      if (!snap.empty) {
        this.advogadoAtual.set({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        const userSnap = await getDoc(doc(db, 'usuarios', uid));
        if (userSnap.exists()) this.advogadoAtual.set(userSnap.data());
      }
    } catch (err) {
      console.error(err);
    }
  }

  async carregarConsultas(uid: string) {
    try {
      const q = query(collection(db, 'Consultas'), where('Advogado', '==', uid));
      const snap = await getDocs(q);

      const maeUids = [...new Set(snap.docs.filter(d => d.data()['Mae']).map(d => d.data()['Mae']))];
      const maeSnaps = await Promise.all(maeUids.map(id => getDoc(doc(db, 'usuarios', id))));

      const maeMap = Object.fromEntries(
        maeSnaps.filter(s => s.exists()).map(s => [s.id, { id: s.id, ...s.data() }])
      );

      const lista = snap.docs.map(docu => {
        const dados = docu.data();
        return { id: docu.id, ...dados, maeInfo: maeMap[dados['Mae']] || null };
      });

      this.consultas.set(lista);
    } catch (err) {
      console.error('Erro ao carregar consultas:', err);
    }
  }

  async carregarArtigosMock() {
    try {
      const snap = await getDocs(collection(db, 'artigos'));
      if (!snap.empty) {
        this.artigos.set(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } else {
        this.artigos.set([
          { id: 1, titulo: 'Guia da Pensão Alimentícia', descricao: 'Entenda os seus direitos básicos no primeiro mês...', img: './img/artigos/1.jpg' },
          { id: 2, titulo: 'Guarda Compartilhada', descricao: 'Como funciona a guarda no Brasil em 2026...', img: './img/artigos/2.jpg' }
        ]);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // --- LÓGICA DE UI E CLICKS ---

  selecionarSecao(secao: string) {
    this.activeSection.set(secao);
    localStorage.setItem('homeadv_lastSection', secao);
  }

  setAbaConsultas(status: string) {
    this.abaConsultasStatus.set(status);
  }

  abrirDetalhes(consulta: any) {
    this.consultaSelecionada.set(consulta);
    this.showModalDetalhes.set(true);
  }

  abrirChat(paciente: any) {
    this.chatAtivo.set(paciente);
    this.selecionarSecao('chats');
  }

  async atualizarStatusConsulta(id: string, novoStatus: string) {
    try {
      await updateDoc(doc(db, 'Consultas', id), { status: novoStatus });
      this.consultas.update(lista =>
        lista.map(c => c.id === id ? { ...c, status: novoStatus } : c)
      );
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
    }
  }

  alterarMes(delta: number) {
    let m = this.mesAtualOff() + delta;
    let y = this.anoAtualOff();
    if (m > 11) { m = 0; y++; }
    else if (m < 0) { m = 11; y--; }
    this.mesAtualOff.set(m);
    this.anoAtualOff.set(y);
  }

  // --- LÓGICA DE DEFINIÇÃO DE DISPONIBILIDADE NA AGENDA ---
  abrirModalDisponibilidade(dia: number | null, passado: boolean) {
    if (!dia || passado) return;

    const dataClicada = new Date(this.anoAtualOff(), this.mesAtualOff(), dia);
    this.diaSelecionadoObj.set(dataClicada);

    const adv = this.advogadoAtual();
    const disp = (adv?.disponibilidade || []).map((t: any) => t.toDate ? t.toDate() : new Date(t));
    const agend = (adv?.agendados || []).map((t: any) => t.toDate ? t.toDate() : new Date(t));

    const horasOcupadas = new Set<string>();

    [...disp, ...agend].forEach((d: Date) => {
      if (d.toDateString() === dataClicada.toDateString()) {
        horasOcupadas.add(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      }
    });

    const horariosPadrao = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

    const slots = horariosPadrao.map(h => ({
      hora: h,
      status: horasOcupadas.has(h) ? 'ocupado' : 'livre',
      selecionado: false
    }));

    this.horariosDoDia.set(slots);
    this.showModalDisponibilidade.set(true);
  }

  toggleHorario(h: any) {
    if (h.status === 'ocupado') return;
    this.horariosDoDia.update(slots =>
      slots.map(slot => slot.hora === h.hora ? { ...slot, selecionado: !slot.selecionado } : slot)
    );
  }

  async salvarDisponibilidade() {
    const selecionados = this.horariosDoDia().filter(h => h.selecionado).map(h => h.hora);
    if (selecionados.length === 0) {
      alert('Selecione ao menos um horário.');
      return;
    }

    const dataClicada = this.diaSelecionadoObj();
    if (!dataClicada) return;

    const novosTimestamps = selecionados.map(h => {
      const [hr, min] = h.split(':').map(Number);
      return new Date(dataClicada.getFullYear(), dataClicada.getMonth(), dataClicada.getDate(), hr, min, 0, 0);
    });

    try {
      const advRef = doc(db, 'advogados', this.advogadoAtual().id);
      const antigos = this.advogadoAtual().disponibilidade || [];

      await updateDoc(advRef, {
        disponibilidade: [...antigos, ...novosTimestamps]
      });

      this.advogadoAtual.update((a: any) => ({ ...a, disponibilidade: [...antigos, ...novosTimestamps] }));
      this.showModalDisponibilidade.set(false);
      alert('Disponibilidade salva com sucesso!');
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar disponibilidade.');
    }
  }

  formatarDataSelecionada(): string {
    const d = this.diaSelecionadoObj();
    if (!d) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  onHeroMouseMove(e: MouseEvent) {
    const hero = e.currentTarget as HTMLElement;
    const { left, top, width, height } = hero.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    hero.style.setProperty('--mouse-x', `${x}%`);
    hero.style.setProperty('--mouse-y', `${y}%`);
  }

  formatarData(datahora: any): string {
    if (!datahora) return 'Sem data';
    const d = datahora.toDate ? datahora.toDate() : new Date(datahora);
    return d.toLocaleDateString('pt-BR');
  }

  formatarHora(datahora: any): string {
    if (!datahora) return '';
    const d = datahora.toDate ? datahora.toDate() : new Date(datahora);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  async logout() {
    await auth.signOut();
    this.router.navigate(['/login-profissional']);
  }

  toggleTheme(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.isDarkMode.update(v => !v);
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
    localStorage.setItem('theme', this.isDarkMode() ? 'dark' : 'light');
  }
}
