import { Component, OnInit, signal, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import {
  formatarDataArtigo, autorDoArtigo, fonteDoArtigo,
  carregarIdsFavoritosPsi, definirFavoritoPsi
} from '../../services/artigo-utils';
import { SelosAutorComponent } from '../../components/selos-autor/selos-autor';

/** Artigos favoritos do PSICÓLOGO (salvos em psicologos/{id}.favoritos). */
@Component({
  selector: 'app-artigos-favoritos-psi',
  standalone: true,
  imports: [CommonModule, RouterModule, SelosAutorComponent],
  templateUrl: './artigos-favoritos-psi.html',
  // mesmo visual da tela da mãe, reaproveitando o CSS dela sem alterá-lo
  styleUrls: ['../artigos-favoritos/artigos-favoritos.css']
})
export class ArtigosFavoritosPsi implements OnInit {
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
        this.router.navigate(['/login-profissional']);
      }
    });
  }

  async carregarFavoritos(uid: string) {
    try {
      this.isLoading.set(true);
      const [idsFavoritos, artigosSnap] = await Promise.all([
        carregarIdsFavoritosPsi(uid),
        getDocs(collection(db, 'artigos')),
      ]);

      const lista: any[] = [];
      artigosSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data?.['moderacao']?.removido) return;
        if (!idsFavoritos.includes(docSnap.id)) return;

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
      console.error('Erro ao carregar favoritos:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  lerArtigo(id: string) {
    this.router.navigate(['/artigo-ind-profissional'], { queryParams: { id, origem: 'psi' } });
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
      await definirFavoritoPsi(user.uid, artigoId, false);
      this.artigosFavoritos.update(lista => lista.filter(a => a.id !== artigoId));
    } catch (error) {
      console.error('Erro ao remover favorito:', error);
    }
  }
}
