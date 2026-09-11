import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase'; 
import { onAuthStateChanged } from 'firebase/auth';
import { 
  collection, query, orderBy, limit, getDocs, doc, getDoc, updateDoc, arrayUnion, arrayRemove 
} from 'firebase/firestore';

@Component({
  selector: 'app-home-mae',
  standalone: true,
  imports: [HeaderComponent, CommonModule, RouterModule, FormsModule],
  templateUrl: './home-mae.html',
  styleUrls: ['./home-mae.css']
})
export class HomeMaeComponent implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  heroUserName = signal<string>('Usuária');
  
  ultimosPosts = signal<any[]>([]);
  ultimosArtigos = signal<any[]>([]);
  ultimosEventos = signal<any[]>([]);
  userInscritos = signal<any[]>([]); 
  artigosSalvos = signal<string[]>([]); // IDS DOS ARTIGOS SALVOS NO FIRESTORE

  isLoading = signal<boolean>(true);
  showWelcomeModal = signal<boolean>(false);
  
  // MODAIS
  selectedEvent = signal<any>(null);
  infoModal = signal<{title: string, message: string} | null>(null);
  confirmModal = signal<{title: string, message: string, action: () => void} | null>(null);

  perfilForm = { cidade: '', emprego: '', filhos: '', telefone: '' };

  ngOnInit() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        this.currentUser.set(firebaseUser);
        if (firebaseUser.displayName) {
          this.heroUserName.set(firebaseUser.displayName.trim().split(' ')[0]);
        }
        await this.checkUserProfile(firebaseUser.uid);
      } else {
        this.currentUser.set(null);
        this.userInscritos.set([]);
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
        }
        this.userInscritos.set(data['eventosInscritos'] || []);
        this.artigosSalvos.set(data['artigosSalvos'] || []);
      }
    } catch (err) {
      console.error('Erro ao verificar perfil:', err);
    }
  }

  closeModal() { this.showWelcomeModal.set(false); }

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
      this.infoModal.set({title: 'Sucesso', message: 'Perfil atualizado!'});
    } catch (err) {
      this.infoModal.set({title: 'Erro', message: 'Erro ao salvar perfil.'});
    }
  }

  // ==========================================
  // FIRESTORE GETS (DADOS REAIS)
  // ==========================================
  async carregarUltimosPosts() {
    try {
      const q = query(collection(db, 'posts'), orderBy('data', 'desc'), limit(2));
      const snapshot = await getDocs(q);
      const posts: any[] = [];
      for (const docSnap of snapshot.docs) {
        const p = docSnap.data();
        p['id'] = docSnap.id;
        p['dataFormatada'] = p['data']?.toDate?.().toLocaleDateString('pt-BR') || 'Agora';
        p['autorFotoFinal'] = p['autorFoto'] || './img/account_icon.png';
        p['autorNomeFinal'] = p['autorNome'] || 'Usuário';

        const curtidas = p['curtidas'] || [];
        p['jaCurtiu'] = this.currentUser() ? curtidas.includes(this.currentUser().uid) : false;

        if (p['autorId']) {
          const userSnap = await getDoc(doc(db, 'usuarios', p['autorId']));
          if (userSnap.exists()) {
             p['autorFotoFinal'] = userSnap.data()['avatar'] || userSnap.data()['fotoURL'] || p['autorFotoFinal'];
             p['autorNomeFinal'] = userSnap.data()['nome'] || p['autorNomeFinal'];
          }
        }
        posts.push(p);
      }
      this.ultimosPosts.set(posts);
    } catch (err) { console.error(err); }
  }

  async carregarUltimosArtigos() {
    try {
      const q = query(collection(db, 'artigos'), orderBy('datahorapost', 'desc'), limit(6));
      const snap = await getDocs(q);
      const user = this.currentUser();
      
      const artigos = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          salvo: user ? (data['artigosSalvos']?.includes(user.uid) || false) : false
        };
      });
      this.ultimosArtigos.set(artigos);
    } catch (e) { console.error(e); }
  }

  async carregarUltimosEventos() {
    try {
      const q = query(collection(db, 'eventos'), orderBy('data', 'desc'), limit(2));
      const snap = await getDocs(q);
      const eventos = snap.docs.map(docSnap => {
        const data = docSnap.data();
        const rawDate = data['data'] ?? data['date'];
        const dataFormatada = rawDate?.toDate ? rawDate.toDate() : (new Date(rawDate));
        return {
          id: docSnap.id, ...data,
          dataFormatada: dataFormatada ? dataFormatada.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) : '',
          horaFormatada: dataFormatada ? dataFormatada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
        };
      });
      this.ultimosEventos.set(eventos);
      this.isLoading.set(false);
    } catch (e) { this.isLoading.set(false); }
  }

  // ==========================================
  // AÇÕES: CURTIR, SALVAR E NAVEGAÇÃO
  // ==========================================
  async toggleLike(post: any, event: Event) {
    event.preventDefault(); event.stopPropagation();
    const user = this.currentUser();
    if (!user) {
      this.infoModal.set({title: 'Login necessário', message: 'Você precisa estar conectada para curtir!'});
      return;
    }
    const postRef = doc(db, 'posts', post.id);
    const isLiked = post.jaCurtiu;
    try {
      post.jaCurtiu = !isLiked;
      if (isLiked) await updateDoc(postRef, { curtidas: arrayRemove(user.uid) });
      else await updateDoc(postRef, { curtidas: arrayUnion(user.uid) });
    } catch (error) { post.jaCurtiu = isLiked; }
  }

  // Salvar ou Remover Artigo dos favoritos no Firestore
  async toggleSalvarArtigo(artigo: any, event: Event) {
    event.preventDefault(); 
    event.stopPropagation();
    const user = this.currentUser();
    if (!user) {
      this.infoModal.set({title: 'Login necessário', message: 'Você precisa estar logada para salvar artigos!'});
      return;
    }
    const artigoRef = doc(db, 'artigos', artigo.id);
    const isSaved = artigo.salvo;
    
    try {
      artigo.salvo = !isSaved;
      if (isSaved) {
        await updateDoc(artigoRef, { salvosPor: arrayRemove(user.uid) });
      } else {
        await updateDoc(artigoRef, { salvosPor: arrayUnion(user.uid) });
      }
    } catch (err) {
      artigo.salvo = isSaved;
      console.error("Erro ao salvar artigo", err);
    }
  }

  // Navegação direta para as páginas completas
  irParaForum() { this.router.navigate(['/forum']); }
  irParaEventos() { this.router.navigate(['/eventos']); }
  irParaArtigos() { this.router.navigate(['/artigos']); }

  getImg(src: string): string { return src || './img/art1_img.png'; }

  isUserInscrito(id: string): boolean {
    return this.userInscritos().some(i => i.id === id);
  }

  openEventModal(ev: any) { this.selectedEvent.set(ev); }
  closeEventModal() { this.selectedEvent.set(null); }

  async inscrever(ev: any) {
    const user = this.currentUser();
    if (!user) {
      this.infoModal.set({ title: 'Login necessário', message: 'Você precisa estar logado para se inscrever.' });
      return;
    }
    const toSave = { id: ev.id, titulo: ev.titulo || '', descricao: ev.descricao || '', date: ev.data ? ev.data.toString() : '' };
    const novos = [...this.userInscritos(), toSave];
    try {
      await updateDoc(doc(db, 'usuarios', user.uid), { eventosInscritos: novos });
      this.userInscritos.set(novos);
      this.closeEventModal();
      this.infoModal.set({ title: 'Sucesso', message: 'Inscrição realizada com sucesso!' });
    } catch (err) {
      this.infoModal.set({ title: 'Erro', message: 'Erro ao inscrever. Tente novamente.' });
    }
  }

  cancelarInscricao(ev: any) {
    this.confirmModal.set({
      title: 'Cancelar inscrição',
      message: 'Tem certeza que deseja cancelar sua inscrição neste evento?',
      action: async () => {
        try {
          const atualizados = this.userInscritos().filter(e => e.id !== ev.id);
          await updateDoc(doc(db, 'usuarios', this.currentUser().uid), { eventosInscritos: atualizados });
          this.userInscritos.set(atualizados);
          this.confirmModal.set(null);
          this.closeEventModal();
          this.infoModal.set({ title: 'Cancelado', message: 'Inscrição cancelada com sucesso.' });
        } catch(err) {
          this.confirmModal.set(null);
          this.infoModal.set({ title: 'Erro', message: 'Erro ao cancelar. Tente novamente.' });
        }
      }
    });
  }
}