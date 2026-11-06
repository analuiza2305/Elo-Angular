import { Component, OnInit, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { formatarDataArtigo, autorDoArtigo, fonteDoArtigo, carregarIdsFavoritos, definirFavorito } from '../../services/artigo-utils';

import { SelosAutorComponent } from '../../components/selos-autor/selos-autor';
@Component({
  selector: 'app-artigos-favoritos',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, SelosAutorComponent],
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
      const [idsFavoritos, artigosSnap] = await Promise.all([
        carregarIdsFavoritos(uid),
        getDocs(collection(db, 'artigos')),
      ]);

      const lista: any[] = [];
      artigosSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data?.['moderacao']?.removido) return;
        // também aceita favoritos antigos, salvos só em artigos/{id}.salvosPor
        const favoritado = idsFavoritos.includes(docSnap.id) || data['salvosPor']?.includes(uid);
        if (!favoritado) return;

        lista.push({
          id: docSnap.id,
          ...data,
          categoria: data['categoria'] || 'Legislativo',
          dataString: formatarDataArtigo(data),
          autorExibido: autorDoArtigo(data),
          fonteExibida: fonteDoArtigo(data),
        });
      });

      this.artigosFavoritos.set(lista);
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
      await definirFavorito(user.uid, artigoId, false);
      // Atualiza a lista localmente removendo o card da tela
      this.artigosFavoritos.update(lista => lista.filter(a => a.id !== artigoId));
    } catch (error) {
      console.error("Erro ao remover favorito:", error);
    }
  }
}