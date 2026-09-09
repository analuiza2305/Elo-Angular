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
  novoPostForm = { titulo: '', conteudo: '', anonimo: false };

  // Controles de Pesquisa, Filtros e Dropdown Mobile
  termoPesquisa: string = '';
  categoriaSelecionada = signal<string>('Todos');
  isDropdownCatOpen = signal<boolean>(false);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        await this.carregarPosts();
      } else {
        this.router.navigate(['/login']);
      }
    });

    document.addEventListener('click', () => {
      this.isDropdownCatOpen.set(false);
    });
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
    });
  }

  filtrarPorCategoria(categoria: string) {
    this.categoriaSelecionada.set(categoria);
    this.isDropdownCatOpen.set(false);
  }

  toggleDropdownCategoria(event: Event) {
    event.stopPropagation();
    this.isDropdownCatOpen.update(v => !v);
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
          dataFormatada: p['data']?.toDate ? p['data'].toDate().toLocaleString('pt-BR') : 'Agora',
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
    this.novoPostForm = { titulo: '', conteudo: '', anonimo: false };
    this.showNewPostModal.set(true);
  }

  fecharModalNovoPost() {
    this.showNewPostModal.set(false);
  }

  async criarPostagem() {
    const user = this.currentUser();
    if (!user || !this.novoPostForm.titulo.trim() || !this.novoPostForm.conteudo.trim()) return;

    let autorId = user.uid;
    let autorNome = user.displayName || 'Usuária';
    let autorFoto = './img/account_icon.png';

    if (this.novoPostForm.anonimo) {
      autorId = 'anonimo';
      autorNome = 'Anônimo';
    } else {
      try {
        const uSnap = await getDoc(doc(db, 'usuarios', user.uid));
        if (uSnap.exists()) {
          autorNome = uSnap.data()['nome'] || autorNome;
          autorFoto = uSnap.data()['avatar'] || uSnap.data()['fotoURL'] || autorFoto;
        }
      } catch(e) {}
    }

    try {
      await addDoc(collection(db, 'posts'), {
        autorId,
        autorNome,
        autorFoto,
        titulo: this.novoPostForm.titulo,
        conteudo: this.novoPostForm.conteudo,
        likes: 0,
        respondido: false,
        categoria: this.categoriaSelecionada() !== 'Todos' ? this.categoriaSelecionada() : 'Desabafos',
        data: serverTimestamp()
      });
      this.fecharModalNovoPost();
      await this.carregarPosts();
    } catch (err) {
      console.error('Erro ao criar post:', err);
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
