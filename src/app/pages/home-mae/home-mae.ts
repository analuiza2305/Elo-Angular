import { Component, OnInit, OnDestroy, signal, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { CardPostComponent } from '../../components/card-post/card-post';
import { CardArtigoComponent } from '../../components/card-artigo/card-artigo';
import { CardEventoComponent } from '../../components/card-evento/card-evento';
import { EventoDetalhesComponent } from '../../components/evento-detalhes/evento-detalhes';
import { CarrosselComponent } from '../../components/carrossel/carrossel';
import { carregarPostsForum, curtirPost } from '../../services/forum-dados';
import { carregarArtigos, ordemPadraoArtigos, alternarFavorito } from '../../services/artigos-dados';
import { carregarEventos, InscricoesEventosService } from '../../services/eventos-dados';
import { auth, db } from '../../core/firebase'; 
import { onAuthStateChanged } from 'firebase/auth';
import { AnuncioEspacoComponent } from '../../components/anuncio-espaco/anuncio-espaco';
import { GuiaPassosComponent, PassoGuia } from '../../components/guia-passos/guia-passos';
import { 
  collection, query, orderBy, limit, where, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc, increment, getCountFromServer, Timestamp, onSnapshot
} from 'firebase/firestore';
import { motivoEncerramentoAutomatico, encerrarAutomaticamente } from '../../services/prazos-consulta';
import { formatarDataArtigo, autorDoArtigo, carregarIdsFavoritos, definirFavorito } from '../../services/artigo-utils';

@Component({
  selector: 'app-home-mae',
  standalone: true,
  imports: [CardPostComponent, CardArtigoComponent, CardEventoComponent, EventoDetalhesComponent, CarrosselComponent, HeaderComponent, CommonModule, RouterModule, FormsModule, AnuncioEspacoComponent, GuiaPassosComponent],
  templateUrl: './home-mae.html',
  styleUrls: ['./home-mae.css', './home-mae-cards.css']
})
export class HomeMaeComponent implements OnInit, OnDestroy {
  private router = inject(Router);

  currentUser = signal<any>(null);
  heroUserName = signal<string>('Usuária');
  
  ultimosPosts = signal<any[]>([]);
  ultimosArtigos = signal<any[]>([]);
  ultimosEventos = signal<any[]>([]);
  readonly inscricoes = inject(InscricoesEventosService);
  artigosSalvos = signal<string[]>([]); // IDS DOS ARTIGOS SALVOS NO FIRESTORE

  isLoading = signal<boolean>(true);
  showWelcomeModal = signal<boolean>(false);
  
  // MODAIS
  infoModal = signal<{title: string, message: string} | null>(null);
  confirmModal = signal<{title: string, message: string, action: () => void} | null>(null);

  perfilForm = { cidade: '', emprego: '', filhos: '', telefone: '' };

  // Boas-vindas em passos: uma pergunta por vez, com opção de pular
  passoBv = signal(0);
  opcoesTrabalho = ['Trabalho fora de casa', 'Trabalho em casa', 'Não estou trabalhando', 'Não se aplica / prefiro não dizer'];
  opcoesFilhos = ['Estou grávida', '1', '2', '3', '4 ou mais', 'Prefiro não dizer'];

  // ==========================================
  // PRÓXIMA CONSULTA (aparece no topo, bate o olho e sabe o que fazer)
  // ==========================================
  proximaConsulta = signal<{
    id: string; status: string; quando: string; profissional: string; tipo: string;
    /** Está na hora (de 15 min antes até o fim da tolerância): o botão leva direto para a chamada. */
    podeEntrar: boolean;
    profNaSala: boolean;
  } | null>(null);

  /** Avisos de novidades na agenda desde a última visita (consulta confirmada/cancelada, evento novo). */
  novidadesAgenda = signal<string[]>([]);

  private unsubConsultas?: () => void;
  private relogio?: any;
  private consultasCache: any[] = [];
  private nomesProf = new Map<string, string>();

  ngOnDestroy() {
    this.unsubConsultas?.();
    clearInterval(this.relogio);
  }

  /** Escuta as consultas em tempo real: assim o atalho "Entrar agora" aparece sozinho na hora certa. */
  ouvirConsultas(uid: string) {
    this.unsubConsultas?.();
    this.unsubConsultas = onSnapshot(
      query(collection(db, 'Consultas'), where('maeId', '==', uid)),
      async (snap) => {
        this.consultasCache = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        await this.atualizarProximaConsulta();
        this.verificarNovidadesConsultas(uid);
      },
      (e) => console.warn('Consultas não carregadas:', e),
    );
    // Reavalia a cada 30s (o botão "Entrar agora" depende do relógio, não só do banco)
    clearInterval(this.relogio);
    this.relogio = setInterval(() => this.atualizarProximaConsulta(), 30000);
  }

  private async atualizarProximaConsulta() {
    try {
      const agoraMs = Date.now();
      const abertas = this.consultasCache
        .filter((c) => {
          const motivo = motivoEncerramentoAutomatico(c, agoraMs);
          if (motivo) { encerrarAutomaticamente(c.id, motivo); return false; }
          return ['aceito', 'pendente'].includes(c.status);
        })
        .map((c) => ({ ...c, data: c.Datahora?.toDate ? c.Datahora.toDate() : (c.Datahora ? new Date(c.Datahora) : null) }))
        .filter((c) => c.data && c.data.getTime() > agoraMs - 60 * 60 * 1000) // até 1h depois do horário ainda conta
        .sort((a, b) => a.data.getTime() - b.data.getTime());
      const c = abertas[0];
      if (!c) { this.proximaConsulta.set(null); return; }

      const profId = c.profissionalId || c.Psicologo || c.Advogado;
      const tipo = c.tipoProfissional || (c.Advogado ? 'advogado' : 'psicologo');
      let profissional = tipo === 'advogado' ? 'a advogada' : 'a psicóloga';
      if (profId) {
        if (!this.nomesProf.has(profId)) {
          const p = await getDoc(doc(db, tipo === 'advogado' ? 'advogados' : 'psicologos', profId)).catch(() => null);
          const nome = p?.exists() ? (p.data() as any)['nome'] : '';
          this.nomesProf.set(profId, nome ? String(nome).trim().split(' ')[0] : '');
        }
        profissional = this.nomesProf.get(profId) || profissional;
      }
      const quando = c.data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
        + ' às ' + c.data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const inicioJanela = c.data.getTime() - 15 * 60 * 1000;
      const podeEntrar = c.status === 'aceito' && (agoraMs >= inicioJanela || !!c.profissionalNaSala);
      this.proximaConsulta.set({ id: c.id, status: c.status, quando, profissional, tipo, podeEntrar, profNaSala: !!c.profissionalNaSala });
    } catch (e) {
      console.warn('Próxima consulta não carregada:', e);
    }
  }

  // ---------- Novidades na agenda ----------
  // Guarda no navegador o último estado visto (status de cada consulta e eventos já vistos).
  private chaveAgenda(uid: string) { return `elo_agenda_vista_${uid}`; }

  private lerAgendaVista(uid: string): { consultas: Record<string, string>; eventos: string[] | null } | null {
    try { return JSON.parse(localStorage.getItem(this.chaveAgenda(uid)) || 'null'); } catch { return null; }
  }

  private novidadesConsultas: string[] = [];
  private novidadesEventos: string[] = [];

  private verificarNovidadesConsultas(uid: string) {
    const vista = this.lerAgendaVista(uid);
    if (!vista) { this.marcarAgendaComoVista(); return; } // primeira visita: nada é "novidade"
    const msgs: string[] = [];
    let confirmadas = 0, canceladas = 0;
    for (const c of this.consultasCache) {
      const antes = vista.consultas?.[c.id];
      if (antes === undefined || antes === c.status) continue;
      if (c.status === 'aceito') confirmadas++;
      else if (c.status === 'negado') canceladas++;
    }
    if (confirmadas) msgs.push(confirmadas === 1 ? 'Uma consulta sua foi confirmada' : `${confirmadas} consultas suas foram confirmadas`);
    if (canceladas) msgs.push(canceladas === 1 ? 'Uma consulta sua foi cancelada' : `${canceladas} consultas suas foram canceladas`);
    this.novidadesConsultas = msgs;
    this.novidadesAgenda.set([...this.novidadesConsultas, ...this.novidadesEventos]);
  }

  private verificarNovidadesEventos(idsEventos: string[]) {
    const user = this.currentUser();
    if (!user) return;
    const vista = this.lerAgendaVista(user.uid);
    if (!vista) return;
    if (!vista.eventos) {
      // primeira vez que os eventos carregam: só guarda, sem avisar
      try { localStorage.setItem(this.chaveAgenda(user.uid), JSON.stringify({ ...vista, eventos: idsEventos })); } catch { /* sem storage */ }
      return;
    }
    const novos = idsEventos.filter((id) => !(vista.eventos || []).includes(id)).length;
    this.novidadesEventos = novos ? [novos === 1 ? 'Tem 1 evento novo na agenda' : `Tem ${novos} eventos novos na agenda`] : [];
    this.novidadesAgenda.set([...this.novidadesConsultas, ...this.novidadesEventos]);
  }

  /** "Ok, entendi": guarda o estado atual e esconde o aviso. */
  marcarAgendaComoVista() {
    const user = this.currentUser();
    if (!user) return;
    const consultas: Record<string, string> = {};
    this.consultasCache.forEach((c) => (consultas[c.id] = c.status));
    const anterior = this.lerAgendaVista(user.uid);
    const vistos = [...(anterior?.eventos || []), ...this.ultimosEventos().map((e: any) => e.id)];
    const eventos = vistos.length ? [...new Set(vistos)] : null;
    try { localStorage.setItem(this.chaveAgenda(user.uid), JSON.stringify({ consultas, eventos })); } catch { /* sem storage */ }
    this.novidadesConsultas = [];
    this.novidadesEventos = [];
    this.novidadesAgenda.set([]);
  }

  // Guia "como usar" (componente compartilhado com Consultas)
  @ViewChild('guia') guia?: GuiaPassosComponent;
  passosGuia: PassoGuia[] = [
    { icone: 'ph-light ph-stethoscope', titulo: 'Marque uma consulta', texto: 'Toque em "Marcar uma consulta". Escolha a psicóloga ou advogada, o dia e o horário. É de graça.', imagem: 'marcar-consulta' },
    { icone: 'ph ph-bell', titulo: 'Espere a confirmação', texto: 'A profissional confirma o seu pedido. Um aviso aparece na sua tela e no sino lá em cima.', imagem: 'confirmacao' },
    { icone: 'ph-light ph-video-camera', titulo: 'Entre na chamada', texto: 'No dia e na hora marcados, abra "Minhas consultas" e toque no botão verde "Entrar na chamada".', imagem: 'entrar-chamada' },
    { icone: 'ph-light ph-chats-circle', titulo: 'Converse com outras mães', texto: 'No fórum você pode perguntar, desabafar e ajudar outras mães. Pode até escrever sem mostrar seu nome.', imagem: 'forum' },
  ];

  /** Depois das boas-vindas, o guia abre sozinho (até a mãe marcar "não mostrar de novo"). */
  private abrirGuiaNaPrimeiraVez() {
    setTimeout(() => this.guia?.abrirSeDeve(), 400);
  }

  ngOnInit() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        this.currentUser.set(firebaseUser);
        if (firebaseUser.displayName) {
          this.heroUserName.set(firebaseUser.displayName.trim().split(' ')[0]);
        }
        await this.checkUserProfile(firebaseUser.uid);
        this.ouvirConsultas(firebaseUser.uid);
      } else {
        this.currentUser.set(null);
        this.inscricoes.carregar(null);
        this.artigosSalvos.set([]);
      }
      
      this.carregarUltimosPosts();
      this.carregarUltimosArtigos();
      this.carregarUltimosEventos();
    });
  }

  // ==========================================
  // PERFIL E BOAS VINDAS
  // ==========================================
  async checkUserProfile(uid: string) {
    try {
      const snap = await getDoc(doc(db, 'usuarios', uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data['nome']) this.heroUserName.set(data['nome'].trim().split(' ')[0]);
        if ((!data['telefone'] || data['telefone'] === '') && !data['welcomeModalShown']) {
          this.showWelcomeModal.set(true);
        } else {
          this.abrirGuiaNaPrimeiraVez();
        }
        this.inscricoes.inscritos.set(data['eventosInscritos'] || []);
        this.artigosSalvos.set(data['artigosSalvos'] || []);
      }
    } catch (err) {
      console.error('Erro ao verificar perfil:', err);
    }
  }

  closeModal() {
    this.showWelcomeModal.set(false);
    // marca para não abrir de novo a cada visita (antes ela travava nessa tela)
    const user = this.currentUser();
    if (user) updateDoc(doc(db, 'usuarios', user.uid), { welcomeModalShown: true }).catch(() => {});
    this.abrirGuiaNaPrimeiraVez();
  }

  formatarTelefone(valor: string) {
    const d = (valor || '').replace(/\D/g, '').slice(0, 11);
    let f = d;
    if (d.length > 10) f = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    else if (d.length > 6) f = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    else if (d.length > 2) f = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    else if (d.length) f = `(${d}`;
    this.perfilForm.telefone = f;
  }

  async saveProfile() {
    const user = this.currentUser();
    if (!user) return;
    const updates: any = { welcomeModalShown: true };
    if (this.perfilForm.cidade) updates.cidade = this.perfilForm.cidade;
    if (this.perfilForm.emprego) updates.emprego = this.perfilForm.emprego;
    if (this.perfilForm.filhos) updates.filhos = this.perfilForm.filhos;
    if (this.perfilForm.telefone) updates.telefone = this.perfilForm.telefone;

    try {
      await updateDoc(doc(db, 'usuarios', user.uid), updates);
      this.closeModal();
    } catch (err) {
      this.infoModal.set({title: 'Erro', message: 'Erro ao salvar perfil.'});
    }
  }

  // ==========================================
  // FIRESTORE GETS (DADOS REAIS)
  // ==========================================
  // Os três blocos buscam os dados com as mesmas funções das páginas
  // (services/forum-dados, artigos-dados e eventos-dados), então o que aparece
  // aqui é igual ao que aparece no Fórum, na Comunidade e em Eventos.
  async carregarUltimosPosts() {
    try {
      const user = this.currentUser();
      const posts = await carregarPostsForum({ limite: 9, user, meuAutorId: user?.uid || '' });
      this.ultimosPosts.set(posts.slice(0, 6));
    } catch (err) { console.error(err); }
  }

  async carregarUltimosArtigos() {
    try {
      const artigos = await carregarArtigos(this.currentUser());
      this.ultimosArtigos.set(artigos.sort(ordemPadraoArtigos).slice(0, 9));
    } catch (e) { console.error(e); }
  }

  async carregarUltimosEventos() {
    try {
      const proximos = (await carregarEventos()).filter(e => !e.encerrado);
      this.ultimosEventos.set(proximos.slice(0, 9));
      this.verificarNovidadesEventos(proximos.map((e: any) => e.id));
    } catch (e) { console.error(e); }
    finally { this.isLoading.set(false); }
  }

  // ==========================================
  // AÇÕES: CURTIR, SALVAR E NAVEGAÇÃO
  // ==========================================
  async toggleLike(post: any) {
    const user = this.currentUser();
    if (!user) {
      this.infoModal.set({title: 'Login necessário', message: 'Você precisa estar conectada para curtir!'});
      return;
    }
    await curtirPost(post, user.uid);
  }

  irParaPost(id: string) { this.router.navigate(['/comentResp'], { queryParams: { postId: id } }); }
  irParaArtigo(id: string) { this.router.navigate(['/artigo_ind'], { queryParams: { id } }); }

  async toggleSalvarArtigo(artigo: any) {
    const user = this.currentUser();
    if (!user) {
      this.infoModal.set({title: 'Login necessário', message: 'Você precisa estar logada para salvar postagens!'});
      return;
    }
    await alternarFavorito(artigo, user.uid);
  }

  // Navegação direta para as páginas completas
  irParaForum() { this.router.navigate(['/forum']); }
  irParaEventos() { this.router.navigate(['/eventos']); }
  irParaArtigos() { this.router.navigate(['/artigos']); }

  getImg(src: string): string { return src || './img/art1_img.png'; }

  /** evento aberto no modal (o mesmo da página de Eventos) */
  eventoAberto = signal<any>(null);
}
