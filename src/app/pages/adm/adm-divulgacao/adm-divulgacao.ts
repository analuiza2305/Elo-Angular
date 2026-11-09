import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PERIODICIDADES, formatarBRL, sufixoPeriodicidade } from '../../../services/plano';
import {
  Anuncio, CobrancaDivulgacao, DivulgacaoService, ItemDivulgacao, ItemDivulgacaoForm, MODELOS_DIVULGACAO,
  ModeloDivulgacao, PacoteContratado, POSICOES_ANUNCIO, StatusAnuncio, VISIBILIDADES, rotuloPosicao, rotuloVisibilidade,
} from '../../../services/divulgacao';

type AbaDivulgacao = 'catalogo' | 'contratacoes';
type VisaoContratacoes = 'anuncios' | 'pacotes' | 'cobrancas';

const SUGESTOES_BENEFICIOS: Record<ModeloDivulgacao, string[]> = {
  pacote: [
    'Postagens e eventos aparecem antes dos básicos nas listas',
    'Selo "Em destaque" nas publicações',
    'Primeiras posições nas listas de postagens e eventos',
  ],
  evento: ['Evento aparece antes dos básicos', 'Selo "Em destaque" no evento', 'Evento nas primeiras posições da lista'],
  anuncio: ['Anúncio em um espaço à sua escolha', 'Renovação automática (simulada) até você cancelar'],
};

/**
 * Gerenciamento de divulgação (ADM): pacotes de publicação, divulgação de eventos e anúncios
 * em espaços estratégicos, com controle de duração e recorrência. Pagamentos simulados.
 * Usa o mesmo visual da tela de Planos.
 */
@Component({
  selector: 'app-adm-divulgacao',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './adm-divulgacao.html',
  styleUrls: ['../adm-planos/adm-planos.css'],
  styles: [`
    .pl-situacao.pausado { background: #eef0fb; color: #4b4fa8; }
    .pl-situacao.encerrado { background: #f1eef5; color: #6b6280; }
    .pl-situacao.noar { background: #e9f8f2; color: #1f6f55; }
    .dv-pos-grid { display: grid; gap: 8px; }
    .dv-tag { display: inline-flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #f4efff; color: #5b3d99; }
    .dv-tag.destaque { background: #fff4e0; color: #9a6410; }
    .dv-tag.premium { background: #fdecef; color: #a8283f; }
    .dv-pos-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  `],
})
export class AdmDivulgacaoComponent implements OnInit {
  private readonly svc = inject(DivulgacaoService);

  readonly modelos = MODELOS_DIVULGACAO;
  readonly visibilidades = VISIBILIDADES;
  readonly periodicidades = PERIODICIDADES;
  readonly posicoes = POSICOES_ANUNCIO;
  readonly brl = formatarBRL;
  readonly sufixo = sufixoPeriodicidade;
  readonly rotuloPosicao = rotuloPosicao;
  readonly rotuloVis = rotuloVisibilidade;

  readonly aba = signal<AbaDivulgacao>('catalogo');
  readonly filtroModelo = signal<ModeloDivulgacao>('pacote');
  readonly visao = signal<VisaoContratacoes>('anuncios');
  readonly carregando = signal(true);
  readonly erroCarga = signal('');
  readonly aviso = signal<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  private avisoTimer: any = null;

  readonly itens = signal<ItemDivulgacao[]>([]);
  readonly pacotes = signal<PacoteContratado[]>([]);
  readonly anuncios = signal<Anuncio[]>([]);
  readonly cobrancas = signal<CobrancaDivulgacao[]>([]);

  // ---------- modal de cadastro/edição de item ----------
  readonly modalAberto = signal(false);
  readonly salvando = signal(false);
  readonly erroForm = signal('');
  editandoId: string | null = null;
  form: ItemDivulgacaoForm = this.formVazio('pacote');

  // ---------- modal de ajuste de anúncio ----------
  readonly anuncioEmAjuste = signal<Anuncio | null>(null);
  readonly salvandoAjuste = signal(false);
  ajuste = { status: 'ativo' as StatusAnuncio, fim: '', posicao: '', recorrente: true };

  // ---------- derivados ----------
  readonly itensDoModelo = computed(() => this.itens().filter((i) => i.modelo === this.filtroModelo()));
  readonly catalogoVazio = computed(() => !this.carregando() && !this.erroCarga() && this.itensDoModelo().length === 0);
  readonly rotuloModeloFiltro = computed(() => this.modelos.find((m) => m.valor === this.filtroModelo())?.rotulo ?? '');

