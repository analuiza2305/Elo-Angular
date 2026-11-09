import { Component, EventEmitter, Input, OnInit, AfterViewInit, Output, signal, inject, ViewChild } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { DenunciarComponent } from '../../components/denunciar/denunciar';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { formatarDataArtigo, autorDoArtigo, fonteDoArtigo, carregarIdsFavoritos, definirFavorito } from '../../services/artigo-utils';
import { onAuthStateChanged } from 'firebase/auth';
import { AlertaService } from '../../core/services/alerta.service';

import { SelosAutorComponent } from '../../components/selos-autor/selos-autor';
import { AnuncioEspacoComponent } from '../../components/anuncio-espaco/anuncio-espaco';
@Component({
  selector: 'app-artigo-ind',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, DenunciarComponent, SelosAutorComponent, AnuncioEspacoComponent],
  templateUrl: './artigo-ind.html',
  styleUrls: ['./artigo-ind.css']
})
export class ArtigoInd implements OnInit, AfterViewInit {
  @ViewChild(HeaderComponent) headerComponent!: HeaderComponent;

  /** Dentro do painel do parceiro: sem header, o artigo vem por input e "voltar" avisa o painel. */
  @Input() embutido = false;
  @Input() artigoIdEmbutido = '';
  @Output() voltarPainel = new EventEmitter<void>();

  private router = inject(Router);
  private readonly alerta = inject(AlertaService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  artigo = signal<any>(null);
  isLoading = signal<boolean>(true);
  errorMessage = signal<string>('');
  
  isFavorito = signal<boolean>(false);
  origemTipo = signal<string | null>(null);
  
  private artigoIdAtual: string = '';
  /** id do artigo aberto (usado pelo botão Denunciar). */
  get artigoId(): string { return this.artigoIdAtual; }
  private uidLogado: string | null = null;

  ngOnInit() {
    // Pega a origem direto da URL de forma instantânea
    const urlParams = new URLSearchParams(window.location.search);
    const origem = urlParams.get('origem');
    if (origem) {
      this.origemTipo.set(origem);
    }

    if (this.embutido) {
      this.artigoIdAtual = this.artigoIdEmbutido;
      if (this.artigoIdEmbutido) this.carregarArtigo(this.artigoIdEmbutido);
      else { this.errorMessage.set('Nenhum artigo selecionado.'); this.isLoading.set(false); }
      return;
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

      if (artigoSnap.exists() && !artigoSnap.data()?.['moderacao']?.removido) {
        const data = artigoSnap.data();
        this.artigo.set({
          id: artigoSnap.id,
          ...data,
          categoria: data['categoria'] || 'Legislativo',
          dataString: formatarDataArtigo(data),
          autorExibido: autorDoArtigo(data),
          fonteExibida: fonteDoArtigo(data),
        });

        if (!this.embutido) document.title = `Artigo • ${data['titulo'] || 'EloMaterno'}`;
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
    const favoritos = await carregarIdsFavoritos(uid);
    this.isFavorito.set(favoritos.includes(artigoId));
  }

  async toggleFavorito() {
    const user = auth.currentUser;
    if (!user) {
      this.alerta.aviso('Você precisa estar logada para salvar postagens nos favoritos.', 'Faça login');
      this.router.navigate(['/login']);
      return;
    }

    if (!this.artigoIdAtual) return;

    const salvar = !this.isFavorito();
    this.isFavorito.set(salvar);
    try {
      await definirFavorito(user.uid, this.artigoIdAtual, salvar);
    } catch (error) {
      this.isFavorito.set(!salvar);
      console.error("Erro ao atualizar favoritos:", error);
      this.alerta.erro('Não foi possível atualizar seus favoritos. Tente novamente.');
    }
  }

  voltar() {
    if (this.embutido) { this.voltarPainel.emit(); return; }
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