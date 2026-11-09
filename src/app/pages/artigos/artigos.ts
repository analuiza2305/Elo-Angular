import { Component, EventEmitter, Input, OnInit, Output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, query, where, limit } from 'firebase/firestore';
import { formatarDataArtigo, dataDoArtigo, autorDoArtigo, fonteDoArtigo, carregarIdsFavoritos, definirFavorito } from '../../services/artigo-utils';
import { AlertaService } from '../../core/services/alerta.service';

import { SelosAutorComponent } from '../../components/selos-autor/selos-autor';
import { prioridadeVisibilidade, visibilidadeEfetiva } from '../../services/divulgacao';
import { AnuncioEspacoComponent } from '../../components/anuncio-espaco/anuncio-espaco';
@Component({
  selector: 'app-artigos',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, SelosAutorComponent, AnuncioEspacoComponent],
  templateUrl: './artigos.html',
  styleUrls: ['./artigos.css']
})
export class Artigos implements OnInit {
  private router = inject(Router);
  private readonly alerta = inject(AlertaService);

  /**
   * Modo "dentro do painel do parceiro": sem header, com o botão Nova postagem,
   * o filtro Minhas postagens e a lixeira nos artigos da própria empresa.
   */
  @Input() embutido = false;
  @Output() abrirArtigo = new EventEmitter<string>();
  @Output() novoArtigo = new EventEmitter<void>();
  @Output() excluirArtigo = new EventEmitter<string>();
  soMeus = signal(false);
  private nomeEmpresa = '';

  currentUser = signal<any>(null);
  isLoading = signal<boolean>(true);
  
  todosArtigos = signal<any[]>([]);
  categoriaSelecionada = signal<string>('Todos');
  ordemSelecionada = signal<string>('recentes'); // 'recentes', 'antigos', 'alfabetica'
  isDropdownOpen = signal<boolean>(false);
  isDropdownCatOpen = signal<boolean>(false); // Controle do menu mobile de categorias

  // Computa os artigos filtrados e ordenados em tempo real
  artigosFiltrados = computed(() => {
    let filtrados = [...this.todosArtigos()];

    if (this.embutido && this.soMeus()) filtrados = filtrados.filter(a => this.ehMeu(a));

    // Filtro por Categoria
    if (this.categoriaSelecionada() !== 'Todos') {
      filtrados = filtrados.filter(a => a.categoria?.toLowerCase() === this.categoriaSelecionada().toLowerCase());
    }

    // Ordenação
    filtrados.sort((a, b) => {
      if (this.ordemSelecionada() === 'alfabetica') {
        return (a.titulo || '').localeCompare(b.titulo || '');
      }
      
      const dataA = dataDoArtigo(a)?.getTime() || 0;
      const dataB = dataDoArtigo(b)?.getTime() || 0;

      if (this.ordemSelecionada() === 'antigos') {
        return dataA - dataB;
      }
      // Padrão: quem tem pacote de divulgação aparece primeiro, depois os mais recentes
      const porNivel = prioridadeVisibilidade(b.visibilidade) - prioridadeVisibilidade(a.visibilidade);
      if (porNivel) return porNivel;
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
    onAuthStateChanged(auth, async (user) => {
      this.currentUser.set(user);
      if (this.embutido && user) await this.carregarNomeEmpresa(user.uid);
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
      const user = this.currentUser();
      const [snap, favoritos] = await Promise.all([
        getDocs(collection(db, 'artigos')),
        user ? carregarIdsFavoritos(user.uid) : Promise.resolve([] as string[]),
      ]);

      const artigos = snap.docs.filter(d => !d.data()?.['moderacao']?.removido).map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          // nível de visibilidade (pacote de divulgação do parceiro); volta ao básico quando o pacote acaba
          visibilidade: visibilidadeEfetiva(data),
          dataString: formatarDataArtigo(data),
          autorExibido: autorDoArtigo(data),
          fonteExibida: fonteDoArtigo(data),
          // favoritos ficam no perfil da usuária (usuarios/{uid}.favoritos)
          salvo: user ? (favoritos.includes(d.id) || data['salvosPor']?.includes(user.uid) || false) : false
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

  private async carregarNomeEmpresa(uid: string) {
    try {
      let s = await getDoc(doc(db, 'parceiros', uid));
      let d: any = s.exists() ? s.data() : null;
      if (!d) {
        const q = await getDocs(query(collection(db, 'parceiros'), where('uid', '==', uid), limit(1)));
        d = q.empty ? null : q.docs[0].data();
      }
      this.nomeEmpresa = d?.nomeEmpresa || d?.nome || '';
    } catch { this.nomeEmpresa = ''; }
  }

  /** O artigo é da empresa logada? (usado só no painel do parceiro) */
  ehMeu(a: any): boolean {
    const uid = this.currentUser()?.uid;
    return !!uid && (a.parceiroId === uid || a.autorId === uid || (!!this.nomeEmpresa && a.postadoPor === this.nomeEmpresa));
  }

  lerArtigo(id: string) {
    if (this.embutido) { this.abrirArtigo.emit(id); return; }
    this.router.navigate(['/artigo_ind'], { queryParams: { id } });
  }

  async toggleFavoritoRapido(artigo: any) {
    const user = this.currentUser();
    if (!user) {
      this.alerta.aviso('Entre na sua conta para salvar postagens.', 'Faça login');
      return;
    }

    const isSaved = artigo.salvo;

    // Atualização Otimista: Muda na tela antes do banco terminar
    artigo.salvo = !isSaved;

    try {
      await definirFavorito(user.uid, artigo.id, !isSaved);
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