  readonly kpis = computed(() => ({
    itensAtivos: this.itens().filter((i) => i.ativo).length,
    pacotesAtivos: this.pacotes().filter((p) => p.situacao === 'ativo').length,
    anunciosNoAr: this.anuncios().filter((a) => a.noAr).length,
    receita: this.cobrancas().reduce((s, c) => s + c.valor, 0),
  }));

  ngOnInit(): void {
    this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    this.erroCarga.set('');
    try {
      const [itens, pacotes, anuncios, cobrancas] = await Promise.all([
        this.svc.itens(), this.svc.todosPacotes(), this.svc.anuncios(), this.svc.cobrancas(),
      ]);
      this.itens.set(itens);
      this.pacotes.set(pacotes);
      this.anuncios.set(anuncios);
      this.cobrancas.set(cobrancas);
    } catch (e) {
      console.error('Erro ao carregar divulgação:', e);
      this.erroCarga.set('Não foi possível carregar a divulgação. Verifique as regras do Firestore (pacotesDivulgacao, pacotesContratados, anuncios e pagamentosPlanos).');
    } finally {
      this.carregando.set(false);
    }
  }

  // ======================= CATÁLOGO =======================

  async criarPadrao(): Promise<void> {
    try {
      await this.svc.criarPadrao(this.filtroModelo());
      this.mostrarAviso('ok', 'Itens padrão criados. Agora é só ajustar valores e benefícios.');
      await this.carregar();
    } catch (e) {
      console.error(e);
      this.mostrarAviso('erro', 'Não foi possível criar os itens padrão.');
    }
  }

  abrirNovo(): void {
    this.editandoId = null;
    this.form = this.formVazio(this.filtroModelo());
    this.erroForm.set('');
    this.modalAberto.set(true);
  }

  abrirEdicao(i: ItemDivulgacao): void {
    this.editandoId = i.id;
    this.form = {
      modelo: i.modelo, nome: i.nome, descricao: i.descricao, visibilidade: i.visibilidade, preco: i.preco,
      periodicidade: i.periodicidade, duracaoDias: i.duracaoDias, beneficios: [...i.beneficios],
      posicoes: [...i.posicoes], ativo: i.ativo, destaque: i.destaque,
    };
    if (!this.form.beneficios.length) this.form.beneficios = [''];
    this.erroForm.set('');
    this.modalAberto.set(true);
  }

  fecharModal(): void {
    if (this.salvando()) return;
    this.modalAberto.set(false);
  }

  adicionarBeneficio(texto = ''): void {
    if (texto && this.form.beneficios.some((b) => b.trim().toLowerCase() === texto.toLowerCase())) return;
    const ultimo = this.form.beneficios.length - 1;
    if (texto && ultimo >= 0 && !this.form.beneficios[ultimo].trim()) this.form.beneficios[ultimo] = texto;
    else this.form.beneficios = [...this.form.beneficios, texto];
  }

  removerBeneficio(i: number): void {
    this.form.beneficios = this.form.beneficios.filter((_, idx) => idx !== i);
    if (!this.form.beneficios.length) this.form.beneficios = [''];
  }

  sugestoes(): string[] {
    return SUGESTOES_BENEFICIOS[this.form.modelo].filter((s) =>
      !this.form.beneficios.some((b) => b.trim().toLowerCase() === s.toLowerCase()));
  }

  alternarPosicao(valor: string): void {
    this.form.posicoes = this.form.posicoes.includes(valor)
      ? this.form.posicoes.filter((p) => p !== valor)
      : [...this.form.posicoes, valor];
  }

  trackIndice(i: number): number { return i; }

  async salvar(): Promise<void> {
    const erro = this.validarForm();
    if (erro) { this.erroForm.set(erro); return; }
    this.salvando.set(true);
    this.erroForm.set('');
    try {
      const proximaOrdem = Math.max(0, ...this.itens().map((i) => i.ordem)) + 1;
      await this.svc.salvarItem(this.editandoId, this.form, proximaOrdem);
      this.modalAberto.set(false);
      this.mostrarAviso('ok', this.editandoId ? 'Item atualizado.' : 'Item cadastrado.');
      await this.carregar();
    } catch (e) {
      console.error('Erro ao salvar item:', e);
      this.erroForm.set('Não foi possível salvar. Verifique sua conexão e as regras do Firestore.');
    } finally {
      this.salvando.set(false);
    }
  }

