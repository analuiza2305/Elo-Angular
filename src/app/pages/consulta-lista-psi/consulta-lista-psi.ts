import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import {
  collection, getDocs, doc, arrayRemove, arrayUnion,
  Timestamp, runTransaction
} from 'firebase/firestore';
import { carregarReputacoesDeTodos, Reputacao, REPUTACAO_VAZIA } from '../../services/reputacao';
import { PlanoService } from '../../services/plano';

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
  reputacao: Reputacao;
  premium: boolean;
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
  private planoService = inject(PlanoService);

  profissionais = signal<Profissional[]>([]);
  termoBusca = signal<string>('');
  isLoading = signal<boolean>(true);

  showModal = signal<boolean>(false);
  modalInfo = signal<any>(null);
  motivoConsulta = signal<string>('');
  salvando = signal<boolean>(false);

  showFiltroModal = signal<boolean>(false);
  filtroDisponibilidade = signal<boolean>(false);
  filtroEspecialidade = signal<string>('todos');
  filtroOrdem = signal<string>('relevancia');
  filtroBemAvaliados = signal<boolean>(false);

  profissionaisFiltrados = computed(() => {
    const termo = this.termoBusca().toLowerCase().trim();
    const apenasDisponiveis = this.filtroDisponibilidade();
    const espFiltro = this.filtroEspecialidade();
    const ordem = this.filtroOrdem();
    const soBemAvaliados = this.filtroBemAvaliados();

    let lista = this.profissionais().filter(p => {
      const matchTermo = !termo || 
        p.nome.toLowerCase().includes(termo) ||
        p.identificacao.toLowerCase().includes(termo) ||
        p.area.toLowerCase().includes(termo) ||
        p.especializacoes.some(esp => esp.toLowerCase().includes(termo));

      const matchDisp = !apenasDisponiveis || p.datasDisponiveis.length > 0;
      const matchEsp = espFiltro === 'todos' || 
        p.area.toLowerCase().includes(espFiltro.toLowerCase()) ||
        p.especializacoes.some(esp => esp.toLowerCase().includes(espFiltro.toLowerCase()));

      const matchSelo = !soBemAvaliados || p.reputacao.bemAvaliado;

      return matchTermo && matchDisp && matchEsp && matchSelo;
    });

    if (ordem === 'relevancia') {
      lista.sort((a, b) => this.compararRelevancia(a, b));
    } else if (ordem === 'avaliacao') {
      // Escolha explícita da mãe: só a nota conta (sem prioridade paga)
      lista.sort((a, b) => this.pontuacaoReputacao(b) - this.pontuacaoReputacao(a));
    } else if (ordem === 'disponiveis') {
      lista.sort((a, b) => b.datasDisponiveis.length - a.datasDisponiveis.length);
    } else {
      lista.sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase()));
    }

    return lista;
  });

  ngOnInit() {
    this.carregarProfissionais();
  }

  /**
   * Ordem padrão:
   * 1. Premium (destaque pago, sempre identificado como tal no card)
   * 2. Dentro de cada grupo: selo "Bem avaliado" → nota → "Novo na rede" → demais
   * 3. Empate: quem tem horário disponível primeiro, depois nome
   */
  private compararRelevancia(a: Profissional, b: Profissional): number {
    if (a.premium !== b.premium) return a.premium ? -1 : 1;
    const dif = this.pontuacaoReputacao(b) - this.pontuacaoReputacao(a);
    if (dif !== 0) return dif;
    const dispA = a.datasDisponiveis.length > 0 ? 1 : 0;
    const dispB = b.datasDisponiveis.length > 0 ? 1 : 0;
    if (dispA !== dispB) return dispB - dispA;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  }

  /** Número para ordenar por reputação (selo > nota > novo na rede > nota baixa). */
  private pontuacaoReputacao(p: Profissional): number {
    const r = p.reputacao;
    if (r.bemAvaliado) return 300 + r.media;
    if (r.novo) return 150;           // novos não ficam enterrados no fim da lista
    return 100 + r.media * 20;        // avaliados sem selo, pela média
  }

  /** "CRP 06/123456" ou "OAB 123456" (sem repetir a sigla se já vier no cadastro). */
  registro(prof: Profissional): string {
    const id = (prof.identificacao || '').trim();
    if (!id || id.startsWith('Sem ')) return id || '';
    const sigla = prof.tipo === 'psicologo' ? 'CRP' : 'OAB';
    return id.toUpperCase().startsWith(sigla) ? id : `${sigla} ${id}`;
  }

  /** Classes das 5 estrelas da média. */
  estrelas(media: number): string[] {
    return [1, 2, 3, 4, 5].map((i) =>
      media >= i - 0.25 ? 'fa-solid fa-star'
      : media >= i - 0.75 ? 'fa-solid fa-star-half-stroke'
      : 'fa-regular fa-star'
    );
  }

  async carregarProfissionais() {
    this.isLoading.set(true);
    try {
      const [snapPsi, snapAdv, reputacoes, premiums] = await Promise.all([
        getDocs(collection(db, 'psicologos')),
        getDocs(collection(db, 'advogados')),
        carregarReputacoesDeTodos().catch(() => new Map<string, Reputacao>()),
        this.planoService.premiumAtivos()
      ]);

      const docsAll = [
        ...snapPsi.docs.map(d => ({ snap: d, tipo: 'psicologo' as const })),
        ...snapAdv.docs.map(d => ({ snap: d, tipo: 'advogado' as const }))
      ];

      const lista: Profissional[] = docsAll.map(({ snap, tipo }) => {
        const data = snap.data() as any;

        const nome = data.nome || (tipo === 'psicologo' ? 'Psicólogo(a)' : 'Advogado(a)');
        const identificacao = tipo === 'psicologo' ? (data.crp || 'Sem CRP') : (data.oab || 'Sem OAB');
        const cargoLabel = tipo === 'psicologo' ? 'Psicólogo(a)' : 'Advogada';
        const area = tipo === 'psicologo' ? (data.area || 'Área não informada') : (data.atuacao || 'Atuação não informada');
        const especializacoesTodas = data.especializacoes || [];
        const especializacoes = especializacoesTodas.slice(0, 3);
        const extrasCount = especializacoesTodas.length > 3 ? especializacoesTodas.length - 3 : 0;
        const foto = data.avatar || 'img/account_icon.png';
        const uid = data.uid || snap.id;

        const disponibilidadeRaw = data.disponibilidade || [];
        const disponibilidadeFormatada = this.processarDisponibilidade(disponibilidadeRaw);
        // Datas em ordem cronológica (chaves AAAA-MM-DD ordenam certo como texto)
        const datasKeys = Object.keys(disponibilidadeFormatada).sort();
        const datasDisponiveis = datasKeys.map(k => ({
          key: k,
          diaSemana: this.formatarDiaSemana(k),
          diaMes: this.formatarDiaMes(k)
        }));

        return {
          docId: snap.id,
          tipo,
          uid,
          nome,
          identificacao,
          cargoLabel,
          area,
          especializacoes,
          extrasCount,
          foto,
          reputacao: reputacoes.get(uid) || REPUTACAO_VAZIA,
          premium: premiums.has(uid),
          disponibilidadeRaw,
          disponibilidadeFormatada,
          datasDisponiveis,
          dataSelecionada: datasKeys[0] || null,
          horarioSelecionado: null,
          visivel: true
        };
      });

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
      cargo: `${prof.cargoLabel} • ${prof.identificacao}`,
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

  abrirFiltros() { this.showFiltroModal.set(true); }
  fecharFiltros() { this.showFiltroModal.set(false); }

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
        maeId: currentUser.uid,   // sempre o uid de login (videochamada e regras comparam com ele)
        profissionalId: info.uid,
        tipoProfissional: info.tipo,
        Datahora: timestampFinal,
        Motivo: motivo,
        status: 'pendente',
        criadoEm: Timestamp.now(),
        primeiraGratuita: true,
        relatorioGerado: false
      };

      const collectionName = info.tipo === 'psicologo' ? 'psicologos' : 'advogados';
      const profRef = doc(db, collectionName, info.docId);
      const consultaRef = doc(collection(db, 'Consultas'));
      const minuto = (ms: number) => Math.floor(ms / 60000);   // compara até o minuto
      const alvo = minuto(dataConsulta.getTime());

      // Transação: só agenda se o horário ainda estiver livre no banco
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(profRef);
        const disponiveis: any[] = snap.data()?.['disponibilidade'] || [];
        const original = disponiveis.find((t: any) => minuto((t?.toDate ? t.toDate() : new Date(t)).getTime()) === alvo);
        if (!original) throw new Error('HORARIO_OCUPADO');
        tx.set(consultaRef, payload);
        tx.update(profRef, { disponibilidade: arrayRemove(original), agendados: arrayUnion(original) });
      });

      alert('Consulta agendada com sucesso!');
      this.fecharModal();
      this.carregarProfissionais();
    } catch (err: any) {
      console.error('Erro ao salvar consulta:', err);
      alert(err?.message === 'HORARIO_OCUPADO'
        ? 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.'
        : 'Erro ao agendar. Tente novamente.');
      if (err?.message === 'HORARIO_OCUPADO') this.carregarProfissionais();
    } finally {
      this.salvando.set(false);
    }
  }

  /**
   * Agrupa os horários por dia, em ordem de ano, mês, dia e hora
   * (e não na ordem em que o profissional cadastrou). Horários que já passaram ficam de fora.
   */
  private processarDisponibilidade(arrayTimestamps: any[]): { [dataStr: string]: string[] } {
    const dias: { [dataStr: string]: string[] } = {};
    const agora = Date.now();
    const datas = (arrayTimestamps || [])
      .map((t: any) => (t?.toDate ? t.toDate() : new Date(t)))
      .filter((d: Date) => !isNaN(d.getTime()) && d.getTime() > agora)
      .sort((a: Date, b: Date) => a.getTime() - b.getTime());

    datas.forEach((data: Date) => {
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

  scrollDatas(container: HTMLElement, direction: number) {
    const scrollAmount = 250;
    container.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
  }
}