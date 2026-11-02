import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AtribuicaoSelo,
  CRITERIO_MERITO,
  DadosSelos,
  PerfilSelo,
  PessoaSelo,
  SELOS,
  SeloService,
  SituacaoSelo,
  TipoSelo,
  VALIDADES_CORTESIA,
  definicaoSelo,
  rotuloPerfil,
} from '../../../services/selo';

type AbaSelos = 'geral' | 'destaque' | 'apoiador' | 'merito';
type FiltroMerito = 'todos' | 'ativo' | 'em_progresso' | 'suspenso';
type AcaoConfirmacao = 'revogar' | 'suspender';

/**
 * Gerenciamento de selos (ADM):
 *  - Visão geral: separa o que é PAGO do que é por MÉRITO;
 *  - Destaque (psicólogos/advogados) e Apoiador (empresas parceiras): cortesias e quem tem pelo plano;
 *  - Mérito: acompanha o selo "Bem avaliado" e permite suspender/restaurar (nunca conceder).
 * Tudo passa pelo SeloService.
 */
@Component({
  selector: 'app-adm-selos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './adm-selos.html',
  styleUrl: './adm-selos.css',
})
export class AdmSelosComponent implements OnInit, OnDestroy {
  private readonly svc = inject(SeloService);

  readonly catalogo = SELOS;
  readonly pagos = SELOS.filter((s) => s.natureza === 'pago');
  readonly merito = SELOS.filter((s) => s.natureza === 'merito');
  readonly criterio = CRITERIO_MERITO;
  readonly validades = VALIDADES_CORTESIA;
  readonly rotuloPerfil = rotuloPerfil;

  readonly aba = signal<AbaSelos>('geral');
  readonly carregando = signal(true);
  readonly erroCarga = signal('');
  readonly dados = signal<DadosSelos>({ pessoas: [], atribuicoes: [] });
  readonly aviso = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  private avisoTimer: any = null;

  // ---------- filtros ----------
  readonly busca = signal('');
  readonly filtroSituacao = signal<'todas' | SituacaoSelo>('todas');
  readonly filtroMerito = signal<FiltroMerito>('todos');

  // ---------- modal: conceder cortesia ----------
  readonly modalConcederAberto = signal(false);
  readonly salvando = signal(false);
  readonly erroForm = signal('');
  buscaPessoa = '';
  pessoaEscolhida: PessoaSelo | null = null;
  validadeDias: number | null = 30;
  motivoCortesia = '';

  // ---------- modal: confirmar revogação / suspensão ----------
  readonly alvoConfirmacao = signal<{ acao: AcaoConfirmacao; atribuicao: AtribuicaoSelo } | null>(null);
  motivoConfirmacao = '';

  // ---------- derivados ----------
  /** Selo da aba atual (null na visão geral e no mérito). */
  readonly seloPago = computed<TipoSelo | null>(() => {
    const a = this.aba();
    return a === 'destaque' || a === 'apoiador' ? a : null;
  });

  private readonly pagosDe = (selo: TipoSelo) =>
    this.dados().atribuicoes.filter((a) => a.selo === selo);

  readonly kpis = computed(() => {
    const todas = this.dados().atribuicoes;
    const ativos = (selo: TipoSelo, origem?: string) =>
      todas.filter((a) => a.selo === selo && a.situacao === 'ativo' && (!origem || a.origem === origem)).length;
    return {
      destaque: ativos('destaque'),
      destaquePlano: ativos('destaque', 'plano'),
      destaqueCortesia: ativos('destaque', 'cortesia'),
      apoiador: ativos('apoiador'),
      apoiadorPlano: ativos('apoiador', 'plano'),
      apoiadorCortesia: ativos('apoiador', 'cortesia'),
      merito: ativos('bem-avaliado'),
      suspensos: todas.filter((a) => a.situacao === 'suspenso').length,
    };
  });

  readonly listaPaga = computed(() => {
    const selo = this.seloPago();
    if (!selo) return [];
    const termo = this.normalizar(this.busca());
    const situacao = this.filtroSituacao();
    return this.pagosDe(selo)
      .filter((a) => situacao === 'todas' || a.situacao === situacao)
      .filter((a) => !termo || this.normalizar(a.pessoa.nome + ' ' + a.pessoa.email).includes(termo))
      .sort((x, y) => this.pesoSituacao(x.situacao) - this.pesoSituacao(y.situacao)
        || x.pessoa.nome.localeCompare(y.pessoa.nome, 'pt-BR'));
  });

  readonly totalPago = computed(() => {
    const selo = this.seloPago();
    return selo ? this.pagosDe(selo).length : 0;
  });

