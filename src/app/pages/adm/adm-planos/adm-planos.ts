import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Assinante,
  NivelPlano,
  PERIODICIDADES,
  PUBLICOS_PLANO,
  Plano,
  PlanoForm,
  PlanoService,
  PublicoPlano,
  SituacaoAssinante,
  formatarBRL,
  rotuloPublico,
  sufixoPeriodicidade,
} from '../../../services/plano';

type AbaPlanos = 'planos' | 'assinantes';

/** Sugestões de benefícios (os mesmos recursos que o Premium já libera no app). */
const SUGESTOES_BENEFICIOS = [
  'Tudo do plano gratuito',
  'Destaque na busca e selo Premium no perfil',
  'Modelos de atestado, relatório, laudo e parecer (Resolução CFP 06/2019)',
  'Preenchimento automático com os dados das consultas',
  'Relatório de atendimentos em PDF',
  'Certificado de horas mensal',
];

/**
 * Gerenciamento de planos (ADM): visualizar, cadastrar, editar, ativar/desativar,
 * definir benefícios e acompanhar quem adquiriu cada plano.
 * Tudo passa pelo PlanoService.
 */
@Component({
  selector: 'app-adm-planos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './adm-planos.html',
  styleUrl: './adm-planos.css',
})
export class AdmPlanosComponent implements OnInit {
  private readonly svc = inject(PlanoService);

  readonly periodicidades = PERIODICIDADES;
  readonly publicos = PUBLICOS_PLANO;
  readonly rotuloPublico = rotuloPublico;
  readonly sugestoes = SUGESTOES_BENEFICIOS;
  readonly brl = formatarBRL;
  readonly sufixo = sufixoPeriodicidade;

  readonly aba = signal<AbaPlanos>('planos');
  readonly carregando = signal(true);
  readonly erroCarga = signal('');
  readonly planos = signal<Plano[]>([]);
  /** Qual catálogo a aba "Planos" mostra: cada público (psicólogo, advogado, parceiro) tem o seu. */
  readonly filtroPublico = signal<PublicoPlano>('psicologo');
  readonly planosDoPublico = computed(() => this.planos().filter((p) => p.publico === this.filtroPublico()));
  readonly assinantes = signal<Assinante[]>([]);
  readonly aviso = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  private avisoTimer: any = null;

  // ---------- filtros de assinantes ----------
  readonly busca = signal('');
  readonly filtroPlano = signal('todos');
  readonly filtroSituacao = signal<'todas' | SituacaoAssinante>('todas');

  // ---------- modal de cadastro/edição ----------
  readonly modalAberto = signal(false);
  readonly salvando = signal(false);
  readonly erroForm = signal('');
  editandoId: string | null = null;
  form: PlanoForm = this.formVazio();

  // ---------- confirmação ao desativar ----------
  readonly planoParaDesativar = signal<Plano | null>(null);
  readonly alterandoId = signal<string | null>(null);

  // ---------- derivados ----------
  readonly ativosPorPlano = computed(() => {
    const mapa = new Map<string, number>();
    this.assinantes().filter((a) => a.situacao === 'ativa')
      .forEach((a) => mapa.set(a.planoId, (mapa.get(a.planoId) || 0) + 1));
    return mapa;
  });

  readonly kpis = computed(() => {
    const lista = this.assinantes();
    const agora = new Date();
    const novosNoMes = lista.filter((a) => a.adquiridoEm
      && a.adquiridoEm.getMonth() === agora.getMonth()
      && a.adquiridoEm.getFullYear() === agora.getFullYear()).length;
    return {
      planosAtivos: this.planos().filter((p) => p.ativo).length,
      assinantesAtivos: lista.filter((a) => a.situacao === 'ativa').length,
      novosNoMes,
      totalArrecadado: lista.reduce((s, a) => s + a.totalPago, 0),
    };
  });

