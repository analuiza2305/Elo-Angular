import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, Unsubscribe, where } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { HeaderComponent } from '../../components/header/header';
import { SelosAutorComponent } from '../../components/selos-autor/selos-autor';
import {
  AREAS_CARREIRA, BENEFICIOS_MAE, Curso, MODALIDADES, Vaga,
  cursoDeDoc, infoArea, linkSeguro, removidoPelaModeracao, tempoDesde, vagaDeDoc,
} from '../../services/carreiras';

/**
 * Carreiras (mãe): vitrine de vagas e cursos divulgados pelos parceiros.
 * Nada é feito dentro da plataforma: o botão leva para o link do parceiro.
 */
@Component({
  selector: 'app-carreiras',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent, SelosAutorComponent],
  templateUrl: './carreiras.html',
  styleUrls: ['./carreiras.css'],
})
export class Carreiras implements OnInit, OnDestroy {
  private browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly areas = AREAS_CARREIRA;
  readonly modalidades = MODALIDADES;
  readonly beneficiosMae = BENEFICIOS_MAE;
  readonly infoArea = infoArea;
  readonly tempoDesde = tempoDesde;
  readonly linkSeguro = linkSeguro;

  aba = signal<'vagas' | 'cursos'>('vagas');
  carregando = signal(true);
  vagas = signal<Vaga[]>([]);
  cursos = signal<Curso[]>([]);

  buscaVaga = signal('');
  areaVaga = signal('');
  modalidadeVaga = signal('');
  beneficiosFiltro = signal<string[]>([]);
  buscaCurso = signal('');
  areaCurso = signal('');
  soGratuitos = signal(false);
  painelBeneficios = signal(false);

  vagaAberta = signal<Vaga | null>(null);
  cursoAberto = signal<Curso | null>(null);

  /** Foto atual de cada parceiro (a que ele definiu no perfil). */
  fotosParceiros = signal<Record<string, string>>({});
  fotosQuebradas = signal<Record<string, boolean>>({});
  private fotosBuscadas = new Set<string>();

  private unsubs: Unsubscribe[] = [];

  vagasFiltradas = computed(() => {
    const busca = this.normalizar(this.buscaVaga());
    const area = this.areaVaga();
    const mod = this.modalidadeVaga();
    const bens = this.beneficiosFiltro();
    return this.vagas().filter((v) =>
      v.status === 'aberta'
      && (!area || v.area === area)
      && (!mod || v.modalidade === mod)
      && bens.every((b) => v.beneficios.includes(b))
      && (!busca || this.normalizar(`${v.titulo} ${v.empresa} ${v.local} ${v.area}`).includes(busca)));
  });

  cursosFiltrados = computed(() => {
    const busca = this.normalizar(this.buscaCurso());
    const area = this.areaCurso();
    return this.cursos().filter((c) =>
      c.status === 'ativo'
      && (!area || c.area === area)
      && (!this.soGratuitos() || c.gratuito)
      && (!busca || this.normalizar(`${c.titulo} ${c.instituicao} ${c.area}`).includes(busca)));
  });

  filtrosVagaAtivos = computed(() => !!(this.buscaVaga() || this.areaVaga() || this.modalidadeVaga() || this.beneficiosFiltro().length));

  totalVagas = computed(() => this.vagas().filter((v) => v.status === 'aberta').length);
  totalCursos = computed(() => this.cursos().filter((c) => c.status === 'ativo').length);
  totalParceiros = computed(() => new Set([
    ...this.vagas().filter((v) => v.status === 'aberta').map((v) => v.parceiroId),
    ...this.cursos().filter((c) => c.status === 'ativo').map((c) => c.parceiroId),
  ].filter(Boolean)).size);

  ngOnInit(): void {
    if (!this.browser) return;
    const ordenar = <T extends { criadoEm: Date | null }>(l: T[]) => l.sort((a, b) => (b.criadoEm?.getTime() || 0) - (a.criadoEm?.getTime() || 0));

    this.unsubs.push(onSnapshot(collection(db, 'vagas'), (snap) => {
      this.vagas.set(ordenar(snap.docs.filter((d) => !removidoPelaModeracao(d.data())).map((d) => vagaDeDoc(d.id, d.data()))));
      this.buscarFotos(this.vagas().map((v) => v.parceiroId));
      this.carregando.set(false);
    }, (e) => { console.error('Erro ao carregar vagas:', e); this.carregando.set(false); }));

    this.unsubs.push(onSnapshot(collection(db, 'cursos'), (snap) => {
      this.cursos.set(ordenar(snap.docs.filter((d) => !removidoPelaModeracao(d.data())).map((d) => cursoDeDoc(d.id, d.data()))));
      this.buscarFotos(this.cursos().map((c) => c.parceiroId));
    }, (e) => console.error('Erro ao carregar cursos:', e)));
  }

  ngOnDestroy(): void { this.unsubs.forEach((u) => u()); }

  /** Busca a foto de perfil atual dos parceiros (coleção 'parceiros', campo fotoURL). */
  private async buscarFotos(ids: string[]): Promise<void> {
    const novos = [...new Set(ids.filter((id) => id && !this.fotosBuscadas.has(id)))];
    novos.forEach((id) => this.fotosBuscadas.add(id));
    await Promise.all(novos.map(async (id) => {
      try {
        const s = await getDoc(doc(db, 'parceiros', id));
        let d: any = s.exists() ? s.data() : null;
        if (!d) {
          const q = await getDocs(query(collection(db, 'parceiros'), where('uid', '==', id), limit(1)));
          d = q.empty ? null : q.docs[0].data();
        }
        const foto = d?.fotoURL || d?.avatar || '';
        if (foto) this.fotosParceiros.update((m) => ({ ...m, [id]: foto }));
      } catch { /* sem permissão ou sem foto: fica a letrinha */ }
    }));
  }

  /** Foto do parceiro: a do perfil dele; se não tiver, a salva na publicação; se não, vazio (mostra as iniciais). */
  fotoDe(item: { parceiroId: string; empresaFoto: string }): string {
    const foto = this.fotosParceiros()[item.parceiroId] || item.empresaFoto || '';
    return foto && !this.fotosQuebradas()[foto] ? foto : '';
  }

  fotoFalhou(foto: string): void {
    this.fotosQuebradas.update((m) => ({ ...m, [foto]: true }));
  }

  private normalizar(t: string): string {
    return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  alternarBeneficio(b: string): void {
    const atual = this.beneficiosFiltro();
    this.beneficiosFiltro.set(atual.includes(b) ? atual.filter((x) => x !== b) : [...atual, b]);
  }

  limparFiltrosVaga(): void {
    this.buscaVaga.set(''); this.areaVaga.set(''); this.modalidadeVaga.set(''); this.beneficiosFiltro.set([]);
  }

  limparFiltrosCurso(): void {
    this.buscaCurso.set(''); this.areaCurso.set(''); this.soGratuitos.set(false);
  }

  iniciais(nome: string): string {
    return (nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }

  ehEmail(link: string): boolean { return linkSeguro(link).startsWith('mailto:'); }
}
