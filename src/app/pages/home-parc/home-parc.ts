import { Component, OnInit, AfterViewInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
  Unsubscribe,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  limit,
  Timestamp,
  onSnapshot,
  orderBy,
  serverTimestamp,
  updateDoc,
  setDoc,
  increment,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';
import { Chart, registerables } from 'chart.js';
import { auth, db } from '../../core/firebase';
import { AlertaService } from '../../core/services/alerta.service';

/**
 * Página do Parceiro (dashboard, calendário, fórum, artigos, relatórios,
 * configurações e perfil).
 *
 * Portado de `front-end/docs/homeParc.html` + `js/home-parc.js` do projeto
 * antigo. Mantivemos a mesma estratégia de manipulação direta do DOM que já
 * foi usada em `home-adv.ts` (em vez de reescrever tudo em bindings Angular
 * idiomáticos), para preservar o comportamento original com o menor risco
 * possível de regressão. Toda a inicialização só roda no browser
 * (isBrowser), porque este projeto usa SSR e nada aqui (document, window,
 * localStorage, Firebase Auth listener) existe do lado do servidor.
 */
@Component({
  selector: 'app-home-parc',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home-parc.html',
  styleUrl: './home-parc.css',
})
export class HomeParc implements OnInit, AfterViewInit, OnDestroy {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly router = inject(Router);
  private readonly alerta = inject(AlertaService);

  private unsubscribeAuth: Unsubscribe | null = null;
  private unsubscribeForumAuth: Unsubscribe | null = null;
  private unsubscribePosts: (() => void) | null = null;

  // Nome do atributo de escopo que o Angular usa (ex: "_ngcontent-abc-c123")
  // para aplicar o CSS deste componente. Guardamos aqui na 1ª vez que
  // achamos, pra não precisar procurar de novo a cada card criado.
  private ngScopeAttr: string | null | undefined = undefined;

  /**
   * "Carimba" um elemento (e todos os filhos dele) criado via
   * document.createElement/innerHTML com o mesmo atributo de escopo que o
   * Angular usa nos elementos do template. Sem isso, elementos montados
   * direto em JS ficam fora do alcance do CSS deste componente (home-parc.css)
   * — foi essa a causa dos cards do fórum e dos artigos aparecendo
   * completamente sem estilo (avatar gigante, texto desalinhado, etc).
   */
  private aplicarEscopoAngular(el: HTMLElement): void {
    if (this.ngScopeAttr === undefined) {
      this.ngScopeAttr = null;
      const anyTemplateEl = document.querySelector('.content, .header, .sidebar') as HTMLElement | null;
      if (anyTemplateEl) {
        for (let i = 0; i < anyTemplateEl.attributes.length; i++) {
          const nome = anyTemplateEl.attributes[i].name;
          if (nome.startsWith('_ngcontent')) { this.ngScopeAttr = nome; break; }
        }
      }
    }
    if (!this.ngScopeAttr) return;
    const attr = this.ngScopeAttr;
    const marcar = (node: Element) => {
      node.setAttribute(attr, '');
      Array.from(node.children).forEach(marcar);
    };
    marcar(el);
  }

  /**
   * Liga o botão de tema (id="theme-toggle") do header desta página.
   * Antes ele não fazia nada — a lógica de trocar claro/escuro vivia só
   * dentro do <app-header> compartilhado, que esta página não usa (tem seu
   * próprio header fixo no HTML). Segue o mesmo padrão das outras telas:
   * guarda a preferência em localStorage e aplica via atributo data-theme
   * no <body>, que é o que o CSS (:host-context([data-theme="dark"])) espera.
   */
  private inicializarTema(): void {
    const salvo = localStorage.getItem('theme');
    const escuro = salvo === 'dark';
    this.aplicarTema(escuro);

    const btn = document.getElementById('theme-toggle');
    btn?.addEventListener('click', () => {
      const estaEscuro = document.body.getAttribute('data-theme') === 'dark';
      this.aplicarTema(!estaEscuro);
    });
  }

  private aplicarTema(escuro: boolean): void {
    document.body.setAttribute('data-theme', escuro ? 'dark' : 'light');
    localStorage.setItem('theme', escuro ? 'dark' : 'light');
    const icone = document.getElementById('theme-toggle-icon');
    icone?.classList.toggle('fa-moon', !escuro);
    icone?.classList.toggle('fa-sun', escuro);
  }

  // ---- estado que antes eram variáveis soltas no topo do arquivo js ----
  private nomeEmpresaAtual = '';
  private uidAtual: string | null = null;
  // ID real do documento do parceiro na coleção 'parceiros'. Para cadastros
  // feitos ANTES da correção do cadastro (que usava addDoc — ID aleatório,
  // diferente do uid), esse ID pode ser diferente de uidAtual. Usamos esse
  // campo (em vez de uidAtual) em toda leitura/escrita no documento do
  // parceiro, para funcionar tanto com contas antigas quanto novas.
  private parceiroDocId: string | null = null;
  private dadosParceiroAtual: any = null;
  private itemParaExcluir: string | null = null;
  private tipoParaExcluir = '';

  private notificacoesCache: any[] = [];
  private filtroNotifAtual = 'todos';

  private eventosParceiro: any[] = [];
  private currentMonth = new Date().getMonth();
  private currentYear = new Date().getFullYear();
  private diaSelecionado: Date | null = null;

  private chartsInstanciados: Record<string, Chart | undefined> = {};

  private confirmModal: HTMLDivElement | null = null;

  private readonly TIPO_LABEL: Record<string, string> = {
    psicologo: 'Psicólogo',
    apoio: 'Apoio',
    oficinas: 'Oficinas',
    juridico: 'Jurídico',
  };

  private readonly CATEGORIA_COR: Record<string, string> = {
    legislativos: '#e63946',
    educacionais: '#1d3557',
    dicas: '#2a9d8f',
    posts: '#6a4c93',
  };

  ngOnInit(): void {
    if (this.isBrowser) {
      Chart.register(...registerables);
    }
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.initPagina();
  }

  ngOnDestroy(): void {
    this.observadorDinamico?.disconnect();
    this.unsubscribeComentarios?.();
    this.unsubscribeAuth?.();
    this.unsubscribeForumAuth?.();
    this.unsubscribePosts?.();
  }

  // =============================================================
  // INICIALIZAÇÃO GERAL
  // =============================================================
  private initPagina(): void {
    this.inicializarTema();

    this.confirmModal = document.createElement('div');
    this.confirmModal.className = 'modal hidden';
    this.confirmModal.innerHTML = `
      <div class="modal-content" style="max-width:400px;text-align:center;">
        <h3>Tem certeza que deseja excluir?</h3>
        <p>Essa ação não pode ser desfeita.</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:15px;">
          <button id="confirmDelete" style="background:#d9534f;">Excluir</button>
          <button id="cancelDelete" style="background:#aaa;">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.confirmModal);
    this.confirmModal.querySelector('#confirmDelete')?.addEventListener('click', () => this.confirmarExclusao());
    this.confirmModal.querySelector('#cancelDelete')?.addEventListener('click', () => {
      this.confirmModal?.classList.add('hidden');
      this.itemParaExcluir = null;
    });

    // Fecha qualquer modal ao clicar fora do conteúdo (backdrop) ou pressionar Esc
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains('modal') && !target.classList.contains('hidden')) {
        target.classList.add('hidden');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
      }
    });

    // Navegação por seções (sidebar)
    document.querySelectorAll('[data-target]').forEach((el) => {
      el.addEventListener('click', () => this.goToSection(el.getAttribute('data-target') || ''));
    });

    // Dropdown "Olá, Parceiro"
    document.getElementById('headerUserMenuToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('headerUserMenu')?.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      document.getElementById('headerUserMenu')?.classList.add('hidden');
    });

    this.initSidebarToggle();
    this.observarConteudoDinamico();
    this.initAuth();
    this.initArtigos();
    this.initEventos();
    this.configurarTecladoModais();
    this.initNavegacaoPorTab();
    this.initRelatorios();
    this.initConfiguracoes();
    this.initExclusaoConta();
    this.initForumParceiro();

    (window as any).prevMonth = () => this.prevMonth();
    (window as any).nextMonth = () => this.nextMonth();
    (window as any).onMonthChange = () => this.onMonthChange();
    (window as any).onYearChange = () => this.onYearChange();
  }

  /** Sidebar como lista de abas: TAB entra na lista, ↑/↓/Home/End trocam de item. */
  private observadorDinamico: MutationObserver | null = null;

  /**
   * Tudo que é montado via innerHTML (notificações, listas do dashboard, eventos do dia,
   * perfil...) nasce SEM o atributo de escopo do Angular e, por isso, fica sem o CSS do
   * componente. Este observador carimba cada elemento novo assim que ele entra na página.
   */
  private observarConteudoDinamico(): void {
    const host = document.querySelector('app-home-parc');
    if (!host || this.observadorDinamico) return;
    this.observadorDinamico = new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeType === 1) this.aplicarEscopoAngular(n as HTMLElement);
      }));
    });
    this.observadorDinamico.observe(host, { childList: true, subtree: true });
  }

  private initNavegacaoPorTab(): void {
    const botoes = Array.from(document.querySelectorAll<HTMLElement>('#parceiroSidebar .menu-btn[data-target]'));
    botoes.forEach((b) => (b.tabIndex = b.classList.contains('active') ? 0 : -1));
    botoes.forEach((b, i) => {
      b.addEventListener('keydown', (e) => {
        let alvo = -1;
        if (e.key === 'ArrowDown') alvo = (i + 1) % botoes.length;
        else if (e.key === 'ArrowUp') alvo = (i - 1 + botoes.length) % botoes.length;
        else if (e.key === 'Home') alvo = 0;
        else if (e.key === 'End') alvo = botoes.length - 1;
        if (alvo < 0) return;
        e.preventDefault();
        botoes[alvo].focus();
        botoes[alvo].click();
      });
    });
  }

  private initSidebarToggle(): void {
    const menuBtn = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('parceiroSidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!menuBtn || !sidebar || !overlay) return;

    const openSidebar = () => {
      sidebar.classList.add('active');
      overlay.classList.add('active');
      overlay.classList.remove('hidden');
      menuBtn.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden';
    };
    const closeSidebar = () => {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
      overlay.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
    };

    menuBtn.addEventListener('click', () => {
      if (sidebar.classList.contains('active')) closeSidebar();
      else openSidebar();
    });
    overlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') closeSidebar();
    });
    sidebar.querySelectorAll('.menu-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
      });
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeSidebar();
    });
  }

  private goToSection(targetId: string): void {
    const target = document.getElementById(targetId);
    if (!target) return;

    document.querySelectorAll('.menu-btn').forEach((b) => {
      const ativo = b.getAttribute('data-target') === targetId;
      b.classList.toggle('active', ativo);
      b.setAttribute('aria-selected', String(ativo));
      (b as HTMLElement).tabIndex = ativo ? 0 : -1;
    });
    document.querySelectorAll('.content').forEach((c) => c.classList.add('hidden'));
    target.classList.remove('hidden');
    document.getElementById('headerUserMenu')?.classList.add('hidden');

    if (targetId === 'artigos') this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
    if (targetId === 'notificacoes') this.abrirNotificacoes();
    if (targetId === 'relatorios') this.carregarRelatorios();
    if (targetId === 'configuracoes') this.carregarConfiguracoes();
    if (targetId === 'perfil') this.carregarPerfil();
  }

  // =============================================================
  // HELPERS
  // =============================================================
  private sanitize(str: string | null | undefined): string {
    return (str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private nomeExibicao(dados: any): string {
    const fantasia = (dados?.['nomeFantasia'] || '').trim();
    if (fantasia) return fantasia;
    // 'nome' cobre cadastros antigos, que nunca chegaram a salvar 'nomeEmpresa'.
    return dados?.['nomeEmpresa'] || dados?.['nome'] || 'Parceiro';
  }

  private tempoRelativo(data: Date | null | undefined): string {
    if (!data) return '';
    const agora = new Date();
    const diffMs = agora.getTime() - data.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `há ${diffD} dia${diffD > 1 ? 's' : ''}`;
    return data.toLocaleDateString('pt-BR');
  }

  private toDate(v: any): Date {
    if (!v) return new Date(0);
    if (v.toDate) return v.toDate();
    return new Date(v);
  }

  // =============================================================
  // Resolve o documento do parceiro na coleção 'parceiros' para um dado
  // uid. Tenta primeiro pelo caminho novo (ID do documento == uid, criado
  // via setDoc). Se não achar, cai para uma busca pelo campo 'uid' dentro
  // da coleção — cobre contas cadastradas antes da correção do fluxo de
  // cadastro, cujo documento tem um ID aleatório (gerado por addDoc).
  // =============================================================
  private async resolverDocParceiro(uid: string): Promise<{ id: string; data: any } | null> {
    const docRefNovo = doc(db, 'parceiros', uid);
    const snapNovo = await getDoc(docRefNovo);
    if (snapNovo.exists()) {
      return { id: snapNovo.id, data: snapNovo.data() };
    }

    const q = query(collection(db, 'parceiros'), where('uid', '==', uid), limit(1));
    const snapLegado = await getDocs(q);
    if (!snapLegado.empty) {
      const d = snapLegado.docs[0];
      return { id: d.id, data: d.data() };
    }

    return null;
  }

  private setText(id: string, value: string | number): void {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  private setValue(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = value;
  }

  // =============================================================
  // AUTENTICAÇÃO / DADOS DO PARCEIRO
  // =============================================================
  private initAuth(): void {
    this.unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        this.router.navigate(['/login-profissional']);
        return;
      }
      this.uidAtual = user.uid;

      const heroBoasVindas = document.getElementById('heroBoasVindas');
      const headerAvatar = document.getElementById('headerAvatar') as HTMLImageElement | null;
      const sidebarAvatar = document.getElementById('sidebarAvatar') as HTMLImageElement | null;
      const sidebarNomeEmpresa = document.getElementById('sidebarNomeEmpresa');

      try {
        const encontrado = await this.resolverDocParceiro(user.uid);

        if (encontrado) {
          this.parceiroDocId = encontrado.id;
          this.dadosParceiroAtual = encontrado.data;
          this.nomeEmpresaAtual = this.dadosParceiroAtual['nomeEmpresa'] || this.dadosParceiroAtual['nome'] || 'Parceiro';
          if (heroBoasVindas) {
            heroBoasVindas.innerHTML = `Olá, ${this.sanitize(this.nomeExibicao(this.dadosParceiroAtual))}! <img src="./img/selinho-ver.svg" class="verificado-icon" alt="Parceiro verificado" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex:0 0 24px;margin:0;">`;
          }
          if (this.dadosParceiroAtual['fotoURL'] && headerAvatar) headerAvatar.src = this.dadosParceiroAtual['fotoURL'];
          if (this.dadosParceiroAtual['fotoURL'] && sidebarAvatar) sidebarAvatar.src = this.dadosParceiroAtual['fotoURL'];
          if (sidebarNomeEmpresa) sidebarNomeEmpresa.textContent = this.sanitize(this.nomeExibicao(this.dadosParceiroAtual));

          this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
          await this.carregarEventosParceiro(this.nomeEmpresaAtual);
          await this.carregarDashboardStats();
          await this.carregarAtividadeEArtigosRecentes();
          this.atualizarIndicadorNotificacoes();
        } else if (heroBoasVindas) {
          heroBoasVindas.textContent = 'Olá, parceiro!';
        }
      } catch (error) {
        console.error('Erro ao buscar dados da empresa:', error);
        if (heroBoasVindas) heroBoasVindas.textContent = 'Olá!';
      }
    });

    [document.getElementById('logoutBtn'), document.getElementById('menuLogoutBtn')].forEach((btn) => {
      btn?.addEventListener('click', async () => {
        await signOut(auth);
        this.router.navigate(['/login-profissional']);
      });
    });
  }

  // =============================================================
  // DASHBOARD — CARDS DE ESTATÍSTICA
  // =============================================================
  private async carregarDashboardStats(): Promise<void> {
    try {
      const artigosSnap = await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', this.nomeEmpresaAtual)));
      const totalArtigos = artigosSnap.size;
      const totalPosts = artigosSnap.docs.filter((d) => d.data()['categoria'] === 'posts').length;

      const eventosSnap = await getDocs(query(collection(db, 'eventos'), where('enviadoPor', '==', this.nomeEmpresaAtual)));
      const totalEventos = eventosSnap.size;

      const usuariosSnap = await getDocs(query(collection(db, 'usuarios'), where('tipo', '==', 'mae')));
      const totalMaes = usuariosSnap.size;

      this.setText('statPosts', totalPosts);
      this.setText('statEventos', totalEventos);
      this.setText('statMaes', totalMaes);
      this.setText('statArtigos', totalArtigos);
    } catch (err) {
      console.error('Erro ao carregar estatísticas do dashboard:', err);
    }
  }

  // =============================================================
  // ATIVIDADE (comentários recebidos nos posts do fórum do parceiro)
  // =============================================================
  private async buscarAtividadeDoParceiro(limite = 30): Promise<any[]> {
    if (!this.uidAtual) return [];
    const autorId = 'parc_' + this.uidAtual;

    const postsSnap = await getDocs(query(collection(db, 'posts'), where('autorId', '==', autorId)));
    const atividades: any[] = [];

    for (const postDoc of postsSnap.docs) {
      const post = postDoc.data();
      const comentariosSnap = await getDocs(collection(db, 'posts', postDoc.id, 'comentarios'));
      comentariosSnap.forEach((c) => {
        const com = c.data();
        atividades.push({
          autorNome: com['autorNome'] || 'Usuário',
          postTitulo: post['titulo'] || 'seu post',
          conteudo: com['conteudo'] || '',
          data: com['data']?.toDate ? com['data'].toDate() : new Date(),
        });
      });
    }

    atividades.sort((a, b) => b.data - a.data);
    return atividades.slice(0, limite);
  }

  private async carregarAtividadeEArtigosRecentes(): Promise<void> {
    const lista = document.getElementById('atividadeRecenteList');
    const sidebarLista = document.getElementById('sidebarAtividadeList');

    if (lista || sidebarLista) {
      try {
        const atividades = await this.buscarAtividadeDoParceiro(6);

        if (lista) {
          lista.innerHTML = atividades.length === 0
            ? `<p class="empty-hint">Nenhuma atividade recente ainda.</p>`
            : atividades.map((a) => `
                <div class="dash-item">
                  <div class="dash-item-icon"><i class="fa-regular fa-comment"></i></div>
                  <div class="dash-item-body">
                    <span class="dash-item-title">${this.sanitize(a.autorNome)}</span> comentou em
                    <span class="dash-item-title">${this.sanitize(a.postTitulo)}</span>
                    <div class="dash-item-sub">${this.tempoRelativo(a.data)}</div>
                  </div>
                </div>
              `).join('');
          this.aplicarEscopoAngular(lista);
        }

        if (sidebarLista) {
          const topAtividades = atividades.slice(0, 3);
          sidebarLista.innerHTML = topAtividades.length === 0
            ? `<p class="empty-hint">Nenhuma atividade ainda.</p>`
            : `<ul>${topAtividades.map((a) => `
                <li><strong>${this.sanitize(a.autorNome)}</strong> comentou em <strong>${this.sanitize(a.postTitulo)}</strong> · ${this.tempoRelativo(a.data)}</li>
              `).join('')}</ul>`;
          this.aplicarEscopoAngular(sidebarLista);
        }
      } catch (err) {
        console.error('Erro ao carregar atividade recente:', err);
        if (lista) lista.innerHTML = `<p class="empty-hint">Não foi possível carregar a atividade recente.</p>`;
        if (sidebarLista) sidebarLista.innerHTML = `<p class="empty-hint">Não foi possível carregar.</p>`;
      }
    }

    const artigosLista = document.getElementById('artigosRecentesList');
    if (artigosLista) {
      try {
        const snap = await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', this.nomeEmpresaAtual)));
        const artigos = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
        artigos.sort((a, b) => this.toDate(b['datahorapost']).getTime() - this.toDate(a['datahorapost']).getTime());
        const topArtigos = artigos.slice(0, 3);

        artigosLista.innerHTML = topArtigos.length === 0
          ? `<p class="empty-hint">Você ainda não publicou artigos.</p>`
          : topArtigos.map((a) => `
              <div class="dash-item">
                <img class="dash-item-thumb" src="${this.sanitize(a['img'] || './img/artigo_icon.png')}" alt="">
                <div class="dash-item-body">
                  <div class="dash-item-title">${this.sanitize(a['titulo'])}</div>
                  <div class="dash-item-sub">${this.toDate(a['datahorapost']).toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            `).join('');
        this.aplicarEscopoAngular(artigosLista);
      } catch (err) {
        console.error('Erro ao carregar artigos recentes:', err);
      }
    }
  }

  // =============================================================
  // NOTIFICAÇÕES
  // =============================================================
  private chaveUltimaVisita(): string {
    return `parc_notif_seen_${this.uidAtual}`;
  }

  private getUltimaVisitaNotificacoes(): Date {
    const v = localStorage.getItem(this.chaveUltimaVisita());
    return v ? new Date(v) : new Date(0);
  }

  private chaveContagens(): string {
    return 'parc_notif_counts_' + (this.uidAtual || '');
  }

  private lerContagens(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(this.chaveContagens()) || '{}'); } catch { return {}; }
  }

  /**
   * Engajamento agregado: curtidas nos posts do fórum, favoritos nos artigos e
   * curtidas nos comentários do parceiro. Como o Firestore só guarda totais
   * (não a data de cada curtida), "novo" = total atual − total visto na última visita.
   */
  private async buscarEngajamento(): Promise<any[]> {
    if (!this.uidAtual) return [];
    const uid = this.uidAtual;
    const autorId = 'parc_' + uid;
    const anteriores = this.lerContagens();
    const itens: any[] = [];
    const add = (chave: string, tipo: string, total: number, titulo: string) => {
      if (total <= 0) return;
      itens.push({ tipo, chave, total, novo: Math.max(0, total - (anteriores[chave] || 0)), titulo });
    };

    // 1) curtidas nos posts do fórum
    try {
      const postsSnap = await getDocs(query(collection(db, 'posts'), where('autorId', '==', autorId)));
      postsSnap.forEach((p) => {
        const d = p.data() as any;
        add('like-post:' + p.id, 'like-post', Number(d['likes']) || 0, d['titulo'] || 'seu post');
      });
    } catch (err) { console.warn('Notificações: posts', err); }

    // 2) favoritos nos artigos (a mãe guarda os ids em usuarios/{uid}.favoritos)
    try {
      const artigos = new Map<string, any>();
      const porId = await getDocs(query(collection(db, 'artigos'), where('parceiroId', '==', uid)));
      porId.forEach((d) => artigos.set(d.id, d.data()));
      if (this.nomeEmpresaAtual) {
        const porNome = await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', this.nomeEmpresaAtual)));
        porNome.forEach((d) => artigos.set(d.id, d.data()));
      }
      await Promise.all(Array.from(artigos.entries()).map(async ([id, art]) => {
        try {
          const fav = await getDocs(query(collection(db, 'usuarios'), where('favoritos', 'array-contains', id)));
          add('fav:' + id, 'fav', fav.size, art['titulo'] || 'seu artigo');
        } catch { /* regras do Firestore podem bloquear: ignora */ }
      }));
    } catch (err) { console.warn('Notificações: favoritos', err); }

    // 3) curtidas nos comentários que o parceiro escreveu (últimos 30 posts)
    try {
      const recentes = await getDocs(query(collection(db, 'posts'), orderBy('data', 'desc'), limit(30)));
      await Promise.all(recentes.docs.map(async (p) => {
        try {
          const meus = await getDocs(query(collection(db, 'posts', p.id, 'comentarios'), where('autorId', '==', autorId)));
          let soma = 0;
          meus.forEach((c) => (soma += Number((c.data() as any)['likes']) || 0));
          add('like-com:' + p.id, 'like-com', soma, (p.data() as any)['titulo'] || 'um post');
        } catch { /* ignora */ }
      }));
    } catch (err) { console.warn('Notificações: comentários', err); }

    return itens.sort((a, b) => b.novo - a.novo || b.total - a.total);
  }

  private async atualizarIndicadorNotificacoes(): Promise<void> {
    const dot = document.getElementById('notifDot');
    if (!dot) return;
    try {
      const [atividades, engajamento] = await Promise.all([
        this.buscarAtividadeDoParceiro(10),
        this.buscarEngajamento(),
      ]);
      const ultimaVisita = this.getUltimaVisitaNotificacoes();
      const temNaoLida = atividades.some((a) => a.data > ultimaVisita) || engajamento.some((e) => e.novo > 0);
      dot.classList.toggle('hidden', !temNaoLida);
    } catch (err) {
      console.error('Erro ao verificar notificações:', err);
    }
  }

  private async abrirNotificacoes(): Promise<void> {
    const lista = document.getElementById('notifList');
    if (!lista) return;
    lista.innerHTML = `<div class="loader"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;

    document.querySelectorAll<HTMLElement>('#notifFiltros [data-notif-filter]').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('#notifFiltros [data-notif-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filtroNotifAtual = btn.getAttribute('data-notif-filter') || 'todos';
        this.renderNotificacoes();
      };
    });

    try {
      const [comentarios, engajamento] = await Promise.all([
        this.buscarAtividadeDoParceiro(40),
        this.buscarEngajamento(),
      ]);
      this.notificacoesCache = [
        ...engajamento.map((e) => ({ ...e, categoria: 'engajamento' })),
        ...comentarios.map((c) => ({ ...c, tipo: 'comentario', categoria: 'comentario' })),
      ];
      this.renderNotificacoes();

      // marca como visto: guarda os totais atuais e a hora da visita
      const contagens: Record<string, number> = {};
      engajamento.forEach((e) => (contagens[e.chave] = e.total));
      localStorage.setItem(this.chaveContagens(), JSON.stringify(contagens));
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
      lista.innerHTML = `<p class="empty-hint">Não foi possível carregar as notificações.</p>`;
    }

    // a hora da visita só é gravada depois de renderizar (para os "novos" aparecerem destacados)
    this.ultimaVisitaAnterior = this.getUltimaVisitaNotificacoes();
    localStorage.setItem(this.chaveUltimaVisita(), new Date().toISOString());
    document.getElementById('notifDot')?.classList.add('hidden');
  }

  private ultimaVisitaAnterior: Date | null = null;

  private renderNotificacoes(): void {
    const lista = document.getElementById('notifList');
    if (!lista) return;
    const ultimaVisita = this.ultimaVisitaAnterior ?? this.getUltimaVisitaNotificacoes();
    const ehNovo = (n: any) => (n.categoria === 'engajamento' ? n.novo > 0 : n.data > ultimaVisita);

    const todos = this.notificacoesCache;
    const itens = this.filtroNotifAtual === 'nao-lidos' ? todos.filter(ehNovo) : todos;

    // resumo no topo
    const soma = (tipo: string) => todos.filter((n) => n.tipo === tipo).reduce((t, n) => t + n.total, 0);
    const resumo = `
      <div class="notif-resumo">
        <div class="notif-resumo-item"><i class="fa-solid fa-heart"></i><strong>${soma('like-post') + soma('like-com')}</strong><span>curtidas</span></div>
        <div class="notif-resumo-item"><i class="fa-solid fa-star"></i><strong>${soma('fav')}</strong><span>favoritos</span></div>
        <div class="notif-resumo-item"><i class="fa-solid fa-comment-dots"></i><strong>${todos.filter((n) => n.tipo === 'comentario').length}</strong><span>respostas</span></div>
      </div>`;

    if (itens.length === 0) {
      lista.innerHTML = resumo + `<p class="empty-hint" style="padding:20px;">Nenhuma notificação por aqui.</p>`;
      return;
    }

    const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 pessoa ${um}` : `${n} pessoas ${varios}`);

    lista.innerHTML = resumo + itens.map((n) => {
      const novo = ehNovo(n);
      let icone = 'fa-comment', titulo = '', sub = '', cls = 'tipo-comentario';
      const t = this.sanitize(n.titulo || n.postTitulo);
      if (n.tipo === 'like-post') {
        icone = 'fa-heart'; cls = 'tipo-like';
        titulo = `${plural(n.total, 'curtiu', 'curtiram')} o seu post "${t}"`;
      } else if (n.tipo === 'like-com') {
        icone = 'fa-heart'; cls = 'tipo-like';
        titulo = `${plural(n.total, 'curtiu', 'curtiram')} o seu comentário em "${t}"`;
      } else if (n.tipo === 'fav') {
        icone = 'fa-star'; cls = 'tipo-fav';
        titulo = `${plural(n.total, 'favoritou', 'favoritaram')} o seu artigo "${t}"`;
      } else {
        titulo = `${this.sanitize(n.autorNome)} comentou em "${t}"`;
        sub = n.conteudo ? `“${this.sanitize(String(n.conteudo).slice(0, 110))}”` : '';
      }
      if (n.categoria === 'engajamento') {
        sub = n.novo > 0 ? `+${n.novo} desde a sua última visita` : 'Total até agora';
      } else if (n.data) {
        sub = (sub ? sub + ' · ' : '') + this.tempoRelativo(n.data);
      }
      return `
        <div class="notif-item ${novo ? 'unread' : ''}">
          <div class="notif-avatar ${cls}"><i class="fa-solid ${icone}"></i></div>
          <div class="notif-texto">
            <div class="notif-title">${titulo}</div>
            <div class="notif-sub">${sub}</div>
          </div>
          ${novo ? '<span class="notif-badge-novo">novo</span>' : ''}
        </div>`;
    }).join('');
  }

  // =============================================================
  // ARTIGOS — criação, listagem, filtros e busca
  // =============================================================
  private escopoArtigos: 'meus' | 'comunidade' = 'meus';
  private readonly DRAFT_ARTIGO = 'parc_rascunho_artigo';
  private readonly DRAFT_EVENTO = 'parc_rascunho_evento';
  private ultimoFoco: HTMLElement | null = null;

  /** Abre um modal guardando quem tinha o foco e levando o foco pra dentro (acessível por TAB). */
  private abrirModal(modal: HTMLElement | null): void {
    if (!modal) return;
    this.ultimoFoco = document.activeElement as HTMLElement | null;
    modal.classList.remove('hidden');
    const primeiro = modal.querySelector<HTMLElement>('input, textarea, select, button');
    setTimeout(() => primeiro?.focus(), 30);
  }

  private fecharModal(modal: HTMLElement | null): void {
    if (!modal) return;
    modal.classList.add('hidden');
    this.ultimoFoco?.focus?.();
  }

  /** Esc fecha o modal aberto; TAB fica preso dentro do modal enquanto ele está aberto. */
  private configurarTecladoModais(): void {
    document.addEventListener('keydown', (e) => {
      const aberto = document.querySelector<HTMLElement>('.modal:not(.hidden)');
      if (!aberto) return;
      if (e.key === 'Escape') { this.fecharModal(aberto); return; }
      if (e.key !== 'Tab') return;
      const foc = Array.from(aberto.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null);
      if (!foc.length) return;
      const first = foc[0], last = foc[foc.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // "x" de fechar também responde a Enter/Espaço
    document.querySelectorAll<HTMLElement>('.modal .close').forEach((c) => {
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
      });
    });
  }

  private initArtigos(): void {
    const modal = document.getElementById('postModal');
    const closeModalBtn = document.getElementById('closeModal');
    const postForm = document.getElementById('postForm') as HTMLFormElement | null;
    const postMsg = document.getElementById('postMsg');
    const campos = ['artigoTitulo', 'artigoDescricao', 'resumo', 'img', 'link', 'categoria'];
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

    const atualizarPrevia = () => {
      const cat = val('categoria') || 'posts';
      const img = val('img').trim();
      const imgEl = document.getElementById('prevArtImg') as HTMLImageElement | null;
      const thumb = document.getElementById('prevArtThumb');
      const set = (id: string, t: string) => { const el = document.getElementById(id); if (el) el.textContent = t; };
      set('prevArtTitulo', val('artigoTitulo').trim() || 'Título do artigo');
      set('prevArtDesc', val('artigoDescricao').trim() || 'A descrição aparece aqui.');
      set('prevArtCat', cat);
      set('prevArtData', new Date().toLocaleDateString('pt-BR'));
      const top = document.getElementById('prevArtTopbar');
      if (top) top.style.background = this.CATEGORIA_COR[cat] || '#7a5fe8';
      if (imgEl && thumb) {
        if (img) { imgEl.src = img; imgEl.hidden = false; thumb.style.display = 'none'; imgEl.onerror = () => { imgEl.hidden = true; thumb.style.display = ''; }; }
        else { imgEl.hidden = true; thumb.style.display = ''; }
      }
    };
    const statusRascunho = (msg: string) => { const el = document.getElementById('draftStatusArtigo'); if (el) el.textContent = msg; };

    const carregarRascunho = () => {
      try {
        const raw = localStorage.getItem(this.DRAFT_ARTIGO);
        if (!raw) { statusRascunho(''); return; }
        const d = JSON.parse(raw);
        campos.forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && d[id] != null) el.value = d[id]; });
        statusRascunho('Rascunho recuperado.');
      } catch { /* sem rascunho */ }
    };

    campos.forEach((id) => document.getElementById(id)?.addEventListener('input', atualizarPrevia));
    document.getElementById('categoria')?.addEventListener('change', atualizarPrevia);

    document.getElementById('salvarRascunhoArtigo')?.addEventListener('click', () => {
      const d: Record<string, string> = {};
      campos.forEach((id) => (d[id] = val(id)));
      try { localStorage.setItem(this.DRAFT_ARTIGO, JSON.stringify(d)); statusRascunho('Rascunho salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.'); }
      catch { statusRascunho('Não foi possível salvar o rascunho.'); }
    });

    document.querySelectorAll('.add-post-btn-artigos').forEach((btn) =>
      btn.addEventListener('click', () => { carregarRascunho(); atualizarPrevia(); this.abrirModal(modal); }),
    );
    closeModalBtn?.addEventListener('click', () => this.fecharModal(modal));

    postForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const artigo = {
        titulo: val('artigoTitulo').trim(),
        descricao: val('artigoDescricao').trim(),
        resumo: val('resumo').trim(),
        img: val('img').trim(),
        link: val('link').trim(),
        categoria: val('categoria'),
        postadoPor: this.nomeEmpresaAtual,
        datahorapost: new Date(),
        custoMoedas: 0,
        parceiroId: this.uidAtual,
      };

      try {
        await addDoc(collection(db, 'artigos'), artigo);
        if (postMsg) { postMsg.style.color = 'green'; postMsg.textContent = 'Artigo publicado com sucesso!'; }
        postForm.reset();
        try { localStorage.removeItem(this.DRAFT_ARTIGO); } catch { /* ok */ }
        statusRascunho('');
        this.fecharModal(modal);
        this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
        this.carregarAtividadeEArtigosRecentes();
      } catch (err) {
        console.error('Erro ao criar post:', err);
        if (postMsg) { postMsg.style.color = 'red'; postMsg.textContent = 'Erro ao publicar o artigo.'; }
      }
    });

    document.getElementById('artigos-search-input')?.addEventListener('input', () => this.aplicarBuscaArtigos());

    document.getElementById('qaComunicadoBtn')?.addEventListener('click', () => {
      carregarRascunho();
      const categoriaSelect = document.getElementById('categoria') as HTMLSelectElement | null;
      if (categoriaSelect) categoriaSelect.value = 'posts';
      atualizarPrevia();
      this.abrirModal(modal);
    });

    // abas "Meus artigos" / "Outros parceiros" (setas ← → também funcionam)
    const abas = Array.from(document.querySelectorAll<HTMLElement>('.aba-btn'));
    abas.forEach((aba, i) => {
      aba.addEventListener('click', () => {
        abas.forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); b.tabIndex = -1; });
        aba.classList.add('active'); aba.setAttribute('aria-selected', 'true'); aba.tabIndex = 0;
        this.escopoArtigos = (aba.dataset['escopo'] as 'meus' | 'comunidade') || 'meus';
        this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
      });
      aba.tabIndex = i === 0 ? 0 : -1;
      aba.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const prox = abas[(i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
        prox.focus(); prox.click();
      });
    });
  }

  private async carregarArtigosNaAbaArtigos(nomeEmpresa: string): Promise<void> {
    const articlesGridArtigos = document.getElementById('articlesGridArtigos');
    if (!articlesGridArtigos || !nomeEmpresa) return;

    const comunidade = this.escopoArtigos === 'comunidade';
    const snapshot = comunidade
      ? await getDocs(collection(db, 'artigos'))
      : await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', nomeEmpresa)));

    articlesGridArtigos.innerHTML = '';

    // comunidade = artigos de OUTROS parceiros (os meus ficam na outra aba)
    const docs = snapshot.docs
      .filter((d) => !comunidade || ((d.data() as any)['postadoPor'] !== nomeEmpresa && (d.data() as any)['parceiroId'] !== this.uidAtual))
      .filter((d) => !comunidade || !!(d.data() as any)['postadoPor'])
      .sort((a, b) => this.toDate((b.data() as any)['datahorapost']).getTime() - this.toDate((a.data() as any)['datahorapost']).getTime());

    if (!docs.length) {
      articlesGridArtigos.innerHTML = comunidade
        ? `<p class="empty-hint">Nenhum outro parceiro publicou artigos ainda.</p>`
        : `<p class="empty-hint">Você ainda não publicou nenhum artigo.</p>`;
      return;
    }

    docs.forEach((d) => {
      const art = d.data() as any;
      const cor = this.CATEGORIA_COR[art['categoria']] || '#7a5fe8';
      const dataFormatada = this.toDate(art['datahorapost']).toLocaleDateString('pt-BR');

      const card = document.createElement('div');
      card.className = 'article-card';
      card.setAttribute('data-categoria', art['categoria']);

      card.innerHTML = `
        ${comunidade ? '' : `<button type="button" class="delete-btn" aria-label="Excluir artigo"><i class="fa-solid fa-trash"></i></button>`}
        <div class="card-topbar" style="background:${cor}"></div>
        ${art['img'] ? `<img src="${this.sanitize(art['img'])}" class="article-img" alt="${this.sanitize(art['titulo'])}">` : `<div class="article-thumb"><i class="fa-regular fa-image"></i></div>`}
        <div class="article-body">
          <h3>${this.sanitize(art['titulo'])}</h3>
          <p>${this.sanitize(art['descricao'])}</p>
          <span class="categoria-tag">${this.sanitize(art['categoria'])}</span>
          ${comunidade ? `<span class="autor-tag"><i class="fa-regular fa-building"></i> ${this.sanitize(art['postadoPor'])}</span>` : ''}
          <div class="article-card-footer">
            <span class="article-card-date">${dataFormatada}</span>
            <button type="button" class="article-card-ver">Ver →</button>
          </div>
        </div>
      `;

      this.aplicarEscopoAngular(card);

      card.querySelector('.delete-btn')?.addEventListener('click', () => {
        this.itemParaExcluir = d.id;
        this.tipoParaExcluir = 'artigo';
        this.confirmModal?.classList.remove('hidden');
      });

      if (art['link']) {
        card.querySelector('.article-card-ver')?.addEventListener('click', () => window.open(art['link'], '_blank'));
      }

      articlesGridArtigos.appendChild(card);
    });

    this.configurarFiltrosArtigos();
    this.aplicarBuscaArtigos();
  }

  private configurarFiltrosArtigos(): void {
    const botoes = document.querySelectorAll('.filtro-btn');
    botoes.forEach((btn) => {
      (btn as HTMLElement).onclick = () => {
        botoes.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.aplicarBuscaArtigos();
      };
    });
  }

  private aplicarBuscaArtigos(): void {
    const categoriaAtiva = document.querySelector('.filtro-btn.active')?.getAttribute('data-cat') || 'todas';
    const termo = ((document.getElementById('artigos-search-input') as HTMLInputElement)?.value || '').toLowerCase();

    document.querySelectorAll('#articlesGridArtigos .article-card').forEach((card) => {
      const cardCat = card.getAttribute('data-categoria');
      const titulo = card.querySelector('h3')?.textContent?.toLowerCase() || '';
      const bateCategoria = categoriaAtiva === 'todas' || categoriaAtiva === cardCat;
      const bateTermo = !termo || titulo.includes(termo);
      (card as HTMLElement).style.display = bateCategoria && bateTermo ? 'flex' : 'none';
    });
  }

  // =============================================================
  // EVENTOS / CALENDÁRIO
  // =============================================================
  private initEventos(): void {
    const eventModal = document.getElementById('eventModal');
    const closeEventModal = document.getElementById('closeEventModal');
    const eventForm = document.getElementById('eventForm') as HTMLFormElement | null;
    const eventMsg = document.getElementById('eventMsg');
    const campos = ['tituloEvento', 'descricaoEvento', 'dataEvento', 'localEvento', 'capaEvento', 'tipoEvento'];
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
    const status = (msg: string) => { const el = document.getElementById('draftStatusEvento'); if (el) el.textContent = msg; };

    const atualizarPrevia = () => {
      const set = (id: string, t: string) => { const el = document.getElementById(id); if (el) el.textContent = t; };
      const tipo = val('tipoEvento') || 'psicologo';
      const nomesTipo: Record<string, string> = { psicologo: 'psicólogo', apoio: 'apoio', oficinas: 'oficinas', juridico: 'jurídico' };
      set('prevEvTitulo', val('tituloEvento').trim() || 'Título do evento');
      set('prevEvDesc', val('descricaoEvento').trim() || 'A descrição aparece aqui.');
      set('prevEvLocal', val('localEvento').trim() || 'Local do evento');
      const d = val('dataEvento');
      set('prevEvData', d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }) : 'Escolha a data');
      const tag = document.getElementById('prevEvTipo');
      if (tag) { tag.textContent = nomesTipo[tipo]; tag.className = 'evento-tipo-tag tipo-' + tipo; }
    };

    const carregarRascunho = () => {
      try {
        const raw = localStorage.getItem(this.DRAFT_EVENTO);
        if (!raw) { status(''); return; }
        const d = JSON.parse(raw);
        campos.forEach((id) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && d[id] != null) el.value = d[id]; });
        status('Rascunho recuperado.');
      } catch { /* sem rascunho */ }
    };

    campos.forEach((id) => {
      document.getElementById(id)?.addEventListener('input', atualizarPrevia);
      document.getElementById(id)?.addEventListener('change', atualizarPrevia);
    });

    document.getElementById('salvarRascunhoEvento')?.addEventListener('click', () => {
      const d: Record<string, string> = {};
      campos.forEach((id) => (d[id] = val(id)));
      try { localStorage.setItem(this.DRAFT_EVENTO, JSON.stringify(d)); status('Rascunho salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.'); }
      catch { status('Não foi possível salvar o rascunho.'); }
    });

    document.querySelectorAll('.add-event-btn').forEach((btn) =>
      btn.addEventListener('click', () => { carregarRascunho(); atualizarPrevia(); this.abrirModal(eventModal); }),
    );
    closeEventModal?.addEventListener('click', () => this.fecharModal(eventModal));

    eventForm?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const evento = {
        titulo: val('tituloEvento').trim(),
        descricao: val('descricaoEvento').trim(),
        data: Timestamp.fromDate(new Date(val('dataEvento'))),
        local: val('localEvento').trim(),
        capa: val('capaEvento').trim(),
        tipo: val('tipoEvento'),
        enviadoPor: this.nomeEmpresaAtual,
        parceiroId: this.uidAtual,
      };

      try {
        await addDoc(collection(db, 'eventos'), evento);
        if (eventMsg) { eventMsg.style.color = 'green'; eventMsg.textContent = 'Evento criado com sucesso!'; }
        eventForm.reset();
        try { localStorage.removeItem(this.DRAFT_EVENTO); } catch { /* ok */ }
        status('');
        this.fecharModal(eventModal);
        await this.carregarEventosParceiro(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
      } catch (err) {
        console.error('Erro ao criar evento:', err);
        if (eventMsg) { eventMsg.style.color = 'red'; eventMsg.textContent = 'Erro ao criar evento.'; }
      }
    });
  }

  private async carregarEventosParceiro(nomeEmpresa: string): Promise<void> {
    if (!nomeEmpresa && !this.uidAtual) return;

    // Busca por parceiroId (estável) e por enviadoPor (nome exibido, usado nos eventos
    // antigos criados antes de existir o parceiroId). Combina os dois resultados para
    // não perder eventos publicados antes de uma eventual troca de nome do parceiro.
    const consultas: Promise<QuerySnapshot<DocumentData>>[] = [];
    if (this.uidAtual) {
      consultas.push(getDocs(query(collection(db, 'eventos'), where('parceiroId', '==', this.uidAtual))));
    }
    if (nomeEmpresa) {
      consultas.push(getDocs(query(collection(db, 'eventos'), where('enviadoPor', '==', nomeEmpresa))));
    }

    const snaps = await Promise.all(consultas);
    const eventosPorId = new Map<string, any>();
    snaps.forEach((snap) => {
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        eventosPorId.set(docSnap.id, {
          id: docSnap.id,
          ...data,
          data: data['data']?.toDate ? data['data'].toDate() : new Date(data['data']),
        });
      });
    });

    this.eventosParceiro = Array.from(eventosPorId.values());
    this.inicializarSelects();
    this.renderCalendar();
    this.renderProximosEventosDashboard();
  }

  private inicializarSelects(): void {
    const monthSelect = document.getElementById('month-select') as HTMLSelectElement | null;
    const yearSelect = document.getElementById('year-select') as HTMLSelectElement | null;
    if (!monthSelect || !yearSelect) return;

    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    if (monthSelect.options.length === 0) {
      months.forEach((m, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = m;
        monthSelect.appendChild(opt);
      });
      const year = new Date().getFullYear();
      for (let y = year - 2; y <= year + 3; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect.appendChild(opt);
      }
    }
    this.atualizarSelects();
  }

  private atualizarSelects(): void {
    const monthSelect = document.getElementById('month-select') as HTMLSelectElement | null;
    const yearSelect = document.getElementById('year-select') as HTMLSelectElement | null;
    if (!monthSelect || !yearSelect) return;
    monthSelect.value = String(this.currentMonth);
    yearSelect.value = String(this.currentYear);
    this.renderCalendar();
  }

  private prevMonth(): void {
    this.currentMonth--;
    if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
    this.atualizarSelects();
  }

  private nextMonth(): void {
    this.currentMonth++;
    if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
    this.atualizarSelects();
  }

  private onMonthChange(): void {
    this.currentMonth = parseInt((document.getElementById('month-select') as HTMLSelectElement).value, 10);
    this.renderCalendar();
  }

  private onYearChange(): void {
    this.currentYear = parseInt((document.getElementById('year-select') as HTMLSelectElement).value, 10);
    this.renderCalendar();
  }

  private corDoTipo(tipo: string): string {
    return ({ psicologo: '#2d2d7a', apoio: '#e0524f', oficinas: '#4caf6b', juridico: '#37c1d1' } as Record<string, string>)[tipo] || '#7a5fe8';
  }

  private renderCalendar(): void {
    const calendarDates = document.getElementById('calendarDates');
    if (!calendarDates) return;

    const today = new Date();
    const firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
    const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();

    calendarDates.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.classList.add('empty');
      calendarDates.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateDiv = document.createElement('div');
      dateDiv.classList.add('date');

      const current = new Date(this.currentYear, this.currentMonth, d);
      if (current.toDateString() === today.toDateString()) dateDiv.classList.add('today');
      if (current < today && current.toDateString() !== today.toDateString()) dateDiv.classList.add('past');

      const eventosDia = this.eventosParceiro.filter(
        (ev) => ev.data.getDate() === d && ev.data.getMonth() === this.currentMonth && ev.data.getFullYear() === this.currentYear,
      );

      dateDiv.textContent = String(d);

      if (eventosDia.length > 0) {
        dateDiv.classList.add('has-event');
        dateDiv.title = eventosDia.map((ev) => ev.titulo).join(', ');
        const dot = document.createElement('span');
        dot.className = `event-dot tipo-${eventosDia[0].tipo || 'apoio'}`;
        dateDiv.appendChild(dot);

        dateDiv.addEventListener('click', () => {
          this.diaSelecionado = current;
          this.renderEventosDoDia(eventosDia, current);
        });
      }

      calendarDates.appendChild(dateDiv);
    }
  }

  private renderEventosDoDia(eventos: any[], dataRef: Date): void {
    const titulo = document.getElementById('eventosDoDiaTitulo');
    const lista = document.getElementById('eventosDoDiaList');
    if (!lista) return;

    if (titulo) {
      titulo.textContent = `Eventos do dia — ${dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`;
    }

    const ordenados = [...eventos].sort((a, b) => a.data - b.data);

    lista.innerHTML = ordenados.map((ev) => `
      <div class="event evento-card" style="border-left-color:${this.corDoTipo(ev.tipo)}">
        <div class="evento-card-header">
          <strong>${ev.data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
          <div class="evento-card-actions">
            <span class="evento-tipo-tag tipo-${ev.tipo || 'apoio'}">${this.TIPO_LABEL[ev.tipo] || 'Evento'}</span>
            <div class="delete-btn"><i class="fa-solid fa-trash"></i></div>
          </div>
        </div>
        <p style="margin:4px 0 2px;font-weight:600;">${this.sanitize(ev.titulo)}</p>
        <p style="margin:0;color:#777;">${this.sanitize(ev.local)}</p>
      </div>
    `).join('');

    lista.querySelectorAll('.delete-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        this.itemParaExcluir = ordenados[i].id;
        this.tipoParaExcluir = 'evento';
        this.confirmModal?.classList.remove('hidden');
      });
    });
  }

  private renderProximosEventosDashboard(): void {
    const lista = document.getElementById('proximosEventosList');
    if (!lista) return;

    const agora = new Date();
    const proximos = this.eventosParceiro.filter((ev) => ev.data >= agora).sort((a, b) => a.data - b.data).slice(0, 3);

    lista.innerHTML = proximos.length === 0
      ? `<p class="empty-hint">Nenhum evento futuro cadastrado.</p>`
      : proximos.map((ev) => `
          <div class="dash-item">
            <div class="dash-item-icon"><i class="fa-regular fa-calendar"></i></div>
            <div class="dash-item-body">
              <div class="dash-item-title">${this.sanitize(ev.titulo)}</div>
              <div class="dash-item-sub">${ev.data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} • ${this.sanitize(ev.local)}</div>
            </div>
          </div>
        `).join('');
  }

  // =============================================================
  // CONFIRMAÇÃO DE EXCLUSÃO (artigos/eventos)
  // =============================================================
  private async confirmarExclusao(): Promise<void> {
    if (!this.itemParaExcluir) return;
    try {
      if (this.tipoParaExcluir === 'artigo') {
        await deleteDoc(doc(db, 'artigos', this.itemParaExcluir));
        this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
        this.carregarAtividadeEArtigosRecentes();
      } else if (this.tipoParaExcluir === 'evento') {
        await deleteDoc(doc(db, 'eventos', this.itemParaExcluir));
        await this.carregarEventosParceiro(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
        const listaDia = document.getElementById('eventosDoDiaList');
        if (listaDia) listaDia.innerHTML = `<p class="empty-hint">Selecione um dia com evento para ver os detalhes.</p>`;
      }
    } catch (err) {
      console.error('Erro ao excluir:', err);
    } finally {
      this.confirmModal?.classList.add('hidden');
      this.itemParaExcluir = null;
      this.tipoParaExcluir = '';
    }
  }

  // =============================================================
  // RELATÓRIOS
  // =============================================================
  private ultimosNMeses(n: number): { label: string; mes: number; ano: number }[] {
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const arr: { label: string; mes: number; ano: number }[] = [];
    const hoje = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      arr.push({ label: nomes[d.getMonth()], mes: d.getMonth(), ano: d.getFullYear() });
    }
    return arr;
  }

  private initRelatorios(): void {
    document.getElementById('exportarRelatorioBtn')?.addEventListener('click', () => {
      const linhas = [
        ['Métrica', 'Valor'],
        ['Artigos publicados', document.getElementById('repArtigos')?.textContent || '0'],
        ['Eventos realizados', document.getElementById('repEventos')?.textContent || '0'],
        ['Participantes alcançados', document.getElementById('repParticipantes')?.textContent || '0'],
        ['Novos membros', document.getElementById('repNovosMembros')?.textContent || '0'],
      ];
      const csv = linhas.map((l) => l.join(';')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio_${this.nomeEmpresaAtual || 'parceiro'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  private async carregarRelatorios(): Promise<void> {
    try {
      const artigosSnap = await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', this.nomeEmpresaAtual)));
      const artigos = artigosSnap.docs.map((d) => d.data() as any);

      this.setText('repArtigos', artigos.length);
      this.setText('repEventos', this.eventosParceiro.length);

      const postsSnap = await getDocs(query(collection(db, 'posts'), where('autorId', '==', 'parc_' + this.uidAtual)));
      let totalLikes = 0;
      let totalComentarios = 0;
      const comentaristasUnicos = new Set<string>();

      for (const postDoc of postsSnap.docs) {
        const post = postDoc.data() as any;
        totalLikes += post['likes'] || 0;
        const comentariosSnap = await getDocs(collection(db, 'posts', postDoc.id, 'comentarios'));
        totalComentarios += comentariosSnap.size;
        comentariosSnap.forEach((c) => {
          const autorId = (c.data() as any)['autorId'];
          if (autorId) comentaristasUnicos.add(autorId);
        });
      }

      this.setText('repParticipantes', totalLikes + totalComentarios);
      this.setText('repNovosMembros', comentaristasUnicos.size);

      this.renderChartArtigosPorMes(artigos);
      this.renderChartEventosPorMes(this.eventosParceiro);
      this.renderChartParticipacaoForum(postsSnap.size, totalComentarios, totalLikes);
    } catch (err) {
      console.error('Erro ao carregar relatórios:', err);
    }
  }

  private renderChartArtigosPorMes(artigos: any[]): void {
    const canvas = document.getElementById('chartArtigos') as HTMLCanvasElement | null;
    if (!canvas) return;
    const meses = this.ultimosNMeses(6);
    const dados = meses.map((m) => artigos.filter((a) => {
      const d = this.toDate(a['datahorapost']);
      return d.getMonth() === m.mes && d.getFullYear() === m.ano;
    }).length);

    this.chartsInstanciados['artigos']?.destroy();
    this.chartsInstanciados['artigos'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: meses.map((m) => m.label),
        datasets: [{ data: dados, borderColor: '#7a5fe8', backgroundColor: 'rgba(122,95,232,0.15)', fill: true, tension: 0.35 }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  private renderChartEventosPorMes(eventos: any[]): void {
    const canvas = document.getElementById('chartEventos') as HTMLCanvasElement | null;
    if (!canvas) return;
    const meses = this.ultimosNMeses(6);
    const dados = meses.map((m) => eventos.filter((ev) => ev.data.getMonth() === m.mes && ev.data.getFullYear() === m.ano).length);

    this.chartsInstanciados['eventos']?.destroy();
    this.chartsInstanciados['eventos'] = new Chart(canvas, {
      type: 'bar',
      data: { labels: meses.map((m) => m.label), datasets: [{ data: dados, backgroundColor: '#f1b93f', borderRadius: 6 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  private renderChartParticipacaoForum(discussoes: number, comentarios: number, curtidas: number): void {
    const canvas = document.getElementById('chartForum') as HTMLCanvasElement | null;
    if (!canvas) return;

    this.chartsInstanciados['forum']?.destroy();
    this.chartsInstanciados['forum'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Discussões', 'Comentários', 'Curtidas'],
        datasets: [{ data: [discussoes, comentarios, curtidas], backgroundColor: ['#7a5fe8', '#bfa8f5', '#e6ddfb'] }],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });
  }

  // =============================================================
  // CONFIGURAÇÕES
  // =============================================================
  private initConfiguracoes(): void {
    document.getElementById('formConfigConta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cfgSalvarMsg');
      try {
        const dadosAtualizados = {
          nomeEmpresa: (document.getElementById('cfgNomeEmpresa') as HTMLInputElement).value.trim(),
          nomeFantasia: (document.getElementById('cfgNomeFantasia') as HTMLInputElement).value.trim(),
          email: (document.getElementById('cfgEmail') as HTMLInputElement).value.trim(),
          telefone: (document.getElementById('cfgTelefone') as HTMLInputElement).value.trim(),
          cidade: (document.getElementById('cfgCidade') as HTMLInputElement).value.trim(),
        };
        await updateDoc(doc(db, 'parceiros', this.parceiroDocId as string), dadosAtualizados);
        if (dadosAtualizados.nomeFantasia) {
          try {
            await updateDoc(doc(db, 'usuarios', this.uidAtual as string), { nome: dadosAtualizados.nomeFantasia });
          } catch (errUsuario) {
            console.error('Erro ao atualizar nome público:', errUsuario);
          }
        }
        this.dadosParceiroAtual = { ...this.dadosParceiroAtual, ...dadosAtualizados };
        this.nomeEmpresaAtual = dadosAtualizados.nomeEmpresa || this.nomeEmpresaAtual;
        const heroBoasVindas = document.getElementById('heroBoasVindas');
        if (heroBoasVindas) {
          heroBoasVindas.innerHTML = `Olá, ${this.sanitize(this.nomeExibicao(this.dadosParceiroAtual))}! <img src="./img/selinho-ver.svg" class="verificado-icon" alt="Parceiro verificado" width="24" height="24" style="width:24px;height:24px;min-width:24px;max-width:24px;flex:0 0 24px;margin:0;">`;
        }
        const perfilNome = document.getElementById('perfilNomeEmpresa');
        if (perfilNome) perfilNome.textContent = this.nomeExibicao(this.dadosParceiroAtual);

        if (msg) { msg.style.color = 'green'; msg.textContent = 'Alterações salvas com sucesso!'; }
      } catch (err) {
        console.error('Erro ao salvar configurações:', err);
        if (msg) { msg.style.color = 'red'; msg.textContent = 'Erro ao salvar alterações.'; }
      }
    });

    document.getElementById('segAlterarSenhaBtn')?.addEventListener('click', async () => {
      try {
        await sendPasswordResetEmail(auth, this.dadosParceiroAtual?.['email'] || auth.currentUser?.email || '');
        this.alerta.sucesso('Confira sua caixa de entrada para redefinir a senha.', 'E-mail enviado!');
      } catch (err) {
        console.error('Erro ao solicitar redefinição de senha:', err);
        this.alerta.erro('Não foi possível enviar o e-mail de redefinição.');
      }
    });

    document.getElementById('segSairContaBtn')?.addEventListener('click', async () => {
      if (!(await this.alerta.confirmar('Você precisará entrar novamente para acessar o painel.', { titulo: 'Sair da conta?', textoOk: 'Sair' }))) return;
      try {
        await signOut(auth);
        this.router.navigate(['/login-profissional']);
      } catch (err) {
        console.error('Erro ao sair da conta:', err);
        this.alerta.erro('Não foi possível sair da conta. Tente novamente.');
      }
    });

    document.getElementById('cfgAlterarFotoBtn')?.addEventListener('click', async () => {
      const url = (await this.alerta.solicitar('Cole a URL da nova foto ou logo da empresa.', { titulo: 'Alterar foto', placeholder: 'https://...', textoOk: 'Salvar' }))?.trim();
      if (!url) return;
      try {
        await updateDoc(doc(db, 'parceiros', this.parceiroDocId as string), { fotoURL: url });
        if (this.dadosParceiroAtual) this.dadosParceiroAtual['fotoURL'] = url;
        const preview = document.getElementById('cfgFotoPreview') as HTMLImageElement | null;
        if (preview) preview.src = url;
        const headerAvatar = document.getElementById('headerAvatar') as HTMLImageElement | null;
        const sidebarAvatar = document.getElementById('sidebarAvatar') as HTMLImageElement | null;
        if (headerAvatar) headerAvatar.src = url;
        if (sidebarAvatar) sidebarAvatar.src = url;
      } catch (err) {
        console.error('Erro ao atualizar foto:', err);
      }
    });
  }

  private carregarConfiguracoes(): void {
    if (!this.dadosParceiroAtual) return;
    this.setValue('cfgNomeEmpresa', this.dadosParceiroAtual['nomeEmpresa'] || '');
    this.setValue('cfgNomeFantasia', this.dadosParceiroAtual['nomeFantasia'] || '');
    this.setValue('cfgEmail', this.dadosParceiroAtual['email'] || '');
    this.setValue('cfgTelefone', this.dadosParceiroAtual['telefone'] || '');
    this.setValue('cfgCidade', this.dadosParceiroAtual['cidade'] || '');

    const foto = this.dadosParceiroAtual['fotoURL'] || './img/logo_icon.png';
    const preview = document.getElementById('cfgFotoPreview') as HTMLImageElement | null;
    if (preview) preview.src = foto;

    const ultimaAlteracao = document.getElementById('segUltimaAlteracaoSenha');
    if (ultimaAlteracao) ultimaAlteracao.textContent = 'Última alteração: não disponível';
  }

  // =============================================================
  // EXCLUSÃO DE CONTA
  // =============================================================
  private initExclusaoConta(): void {
    const excluirContaModal = document.getElementById('excluirContaModal');
    const excluirContaSenhaInput = document.getElementById('excluirContaSenha') as HTMLInputElement | null;
    const excluirContaMsg = document.getElementById('excluirContaMsg');

    const abrirExcluirContaModal = () => {
      if (!excluirContaModal) return;
      if (excluirContaSenhaInput) excluirContaSenhaInput.value = '';
      if (excluirContaMsg) excluirContaMsg.textContent = '';
      excluirContaModal.classList.remove('hidden');
    };
    const fecharExcluirContaModal = () => {
      excluirContaModal?.classList.add('hidden');
    };

    document.getElementById('segExcluirContaBtn')?.addEventListener('click', abrirExcluirContaModal);
    document.getElementById('closeExcluirContaModal')?.addEventListener('click', fecharExcluirContaModal);
    document.getElementById('cancelarExcluirConta')?.addEventListener('click', fecharExcluirContaModal);

    document.getElementById('confirmarExcluirConta')?.addEventListener('click', async () => {
      const senha = excluirContaSenhaInput?.value || '';
      if (!senha) {
        if (excluirContaMsg) { excluirContaMsg.style.color = 'red'; excluirContaMsg.textContent = 'Digite sua senha para confirmar.'; }
        return;
      }
      try {
        const user = auth.currentUser;
        if (!user || !user.email) throw new Error('Usuário não autenticado.');
        const credential = EmailAuthProvider.credential(user.email, senha);
        await reauthenticateWithCredential(user, credential);

        try { await deleteDoc(doc(db, 'parceiros', this.parceiroDocId || user.uid)); } catch (e) { console.warn('Erro ao remover dados de parceiro:', e); }
        try { await deleteDoc(doc(db, 'usuarios', user.uid)); } catch (e) { console.warn('Erro ao remover dados de usuário:', e); }

        await deleteUser(user);

        fecharExcluirContaModal();
        this.alerta.sucesso('Sua conta foi excluída com sucesso.', 'Conta excluída');
        this.router.navigate(['/login-profissional']);
      } catch (err: any) {
        console.error('Erro ao excluir conta:', err);
        if (excluirContaMsg) {
          excluirContaMsg.style.color = 'red';
          excluirContaMsg.textContent = err?.code === 'auth/wrong-password'
            ? 'Senha incorreta. Tente novamente.'
            : 'Não foi possível excluir a conta. Tente novamente.';
        }
      }
    });
  }

  // =============================================================
  // PERFIL / MINHA EMPRESA
  // =============================================================
  private async carregarPerfil(): Promise<void> {
    if (!this.dadosParceiroAtual) return;

    this.setText('perfilNomeEmpresa', this.nomeExibicao(this.dadosParceiroAtual) || 'Empresa parceira');
    this.setText('perfilCidade', this.dadosParceiroAtual['cidade'] || 'Não informado');
    this.setText('perfilSite', this.dadosParceiroAtual['site'] || 'Não informado');
    this.setText('perfilEmail', this.dadosParceiroAtual['email'] || '—');
    this.setText('perfilTelefone', this.dadosParceiroAtual['telefone'] || '—');
    const logo = document.getElementById('perfilLogo') as HTMLImageElement | null;
    if (logo) logo.src = this.dadosParceiroAtual['fotoURL'] || './img/logo_icon.png';

    try {
      const artigosSnap = await getDocs(query(collection(db, 'artigos'), where('postadoPor', '==', this.nomeEmpresaAtual)));
      const artigos = artigosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);

      const postsSnap = await getDocs(query(collection(db, 'posts'), where('autorId', '==', 'parc_' + this.uidAtual)));
      let totalLikes = 0;
      let totalComentarios = 0;
      for (const postDoc of postsSnap.docs) {
        totalLikes += (postDoc.data() as any)['likes'] || 0;
        const comentariosSnap = await getDocs(collection(db, 'posts', postDoc.id, 'comentarios'));
        totalComentarios += comentariosSnap.size;
      }

      this.setText('perfilArtigosCount', artigos.length);
      this.setText('perfilEventosCount', this.eventosParceiro.length);
      this.setText('perfilUsuariasCount', totalLikes + totalComentarios);
      this.setText('perfilForumCount', postsSnap.size);

      artigos.sort((a, b) => this.toDate(b['datahorapost']).getTime() - this.toDate(a['datahorapost']).getTime());
      const listaArtigos = document.getElementById('perfilArtigosList');
      if (listaArtigos) {
        listaArtigos.innerHTML = artigos.slice(0, 3).map((a) => `
          <div class="dash-item">
            <img class="dash-item-thumb" src="${this.sanitize(a['img'] || './img/artigo_icon.png')}" alt="">
            <div class="dash-item-body">
              <span class="categoria-tag">${this.sanitize(a['categoria'])}</span>
              <div class="dash-item-title">${this.sanitize(a['titulo'])}</div>
              <div class="dash-item-sub">${this.toDate(a['datahorapost']).toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
        `).join('') || `<p class="empty-hint">Nenhum artigo publicado ainda.</p>`;
        this.aplicarEscopoAngular(listaArtigos);
      }

      const atividades = await this.buscarAtividadeDoParceiro(4);
      const listaAtividade = document.getElementById('perfilAtividadeList');
      if (listaAtividade) {
        listaAtividade.innerHTML = atividades.map((a) => `
          <div class="dash-item">
            <div class="dash-item-icon"><i class="fa-regular fa-comment"></i></div>
            <div class="dash-item-body">
              <span class="dash-item-title">${this.sanitize(a.autorNome)}</span> comentou em
              <span class="dash-item-title">${this.sanitize(a.postTitulo)}</span>
              <div class="dash-item-sub">${this.tempoRelativo(a.data)}</div>
            </div>
          </div>
        `).join('') || `<p class="empty-hint">Nenhuma atividade recente.</p>`;
        this.aplicarEscopoAngular(listaAtividade);
      }
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
    }
  }

  // =============================================================
  // FÓRUM
  // =============================================================
  private initForumParceiro(): void {
    const postsList = document.getElementById('posts-list');
    const novaBtn = document.getElementById('nova-post-btn');
    const modalForum = document.getElementById('modal-post');
    const formPost = document.getElementById('form-post') as HTMLFormElement | null;
    const cancelarPost = document.getElementById('cancelar-post');
    const closePostModal = document.getElementById('close-post-modal');
    const inputTitulo = modalForum?.querySelector('#titulo') as HTMLInputElement | null;
    const inputConteudo = modalForum?.querySelector('#conteudo') as HTMLTextAreaElement | null;
    const anonimoCheck = modalForum?.querySelector('#anonimo-checkbox') as HTMLInputElement | null;
    const searchInput = document.getElementById('forum-search-input') as HTMLInputElement | null;

    if (!postsList || !modalForum || !formPost || !inputTitulo || !inputConteudo) return;

    let usuarioLogado: any = null;
    let dadosParceiro: any = null;

    this.unsubscribeForumAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      usuarioLogado = user;

      try {
        const encontrado = await this.resolverDocParceiro(user.uid);
        dadosParceiro = encontrado ? encontrado.data : null;
      } catch (err) {
        dadosParceiro = null;
      }

      const q = query(collection(db, 'posts'), orderBy('data', 'desc'));
      this.unsubscribePosts = onSnapshot(q, async (snapshot) => {
        const cards: HTMLDivElement[] = [];
        for (const docSnap of snapshot.docs) {
          const post = docSnap.data() as any;
          const id = docSnap.id;
          const dataFormatada = post['data']?.toDate ? post['data'].toDate().toLocaleString('pt-BR') : 'Agora';
          const isParceiro = post['autorId'] && post['autorId'].startsWith('parc_');

          let comentariosCount = 0;
          try {
            const commentsSnap = await getDocs(collection(db, 'posts', id, 'comentarios'));
            comentariosCount = commentsSnap.size;
          } catch (err) {
            // silencioso: contagem de comentários é best-effort
          }

          const card = document.createElement('div');
          card.className = `post-card com-brilho ${isParceiro ? 'parceiro' : ''}`;
          card.dataset['id'] = id;
          card.innerHTML = `
            <h3 class="post-title">${this.sanitize(post['titulo'])}</h3>
            <div class="post-meta">
              <img src="${this.sanitize(post['autorFoto'] || './img/account_icon.png')}" class="author-avatar" alt="avatar">
              <div>
                <span class="author-name">${this.sanitize(post['autorNome'] || 'Usuário')}</span>
                <span class="post-date">${dataFormatada}</span>
              </div>
            </div>
            <p class="post-content">${this.sanitize(post['conteudo'])}</p>
            <div class="like-wrap" data-id="${id}">
              <img src="./img/like_icon.png" alt="Curtir" class="like-icon">
              <span class="like-count">${post['likes'] || 0}</span>
            </div>
            <div class="post-actions">
              <div class="comments-info" role="button" tabindex="0" aria-label="Ver respostas">
                <img src="./img/consult_icon.png" alt="" class="comment-icon">
                <span class="comment-count" data-id="${id}">${comentariosCount}</span>
              </div>
              <button type="button" class="btn-responder">Responder</button>
              ${usuarioLogado && usuarioLogado.uid === post['autorId'] ? `<button class="delete-btn action-btn" data-id="${id}">Excluir</button>` : ''}
            </div>
          `;
          this.aplicarEscopoAngular(card);
          cards.push(card);
        }
        postsList.innerHTML = '';
        cards.forEach((c) => postsList.appendChild(c));
      });
    });

    const criarPost = async (titulo: string, conteudo: string) => {
      if (!usuarioLogado) { this.alerta.aviso('Você precisa estar logado para postar.', 'Faça login'); return; }
      let autorId: string, autorNome: string, autorFoto: string;
      if (anonimoCheck && anonimoCheck.checked) {
        autorId = 'anonimo'; autorNome = 'Anônimo'; autorFoto = './img/account_icon.png';
      } else if (dadosParceiro) {
        autorId = 'parc_' + usuarioLogado.uid;
        autorNome = dadosParceiro['nomeEmpresa'] || dadosParceiro['nome'] || 'Parceiro';
        autorFoto = './img/logo_icon.png';
      } else {
        const usuarioSnap = await getDoc(doc(db, 'usuarios', usuarioLogado.uid));
        const dadosUsuario = usuarioSnap.exists() ? (usuarioSnap.data() as any) : {};
        autorId = usuarioLogado.uid;
        autorNome = dadosUsuario['nome'] || 'Usuário';
        autorFoto = dadosUsuario['avatar'] || './img/account_icon.png';
      }

      await addDoc(collection(db, 'posts'), {
        autorId, autorNome, autorFoto, titulo, conteudo, likes: 0, data: serverTimestamp(),
      });
      this.carregarDashboardStats();
    };

    [novaBtn].forEach((btn) => btn?.addEventListener('click', () => {
      inputTitulo.value = '';
      inputConteudo.value = '';
      modalForum.classList.remove('hidden');
    }));
    cancelarPost?.addEventListener('click', () => modalForum.classList.add('hidden'));
    closePostModal?.addEventListener('click', () => modalForum.classList.add('hidden'));

    formPost.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titulo = inputTitulo.value.trim();
      const conteudo = inputConteudo.value.trim();
      if (!titulo || !conteudo) { this.alerta.aviso('Preencha o título e o conteúdo do post.', 'Campos obrigatórios'); return; }
      await criarPost(titulo, conteudo);
      modalForum.classList.add('hidden');
    });

    postsList.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest('.post-card') as HTMLElement | null;
      if (!card) return;
      const postId = card.dataset['id'] as string;

      if (target.closest('.comments-info') || target.closest('.btn-responder')) {
        this.abrirComentarios(postId, card, usuarioLogado, dadosParceiro);
        return;
      }

      if (target.classList.contains('like-icon')) {
        e.stopPropagation();
        if (!usuarioLogado) { this.alerta.aviso('É necessário estar logado para curtir.', 'Faça login'); return; }
        const likeWrap = target.closest('.like-wrap') as HTMLElement;
        const countEl = likeWrap.querySelector('.like-count') as HTMLElement;
        const current = parseInt(countEl.textContent || '0', 10) || 0;
        const liked = (target as HTMLImageElement).src.includes('like_curtido.png');
        countEl.textContent = String(liked ? current - 1 : current + 1);
        (target as HTMLImageElement).src = liked ? './img/like_icon.png' : './img/like_curtido.png';

        const likeRef = doc(db, 'posts', postId, 'likes', usuarioLogado.uid);
        try {
          const snap = await getDoc(likeRef);
          if (snap.exists()) {
            await deleteDoc(likeRef);
            await updateDoc(doc(db, 'posts', postId), { likes: increment(-1) });
          } else {
            await setDoc(likeRef, { curtido: true });
            await updateDoc(doc(db, 'posts', postId), { likes: increment(1) });
          }
        } catch (err) { console.error('Erro ao curtir:', err); }
        return;
      }

      if (target.closest('.delete-btn')) {
        if (await this.alerta.confirmar('Esta ação não pode ser desfeita.', { titulo: 'Excluir este post?', textoOk: 'Excluir', perigo: true })) await deleteDoc(doc(db, 'posts', postId));
        return;
      }
    });

    postsList.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('comments-info')) { e.preventDefault(); t.click(); }
    });
    this.initModalComentarios();

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const termo = searchInput.value.toLowerCase();
        document.querySelectorAll('.post-card').forEach((card) => {
          const titulo = card.querySelector('.post-title')?.textContent?.toLowerCase() || '';
          const autor = card.querySelector('.author-name')?.textContent?.toLowerCase() || '';
          (card as HTMLElement).style.display = titulo.includes(termo) || autor.includes(termo) ? 'block' : 'none';
        });
      });
    }

    document.addEventListener('mousemove', (e) => {
      document.querySelectorAll('.post-card.com-brilho').forEach((card) => {
        const rect = card.getBoundingClientRect();
        (card as HTMLElement).style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        (card as HTMLElement).style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
      });
    });
  }

  // =============================================================
  // FÓRUM — responder (mesma coleção posts/{id}/comentarios usada pelas mães e profissionais)
  // =============================================================
  private unsubscribeComentarios: (() => void) | null = null;
  private postAbertoId: string | null = null;
  private postAbertoCard: HTMLElement | null = null;
  private usuarioComentario: any = null;
  private dadosParceiroComentario: any = null;

  private initModalComentarios(): void {
    const modal = document.getElementById('modal-comentarios');
    const fechar = () => {
      this.unsubscribeComentarios?.();
      this.unsubscribeComentarios = null;
      this.postAbertoId = null;
      this.fecharModal(modal);
    };
    document.getElementById('close-comentarios')?.addEventListener('click', fechar);

    const form = document.getElementById('form-comentario') as HTMLFormElement | null;
    const input = document.getElementById('novoComentarioInput') as HTMLTextAreaElement | null;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const texto = (input?.value || '').trim();
      const user = this.usuarioComentario;
      if (!texto || !this.postAbertoId) return;
      if (!user) { this.alerta.aviso('Você precisa estar logado para responder.', 'Faça login'); return; }

      const d = this.dadosParceiroComentario;
      const nome = d ? this.nomeExibicao(d) : (user.displayName || 'Parceiro');
      try {
        await addDoc(collection(db, 'posts', this.postAbertoId, 'comentarios'), {
          autorId: 'parc_' + user.uid,
          autorNome: nome,
          autorFoto: d?.['avatar'] || d?.['fotoURL'] || './img/logo_icon.png',
          conteudo: texto,
          likes: 0,
          data: serverTimestamp(),
        });
        if (input) input.value = '';
      } catch (err) {
        console.error('Erro ao responder:', err);
        this.alerta.erro('Não foi possível enviar sua resposta. Tente novamente.');
      }
    });
  }

  private abrirComentarios(postId: string, card: HTMLElement, user: any, dadosParceiro: any): void {
    const modal = document.getElementById('modal-comentarios');
    const lista = document.getElementById('comentariosLista');
    if (!modal || !lista) return;

    this.usuarioComentario = user;
    this.dadosParceiroComentario = dadosParceiro;
    this.postAbertoId = postId;
    this.postAbertoCard = card;

    const titulo = document.getElementById('comentariosTitulo');
    const conteudo = document.getElementById('comentariosConteudo');
    if (titulo) titulo.textContent = card.querySelector('.post-title')?.textContent || 'Publicação';
    if (conteudo) conteudo.textContent = card.querySelector('.post-content')?.textContent || '';
    lista.innerHTML = '<p class="empty-hint">Carregando respostas...</p>';
    this.abrirModal(modal);

    this.unsubscribeComentarios?.();
    const q = query(collection(db, 'posts', postId, 'comentarios'), orderBy('data', 'asc'));
    // onSnapshot: se uma mãe ou profissional responder agora, aparece aqui na hora
    this.unsubscribeComentarios = onSnapshot(q, (snap) => {
      lista.innerHTML = '';
      if (snap.empty) {
        lista.innerHTML = '<p class="empty-hint">Ninguém respondeu ainda. Seja a primeira pessoa!</p>';
      }
      snap.forEach((c) => {
        const x = c.data() as any;
        const item = document.createElement('div');
        item.className = 'comentario-item';
        const quando = x['data']?.toDate ? x['data'].toDate().toLocaleString('pt-BR') : 'Agora';
        item.innerHTML = `
          <img src="${this.sanitize(x['autorFoto'] || './img/account_icon.png')}" alt="">
          <div>
            <span class="c-nome">${this.sanitize(x['autorNome'] || 'Usuário')}</span><span class="c-data">${quando}</span>
            <p>${this.sanitize(x['conteudo'])}</p>
          </div>`;
        this.aplicarEscopoAngular(item);
        lista.appendChild(item);
      });
      lista.scrollTop = lista.scrollHeight;
      const contador = document.querySelector(`.comment-count[data-id="${postId}"]`);
      if (contador) contador.textContent = String(snap.size);
    });
  }
}
