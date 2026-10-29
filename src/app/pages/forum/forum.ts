import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc, addDoc, serverTimestamp, updateDoc, deleteDoc, setDoc, increment, getCountFromServer
} from 'firebase/firestore';

const POSTS_POR_PAGINA = 8;

@Component({
  selector: 'app-forum',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './forum.html',
  styleUrls: ['./forum.css']
})
export class ForumComponent implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  posts = signal<any[]>([]);
  isLoading = signal<boolean>(true);

  // Controle de Modais
  showNewPostModal = signal<boolean>(false);
  showConfirmModal = signal<boolean>(false);
  postParaExcluirId = signal<string | null>(null);
  novoPostForm = { titulo: '', conteudo: '', anonimo: false, categoria: 'Desabafos' };
  publicando = signal<boolean>(false);

  // Perfil de quem está logada (usado na prévia do card de nova publicação)
  meuNome = signal<string>('Você');
  minhaFoto = signal<string>('./img/account_icon.png');

  // Controles de Pesquisa, Filtros, Ordenação e Paginação
  termoPesquisa: string = '';
  categoriaSelecionada = signal<string>('Todos');
  ordenacao = signal<'recentes' | 'curtidos' | 'comentados'>('recentes');
  limiteVisiveis = signal<number>(POSTS_POR_PAGINA);

  readonly categorias = [
    { nome: 'Desabafos', icone: 'fa-solid fa-heart', descricao: 'Para falar do que pesa no coração' },
    { nome: 'Dúvidas', icone: 'fa-solid fa-circle-question', descricao: 'Pergunte à comunidade e às especialistas' },
    { nome: 'Dicas', icone: 'fa-solid fa-lightbulb', descricao: 'Compartilhe o que funcionou para você' }
  ];

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        this.carregarMeuPerfil(user);
        await this.carregarPosts();
      } else {
        this.router.navigate(['/login']);
      }
    });
  }

  private async carregarMeuPerfil(user: any) {
    this.meuNome.set(user.displayName || 'Usuária');
    try {
      const uSnap = await getDoc(doc(db, 'usuarios', user.uid));
      if (uSnap.exists()) {
        this.meuNome.set(uSnap.data()['nome'] || this.meuNome());
        this.minhaFoto.set(uSnap.data()['avatar'] || uSnap.data()['fotoURL'] || this.minhaFoto());
      }
    } catch (e) { console.error(e); }
  }

  get postsFiltrados() {
    const termo = this.termoPesquisa.toLowerCase().trim();
    const cat = this.categoriaSelecionada();
    return this.posts().filter(post => {
      const matchTitulo = post.titulo?.toLowerCase().includes(termo) || false;
      const matchConteudo = post.conteudo?.toLowerCase().includes(termo) || false;
      const matchAutor = post.autorNomeFinal?.toLowerCase().includes(termo) || false;
      const matchTermo = !termo || matchTitulo || matchConteudo || matchAutor;
      const matchCat = cat === 'Todos' || post.categoria === cat;
      return matchTermo && matchCat;
    }).sort((a, b) => {
      if (this.ordenacao() === 'curtidos') return (b.likes || 0) - (a.likes || 0);
      if (this.ordenacao() === 'comentados') return (b.totalComentarios || 0) - (a.totalComentarios || 0);
      return 0; // 'recentes': já vem ordenado do Firestore
    });
  }

  get postsVisiveis() {
    return this.postsFiltrados.slice(0, this.limiteVisiveis());
  }

  get tituloLista() {
    if (this.ordenacao() === 'curtidos') return 'Tópicos mais curtidos';
    if (this.ordenacao() === 'comentados') return 'Tópicos mais comentados';
    return 'Tópicos recentes';
  }

  filtrarPorCategoria(categoria: string) {
    this.categoriaSelecionada.set(categoria);
    this.limiteVisiveis.set(POSTS_POR_PAGINA);
  }

  ordenarPor(valor: string) {
    this.ordenacao.set(valor as 'recentes' | 'curtidos' | 'comentados');
    this.limiteVisiveis.set(POSTS_POR_PAGINA);
  }

  carregarMais() {
    this.limiteVisiveis.update(n => n + POSTS_POR_PAGINA);
  }

  async carregarPosts() {
    try {
      this.isLoading.set(true);
      const q = query(collection(db, 'posts'), orderBy('data', 'desc'), limit(20));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        this.posts.set([]);
        this.isLoading.set(false);
        return;
      }
      const user = this.currentUser();

      const postsList = await Promise.all(snapshot.docs.map(async (docSnap) => {
        const p = docSnap.data();
        const postId = docSnap.id;

        let autorNome = p['autorNome'] || 'Usuária';
        let autorFoto = p['autorFoto'] || './img/account_icon.png';

        if (p['autorId'] && p['autorId'] !== 'anonimo') {
          try {
            const userSnap = await getDoc(doc(db, 'usuarios', p['autorId']));
            if (userSnap.exists()) {
              const uData = userSnap.data();
              autorNome = uData['nome'] || autorNome;
              autorFoto = uData['avatar'] || uData['fotoURL'] || autorFoto;
            }
          } catch (e) { console.error(e); }
        }
        if (p['autorId'] === 'anonimo') {
          autorNome = 'Anônimo';
          autorFoto = './img/account_icon.png';
        }

        let jaCurtiu = false;
        let totalComentarios = 0;
        const promisesExtras = [];
        if (user) {
          promisesExtras.push(
            getDoc(doc(db, 'posts', postId, 'likes', user.uid)).then(likeSnap => {
              jaCurtiu = likeSnap.exists();
            }).catch(() => {})
          );
        }
        promisesExtras.push(
          getCountFromServer(collection(db, 'posts', postId, 'comentarios')).then(comSnap => {
            totalComentarios = comSnap.data().count;
          }).catch(() => {})
        );
        await Promise.all(promisesExtras);

        return {
          id: postId,
          ...p,
          autorNomeFinal: autorNome,
          autorFotoFinal: autorFoto,
          dataFormatada: p['data']?.toDate
            ? p['data'].toDate().toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
            : 'Agora',
          jaCurtiu,
          totalComentarios
        };
      }));

      // Esconde do fórum público os posts removidos pela moderação do admin
      const postsVisiveis = postsList.filter((p: any) => !p.moderacao?.removido);

      this.posts.set(postsVisiveis);
    } catch (err) {
      console.error('Erro ao carregar posts:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  abrirModalNovoPost() {
    const cat = this.categoriaSelecionada();
    this.novoPostForm = { titulo: '', conteudo: '', anonimo: false, categoria: cat !== 'Todos' ? cat : 'Desabafos' };
    this.showNewPostModal.set(true);
  }

  fecharModalNovoPost() {
    this.showNewPostModal.set(false);
  }

  podePublicar() {
    return !!this.novoPostForm.titulo.trim() && !!this.novoPostForm.conteudo.trim();
  }

  // Faz o campo de texto crescer conforme a mãe escreve
  ajustarAltura(campo: HTMLTextAreaElement) {
    campo.style.height = 'auto';
    campo.style.height = campo.scrollHeight + 'px';
  }

  async criarPostagem() {
    const user = this.currentUser();
    if (!user || !this.podePublicar() || this.publicando()) return;

    let autorId = user.uid;
    let autorNome = this.meuNome();
    let autorFoto = this.minhaFoto();

    if (this.novoPostForm.anonimo) {
      autorId = 'anonimo';
      autorNome = 'Anônimo';
      autorFoto = './img/account_icon.png';
    }

    this.publicando.set(true);
    try {
      await addDoc(collection(db, 'posts'), {
        autorId,
        autorNome,
        autorFoto,
        titulo: this.novoPostForm.titulo,
        conteudo: this.novoPostForm.conteudo,
        likes: 0,
        respondido: false,
        categoria: this.novoPostForm.categoria,
        data: serverTimestamp()
      });
      this.fecharModalNovoPost();
      await this.carregarPosts();
    } catch (err) {
      console.error('Erro ao criar post:', err);
    } finally {
      this.publicando.set(false);
    }
  }

  async toggleLikePost(post: any, event: Event) {
    event.stopPropagation();
    const user = this.currentUser();
    if (!user) return;
    const likeRef = doc(db, 'posts', post.id, 'likes', user.uid);
    const postRef = doc(db, 'posts', post.id);
    try {
      if (post.jaCurtiu) {
        post.jaCurtiu = false;
        post.likes = Math.max(0, (post.likes || 1) - 1);
        await deleteDoc(likeRef);
        await updateDoc(postRef, { likes: increment(-1) });
      } else {
        post.jaCurtiu = true;
        post.likes = (post.likes || 0) + 1;
        await setDoc(likeRef, { curtido: true });
        await updateDoc(postRef, { likes: increment(1) });
      }
    } catch (err) {
      console.error('Erro ao curtir:', err);
    }
  }

  confirmarExclusao(postId: string, event: Event) {
    event.stopPropagation();
    this.postParaExcluirId.set(postId);
    this.showConfirmModal.set(true);
  }

  async excluirPost() {
    const id = this.postParaExcluirId();
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'posts', id));
      this.showConfirmModal.set(false);
      this.postParaExcluirId.set(null);
      await this.carregarPosts();
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
  }

  irParaDetalhes(postId: string) {
    this.router.navigate(['/comentResp'], { queryParams: { postId } });
  }
}

export { ForumComponent as Forum };
