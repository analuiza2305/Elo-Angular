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
    this.initAuth();
    this.initArtigos();
    this.initEventos();
    this.initRelatorios();
    this.initConfiguracoes();
    this.initExclusaoConta();
    this.initForumParceiro();

    (window as any).prevMonth = () => this.prevMonth();
    (window as any).nextMonth = () => this.nextMonth();
    (window as any).onMonthChange = () => this.onMonthChange();
    (window as any).onYearChange = () => this.onYearChange();
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
      b.classList.toggle('active', b.getAttribute('data-target') === targetId);
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
            heroBoasVindas.innerHTML = `Olá, ${this.sanitize(this.nomeExibicao(this.dadosParceiroAtual))}! <img src="./img/selinho-ver.svg" class="verificado-icon">`;
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

  private async atualizarIndicadorNotificacoes(): Promise<void> {
    const dot = document.getElementById('notifDot');
    if (!dot) return;
    try {
      const atividades = await this.buscarAtividadeDoParceiro(10);
      const ultimaVisita = this.getUltimaVisitaNotificacoes();
      const temNaoLida = atividades.some((a) => a.data > ultimaVisita);
      dot.classList.toggle('hidden', !temNaoLida);
    } catch (err) {
      console.error('Erro ao verificar notificações:', err);
    }
  }

  private async abrirNotificacoes(): Promise<void> {
    const lista = document.getElementById('notifList');
    if (!lista) return;
    lista.innerHTML = `<div class="loader"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;

    try {
      this.notificacoesCache = await this.buscarAtividadeDoParceiro(40);
      this.renderNotificacoes();
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
      lista.innerHTML = `<p class="empty-hint">Não foi possível carregar as notificações.</p>`;
    }

    localStorage.setItem(this.chaveUltimaVisita(), new Date().toISOString());
    document.getElementById('notifDot')?.classList.add('hidden');

    document.querySelectorAll('#notifFiltros [data-notif-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#notifFiltros [data-notif-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.filtroNotifAtual = btn.getAttribute('data-notif-filter') || 'todos';
        this.renderNotificacoes();
      });
    });
  }

  private renderNotificacoes(): void {
    const lista = document.getElementById('notifList');
    if (!lista) return;
    const ultimaVisita = this.getUltimaVisitaNotificacoes();

    let itens = this.notificacoesCache;
    if (this.filtroNotifAtual === 'nao-lidos') {
      itens = itens.filter((a) => a.data > ultimaVisita);
    }

    if (itens.length === 0) {
      lista.innerHTML = `<p class="empty-hint" style="padding:20px;">Nenhuma notificação por aqui.</p>`;
      return;
    }

    lista.innerHTML = itens.map((a) => {
      const naoLida = a.data > ultimaVisita;
      return `
        <div class="notif-item ${naoLida ? 'unread' : ''}">
          <div class="notif-avatar"><i class="fa-regular fa-comment"></i></div>
          <div>
            <div class="notif-title">Novo comentário em: "${this.sanitize(a.postTitulo)}"</div>
            <div class="notif-sub">${this.sanitize(a.autorNome)} comentou no seu artigo</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // =============================================================
  // ARTIGOS — criação, listagem, filtros e busca
  // =============================================================
  private initArtigos(): void {
    const modal = document.getElementById('postModal');
    const closeModalBtn = document.getElementById('closeModal');
    const postForm = document.getElementById('postForm') as HTMLFormElement | null;
    const postMsg = document.getElementById('postMsg');

    document.querySelectorAll('.add-post-btn-artigos').forEach((btn) =>
      btn.addEventListener('click', () => modal?.classList.remove('hidden')),
    );
    closeModalBtn?.addEventListener('click', () => modal?.classList.add('hidden'));

    postForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const artigo = {
        titulo: (document.getElementById('artigoTitulo') as HTMLInputElement).value.trim(),
        descricao: (document.getElementById('artigoDescricao') as HTMLInputElement).value.trim(),
        resumo: (document.getElementById('resumo') as HTMLTextAreaElement).value.trim(),
        img: (document.getElementById('img') as HTMLInputElement).value.trim(),
        link: (document.getElementById('link') as HTMLInputElement).value.trim(),
        categoria: (document.getElementById('categoria') as HTMLSelectElement).value,
        postadoPor: this.nomeEmpresaAtual,
        datahorapost: new Date(),
        custoMoedas: Number((document.getElementById('artigoCustoMoedas') as HTMLInputElement)?.value) || 0,
        parceiroId: this.uidAtual,
      };

      try {
        await addDoc(collection(db, 'artigos'), artigo);
        if (postMsg) {
          postMsg.style.color = 'green';
          postMsg.textContent = 'Post criado com sucesso!';
        }
        postForm.reset();
        modal?.classList.add('hidden');
        this.carregarArtigosNaAbaArtigos(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
        this.carregarAtividadeEArtigosRecentes();
      } catch (err) {
        console.error('Erro ao criar post:', err);
        if (postMsg) {
          postMsg.style.color = 'red';
          postMsg.textContent = 'Erro ao criar post.';
        }
      }
    });

    document.getElementById('artigos-search-input')?.addEventListener('input', () => this.aplicarBuscaArtigos());

    document.getElementById('qaComunicadoBtn')?.addEventListener('click', () => {
      modal?.classList.remove('hidden');
      const categoriaSelect = document.getElementById('categoria') as HTMLSelectElement | null;
      if (categoriaSelect) categoriaSelect.value = 'posts';
    });
  }

  private async carregarArtigosNaAbaArtigos(nomeEmpresa: string): Promise<void> {
    const articlesGridArtigos = document.getElementById('articlesGridArtigos');
    if (!articlesGridArtigos || !nomeEmpresa) return;

    const q = query(collection(db, 'artigos'), where('postadoPor', '==', nomeEmpresa));
    const snapshot = await getDocs(q);

    articlesGridArtigos.innerHTML = '';

    if (snapshot.empty) {
      articlesGridArtigos.innerHTML = `<p class="empty-hint">Você ainda não publicou nenhum artigo.</p>`;
      return;
    }

    snapshot.forEach((d) => {
      const art = d.data() as any;
      const cor = this.CATEGORIA_COR[art['categoria']] || '#7a5fe8';
      const dataFormatada = this.toDate(art['datahorapost']).toLocaleDateString('pt-BR');

      const card = document.createElement('div');
      card.className = 'article-card';
      card.setAttribute('data-categoria', art['categoria']);

      card.innerHTML = `
        <div class="delete-btn"><i class="fa-solid fa-trash"></i></div>
        <div class="card-topbar" style="background:${cor}"></div>
        ${art['img'] ? `<img src="${this.sanitize(art['img'])}" class="article-img" alt="${this.sanitize(art['titulo'])}">` : `<div class="article-thumb"><i class="fa-regular fa-image"></i></div>`}
        <div class="article-body">
          <h3>${this.sanitize(art['titulo'])}</h3>
          <p>${this.sanitize(art['descricao'])}</p>
          <span class="categoria-tag">${this.sanitize(art['categoria'])}</span>
          <div class="article-card-footer">
            <span class="article-card-date">${dataFormatada}</span>
            <button class="article-card-ver">Ver →</button>
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

    document.querySelectorAll('.add-event-btn').forEach((btn) =>
      btn.addEventListener('click', () => eventModal?.classList.remove('hidden')),
    );
    closeEventModal?.addEventListener('click', () => eventModal?.classList.add('hidden'));

    eventForm?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const evento = {
        titulo: (document.getElementById('tituloEvento') as HTMLInputElement).value.trim(),
        descricao: (document.getElementById('descricaoEvento') as HTMLTextAreaElement).value.trim(),
        data: Timestamp.fromDate(new Date((document.getElementById('dataEvento') as HTMLInputElement).value)),
        local: (document.getElementById('localEvento') as HTMLInputElement).value.trim(),
        capa: (document.getElementById('capaEvento') as HTMLInputElement).value.trim(),
        tipo: (document.getElementById('tipoEvento') as HTMLSelectElement).value,
        enviadoPor: this.nomeEmpresaAtual,
        parceiroId: this.uidAtual,
      };

      try {
        await addDoc(collection(db, 'eventos'), evento);
        if (eventMsg) {
          eventMsg.style.color = 'green';
          eventMsg.textContent = 'Evento criado com sucesso!';
        }
        eventForm.reset();
        eventModal?.classList.add('hidden');
        await this.carregarEventosParceiro(this.nomeEmpresaAtual);
        this.carregarDashboardStats();
      } catch (err) {
        console.error('Erro ao criar evento:', err);
        if (eventMsg) {
          eventMsg.style.color = 'red';
          eventMsg.textContent = 'Erro ao criar evento.';
        }
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
          heroBoasVindas.innerHTML = `Olá, ${this.sanitize(this.nomeExibicao(this.dadosParceiroAtual))}! <img src="./img/selinho-ver.svg" class="verificado-icon">`;
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
        alert('Enviamos um e-mail para redefinição de senha.');
      } catch (err) {
        console.error('Erro ao solicitar redefinição de senha:', err);
        alert('Não foi possível enviar o e-mail de redefinição.');
      }
    });

    document.getElementById('segSairContaBtn')?.addEventListener('click', async () => {
      if (!confirm('Deseja realmente sair da sua conta?')) return;
      try {
        await signOut(auth);
        this.router.navigate(['/login-profissional']);
      } catch (err) {
        console.error('Erro ao sair da conta:', err);
        alert('Não foi possível sair da conta. Tente novamente.');
      }
    });

    document.getElementById('cfgAlterarFotoBtn')?.addEventListener('click', async () => {
      const url = prompt('Cole a URL da nova foto/logo da empresa:');
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
        alert('Sua conta foi excluída com sucesso.');
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
              <div class="comments-info">
                <img src="./img/consult_icon.png" alt="Comentários" class="comment-icon">
                <span class="comment-count" data-id="${id}">${comentariosCount}</span>
              </div>
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
      if (!usuarioLogado) { alert('Você precisa estar logado para postar.'); return; }
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
      if (!titulo || !conteudo) { alert('Título e conteúdo são obrigatórios.'); return; }
      await criarPost(titulo, conteudo);
      modalForum.classList.add('hidden');
    });

    postsList.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest('.post-card') as HTMLElement | null;
      if (!card) return;
      const postId = card.dataset['id'] as string;

      if (target.classList.contains('like-icon')) {
        e.stopPropagation();
        if (!usuarioLogado) { alert('É necessário estar logado para curtir.'); return; }
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
        if (confirm('Deseja realmente excluir este post?')) await deleteDoc(doc(db, 'posts', postId));
        return;
      }
    });

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
}