  private validarForm(): string {
    const f = this.form;
    const nome = f.nome.trim();
    if (nome.length < 2) return 'Dê um nome ao item (mínimo 2 letras).';
    if (this.itens().some((i) => i.id !== this.editandoId && i.modelo === f.modelo && i.nome.trim().toLowerCase() === nome.toLowerCase())) {
      return 'Já existe um item com esse nome neste tipo.';
    }
    if (!(Number(f.preco) > 0)) return 'Informe um valor maior que zero.';
    if (f.modelo === 'evento' && !(Number(f.duracaoDias) >= 1)) return 'Informe por quantos dias o evento fica em destaque.';
    if (f.modelo === 'anuncio' && !f.posicoes.length) return 'Escolha pelo menos um espaço para o anúncio.';
    if (f.modelo !== 'anuncio' && f.visibilidade === 'basico') return 'O nível Básico é gratuito para todos. Escolha Destaque ou Premium.';
    if (!f.beneficios.some((b) => b.trim())) return 'Adicione pelo menos um benefício.';
    return '';
  }

  async alternarAtivo(i: ItemDivulgacao): Promise<void> {
    try {
      await this.svc.definirAtivo(i.id, !i.ativo);
      this.itens.update((l) => l.map((x) => (x.id === i.id ? { ...x, ativo: !i.ativo } : x)));
      this.mostrarAviso('ok', i.ativo ? `“${i.nome}” desativado: novas contratações ficam bloqueadas.` : `“${i.nome}” ativado: já aparece para as empresas.`);
    } catch (e) {
      console.error(e);
      this.mostrarAviso('erro', 'Não foi possível alterar o item agora.');
    }
  }

  // ======================= CONTRATAÇÕES / ANÚNCIOS =======================

  rotuloSituacaoAnuncio(a: Anuncio): string {
    if (a.status === 'encerrado') return 'Encerrado';
    if (a.status === 'pausado') return 'Pausado';
    return a.noAr ? 'No ar' : 'Vencido';
  }

  classeSituacaoAnuncio(a: Anuncio): string {
    if (a.status === 'encerrado') return 'encerrado';
    if (a.status === 'pausado') return 'pausado';
    return a.noAr ? 'noar' : 'expirada';
  }

  rotuloModelo(m: string): string {
    return this.modelos.find((x) => x.valor === m)?.singular ?? m;
  }

  abrirAjuste(a: Anuncio): void {
    this.anuncioEmAjuste.set(a);
    this.ajuste = {
      status: a.status,
      fim: a.fim ? this.paraInputData(a.fim) : '',
      posicao: a.posicao,
      recorrente: a.recorrente,
    };
  }

  fecharAjuste(): void {
    if (this.salvandoAjuste()) return;
    this.anuncioEmAjuste.set(null);
  }

  async salvarAjuste(): Promise<void> {
    const a = this.anuncioEmAjuste();
    if (!a) return;
    this.salvandoAjuste.set(true);
    try {
      // fim do dia escolhido (horário local)
      const fim = this.ajuste.fim ? new Date(`${this.ajuste.fim}T23:59:59`) : null;
      await this.svc.ajustarAnuncio(a.id, {
        status: this.ajuste.status, fim, posicao: this.ajuste.posicao, recorrente: this.ajuste.recorrente,
      });
      this.anuncioEmAjuste.set(null);
      this.mostrarAviso('ok', 'Anúncio atualizado.');
      await this.carregar();
    } catch (e) {
      console.error(e);
      this.mostrarAviso('erro', 'Não foi possível atualizar o anúncio.');
    } finally {
      this.salvandoAjuste.set(false);
    }
  }

  // ======================= AUXILIARES =======================

  private paraInputData(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private mostrarAviso(tipo: 'ok' | 'erro', texto: string): void {
    this.aviso.set({ tipo, texto });
    clearTimeout(this.avisoTimer);
    this.avisoTimer = setTimeout(() => this.aviso.set(null), 5000);
  }

  private formVazio(modelo: ModeloDivulgacao): ItemDivulgacaoForm {
    return {
      modelo, nome: '', descricao: '', visibilidade: modelo === 'anuncio' ? 'basico' : 'destaque', preco: 0,
      periodicidade: 'mensal', duracaoDias: modelo === 'evento' ? 15 : 30, beneficios: [''],
      posicoes: modelo === 'anuncio' ? POSICOES_ANUNCIO.map((p) => p.valor) : [], ativo: true, destaque: false,
    };
  }
}
