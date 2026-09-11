import { Component, OnInit, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc, arrayRemove, collection, getDocs } from 'firebase/firestore';

@Component({
  selector: 'app-artigos-favoritos',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './artigos-favoritos.html',
  styleUrls: ['./artigos-favoritos.css']
})
export class ArtigosFavoritos implements OnInit {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  artigosFavoritos = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  currentUser = signal<any>(null);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        await this.carregarFavoritos(user.uid);
      } else {
        this.isLoading.set(false);
        this.router.navigate(['/login']);
      }
    });
  }

  async carregarFavoritos(uid: string) {
    try {
      this.isLoading.set(true);
      const userRef = doc(db, 'usuarios', uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const idsFavoritos: string[] = userSnap.data()['favoritos'] || [];
        
        if (idsFavoritos.length === 0) {
          this.artigosFavoritos.set([]);
          this.isLoading.set(false);
          return;
        }

        // Busca todos os artigos do Firestore para filtrar apenas os favoritados
        const artigosSnap = await getDocs(collection(db, "artigos"));
        const lista: any[] = [];

        artigosSnap.forEach(docSnap => {
          if (idsFavoritos.includes(docSnap.id)) {
            const data = docSnap.data();
            let dataString = '26 de set.';
            let dataObj = null;

            const rawDate = data['data'] ?? data['date'] ?? data['datahorapost'] ?? null;
            if (rawDate && rawDate.toDate) {
              dataObj = rawDate.toDate();
            } else if (typeof rawDate === 'string') {
              dataObj = new Date(rawDate);
            }

            if (dataObj && !isNaN(dataObj.getTime())) {
              dataString = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
            }

            lista.push({
              id: docSnap.id,
              ...data,
              categoria: data['categoria'] || 'Legislativo',
              fonte: data['fonte'] || 'ELOMATERNO',
              dataString
            });
          }
        });

        this.artigosFavoritos.set(lista);
      }
    } catch (err) {
      console.error("Erro ao carregar favoritos:", err);
    } finally {
      this.isLoading.set(false);
    }
  }

  lerArtigo(id: string) {
    this.router.navigate(['/artigo-ind'], { queryParams: { id } });
  }

  abrirLink(link: string) {
    if (isPlatformBrowser(this.platformId) && link) {
      window.open(link, '_blank');
    }
  }

  async removerFavorito(artigoId: string) {
    const user = this.currentUser();
    if (!user) return;

    try {
      const userRef = doc(db, 'usuarios', user.uid);
      await updateDoc(userRef, {
        favoritos: arrayRemove(artigoId)
      });

      // Atualiza a lista localmente removendo o card da tela
      this.artigosFavoritos.update(lista => lista.filter(a => a.id !== artigoId));
    } catch (error) {
      console.error("Erro ao remover favorito:", error);
    }
  }
}