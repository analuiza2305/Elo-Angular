import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import {
  collection, getDocs, doc, updateDoc, arrayRemove, arrayUnion,
  addDoc, Timestamp, query, where
} from 'firebase/firestore';

interface Profissional {
  docId: string;
  tipo: 'psicologo' | 'advogado';
  uid: string;
  nome: string;
  identificacao: string;
  cargoLabel: string;
  area: string;
  especializacoes: string[];
  extrasCount: number;
  foto: string;
  atendimentos: number;
  disponibilidadeRaw: any[];
  disponibilidadeFormatada: { [dataStr: string]: string[] };
  datasDisponiveis: { key: string; diaSemana: string; diaMes: string }[];
  dataSelecionada: string | null;
  horarioSelecionado: string | null;
  visivel: boolean;
}

@Component({
  selector: 'app-consulta-lista-psi',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './consulta-lista-psi.html',
  styleUrls: ['./consulta-lista-psi.css']
})
export class ConsultaListaPsiComponent implements OnInit {
  private router = inject(Router);

  profissionais = signal<Profissional[]>([]);
  termoBusca = signal<string>('');
  isLoading = signal<boolean>(true);

  showModal = signal<boolean>(false);
  modalInfo = signal<any>(null);
  motivoConsulta = signal<string>('');
  salvando = signal<boolean>(false);

  profissionaisFiltrados = computed(() => {
    const termo = this.termoBusca().toLowerCase().trim();
    if (!termo) return this.profissionais();
    return this.profissionais().filter(p =>
      p.nome.toLowerCase().includes(termo) ||
      p.identificacao.toLowerCase().includes(termo)
    );
  });

  ngOnInit() {
    this.carregarProfissionais();
  }

  async carregarProfissionais() {
    this.isLoading.set(true);
    try {
      const [snapPsi, snapAdv] = await Promise.all([
        getDocs(collection(db, 'psicologos')),
        getDocs(collection(db, 'advogados'))
      ]);

      const docsAll = [
        ...snapPsi.docs.map(d => ({ snap: d, tipo: 'psicologo' as const })),
        ...snapAdv.docs.map(d => ({ snap: d, tipo: 'advogado' as const }))
      ];

      const lista: Profissional[] = docsAll.map(({ snap, tipo }) => {
        const data = snap.data() as any;

        const nome = data.nome || (tipo === 'psicologo' ? 'Psicólogo(a)' : 'Advogado(a)');
        const identificacao = tipo === 'psicologo' ? (data.crp || 'Sem CRP') : (data.oab || 'Sem OAB');
        const cargoLabel = tipo === 'psicologo' ? 'Psicólogo(a) - CRP' : 'Advogado - OAB';
        const area = tipo === 'psicologo' ? (data.area || 'Área não informada') : (data.atuacao || 'Atuação não informada');
        const especializacoesTodas = data.especializacoes || [];
        const especializacoes = especializacoesTodas.slice(0, 3);
        const extrasCount = especializacoesTodas.length > 3 ? especializacoesTodas.length - 3 : 0;
        const foto = data.avatar || './img/account_icon.png';
        const atendimentos = data.atendimentos || Math.floor(Math.random() * 300 + 100);

        const disponibilidadeRaw = data.disponibilidade || [];
        const disponibilidadeFormatada = this.processarDisponibilidade(disponibilidadeRaw);
        const datasKeys = Object.keys(disponibilidadeFormatada);
        const datasDisponiveis = datasKeys.map(k => ({
          key: k,
          diaSemana: this.formatarDiaSemana(k),
          diaMes: this.formatarDiaMes(k)
        }));

        return {
          docId: snap.id,
          tipo,
          uid: data.uid || snap.id,
          nome,
          identificacao,
          cargoLabel,
          area,
          especializacoes,
          extrasCount,
          foto,
          atendimentos,
          disponibilidadeRaw,
          disponibilidadeFormatada,
          datasDisponiveis,
          dataSelecionada: datasKeys[0] || null,
          horarioSelecionado: null,
          visivel: true
        };
      });

      lista.sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase()));

