import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  doc, getDoc, collection, getDocs, addDoc, serverTimestamp, query, orderBy, where, updateDoc
} from 'firebase/firestore';

@Component({
  selector: 'app-coment-resp',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './coment-resp.html',
  styleUrls: ['./coment-resp.css']
})
export class ComentResp implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  currentUser = signal<any>(null);
  isProfissional = signal<boolean>(false); // NOVO: Identifica se é profissional
  post = signal<any>(null);
  comentarios = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  novoComentario = signal<string>('');

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        await this.verificarSeEhProfissional(user.uid);

        this.route.queryParams.subscribe(params => {
          const postId = params['postId'];
          if (postId) {
            this.carregarDetalhesPost(postId);
            this.carregarComentarios(postId);
          }
        });
      } else {
        this.router.navigate(['/login']);
      }
    });
  }

  // Verifica se o usuário logado é psicólogo ou advogado.
  // Cada tentativa tem o seu próprio try/catch: antes, se UMA consulta falhasse
  // (ex.: regra do Firestore bloqueando a busca com where), tudo caía em
  // "não é profissional" e o campo de resposta não aparecia.
  async verificarSeEhProfissional(uid: string) {
    const tentar = async (fn: () => Promise<boolean>) => {
      try { return await fn(); } catch (err) { console.warn('Verificação de profissional falhou:', err); return false; }
    };

    for (const colecao of ['psicologos', 'advogados']) {
      // contas novas: o ID do documento é o próprio uid
      if (await tentar(async () => (await getDoc(doc(db, colecao, uid))).exists())) {
        this.isProfissional.set(true);
        return;
      }
      // contas antigas: ID aleatório + campo uid
      if (await tentar(async () => !(await getDocs(query(collection(db, colecao), where('uid', '==', uid)))).empty)) {
        this.isProfissional.set(true);
        return;
      }
    }

    // último recurso: o tipo gravado no cadastro geral
    const porTipo = await tentar(async () => {
      const u = await getDoc(doc(db, 'usuarios', uid));
      const tipo = String(u.data()?.['tipo'] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return tipo === 'psicologo' || tipo === 'advogado';
    });
    this.isProfissional.set(porTipo);
  }

  async carregarDetalhesPost(postId: string) {
    try {
      const docSnap = await getDoc(doc(db, 'posts', postId));
      if (docSnap.exists()) {
        const p = docSnap.data();
        let autorNome = p['autorNome'] || 'Usuária';
        let autorFoto = p['autorFoto'] || './img/account_icon.png';

        if (p['autorId'] && p['autorId'] !== 'anonimo') {
          // Tenta buscar em usuários ou profissionais
          let userSnap = await getDoc(doc(db, 'usuarios', p['autorId']));
          if (!userSnap.exists()) userSnap = await getDoc(doc(db, 'psicologos', p['autorId']));
          if (!userSnap.exists()) userSnap = await getDoc(doc(db, 'advogados', p['autorId']));

          if (userSnap.exists()) {
            autorNome = userSnap.data()['nome'] || autorNome;
            autorFoto = userSnap.data()['avatar'] || userSnap.data()['fotoURL'] || autorFoto;
          }
        }

        this.post.set({
          id: docSnap.id,
          ...p,
          autorNomeFinal: autorNome,
          autorFotoFinal: autorFoto,
          dataFormatada: p['data']?.toDate ? p['data'].toDate().toLocaleString('pt-BR') : 'Agora'
        });
      }
    } catch (err) {
      console.error('Erro ao carregar post:', err);
    }
  }

  async carregarComentarios(postId: string) {
    try {
      this.isLoading.set(true);
      const q = query(collection(db, 'posts', postId, 'comentarios'), orderBy('data', 'asc'));
      const snapshot = await getDocs(q);
      const comList: any[] = [];

      for (const d of snapshot.docs) {
        const c = d.data();
        let nome = c['autorNome'] || 'Usuária';
        let foto = c['autorFoto'] || './img/account_icon.png';

        if (c['autorId']) {
          let uSnap = await getDoc(doc(db, 'usuarios', c['autorId']));
          if (!uSnap.exists()) uSnap = await getDoc(doc(db, 'psicologos', c['autorId']));
          if (!uSnap.exists()) uSnap = await getDoc(doc(db, 'advogados', c['autorId']));

          if (uSnap.exists()) {
            nome = uSnap.data()['nome'] || nome;
            foto = uSnap.data()['avatar'] || uSnap.data()['fotoURL'] || foto;
          }
        }

        comList.push({
          id: d.id,
          ...c,
          autorNomeFinal: nome,
          autorFotoFinal: foto,
          dataFormatada: c['data']?.toDate ? c['data'].toDate().toLocaleString('pt-BR') : 'Agora'
        });
      }

      this.comentarios.set(comList);
    } catch (err) {
      console.error('Erro ao carregar comentários:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  async enviarComentario() {
    if (!this.isProfissional()) {
      alert('Apenas profissionais (psicólogos e advogados) podem responder às publicações.');
      return;
    }

    const texto = this.novoComentario().trim();
    const currentPost = this.post();
    const user = this.currentUser();
    if (!texto || !currentPost || !user) return;

    try {
      let nome = user.displayName || 'Especialista';
      let foto = './img/account_icon.png';
      let tipoAutor = 'profissional';
      for (const [colecao, tipo] of [['psicologos', 'psicologo'], ['advogados', 'advogado'], ['usuarios', 'profissional']]) {
        try {
          const s = await getDoc(doc(db, colecao, user.uid));
          if (s.exists()) {
            nome = s.data()['nome'] || nome;
            foto = s.data()['avatar'] || s.data()['fotoURL'] || foto;
            tipoAutor = tipo;
            break;
          }
        } catch { /* tenta a próxima coleção */ }
      }

      // Adiciona o comentário e atualiza o post para respondido=true
      await addDoc(collection(db, 'posts', currentPost.id, 'comentarios'), {
        autorId: user.uid,
        autorNome: nome,
        autorFoto: foto,
        tipoAutor,
        conteudo: texto,
        likes: 0,
        data: serverTimestamp()
      });

      // Marca o post como respondido por especialista (se falhar, a resposta já foi salva)
      try { await updateDoc(doc(db, 'posts', currentPost.id), { respondido: true }); }
      catch (e) { console.warn('Não foi possível marcar o post como respondido:', e); }

      this.novoComentario.set('');
      await this.carregarDetalhesPost(currentPost.id);
      await this.carregarComentarios(currentPost.id);
    } catch (err) {
      console.error('Erro ao enviar comentário:', err);
      alert('Não foi possível enviar sua resposta. Tente novamente.');
    }
  }

  voltarAoForum() {
    this.router.navigate(['/forum']);
  }
}
