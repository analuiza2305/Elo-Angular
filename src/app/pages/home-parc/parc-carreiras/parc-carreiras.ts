import { Component, HostListener, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { onAuthStateChanged, Unsubscribe as AuthUnsub } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp,
  Unsubscribe, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from '../../../core/firebase';
import {
  AREAS_CARREIRA, BENEFICIOS_MAE, Curso, FORMATOS_CURSO, MODALIDADES, NIVEIS_CURSO, REGIMES, Vaga,
  ResultadoLink, cursoDeDoc, infoArea, linkSeguro, tempoDesde, vagaDeDoc, verificarLinkCarreira,
} from '../../../services/carreiras';

/** Quantas mães abriram os detalhes e quantas clicaram no link de uma vaga/curso. */
interface MetricaItem { viram: number; clicaram: number; }

type FormVaga = Omit<Vaga, 'id' | 'empresa' | 'empresaFoto' | 'parceiroId' | 'criadoEm' | 'status'>;
type FormCurso = Omit<Curso, 'id' | 'instituicao' | 'empresaFoto' | 'parceiroId' | 'criadoEm' | 'status'>;

/**
 * Aba "Carreiras" da empresa parceira: divulga vagas de emprego e cursos para as mães.
 * A plataforma só divulga — candidatura e inscrição acontecem no link do parceiro.
 */
@Component({
  selector: 'app-parc-carreiras',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parc-carreiras.html',
  styleUrls: ['./parc-carreiras.css'],
})
export class ParcCarreirasComponent implements OnInit, OnDestroy {
  private browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly areas = AREAS_CARREIRA;
  readonly modalidades = MODALIDADES;
  readonly regimes = REGIMES;
  readonly niveis = NIVEIS_CURSO;
  readonly formatos = FORMATOS_CURSO;
  readonly beneficiosMae = BENEFICIOS_MAE;
  readonly infoArea = infoArea;
  readonly tempoDesde = tempoDesde;
  readonly linkSeguro = linkSeguro;

  subAba = signal<'vagas' | 'cursos'>('vagas');
  vagas = signal<Vaga[]>([]);
  cursos = signal<Curso[]>([]);
  carregando = signal(true);

  editandoVagaId = signal<string | null>(null);
  editandoCursoId = signal<string | null>(null);
  mostrarFormVaga = signal(false);
  mostrarFormCurso = signal(false);
  salvando = signal(false);
  aviso = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  confirmarExclusao = signal<{ tipo: 'vaga' | 'curso'; id: string; titulo: string } | null>(null);

  formVaga: FormVaga = this.vagaVazia();
  formCurso: FormCurso = this.cursoVazio();

  private uid = '';
  private nomeEmpresa = '';
  private fotoEmpresa = '';
  /** Site e e-mail da empresa: usados para conferir os links de vagas e cursos. */
  private siteEmpresa = '';
  private emailEmpresa = '';

  /** Benefício que a empresa está digitando (além das sugestões da plataforma). */
  novoBeneficio = '';
  readonly MAX_BENEFICIOS = 12;

  /** Alcance de cada vaga/curso (id → métricas) e o total. */
  metricas = signal<Record<string, MetricaItem>>({});
  totalViram = computed(() => Object.values(this.metricas()).reduce((t, m) => t + m.viram, 0));
  totalClicaram = computed(() => Object.values(this.metricas()).reduce((t, m) => t + m.clicaram, 0));
  private unsubs: (Unsubscribe | AuthUnsub)[] = [];
  private timerAviso: any;

  vagasAbertas = computed(() => this.vagas().filter((v) => v.status === 'aberta').length);
  vagasEncerradas = computed(() => this.vagas().filter((v) => v.status !== 'aberta').length);
  cursosAtivos = computed(() => this.cursos().filter((c) => c.status === 'ativo').length);
  cursosEncerrados = computed(() => this.cursos().filter((c) => c.status !== 'ativo').length);

  ngOnInit(): void {
    if (!this.browser) return;
    this.unsubs.push(onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      this.uid = user.uid;
      this.nomeEmpresa = await this.buscarNomeEmpresa(user.uid);
      const ordenar = <T extends { criadoEm: Date | null }>(l: T[]) => l.sort((a, b) => (b.criadoEm?.getTime() || 0) - (a.criadoEm?.getTime() || 0));

      this.unsubs.push(onSnapshot(query(collection(db, 'vagas'), where('parceiroId', '==', user.uid)), (snap) => {
        this.vagas.set(ordenar(snap.docs.map((d) => vagaDeDoc(d.id, d.data()))));
        this.carregando.set(false);
        void this.carregarMetricas('vagas', snap.docs.map((d) => d.id));
      }, (e) => { console.error('Vagas do parceiro:', e); this.carregando.set(false); }));

      this.unsubs.push(onSnapshot(query(collection(db, 'cursos'), where('parceiroId', '==', user.uid)), (snap) => {
        this.cursos.set(ordenar(snap.docs.map((d) => cursoDeDoc(d.id, d.data()))));
        void this.carregarMetricas('cursos', snap.docs.map((d) => d.id));
      }, (e) => console.error('Cursos do parceiro:', e)));
    }));
  }

  ngOnDestroy(): void {
    this.unsubs.forEach((u) => u());
    clearTimeout(this.timerAviso);
  }

  private async buscarNomeEmpresa(uid: string): Promise<string> {
    try {
      const s = await getDoc(doc(db, 'parceiros', uid));
      let d: any = s.exists() ? s.data() : null;
      if (!d) {
        const q = await getDocs(query(collection(db, 'parceiros'), where('uid', '==', uid), limit(1)));
        d = q.empty ? null : q.docs[0].data();
      }
      this.fotoEmpresa = d?.fotoURL || d?.avatar || '';
      this.siteEmpresa = d?.site || '';
      this.emailEmpresa = d?.email || auth.currentUser?.email || '';
      return d?.nomeEmpresa || d?.nome || auth.currentUser?.displayName || 'Parceiro';
    } catch {
      return auth.currentUser?.displayName || 'Parceiro';
    }
  }

  private avisar(texto: string, tipo: 'ok' | 'erro' = 'ok'): void {
    this.aviso.set({ tipo, texto });
    clearTimeout(this.timerAviso);
    this.timerAviso = setTimeout(() => this.aviso.set(null), 3800);
  }

  /** Confere o link de candidatura/inscrição (ver verificarLinkCarreira em services/carreiras). */
  statusLink(link: string): ResultadoLink | null {
    if (!(link || '').trim()) return null;
    return verificarLinkCarreira(link, { site: this.siteEmpresa, email: this.emailEmpresa });
  }

  /**
   * Conta, para cada vaga/curso, quantas mães abriram os detalhes (visualizacoes)
   * e quantas clicaram no link (interessados). Um documento por mãe em cada subcoleção.
   */
  private async carregarMetricas(colecao: 'vagas' | 'cursos', ids: string[]): Promise<void> {
    const contar = async (id: string, sub: string) => {
      try { return (await getCountFromServer(collection(db, colecao, id, sub))).data().count; }
      catch { return 0; } // sem permissão (regras antigas): mostra 0
    };
    const novas: Record<string, MetricaItem> = {};
    await Promise.all(ids.map(async (id) => {
      const [viram, clicaram] = await Promise.all([contar(id, 'visualizacoes'), contar(id, 'interessados')]);
      novas[id] = { viram, clicaram };
    }));
    this.metricas.update((m) => ({ ...m, ...novas }));
  }

  metricaDe(id: string): MetricaItem {
    return this.metricas()[id] || { viram: 0, clicaram: 0 };
  }

  // ---------------- vagas ----------------

  private vagaVazia(): FormVaga {
    return { titulo: '', area: 'Administração', modalidade: 'Presencial', regime: 'CLT', local: '', salario: '',
      descricao: '', requisitos: '', beneficios: [], link: '' };
  }

  novaVaga(): void {
    this.formVaga = this.vagaVazia();
    this.novoBeneficio = '';
    this.editandoVagaId.set(null);
    this.mostrarFormVaga.set(true);
  }

  editarVaga(v: Vaga): void {
    this.formVaga = { titulo: v.titulo, area: v.area, modalidade: v.modalidade, regime: v.regime, local: v.local, salario: v.salario,
      descricao: v.descricao, requisitos: v.requisitos, beneficios: [...v.beneficios], link: v.link };
    this.editandoVagaId.set(v.id);
    this.subAba.set('vagas');
    this.mostrarFormVaga.set(true);
  }

  /** Esc fecha o modal aberto (vaga, curso ou confirmação). */
  @HostListener('document:keydown.escape')
  fecharComEsc(): void {
    if (this.confirmarExclusao()) { this.confirmarExclusao.set(null); return; }
    if (this.mostrarFormVaga()) this.cancelarVaga();
    if (this.mostrarFormCurso()) this.cancelarCurso();
  }

  cancelarVaga(): void { this.mostrarFormVaga.set(false); this.editandoVagaId.set(null); }

  alternarBeneficio(b: string): void {
    const l = this.formVaga.beneficios;
    this.formVaga.beneficios = l.includes(b) ? l.filter((x) => x !== b) : [...l, b];
  }

  /** Benefícios escritos pela empresa (os que não estão na lista de sugestões). */
  beneficiosProprios(): string[] {
    return this.formVaga.beneficios.filter((b) => !this.beneficiosMae.includes(b));
  }

  adicionarBeneficio(): void {
    const texto = this.novoBeneficio.trim().replace(/\s+/g, ' ');
    if (!texto) return;
    if (texto.length > 40) { this.avisar('Escreva o benefício em até 40 caracteres.', 'erro'); return; }
    if (this.formVaga.beneficios.length >= this.MAX_BENEFICIOS) { this.avisar(`Escolha até ${this.MAX_BENEFICIOS} benefícios.`, 'erro'); return; }
    const igual = (a: string) => a.toLowerCase() === texto.toLowerCase();
    const sugestao = this.beneficiosMae.find(igual);
    if (sugestao) {
      // já existe nas sugestões: só marca ela
      if (!this.formVaga.beneficios.includes(sugestao)) this.formVaga.beneficios = [...this.formVaga.beneficios, sugestao];
    } else if (!this.formVaga.beneficios.some(igual)) {
      this.formVaga.beneficios = [...this.formVaga.beneficios, texto];
    }
    this.novoBeneficio = '';
  }

  removerBeneficio(b: string): void {
    this.formVaga.beneficios = this.formVaga.beneficios.filter((x) => x !== b);
  }

  async salvarVaga(): Promise<void> {
    const f = this.formVaga;
    if (!f.titulo.trim()) { this.avisar('Dê um título para a vaga.', 'erro'); return; }
    if (!f.descricao.trim()) { this.avisar('Escreva uma descrição para a vaga.', 'erro'); return; }
    const linkVaga = verificarLinkCarreira(f.link, { site: this.siteEmpresa, email: this.emailEmpresa });
    if (!linkVaga.ok) { this.avisar(linkVaga.mensagem, 'erro'); return; }
    if (!this.uid || this.salvando()) return;
    this.salvando.set(true);
    const dados = {
      titulo: f.titulo.trim(), area: f.area, modalidade: f.modalidade, regime: f.regime, local: f.local.trim(), salario: f.salario.trim(),
      descricao: f.descricao.trim(), requisitos: f.requisitos.trim(), beneficios: f.beneficios, link: f.link.trim(),
      empresa: this.nomeEmpresa, empresaFoto: this.fotoEmpresa, parceiroId: this.uid,
    };
    try {
      const id = this.editandoVagaId();
      if (id) {
        await updateDoc(doc(db, 'vagas', id), { ...dados, editadoEm: serverTimestamp() });
        this.avisar('Vaga atualizada.');
      } else {
        await addDoc(collection(db, 'vagas'), { ...dados, status: 'aberta', criadoEm: serverTimestamp() });
        this.avisar('Vaga divulgada! As mães já podem ver.');
      }
      this.cancelarVaga();
    } catch (e) {
      console.error(e);
      this.avisar('Não foi possível salvar a vaga. Confira as regras do Firestore.', 'erro');
    } finally {
      this.salvando.set(false);
    }
  }

  async alternarStatusVaga(v: Vaga): Promise<void> {
    try {
      await updateDoc(doc(db, 'vagas', v.id), { status: v.status === 'aberta' ? 'encerrada' : 'aberta' });
      this.avisar(v.status === 'aberta' ? 'Vaga encerrada. Ela sai da lista das mães.' : 'Vaga reaberta.');
    } catch (e) { console.error(e); this.avisar('Não foi possível mudar o status.', 'erro'); }
  }

  // ---------------- cursos ----------------

  private cursoVazio(): FormCurso {
    return { titulo: '', area: 'Empreendedorismo', nivel: 'Iniciante', formato: 'Online', cargaHoraria: '', inicio: '',
      gratuito: true, certificado: false, descricao: '', link: '' };
  }

  novoCurso(): void {
    this.formCurso = this.cursoVazio();
    this.editandoCursoId.set(null);
    this.mostrarFormCurso.set(true);
  }

  editarCurso(c: Curso): void {
    this.formCurso = { titulo: c.titulo, area: c.area, nivel: c.nivel, formato: c.formato, cargaHoraria: c.cargaHoraria, inicio: c.inicio,
      gratuito: c.gratuito, certificado: c.certificado, descricao: c.descricao, link: c.link };
    this.editandoCursoId.set(c.id);
    this.subAba.set('cursos');
    this.mostrarFormCurso.set(true);
  }

  cancelarCurso(): void { this.mostrarFormCurso.set(false); this.editandoCursoId.set(null); }

  async salvarCurso(): Promise<void> {
    const f = this.formCurso;
    if (!f.titulo.trim()) { this.avisar('Dê um nome para o curso.', 'erro'); return; }
    const linkCurso = verificarLinkCarreira(f.link, { site: this.siteEmpresa, email: this.emailEmpresa });
    if (!linkCurso.ok) { this.avisar(linkCurso.mensagem, 'erro'); return; }
    if (!this.uid || this.salvando()) return;
    this.salvando.set(true);
    const dados = {
      titulo: f.titulo.trim(), area: f.area, nivel: f.nivel, formato: f.formato, cargaHoraria: f.cargaHoraria.trim(), inicio: f.inicio.trim(),
      gratuito: f.gratuito, certificado: f.certificado, descricao: f.descricao.trim(), link: f.link.trim(),
      instituicao: this.nomeEmpresa, empresaFoto: this.fotoEmpresa, parceiroId: this.uid,
    };
    try {
      const id = this.editandoCursoId();
      if (id) {
        await updateDoc(doc(db, 'cursos', id), { ...dados, editadoEm: serverTimestamp() });
        this.avisar('Curso atualizado.');
      } else {
        await addDoc(collection(db, 'cursos'), { ...dados, status: 'ativo', criadoEm: serverTimestamp() });
        this.avisar('Curso divulgado! As mães já podem ver.');
      }
      this.cancelarCurso();
    } catch (e) {
      console.error(e);
      this.avisar('Não foi possível salvar o curso. Confira as regras do Firestore.', 'erro');
    } finally {
      this.salvando.set(false);
    }
  }

  async alternarStatusCurso(c: Curso): Promise<void> {
    try {
      await updateDoc(doc(db, 'cursos', c.id), { status: c.status === 'ativo' ? 'encerrado' : 'ativo' });
      this.avisar(c.status === 'ativo' ? 'Divulgação encerrada. O curso sai da lista das mães.' : 'Curso divulgado de novo.');
    } catch (e) { console.error(e); this.avisar('Não foi possível mudar o status.', 'erro'); }
  }

  // ---------------- excluir ----------------

  pedirExclusao(tipo: 'vaga' | 'curso', id: string, titulo: string): void {
    this.confirmarExclusao.set({ tipo, id, titulo });
  }

  async excluir(): Promise<void> {
    const alvo = this.confirmarExclusao();
    if (!alvo) return;
    try {
      await deleteDoc(doc(db, alvo.tipo === 'vaga' ? 'vagas' : 'cursos', alvo.id));
      this.avisar(alvo.tipo === 'vaga' ? 'Vaga excluída.' : 'Curso excluído.');
    } catch (e) {
      console.error(e);
      this.avisar('Não foi possível excluir.', 'erro');
    }
    this.confirmarExclusao.set(null);
  }
}