      this.profissionais.set(lista);
    } catch (err) {
      console.error('Erro ao carregar profissionais:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  selecionarData(prof: Profissional, dataStr: string) {
    this.profissionais.update(lista =>
      lista.map(p => p.docId === prof.docId
        ? { ...p, dataSelecionada: dataStr, horarioSelecionado: null }
        : p
      )
    );
  }

  selecionarHorario(prof: Profissional, hora: string) {
    this.profissionais.update(lista =>
      lista.map(p => p.docId === prof.docId ? { ...p, horarioSelecionado: hora } : p)
    );
  }

  horariosDaData(prof: Profissional): string[] {
    if (!prof.dataSelecionada) return [];
    return prof.disponibilidadeFormatada[prof.dataSelecionada] || [];
  }

  verPerfil(prof: Profissional) {
    if (prof.tipo === 'psicologo') {
      this.router.navigate(['/perfil-psi'], { queryParams: { uid: prof.uid } });
    } else {
      this.router.navigate(['/perfil-adv'], { queryParams: { uid: prof.uid } });
    }
  }

  abrirModal(prof: Profissional) {
    if (!prof.dataSelecionada || !prof.horarioSelecionado) {
      alert('Selecione uma data e um horário antes de agendar.');
      return;
    }
    this.modalInfo.set({
      docId: prof.docId,
      uid: prof.uid,
      tipo: prof.tipo,
      nome: prof.nome,
      cargo: `${prof.cargoLabel} ${prof.identificacao}`,
      area: prof.area,
      foto: prof.foto,
      dataStr: prof.dataSelecionada,
      dataFormatada: `${this.formatarDiaSemana(prof.dataSelecionada)} ${this.formatarDiaMes(prof.dataSelecionada)}`,
      hora: prof.horarioSelecionado
    });
    this.motivoConsulta.set('');
    this.showModal.set(true);
  }

  fecharModal() {
    this.showModal.set(false);
    this.modalInfo.set(null);
  }

  async confirmarAgendamento() {
    const motivo = this.motivoConsulta().trim();
    if (!motivo) {
      alert('Por favor, informe o motivo da consulta.');
      return;
    }

    const info = this.modalInfo();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert('Erro: usuário não autenticado.');
      return;
    }

    this.salvando.set(true);
    try {
      const maeDocId = await this.getMaeDocIdOrFallback();
      const maeToSave = maeDocId || currentUser.uid;

      const [horaH, horaM] = info.hora.split(':');
      const dataConsulta = new Date(`${info.dataStr}T${horaH}:${horaM}:00`);
      const timestampFinal = Timestamp.fromDate(dataConsulta);

      const prof = this.profissionais().find(p => p.docId === info.docId);
      if (!prof) throw new Error('Profissional não encontrado.');

      const timestampOriginal = prof.disponibilidadeRaw.find((t: any) => {
        const d = t?.toDate ? t.toDate() : new Date(t);
        return (
          d.getFullYear() === dataConsulta.getFullYear() &&
          d.getMonth() === dataConsulta.getMonth() &&
          d.getDate() === dataConsulta.getDate() &&
          d.getHours() === dataConsulta.getHours() &&
          d.getMinutes() === dataConsulta.getMinutes()
        );
      });

      if (!timestampOriginal) {
        alert('Esse horário pode ter sido reservado por outra pessoa. Atualize a página.');
        return;
      }

      const payload: any = {
        Mae: maeToSave,
        Datahora: timestampFinal,
        Motivo: motivo,
        Chat: '',
        status: 'pendente'
      };
      if (info.tipo === 'psicologo') payload.Psicologo = info.uid;
      else payload.Advogado = info.uid;

      await addDoc(collection(db, 'Consultas'), payload);

      const collectionName = info.tipo === 'psicologo' ? 'psicologos' : 'advogados';
      const profRef = doc(db, collectionName, info.docId);
      await updateDoc(profRef, { disponibilidade: arrayRemove(timestampOriginal) });
      await updateDoc(profRef, { agendados: arrayUnion(timestampOriginal) });

      alert('✅ Consulta agendada com sucesso!');
      this.fecharModal();
      this.carregarProfissionais();
    } catch (err: any) {
      console.error('Erro ao salvar consulta:', err);
      alert('❌ Erro ao agendar. Tente novamente.');
    } finally {
      this.salvando.set(false);
    }
  }

  private async getMaeDocIdOrFallback(): Promise<string | null> {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Usuário não autenticado');
    const uid = currentUser.uid;
    const email = currentUser.email;

    try {
      const q1 = query(collection(db, 'usuarios'), where('uid', '==', uid));
      const s1 = await getDocs(q1);
      if (!s1.empty) return s1.docs[0].id;
    } catch { }

    if (email) {
      try {
        const q2 = query(collection(db, 'usuarios'), where('email', '==', email));
        const s2 = await getDocs(q2);
        if (!s2.empty) return s2.docs[0].id;
      } catch { }
    }

    return null;
  }

  private processarDisponibilidade(arrayTimestamps: any[]): { [dataStr: string]: string[] } {
    const dias: { [dataStr: string]: string[] } = {};
    (arrayTimestamps || []).forEach((t) => {
      const data = t?.toDate ? t.toDate() : new Date(t);
      const ano = data.getFullYear();
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const dia = String(data.getDate()).padStart(2, '0');
      const dataStr = `${ano}-${mes}-${dia}`;
      const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (!dias[dataStr]) dias[dataStr] = [];
      dias[dataStr].push(hora);
    });
    return dias;
  }

  private formatarDiaSemana(dataStr: string): string {
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    const dias = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    return dias[data.getDay()];
  }

  private formatarDiaMes(dataStr: string): string {
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    const meses = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
    return `${String(data.getDate()).padStart(2, '0')} ${meses[data.getMonth()]}`;
  }
}