  readonly listaMerito = computed(() => {
    const termo = this.normalizar(this.busca());
    const filtro = this.filtroMerito();
    return this.pagosDe('bem-avaliado')
      .filter((a) => filtro === 'todos' || a.situacao === filtro)
      .filter((a) => !termo || this.normalizar(a.pessoa.nome + ' ' + a.pessoa.email).includes(termo))
      .sort((x, y) => this.pesoSituacao(x.situacao) - this.pesoSituacao(y.situacao)
        || (y.reputacao?.media ?? 0) - (x.reputacao?.media ?? 0)
        || x.pessoa.nome.localeCompare(y.pessoa.nome, 'pt-BR'));
  });

  /** Pessoas que ainda podem receber cortesia do selo da aba (sem selo ativo e que combinam com a busca). */
  readonly pessoasElegiveis = computed(() => {
    const selo = this.seloPago();
    if (!selo) return [];
    const def = definicaoSelo(selo);
    const comSeloAtivo = new Set(
      this.pagosDe(selo).filter((a) => a.situacao === 'ativo').map((a) => a.pessoa.uid),
    );
    const termo = this.normalizar(this.buscaPessoaSig());
    return this.dados().pessoas
      .filter((p) => def.perfis.includes(p.perfil) && !comSeloAtivo.has(p.uid))
      .filter((p) => !termo || this.normalizar(p.nome + ' ' + p.email).includes(termo))
      .slice(0, 30);
  });
  /** Espelho de `buscaPessoa` em signal, para o computed acima reagir. */
  readonly buscaPessoaSig = signal('');

  ngOnInit(): void {
    this.carregar();
  }

  ngOnDestroy(): void {
    clearTimeout(this.avisoTimer);
  }

  // ======================= CARGA =======================

  async carregar(): Promise<void> {
    this.carregando.set(true);
    this.erroCarga.set('');
    try {
      this.dados.set(await this.svc.carregar());
    } catch (e) {
      console.error('Erro ao carregar selos', e);
      this.erroCarga.set('Não foi possível carregar os selos agora. Confira a conexão e as permissões do Firestore.');
    } finally {
      this.carregando.set(false);
    }
  }

  mudarAba(aba: AbaSelos): void {
    this.aba.set(aba);
    this.busca.set('');
    this.filtroSituacao.set('todas');
    this.filtroMerito.set('todos');
  }

  limparFiltros(): void {
    this.busca.set('');
    this.filtroSituacao.set('todas');
    this.filtroMerito.set('todos');
  }

  // ======================= CORTESIA =======================

  abrirConceder(): void {
    this.buscaPessoa = '';
    this.buscaPessoaSig.set('');
    this.pessoaEscolhida = null;
    this.validadeDias = 30;
    this.motivoCortesia = '';
    this.erroForm.set('');
    this.modalConcederAberto.set(true);
  }

  fecharConceder(): void {
    if (this.salvando()) return;
    this.modalConcederAberto.set(false);
  }

  aoDigitarPessoa(valor: string): void {
    this.buscaPessoa = valor;
    this.buscaPessoaSig.set(valor);
    if (this.pessoaEscolhida && this.pessoaEscolhida.nome !== valor) this.pessoaEscolhida = null;
  }

  escolherPessoa(p: PessoaSelo): void {
    this.pessoaEscolhida = p;
    this.buscaPessoa = p.nome;
    this.buscaPessoaSig.set(p.nome);
    this.erroForm.set('');
  }

  async confirmarConceder(): Promise<void> {
    const selo = this.seloPago();
    if (!selo) return;
    if (!this.pessoaEscolhida) {
      this.erroForm.set('Escolha quem vai receber o selo.');
      return;
    }
    this.salvando.set(true);
    this.erroForm.set('');
    try {
      await this.svc.concederCortesia(this.pessoaEscolhida, selo, this.validadeDias, this.motivoCortesia);
      this.modalConcederAberto.set(false);
      this.mostrarAviso('ok', `Selo ${definicaoSelo(selo).nome} concedido a ${this.pessoaEscolhida.nome}.`);
      await this.recarregarSemPiscar();
    } catch (e: any) {
      console.error('Erro ao conceder selo', e);
      this.erroForm.set(e?.message || 'Não foi possível conceder o selo agora.');
    } finally {
      this.salvando.set(false);
    }
  }

  // ======================= REVOGAR / SUSPENDER / RESTAURAR =======================

  pedirRevogar(a: AtribuicaoSelo): void {
    this.motivoConfirmacao = '';
    this.alvoConfirmacao.set({ acao: 'revogar', atribuicao: a });
  }

