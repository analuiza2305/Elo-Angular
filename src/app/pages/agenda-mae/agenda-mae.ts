import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, where, onSnapshot, getDocs, doc } from 'firebase/firestore';

@Component({
  selector: 'app-agenda-mae',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './agenda-mae.html',
  styleUrls: ['./agenda-mae.css']
})
export class AgendaMae implements OnInit, OnDestroy {
  private router = inject(Router);

  currentUser = signal<any>(null);
  
  currentMonth = signal<number>(new Date().getMonth());
  currentYear = signal<number>(new Date().getFullYear());
  monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  anosDisponiveis = Array.from({ length: 16 }, (_, i) => 2020 + i);

  emptyDays = signal<number[]>([]);
  calendarDays = signal<any[]>([]);

  inscritosCache = signal<any[]>([]);
  consultasCache = signal<any[]>([]);
  profissionalNameCache = new Map<string, string | null>();

  userUnsubscribe: any = null;
  consultasUnsubscribe: any = null;

  selectedDayEvents = signal<any[] | null>(null);

  todosEventos = computed(() => {
    return [...this.inscritosCache(), ...this.consultasCache()];
  });

  futurosEventos = computed(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return this.todosEventos()
      .filter(ev => ev.data && ev.data >= hoje)
      .sort((a, b) => a.data.getTime() - b.data.getTime());
  });

  ngOnInit() {
    onAuthStateChanged(auth, (user) => {
      this.currentUser.set(user);
      if (user) {
        this.carregarEventosUsuario(user.uid);
      } else {
        this.limparDados();
        this.router.navigate(['/login']);
      }
    });
    this.generateCalendar();
  }

  ngOnDestroy() {
    if (this.userUnsubscribe) this.userUnsubscribe();
    if (this.consultasUnsubscribe) this.consultasUnsubscribe();
  }

  limparDados() {
    this.inscritosCache.set([]);
    this.consultasCache.set([]);
    this.generateCalendar();
  }

  generateCalendar() {
    const year = Number(this.currentYear());
    const month = Number(this.currentMonth());
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    this.emptyDays.set(Array.from({ length: firstDay }, (_, i) => i));

    const days = [];
    const eventos = this.todosEventos();

    for (let i = 1; i <= lastDate; i++) {
      const dateObj = new Date(year, month, i);
      const isToday = i === hoje.getDate() && month === hoje.getMonth() && year === hoje.getFullYear();
      const isPast = dateObj < hoje;

      const eventosDoDia = eventos.filter(ev => {
        return ev.data && ev.data.getDate() === i && ev.data.getMonth() === month && ev.data.getFullYear() === year;
      });

      const titles = eventosDoDia.map(ev => ev.titulo || (ev.type === 'consulta' ? 'Consulta' : '')).filter(Boolean).join(' — ');

      days.push({
        number: i,
        isToday,
        isPast,
        hasEvent: eventosDoDia.length > 0,
        eventos: eventosDoDia,
        tooltip: titles,
        dotsCount: Math.min(3, eventosDoDia.length),
        hasMore: eventosDoDia.length > 3
      });
    }
    
    this.calendarDays.set(days);
  }

  updateMonth(val: any) {
    this.currentMonth.set(Number(val));
    this.generateCalendar();
  }

  updateYear(val: any) {
    this.currentYear.set(Number(val));
    this.generateCalendar();
  }

  prevMonth() {
    let m = Number(this.currentMonth()) - 1;
    let y = Number(this.currentYear());
    if (m < 0) { m = 11; y--; }
    this.currentMonth.set(m);
    this.currentYear.set(y);
    this.generateCalendar();
  }

  nextMonth() {
    let m = Number(this.currentMonth()) + 1;
    let y = Number(this.currentYear());
    if (m > 11) { m = 0; y++; }
    this.currentMonth.set(m);
    this.currentYear.set(y);
    this.generateCalendar();
  }

  openDayModal(day: any) {
    if (day.hasEvent) this.selectedDayEvents.set(day.eventos);
  }

  closeDayModal() {
    this.selectedDayEvents.set(null);
  }

  irParaEvento(id: string) {
    this.router.navigate(['/eventos'], { queryParams: { evento: id } });
  }

  formatarData(data: Date | null): string {
    if (!data) return '';
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatarHora(data: Date | null): string {
    if (!data) return '';
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  parsePossibleDate(raw: any): Date | null {
    if (!raw) return null;
    if (raw.toDate && typeof raw.toDate === 'function') {
      try { const d = raw.toDate(); if (!isNaN(d.getTime())) return d; } catch (e) {}
    }
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    if (typeof raw === 'string') {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  normalizeEventosArray(arr: any[] = []): any[] {
    return arr.map(ev => {
      const copy = { ...ev };
      const raw = ev.date ?? ev.data ?? ev.Datahora ?? ev.DataHora ?? ev.Data;
      copy.data = this.parsePossibleDate(raw);
      return copy;
    }).filter(e => e.data instanceof Date && !isNaN(e.data.getTime()));
  }

  async carregarEventosUsuario(uid: string) {
    const docRef = doc(db, 'usuarios', uid);
    this.userUnsubscribe = onSnapshot(docRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      const inscritosRaw = data['eventosInscritos'] || [];
      const eventos = this.normalizeEventosArray(inscritosRaw).map(e => ({ ...e, type: 'evento' }));
      this.inscritosCache.set(eventos);
      this.generateCalendar();
    });

    const qConsultas = query(collection(db, 'Consultas'), where('Mae', '==', uid));
    this.consultasUnsubscribe = onSnapshot(qConsultas, async (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const normalized = [];

      for (const raw of docs) {
        const copy: any = { ...raw };
        copy.data = this.parsePossibleDate(raw['Datahora'] ?? raw['datahora'] ?? raw['DataHora'] ?? raw['Data'] ?? raw['date']);
        copy.type = 'consulta';
        copy.Motivo = raw['Motivo'] ?? raw['motivo'] ?? '';
        copy.status = raw['status'] ?? '';

        let profissionalId = null;
        let collectionName = null;
        
        if (raw['Psicologo']) {
          profissionalId = raw['Psicologo'];
          collectionName = 'psicologos';
        } else if (raw['Advogado']) {
          profissionalId = raw['Advogado'];
          collectionName = 'advogados';
        }
        
        copy.profissionalId = profissionalId;
        copy.collectionName = collectionName;
        normalized.push(copy);
      }

      const fetchPromises = normalized.map(async c => {
        if (c.profissionalId && c.collectionName) {
          const key = `${c.collectionName}:${c.profissionalId}`;
          if (!this.profissionalNameCache.has(key)) {
            const nome = await this.fetchProfissionalNome(c.profissionalId, c.collectionName);
            this.profissionalNameCache.set(key, nome);
          }
          c.profissionalNome = this.profissionalNameCache.get(key) || '';
        } else {
          c.profissionalNome = '';
        }
        c.titulo = c.profissionalNome ? `Consulta com ${c.profissionalNome}` : 'Consulta';
      });

      await Promise.all(fetchPromises);
      this.consultasCache.set(this.normalizeEventosArray(normalized));
      this.generateCalendar();
    });
  }

  async fetchProfissionalNome(profissionalId: string, collectionName: string): Promise<string | null> {
    try {
      const q = query(collection(db, collectionName), where('uid', '==', profissionalId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].data()['nome'] ?? null;
      }
    } catch (err) {
      console.warn('Erro buscando profissional nome', err);
    }
    return null;
  }

  // ==========================================
  // HELPERS DE UI (CORES E ÍCONES)
  // ==========================================
  getEventClass(ev: any): string {
    if (ev.type === 'evento') return 'tipo-evento';
    if (ev.type === 'artigo') return 'tipo-artigo';
    if (ev.type === 'consulta') {
      if (ev.collectionName === 'psicologos') return 'tipo-psi';
      if (ev.collectionName === 'advogados') return 'tipo-adv';
      return 'tipo-consulta';
    }
    return 'tipo-default';
  }

  getEventIcon(ev: any): string {
    if (ev.type === 'evento') return 'fa-regular fa-calendar-check';
    if (ev.type === 'artigo') return 'fa-solid fa-book-open';
    if (ev.type === 'consulta') {
      if (ev.collectionName === 'psicologos') return 'fa-solid fa-brain';
      if (ev.collectionName === 'advogados') return 'fa-solid fa-scale-balanced';
      return 'fa-solid fa-stethoscope';
    }
    return 'fa-regular fa-star';
  }
}