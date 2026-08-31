import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';

@Component({
  selector: 'app-artigos',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './artigos.html',
  styleUrls: ['./artigos.css']
})
export class Artigos implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  isLoading = signal<boolean>(true);
  
  todosArtigos = signal<any[]>([]);
  categoriaSelecionada = signal<string>('Todos');
  ordemSelecionada = signal<string>('recentes'); // 'recentes', 'antigos', 'alfabetica'
  isDropdownOpen = signal<boolean>(false);
  isDropdownCatOpen = signal<boolean>(false); // Controle do menu mobile de categorias

  // Computa os artigos filtrados e ordenados em tempo real
  artigosFiltrados = computed(() => {
    let filtrados = this.todosArtigos();

    // Filtro por Categoria
    if (this.categoriaSelecionada() !== 'Todos') {
      filtrados = filtrados.filter(a => a.categoria?.toLowerCase() === this.categoriaSelecionada().toLowerCase());
    }

    // Ordenação
    filtrados.sort((a, b) => {
      if (this.ordemSelecionada() === 'alfabetica') {
        return (a.titulo || '').localeCompare(b.titulo || '');
      }
      
      const dataA = a.datahorapost?.toDate ? a.datahorapost.toDate().getTime() : 0;
      const dataB = b.datahorapost?.toDate ? b.datahorapost.toDate().getTime() : 0;

      if (this.ordemSelecionada() === 'antigos') {
        return dataA - dataB;
      }
      // Padrão: mais recentes
      return dataB - dataA;
    });

    return filtrados;
  });

  // Transforma o valor interno num texto amigável pro botão
  textoOrdenacao = computed(() => {
    switch (this.ordemSelecionada()) {
      case 'recentes': return 'Mais recentes';
      case 'antigos': return 'Mais antigos';
      case 'alfabetica': return 'Ordem alfabética';
      default: return 'Ordenar';
    }
  });

  ngOnInit() {
    onAuthStateChanged(auth, (user) => {
      this.currentUser.set(user);
      this.carregarArtigos();
    });

    // Fechar dropdowns de ordenação e categorias ao clicar fora
    document.addEventListener('click', () => {
      this.isDropdownOpen.set(false);
      this.isDropdownCatOpen.set(false);
    });
  }

  async carregarArtigos() {
    try {
      this.isLoading.set(true);
      const snap = await getDocs(collection(db, 'artigos'));
      const user = this.currentUser();
      
      const artigos = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          // Verifica se o ID do usuário está no array de salvos deste artigo
          salvo: user ? (data['salvosPor']?.includes(user.uid) || false) : false
        };
      });

      this.todosArtigos.set(artigos);
    } catch (e) {
      console.error("Erro ao carregar artigos:", e);
    } finally {
      this.isLoading.set(false);
    }
  }

  // ==========================================
  // AÇÕES E INTERATIVIDADE
  // ==========================================
  filtrarCategoria(cat: string) {
    this.categoriaSelecionada.set(cat);
    this.isDropdownCatOpen.set(false); // Fecha o menu mobile ao selecionar
  }

  toggleDropdownOrdenacao(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen.update(v => !v);
    this.isDropdownCatOpen.set(false); // Garante que o outro dropdown feche
  }

  toggleDropdownCategoria(event: Event) {
    event.stopPropagation();
    this.isDropdownCatOpen.update(v => !v);
    this.isDropdownOpen.set(false); // Garante que o outro dropdown feche
  }

  ordenarArtigos(ordem: string) {
    this.ordemSelecionada.set(ordem);
    this.isDropdownOpen.set(false);
  }

  lerArtigo(id: string) {
    this.router.navigate(['/artigo_ind'], { queryParams: { id } });
  }

  async toggleFavoritoRapido(artigo: any) {
    const user = this.currentUser();
    if (!user) {
      alert("Faça login para salvar artigos.");
      return;
    }

    const artigoRef = doc(db, 'artigos', artigo.id);
    const isSaved = artigo.salvo;
    
    // Atualização Otimista: Muda na tela antes do banco terminar
    artigo.salvo = !isSaved;

    try {
      if (isSaved) {
        await updateDoc(artigoRef, { salvosPor: arrayRemove(user.uid) });
      } else {
        await updateDoc(artigoRef, { salvosPor: arrayUnion(user.uid) });
      }
    } catch (err) {
      // Reverte se der erro no Firestore
      artigo.salvo = isSaved;
      console.error("Erro ao salvar artigo", err);
    }
  }

  // Se a imagem der erro 404, substitui por um padrão seguro
  tratarErroImagem(artigo: any) {
    artigo.img = './img/art1_img.png';
  }
}