  readonly assinantesFiltrados = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    const plano = this.filtroPlano();
    const situacao = this.filtroSituacao();
    return this.assinantes().filter((a) =>
      (plano === 'todos' || a.planoId === plano)
      && (situacao === 'todas' || a.situacao === situacao)
      && (!termo || a.nome.toLowerCase().includes(termo) || a.email.toLowerCase().includes(termo)));
  });

  /** O público selecionado ainda não tem nenhum plano cadastrado (ele usa os planos padrão). */
  readonly catalogoVazio = computed(() => !this.carregando() && !this.erroCarga() && this.planosDoPublico().length === 0);
  readonly rotuloPublicoFiltro = computed(() => this.publicos.find((x) => x.valor === this.filtroPublico())?.rotulo ?? '');

  /** Cada público tem no máximo um plano gratuito. */
  jaExisteGratuito(): boolean {
    return this.planos().some((p) => p.publico === this.form.publico && p.nivel === 'gratuito' && p.id !== this.editandoId);
  }

  ngOnInit(): void {
    this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    this.erroCarga.set('');
    try {
      const planos = await this.svc.planos();
      this.planos.set(planos);
      this.assinantes.set(await this.svc.assinantes(planos));
    } catch (e) {
      console.error('Erro ao carregar planos:', e);
      this.erroCarga.set('Não foi possível carregar os planos. Verifique as regras do Firestore (coleções planos, assinaturas e pagamentosPlanos).');
    } finally {
      this.carregando.set(false);
    }
  }

  // ======================= PLANOS =======================

  async criarPlanosPadrao(): Promise<void> {
    try {
      await this.svc.criarPlanosPadrao(this.filtroPublico());
      this.mostrarAviso('ok', `Planos Gratuito e Premium de ${this.rotuloPublicoFiltro().toLowerCase()} criados. Agora é só ajustar valores e benefícios.`);
      await this.carregar();
    } catch (e) {
      console.error(e);
      this.mostrarAviso('erro', 'Não foi possível criar os planos padrão.');
    }
  }

  abrirNovo(): void {
    this.editandoId = null;
    this.form = this.formVazio();
    this.form.publico = this.filtroPublico();
    if (this.jaExisteGratuito()) this.form.nivel = 'premium';
    this.erroForm.set('');
    this.modalAberto.set(true);
  }

  abrirEdicao(p: Plano): void {
    this.editandoId = p.id;
    this.form = {
      nome: p.nome, descricao: p.descricao, publico: p.publico, nivel: p.nivel, preco: p.preco,
      periodicidade: p.periodicidade, beneficios: [...p.beneficios], ativo: p.ativo, destaque: p.destaque,
    };
    if (!this.form.beneficios.length) this.form.beneficios = [''];
    this.erroForm.set('');
    this.modalAberto.set(true);
  }

  fecharModal(): void {
    if (this.salvando()) return;
    this.modalAberto.set(false);
  }

  mudarPublico(publico: PublicoPlano): void {
    this.form.publico = publico;
    // se o novo público já tem plano gratuito, só dá para criar um plano pago
    if (this.form.nivel === 'gratuito' && this.jaExisteGratuito()) this.form.nivel = 'premium';
  }

  mudarNivel(nivel: NivelPlano): void {
    this.form.nivel = nivel;
    if (nivel === 'gratuito') { this.form.preco = 0; this.form.ativo = true; }
  }

  // ---- benefícios ----
  adicionarBeneficio(texto = ''): void {
    if (texto && this.form.beneficios.some((b) => b.trim().toLowerCase() === texto.toLowerCase())) return;
    // reaproveita a última linha se estiver vazia
    const ultimo = this.form.beneficios.length - 1;
    if (texto && ultimo >= 0 && !this.form.beneficios[ultimo].trim()) this.form.beneficios[ultimo] = texto;
    else this.form.beneficios = [...this.form.beneficios, texto];
  }

  removerBeneficio(i: number): void {
    this.form.beneficios = this.form.beneficios.filter((_, idx) => idx !== i);
    if (!this.form.beneficios.length) this.form.beneficios = [''];
  }

  moverBeneficio(i: number, direcao: -1 | 1): void {
    const j = i + direcao;
    if (j < 0 || j >= this.form.beneficios.length) return;
    const copia = [...this.form.beneficios];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    this.form.beneficios = copia;
  }

  sugestaoJaAdicionada(s: string): boolean {
    return this.form.beneficios.some((b) => b.trim().toLowerCase() === s.toLowerCase());
  }

  trackIndice(i: number): number { return i; }

  async salvar(): Promise<void> {
    const erro = this.validarForm();
    if (erro) { this.erroForm.set(erro); return; }
    this.salvando.set(true);
    this.erroForm.set('');
    try {
      const proximaOrdem = Math.max(0, ...this.planos().map((p) => p.ordem)) + 1;
      await this.svc.salvarPlano(this.editandoId, this.form, proximaOrdem);
      this.modalAberto.set(false);
      this.mostrarAviso('ok', this.editandoId ? 'Plano atualizado.' : 'Plano cadastrado.');
      await this.carregar();
    } catch (e) {
      console.error('Erro ao salvar plano:', e);
      this.erroForm.set('Não foi possível salvar. Verifique sua conexão e as regras do Firestore.');
    } finally {
      this.salvando.set(false);
    }
  }

  private validarForm(): string {
    const f = this.form;
    const nome = f.nome.trim();
    if (nome.length < 2) return 'Dê um nome ao plano (mínimo 2 letras).';
    if (this.planos().some((p) => p.id !== this.editandoId && p.publico === f.publico && p.nome.trim().toLowerCase() === nome.toLowerCase())) {
      return 'Já existe um plano com esse nome para este público.';
    }
    if (f.nivel === 'gratuito' && this.jaExisteGratuito()) return 'Esse público já tem um plano gratuito. Edite o existente.';
    if (f.nivel === 'premium' && !(Number(f.preco) > 0)) return 'Informe um valor maior que zero para o plano pago.';
    if (!f.beneficios.some((b) => b.trim())) return 'Adicione pelo menos um benefício.';
    return '';
  }

  // ---- ativar / desativar ----
  pedirAlternarAtivo(p: Plano): void {
    if (p.nivel === 'gratuito' || this.alterandoId()) return;
    if (p.ativo && (this.ativosPorPlano().get(p.id) || 0) > 0) {
      this.planoParaDesativar.set(p);
      return;
    }
    this.aplicarAtivo(p, !p.ativo);
  }

  confirmarDesativar(): void {
    const p = this.planoParaDesativar();
    this.planoParaDesativar.set(null);
    if (p) this.aplicarAtivo(p, false);
  }

  private async aplicarAtivo(p: Plano, ativo: boolean): Promise<void> {
    this.alterandoId.set(p.id);
    try {
      await this.svc.definirAtivo(p.id, ativo);
      this.planos.update((lista) => lista.map((x) => (x.id === p.id ? { ...x, ativo } : x)));
      this.mostrarAviso('ok', ativo ? `“${p.nome}” ativado: já aparece para os profissionais.` : `“${p.nome}” desativado: novos profissionais não conseguem contratá-lo.`);
    } catch (e) {
      console.error(e);
      this.mostrarAviso('erro', 'Não foi possível alterar o plano agora.');
    } finally {
      this.alterandoId.set(null);
    }
  }

  // ======================= ASSINANTES =======================

  iniciais(nome: string): string {
    return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  }

  rotuloSituacao(s: SituacaoAssinante): string {
    return s === 'ativa' ? 'Ativa' : s === 'cancelada' ? 'Cancelada' : 'Expirada';
  }

  rotuloTipo(t: string): string {
    return rotuloPublico(t);
  }

  rotuloPeriodo(p: Plano): string {
    return this.periodicidades.find((x) => x.valor === p.periodicidade)?.rotulo ?? '';
  }

  limparFiltros(): void {
    this.busca.set('');
    this.filtroPlano.set('todos');
    this.filtroSituacao.set('todas');
  }

  // ======================= AUXILIARES =======================

  private mostrarAviso(tipo: 'ok' | 'erro', texto: string): void {
    this.aviso.set({ tipo, texto });
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => this.aviso.set(null), 5000);
  }

  private formVazio(): PlanoForm {
    return {
      nome: '', descricao: '', publico: 'psicologo', nivel: 'premium', preco: 0, periodicidade: 'mensal',
      beneficios: [''], ativo: true, destaque: false,
    };
  }
}
