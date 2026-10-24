import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { auth, db } from '../../core/firebase';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, query, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';

@Component({
  selector: 'app-artigo-ind-profissional',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './artigo-ind-profissional.html',
  styleUrls: ['./artigo-ind-profissional.css']
})
export class ArtigoIndProfissional implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  artigo = signal<any>(null);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string>('');
  isFavorito = signal<boolean>(false);
  
  nomeCompleto = signal<string>('Profissional');
  avatarUrl = signal<string>('./img/account_icon.png');
  isDarkMode = signal<boolean>(false);
  accessibilityMenuOpen = signal<boolean>(false);
  
  private artigoIdAtual: string = '';
  origemTipo = signal<string>(''); 

  ngOnInit() {
    this.checkTheme();

    const urlParams = new URLSearchParams(window.location.search);
    const origem = urlParams.get('origem');
    if (origem) {
      this.origemTipo.set(origem);
    }

    this.route.queryParams.subscribe(params => {
      const artigoId = params['id'];

      if (artigoId) {
        this.artigoIdAtual = artigoId;
        this.carregarArtigo(artigoId);
        
        onAuthStateChanged(auth, async (user) => {
          if (user) {
            this.verificarSeFavorito(user.uid, artigoId);
            await this.carregarDadosProfissional(user.uid);
          } else {
            this.router.navigate(['/login-profissional']);
          }
        });
      } else {
        this.errorMessage.set('Nenhum artigo selecionado.');
        this.isLoading.set(false);
      }
    });
  }

  async carregarDadosProfissional(uid: string) {
    let colecao = 'psicologos';
    if (this.origemTipo() === 'adv') {
        colecao = 'advogados';
    }

    try {
      let dados: any = null;
      
      // 1. Tenta buscar pelo ID do documento igual ao UID (contas novas)
      const docSnap = await getDoc(doc(db, colecao, uid));
      if (docSnap.exists()) {
        dados = docSnap.data();
      } else {
        // 2. Fallback para contas legadas (onde UID está num campo e o ID é aleatório)
        const q = query(collection(db, colecao), where('uid', '==', uid));
        const snapLegado = await getDocs(q);
        if (!snapLegado.empty) {
          dados = snapLegado.docs[0].data();
        } else {
           // 3. Tenta na outra coleção (caso a origem tenha vindo errada)
           const outraColecao = colecao === 'psicologos' ? 'advogados' : 'psicologos';
           const docSnapOutra = await getDoc(doc(db, outraColecao, uid));
           if (docSnapOutra.exists()) {
             dados = docSnapOutra.data();
             this.origemTipo.set(outraColecao === 'psicologos' ? 'psi' : 'adv');
           } else {
             const qOutra = query(collection(db, outraColecao), where('uid', '==', uid));
             const snapLegadoOutra = await getDocs(qOutra);
             if (!snapLegadoOutra.empty) {
               dados = snapLegadoOutra.docs[0].data();
               this.origemTipo.set(outraColecao === 'psicologos' ? 'psi' : 'adv');
             }
           }
        }
      }

      if (dados) {
        if (dados['nome']) {
          const partes = dados['nome'].trim().split(' ');
          // Pega o primeiro e o último nome pra não estourar o header
          const nomeCurto = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : partes[0];
          this.nomeCompleto.set(nomeCurto);
        }
        if (dados['fotoURL'] || dados['avatar']) {
          this.avatarUrl.set(dados['fotoURL'] || dados['avatar']);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar dados do profissional:", err);
    }
  }

  async carregarArtigo(id: string) {
    try {
      this.isLoading.set(true);
      const artigoRef = doc(db, 'artigos', id);
      const artigoSnap = await getDoc(artigoRef);

      if (artigoSnap.exists()) {
        const data = artigoSnap.data();
        let dataString = 'Recente';
        const rawDate = data['datahorapost'] ?? data['data'] ?? data['date'] ?? null;
        
        if (rawDate && rawDate.toDate) {
          dataString = rawDate.toDate().toLocaleDateString('pt-BR');
        } else if (typeof rawDate === 'string') {
          dataString = new Date(rawDate).toLocaleDateString('pt-BR');
        }

        this.artigo.set({
          id: artigoSnap.id,
          ...data,
          categoria: data['categoria'] || 'Conteúdo Profissional',
          dataString
        });
      } else {
        this.errorMessage.set('Artigo não encontrado.');
      }
    } catch (err) {
      console.error("Erro ao carregar artigo:", err);
      this.errorMessage.set('Erro ao carregar o artigo.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async verificarSeFavorito(uid: string, artigoId: string) {
    try {
      const colecao = this.origemTipo() === 'adv' ? 'advogados' : 'psicologos';
      let userRef = doc(db, colecao, uid);
      let userSnap = await getDoc(userRef);
      
      // Fallback pra conta antiga igual em 'carregarDadosProfissional'
      if (!userSnap.exists()) {
        const q = query(collection(db, colecao), where('uid', '==', uid));
        const snapLegado = await getDocs(q);
        if (!snapLegado.empty) {
           userRef = doc(db, colecao, snapLegado.docs[0].id);
           userSnap = await getDoc(userRef);
        }
      }

      if (userSnap.exists()) {
        const favoritos: string[] = userSnap.data()['favoritos'] || [];
        this.isFavorito.set(favoritos.includes(artigoId));
      }
    } catch (error) {
      console.error("Erro ao verificar favorito:", error);
    }
  }

  async toggleFavorito() {
    const user = auth.currentUser;
    if (!user) return;
    if (!this.artigoIdAtual) return;

    const colecao = this.origemTipo() === 'adv' ? 'advogados' : 'psicologos';
    let userRef = doc(db, colecao, user.uid);
    
    try {
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        const q = query(collection(db, colecao), where('uid', '==', user.uid));
        const snapLegado = await getDocs(q);
        if (!snapLegado.empty) {
           userRef = doc(db, colecao, snapLegado.docs[0].id);
        }
      }

      if (this.isFavorito()) {
        await updateDoc(userRef, { favoritos: arrayRemove(this.artigoIdAtual) });
        this.isFavorito.set(false);
      } else {
        await updateDoc(userRef, { favoritos: arrayUnion(this.artigoIdAtual) });
        this.isFavorito.set(true);
      }
    } catch (error) {
      console.error("Erro ao atualizar favoritos:", error);
    }
  }

  voltar() {
    if (this.origemTipo() === 'adv') {
      this.router.navigate(['/home-adv']);
    } else {
      this.router.navigate(['/home-psi']);
    }
  }

  irParaPerfil() {
    if (this.origemTipo() === 'adv') {
      this.router.navigate(['/perfil-adv']);
    } else {
      this.router.navigate(['/perfil-psi']);
    }
  }

  async logout() {
    await signOut(auth);
    this.router.navigate(['/login-profissional']);
  }

  toggleTheme() {
    this.isDarkMode.set(!this.isDarkMode());
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
    localStorage.setItem('theme', this.isDarkMode() ? 'dark' : 'light');
  }

  checkTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      this.isDarkMode.set(true);
      document.body.setAttribute('data-theme', 'dark');
    }
  }

  toggleAccessibilityMenu() {
    this.accessibilityMenuOpen.set(!this.accessibilityMenuOpen());
  }

  aumentarFonte() {}
  diminuirFonte() {}
  redefinirAcessibilidade() {}
}