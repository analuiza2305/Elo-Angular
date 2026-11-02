import { Component, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { onAuthStateChanged, Unsubscribe } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { auth, db } from '../../../core/firebase';
import { formatarBRL, sufixoPeriodicidade } from '../../../services/plano';
import {
  Anuncio, DivulgacaoService, EventoDoParceiro, ItemDivulgacao, PacoteContratado, POSICOES_ANUNCIO,
  Visibilidade, normalizarUrl, rotuloPosicao, rotuloVisibilidade,
} from '../../../services/divulgacao';

type Aviso = { tipo: 'ok' | 'erro'; texto: string };

/**
 * Aba "Divulgação" da empresa parceira (pagamentos simulados, sem cobrança real):
 *  - pacotes de publicação (visibilidade em todos os artigos e eventos);
 *  - divulgação de um evento (cobrança por evento);
 *  - anúncios em espaços estratégicos (cobrança recorrente simulada).
 * Tudo vem do catálogo que a ADM gerencia (DivulgacaoService).
 */
@Component({
  selector: 'app-parc-divulgacao',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './parc-divulgacao.html',
  styleUrls: ['../parc-planos/parc-planos.css'],
  styles: [`
    .dv-secao { margin-top: 44px; }
    .dv-secao > h3 { margin: 0 0 6px; font-size: 1.35rem; color: var(--s-texto); }
    .dv-secao > p { margin: 0 0 20px; color: var(--s-suave); }
    .dv-lista { display: grid; gap: 12px; margin-top: 18px; }
    .dv-linha {
      display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
      background: var(--s-card); border: 1px solid var(--s-borda); border-radius: 18px; padding: 16px 18px; box-shadow: var(--s-sombra);
    }
    .dv-linha strong { color: var(--s-texto); }
    .dv-linha small { display: block; color: var(--s-suave); margin-top: 2px; }
    .dv-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
    .dv-tag { display: inline-flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 800; padding: 3px 10px; border-radius: 999px; background: var(--s-roxo-claro); color: var(--s-roxo); }
    .dv-tag.destaque { background: var(--s-ouro-claro); color: var(--s-ouro); }
    .dv-tag.premium { background: #fdecef; color: #a8283f; }
    .dv-tag.pausado { background: #eef0fb; color: #4b4fa8; }
    .dv-tag.encerrado { background: #f1eef5; color: #6b6280; }
    .dv-painel { margin-top: 16px; background: var(--s-card); border: 1px solid var(--s-borda); border-radius: 18px; padding: 20px; box-shadow: var(--s-sombra); }
    .dv-painel h4 { margin: 0 0 12px; color: var(--s-texto); }
    .dv-form { display: grid; gap: 12px; }
    .dv-form label { display: grid; gap: 5px; font-weight: 700; font-size: .85rem; color: var(--s-rotulo); }
    .dv-form input, .dv-form textarea, .dv-form select {
      font: inherit; padding: 10px 12px; border: 1px solid var(--s-borda); border-radius: 12px; background: var(--s-card); color: var(--s-texto);
    }
    .dv-form textarea { min-height: 70px; resize: vertical; }
    .dv-escolhas { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
    .dv-escolha { text-align: left; font: inherit; cursor: pointer; background: var(--s-card); color: var(--s-texto); border: 2px solid var(--s-borda); border-radius: 14px; padding: 12px 14px; }
    .dv-escolha.sel { border-color: var(--s-roxo); background: var(--s-roxo-claro); }
    .dv-escolha small { display: block; color: var(--s-suave); margin-top: 3px; }
    .dv-vazio { color: var(--s-suave); font-style: italic; }
  `],
})
export class ParcDivulgacaoComponent implements OnInit, OnDestroy {
  private readonly svc = inject(DivulgacaoService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private uid = '';
  private email = '';
  private nomeEmpresa = '';
  private unsubAuth: Unsubscribe | null = null;

  readonly brl = formatarBRL;
  readonly sufixo = sufixoPeriodicidade;
  readonly rotuloPosicao = rotuloPosicao;
  readonly rotuloVis = rotuloVisibilidade;

  readonly carregando = signal(true);
  readonly msg = signal<Aviso | null>(null);
  readonly ocupado = signal(false);

  // catálogo
  readonly pacotesOfertados = signal<ItemDivulgacao[]>([]);
  readonly eventosOfertados = signal<ItemDivulgacao[]>([]);
  readonly anunciosOfertados = signal<ItemDivulgacao[]>([]);

  // o que a empresa já tem
  readonly meusPacotes = signal<PacoteContratado[]>([]);
  readonly meusEventos = signal<EventoDoParceiro[]>([]);
  readonly meusAnuncios = signal<Anuncio[]>([]);

  readonly pacotesAtivos = computed(() => this.meusPacotes().filter((p) => p.situacao === 'ativo'));
  /** Melhor nível que as novas publicações recebem agora. */
  readonly nivelAtual = computed<{ visibilidade: Visibilidade; ate: Date | null }>(() => {
    const melhor = [...this.pacotesAtivos()].sort((a, b) => ordem(b.visibilidade) - ordem(a.visibilidade))[0];
    return melhor ? { visibilidade: melhor.visibilidade, ate: melhor.validoAte } : { visibilidade: 'basico', ate: null };
  });

  // pacote: confirmação inline
  readonly confirmandoPacoteId = signal<string | null>(null);

  // evento: escolher evento + item
  readonly eventoEscolhidoId = signal<string | null>(null);
  readonly itemEventoId = signal<string | null>(null);

  // anúncio: formulário de contratação
  readonly anuncioItem = signal<ItemDivulgacao | null>(null);
  form = { titulo: '', texto: '', imagem: '', link: '', posicao: '' };

  readonly posicoesDoItem = computed(() => {
    const i = this.anuncioItem();
    return POSICOES_ANUNCIO.filter((p) => !i || !i.posicoes.length || i.posicoes.includes(p.valor));
  });

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      this.uid = user.uid;
      this.email = user.email || '';
      await this.carregar();
    });
  }

  ngOnDestroy(): void {
    this.unsubAuth?.();
  }

  private get perfil() {
    return { nome: this.nomeEmpresa, email: this.email };
  }

  private async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      this.nomeEmpresa = await this.lerNomeEmpresa(this.uid);
      // cobrança recorrente simulada: renova (ou encerra) os anúncios que venceram
      try {
        const renovados = await this.svc.processarRecorrencias(this.uid, this.perfil);
        if (renovados) this.msg.set({ tipo: 'ok', texto: `${renovados} anúncio(s) renovado(s) automaticamente (cobrança simulada).` });
      } catch (e) {
        console.warn('Não foi possível processar as renovações', e);
      }
      const [pacotes, eventos, anuncios, meusPacotes, meusEventos, meusAnuncios] = await Promise.all([
        this.svc.itensParaOfertar('pacote'),
        this.svc.itensParaOfertar('evento'),
        this.svc.itensParaOfertar('anuncio'),
        this.svc.pacotesDo(this.uid).catch(() => []),
        this.svc.eventosDo(this.uid, this.nomeEmpresa).catch(() => []),
        this.svc.anuncios(this.uid).catch(() => []),
      ]);
      this.pacotesOfertados.set(pacotes);
      this.eventosOfertados.set(eventos);
      this.anunciosOfertados.set(anuncios);
      this.meusPacotes.set(meusPacotes);
      this.meusEventos.set(meusEventos);
      this.meusAnuncios.set(meusAnuncios);
    } finally {
      this.carregando.set(false);
    }
  }

  /** O cadastro antigo do parceiro tem id aleatório; o novo usa o uid. Tenta os dois. */
  private async lerNomeEmpresa(uid: string): Promise<string> {
    try {
      let dados: any = null;
      const direto = await getDoc(doc(db, 'parceiros', uid));
      if (direto.exists()) dados = direto.data();
      else {
        const legado = await getDocs(query(collection(db, 'parceiros'), where('uid', '==', uid), limit(1)));
        if (!legado.empty) dados = legado.docs[0].data();
      }
      return String(dados?.['nomeEmpresa'] || dados?.['nome'] || '');
    } catch {
      return '';
    }
  }

  dataBR(d: Date | null): string {
    return d ? d.toLocaleDateString('pt-BR') : '—';
  }

  // ======================= PACOTES =======================

  pacoteAtivoDoItem(i: ItemDivulgacao): PacoteContratado | undefined {
    return this.pacotesAtivos().find((p) => p.itemId === i.id);
  }

  async contratarPacote(item: ItemDivulgacao): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.msg.set(null);
    try {
      await this.svc.contratarPacote(this.uid, this.perfil, item);
      this.confirmandoPacoteId.set(null);
      this.meusPacotes.set(await this.svc.pacotesDo(this.uid));
      this.msg.set({ tipo: 'ok', texto: `Pacote ${item.nome} ativado! Suas próximas publicações já saem com esse nível.` });
    } catch (e) {
      console.error(e);
      this.msg.set({ tipo: 'erro', texto: 'Não foi possível ativar o pacote agora. Tente de novo.' });
    } finally {
      this.ocupado.set(false);
    }
  }

  async cancelarPacote(p: PacoteContratado): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.msg.set(null);
    try {
      await this.svc.cancelarPacote(p.id);
      this.meusPacotes.set(await this.svc.pacotesDo(this.uid));
      this.msg.set({ tipo: 'ok', texto: `Pacote ${p.itemNome} cancelado. As próximas publicações voltam ao nível Básico.` });
    } catch (e) {
      console.error(e);
      this.msg.set({ tipo: 'erro', texto: 'Não foi possível cancelar agora. Tente de novo.' });
    } finally {
      this.ocupado.set(false);
    }
  }

  // ======================= EVENTOS =======================

  abrirImpulsionar(e: EventoDoParceiro): void {
    this.eventoEscolhidoId.set(this.eventoEscolhidoId() === e.id ? null : e.id);
    this.itemEventoId.set(this.eventosOfertados()[0]?.id ?? null);
    this.msg.set(null);
  }

  async impulsionar(): Promise<void> {
    const eventoId = this.eventoEscolhidoId();
    const item = this.eventosOfertados().find((i) => i.id === this.itemEventoId());
    if (!eventoId || !item || this.ocupado()) return;
    this.ocupado.set(true);
    this.msg.set(null);
    try {
      const ate = await this.svc.impulsionarEvento(this.uid, this.perfil, eventoId, item);
      this.eventoEscolhidoId.set(null);
      this.meusEventos.set(await this.svc.eventosDo(this.uid, this.nomeEmpresa));
      this.msg.set({ tipo: 'ok', texto: `Evento em ${item.nome.toLowerCase()} até ${ate.toLocaleDateString('pt-BR')}.` });
    } catch (e: any) {
      console.error(e);
      this.msg.set({ tipo: 'erro', texto: e?.message || 'Não foi possível divulgar o evento agora.' });
    } finally {
      this.ocupado.set(false);
    }
  }

  // ======================= ANÚNCIOS =======================

  escolherAnuncio(item: ItemDivulgacao): void {
    this.anuncioItem.set(item);
    this.form = { titulo: '', texto: '', imagem: '', link: '', posicao: this.posicoesDoItem()[0]?.valor ?? '' };
    this.msg.set(null);
  }

  fecharAnuncio(): void {
    this.anuncioItem.set(null);
  }

  async contratarAnuncio(): Promise<void> {
    const item = this.anuncioItem();
    if (!item || this.ocupado()) return;
    const f = this.form;
    if (f.titulo.trim().length < 3) { this.msg.set({ tipo: 'erro', texto: 'Dê um título ao anúncio (mínimo 3 letras).' }); return; }
    if (!f.posicao) { this.msg.set({ tipo: 'erro', texto: 'Escolha o espaço do anúncio.' }); return; }
    const link = normalizarUrl(f.link);
    const imagem = normalizarUrl(f.imagem);
    if (!link) {
      this.msg.set({ tipo: 'erro', texto: link === '' ? 'Informe o link do anúncio: é para onde a mãe vai ao clicar.' : 'O link do anúncio não parece um endereço válido (ex.: https://www.suaempresa.com.br).' });
      return;
    }
    if (imagem === null) { this.msg.set({ tipo: 'erro', texto: 'O link da imagem não parece um endereço válido.' }); return; }
    this.ocupado.set(true);
    this.msg.set(null);
    try {
      await this.svc.contratarAnuncio(this.uid, this.perfil, item, { ...f, link, imagem });
      this.anuncioItem.set(null);
      this.meusAnuncios.set(await this.svc.anuncios(this.uid));
      this.msg.set({ tipo: 'ok', texto: 'Anúncio contratado e no ar! A renovação automática é simulada e pode ser desligada quando quiser.' });
    } catch (e: any) {
      console.error(e);
      this.msg.set({ tipo: 'erro', texto: e?.message || 'Não foi possível contratar o anúncio agora.' });
    } finally {
      this.ocupado.set(false);
    }
  }

  // ---- editar o anúncio já contratado ----
  readonly editandoAnuncioId = signal<string | null>(null);
  edicao = { titulo: '', texto: '', imagem: '', link: '' };

  abrirEdicao(a: Anuncio): void {
    if (this.editandoAnuncioId() === a.id) { this.editandoAnuncioId.set(null); return; }
    this.edicao = { titulo: a.titulo, texto: a.texto, imagem: a.imagem, link: a.link };
    this.editandoAnuncioId.set(a.id);
    this.msg.set(null);
  }

  async salvarEdicao(a: Anuncio): Promise<void> {
    if (this.ocupado()) return;
    const e = this.edicao;
    if (e.titulo.trim().length < 3) { this.msg.set({ tipo: 'erro', texto: 'Dê um título ao anúncio (mínimo 3 letras).' }); return; }
    const link = normalizarUrl(e.link);
    const imagem = normalizarUrl(e.imagem);
    if (!link) {
      this.msg.set({ tipo: 'erro', texto: link === '' ? 'Informe o link do anúncio: é para onde a mãe vai ao clicar.' : 'O link do anúncio não parece um endereço válido (ex.: https://www.suaempresa.com.br).' });
      return;
    }
    if (imagem === null) { this.msg.set({ tipo: 'erro', texto: 'O link da imagem não parece um endereço válido.' }); return; }
    await this.atualizarAnuncio(async () => {
      await this.svc.editarAnuncio(a.id, { titulo: e.titulo, texto: e.texto, imagem, link });
      this.editandoAnuncioId.set(null);
    }, 'Anúncio atualizado. A mudança aparece nas telas em até 2 minutos.');
  }

  rotuloSituacaoAnuncio(a: Anuncio): string {
    if (a.status === 'encerrado') return 'Encerrado';
    if (a.status === 'pausado') return 'Pausado';
    return a.noAr ? 'No ar' : 'Vencido';
  }

  async alternarRecorrencia(a: Anuncio): Promise<void> {
    await this.atualizarAnuncio(() => this.svc.definirRecorrencia(a.id, !a.recorrente),
      a.recorrente ? 'Renovação automática desligada: o anúncio acaba no fim do prazo.' : 'Renovação automática ligada.');
  }

  async alternarPausa(a: Anuncio): Promise<void> {
    const pausar = a.status === 'ativo';
    await this.atualizarAnuncio(() => this.svc.definirStatusAnuncio(a.id, pausar ? 'pausado' : 'ativo'),
      pausar ? 'Anúncio pausado.' : 'Anúncio de volta ao ar.');
  }

  async encerrar(a: Anuncio): Promise<void> {
    await this.atualizarAnuncio(() => this.svc.definirStatusAnuncio(a.id, 'encerrado'), 'Anúncio encerrado.');
  }

  private async atualizarAnuncio(acao: () => Promise<void>, ok: string): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.msg.set(null);
    try {
      await acao();
      this.meusAnuncios.set(await this.svc.anuncios(this.uid));
      this.msg.set({ tipo: 'ok', texto: ok });
    } catch (e) {
      console.error(e);
      this.msg.set({ tipo: 'erro', texto: 'Não foi possível atualizar o anúncio agora.' });
    } finally {
      this.ocupado.set(false);
    }
  }
}

function ordem(v: Visibilidade): number {
  return v === 'premium' ? 2 : v === 'destaque' ? 1 : 0;
}
