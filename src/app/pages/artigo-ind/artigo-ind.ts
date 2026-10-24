import { Component, OnInit, AfterViewInit, signal, inject, ViewChild } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

@Component({
  selector: 'app-artigo-ind',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './artigo-ind.html',
  styleUrls: ['./artigo-ind.css']
})
export class ArtigoInd implements OnInit, AfterViewInit {
  @ViewChild(HeaderComponent) headerComponent!: HeaderComponent;

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  artigo = signal<any>(null);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string>('');
  
  isFavorito = signal<boolean>(false);
  origemTipo = signal<string | null>(null);
  
  private artigoIdAtual: string = '';
  private uidLogado: string | null = null;

  ngOnInit() {
    // Pega a origem direto da URL de forma instantânea
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
        
        onAuthStateChanged(auth, (user) => {
          if (user) {
            this.uidLogado = user.uid;
            this.verificarSeFavorito(user.uid, artigoId);
            
            // Injeta a foto do profissional
            const tipoAtual = this.origemTipo();
            if (tipoAtual === 'psi' || tipoAtual === 'adv') {
              this.forcarDadosProfissionalNoHeader(user.uid, tipoAtual);
            }
          }
        });
      } else {
        this.errorMessage.set('Nenhum artigo selecionado.');
        this.isLoading.set(false);
      }
    });
  }

  ngAfterViewInit() {
    // Redundância de segurança para garantir que a foto carregue
    if (this.uidLogado) {
       const tipoAtual = this.origemTipo();
       if (tipoAtual === 'psi' || tipoAtual === 'adv') {
         this.forcarDadosProfissionalNoHeader(this.uidLogado, tipoAtual);
       }
    }
  }

  async forcarDadosProfissionalNoHeader(uid: string, tipo: string) {
    try {
      const colecao = tipo === 'psi' ? 'psicologos' : 'advogados';
      const docSnap = await getDoc(doc(db, colecao, uid));

      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // Timeout garante que vamos injetar os dados DEPOIS que o próprio header tentar e falhar
        setTimeout(() => {
          if (this.headerComponent) {
            if (data['fotoURL'] || data['avatar']) {
              this.headerComponent.userAvatar.set(data['fotoURL'] || data['avatar']);
            }
            if (data['nome']) {
              const names = data['nome'].trim().split(' ');
              const nomeCurto = names.length > 1 ? `${names[0]} ${names[names.length - 1]}` : names[0];
              this.headerComponent.userName.set(nomeCurto);
            }
          }
        }, 300);
      }
    } catch (error) {
      console.error("Erro ao forçar dados no header:", error);
    }
  }

  async carregarArtigo(id: string) {
    try {
      this.isLoading.set(true);
      const artigoRef = doc(db, 'artigos', id);
      const artigoSnap = await getDoc(artigoRef);

      if (artigoSnap.exists()) {
        const data = artigoSnap.data();
        let dataString = '26 de set.';
        const rawDate = data['data'] ?? data['date'] ?? null;
        let dataObj = null;

        if (rawDate && rawDate.toDate) {
          dataObj = rawDate.toDate();
        } else if (typeof rawDate === 'string') {
          dataObj = new Date(rawDate);
        }

        if (dataObj && !isNaN(dataObj.getTime())) {
          dataString = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
        }

        this.artigo.set({
          id: artigoSnap.id,
          ...data,
          categoria: data['categoria'] || 'Legislativo',
          fonte: data['fonte'] || 'ELOMATERNO',
          dataString
        });

        document.title = `Artigo • ${data['titulo'] || 'EloMaterno'}`;
      } else {
        this.errorMessage.set('Artigo não encontrado.');
      }
    } catch (err) {
      console.error("Erro ao carregar artigo:", err);
      this.errorMessage.set('Erro ao carregar os detalhes do artigo.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async verificarSeFavorito(uid: string, artigoId: string) {
    try {
      const userRef = doc(db, 'usuarios', uid);
      const userSnap = await getDoc(userRef);

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
    if (!user) {
      alert("Você precisa estar logada para salvar artigos nos favoritos.");
      this.router.navigate(['/login']);
      return;
    }

    if (!this.artigoIdAtual) return;

    const userRef = doc(db, 'usuarios', user.uid);

    try {
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
    const origem = this.origemTipo();
    if (origem === 'psi') {
      this.router.navigate(['/home-psi']);
    } else if (origem === 'adv') {
      this.router.navigate(['/home-adv']);
    } else {
      this.location.back();
    }
  }
}