  pedirSuspender(a: AtribuicaoSelo): void {
    this.motivoConfirmacao = '';
    this.alvoConfirmacao.set({ acao: 'suspender', atribuicao: a });
  }

  cancelarConfirmacao(): void {
    if (this.salvando()) return;
    this.alvoConfirmacao.set(null);
  }

  async confirmarAcao(): Promise<void> {
    const alvo = this.alvoConfirmacao();
    if (!alvo) return;
    if (alvo.acao === 'suspender' && !this.motivoConfirmacao.trim()) {
      this.mostrarAviso('erro', 'Conte o motivo da suspensão: ele fica registrado.');
      return;
    }
    this.salvando.set(true);
    try {
      const { pessoa, selo } = alvo.atribuicao;
      if (alvo.acao === 'revogar') {
        await this.svc.revogarCortesia(pessoa, selo, this.motivoConfirmacao);
        this.mostrarAviso('ok', `Cortesia de ${pessoa.nome} encerrada.`);
      } else {
        await this.svc.suspenderMerito(pessoa, this.motivoConfirmacao);
        this.mostrarAviso('ok', `Selo de ${pessoa.nome} suspenso.`);
      }
      this.alvoConfirmacao.set(null);
      await this.recarregarSemPiscar();
    } catch (e) {
      console.error('Erro ao atualizar selo', e);
      this.mostrarAviso('erro', 'Não foi possível concluir a ação agora.');
    } finally {
      this.salvando.set(false);
    }
  }

  async restaurar(a: AtribuicaoSelo): Promise<void> {
    try {
      await this.svc.restaurarMerito(a.pessoa);
      this.mostrarAviso('ok', `Suspensão removida: o selo de ${a.pessoa.nome} volta a depender das avaliações.`);
      await this.recarregarSemPiscar();
    } catch (e) {
      console.error('Erro ao restaurar selo', e);
      this.mostrarAviso('erro', 'Não foi possível restaurar o selo agora.');
    }
  }

  // ======================= APRESENTAÇÃO =======================

  iniciais(nome: string): string {
    return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  }

  def(selo: TipoSelo) {
    return definicaoSelo(selo);
  }

  rotuloSituacao(s: SituacaoSelo): string {
    switch (s) {
      case 'ativo': return 'Ativo';
      case 'expirado': return 'Expirado';
      case 'revogado': return 'Encerrado';
      case 'suspenso': return 'Suspenso';
      default: return 'Em progresso';
    }
  }

  rotuloOrigem(a: AtribuicaoSelo): string {
    return a.origem === 'plano' ? 'Plano Premium' : a.origem === 'cortesia' ? 'Cortesia do ADM' : 'Mérito';
  }

  rotuloPerfilCurto(p: PerfilSelo): string {
    return rotuloPerfil(p);
  }

  perfisTexto(perfis: PerfilSelo[], separador: string): string {
    return perfis.map((p) => rotuloPerfil(p)).join(separador);
  }

  recomendaTexto(a: AtribuicaoSelo): string {
    const pct = a.reputacao?.recomendamPct;
    return pct === null || pct === undefined ? '–' : `${pct}%`;
  }

  /** Quanto falta (0 a 100) para cada critério do selo de mérito. */
  progresso(a: AtribuicaoSelo): { avaliacoes: number; media: number; recomendacao: number } {
    const r = a.reputacao;
    const pct = (valor: number, meta: number) => Math.max(0, Math.min(100, Math.round((valor / meta) * 100)));
    return {
      avaliacoes: pct(r?.total ?? 0, this.criterio.avaliacoesMinimas),
      media: pct(r?.media ?? 0, this.criterio.mediaMinima),
      recomendacao: pct(r?.recomendamPct ?? 0, this.criterio.recomendacaoMinimaPct),
    };
  }

  contagemMerito(filtro: FiltroMerito): number {
    const lista = this.pagosDe('bem-avaliado');
    return filtro === 'todos' ? lista.length : lista.filter((a) => a.situacao === filtro).length;
  }

  // ======================= AUXILIARES =======================

  private async recarregarSemPiscar(): Promise<void> {
    try {
      this.dados.set(await this.svc.carregar());
    } catch (e) {
      console.warn('Não foi possível atualizar a lista', e);
    }
  }

  /** Ordem das linhas: o que está valendo primeiro. */
  private pesoSituacao(s: SituacaoSelo): number {
    return { ativo: 0, em_progresso: 1, suspenso: 2, expirado: 3, revogado: 4 }[s];
  }

  private normalizar(t: string): string {
    return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  private mostrarAviso(tipo: 'ok' | 'erro', texto: string): void {
    this.aviso.set({ tipo, texto });
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => this.aviso.set(null), 5000);
  }
}
