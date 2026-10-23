import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';

@Component({
  selector: 'app-eventos',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './eventos.html',
  styleUrls: ['./eventos.css']
})
export class Eventos implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  eventos = signal<any[]>([]);
  userInscritos = signal<any[]>([]);
  isLoading = signal<boolean>(true);

  // Filtros e Dropdowns
  categoriaSelecionada = signal<string>('Todos');
  isDropdownOpen = signal<boolean>(false);
  isDropdownCatOpen = signal<boolean>(false);
  tipoOrdenacao = signal<string>('recentes');
  textoOrdenacao = signal<string>('Mais recentes');

  // Controle de Modais
  eventoSelecionado = signal<any>(null);
  showModalDetalhes = signal<boolean>(false);
  showModalAviso = signal<boolean>(false);
  avisoInfo = signal({ titulo: '', mensagem: '', isConfirm: false, acao: () => {} });

  eventosFiltrados = computed(() => {
    const cat = this.categoriaSelecionada();
    const lista = this.eventos();
    if (cat === 'Todos') return lista;
    return lista.filter((e: any) => e.categoria?.toLowerCase() === cat.toLowerCase());
  });

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        await this.carregarInscricoesUsuario(user.uid);
      } else {
        this.userInscritos.set([]);
      }
      await this.carregarEventos();
    });

    document.addEventListener('click', () => {
      this.isDropdownOpen.set(false);
      this.isDropdownCatOpen.set(false);
    });
  }

  async carregarInscricoesUsuario(uid: string) {
    try {
      const userRef = doc(db, 'usuarios', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        this.userInscritos.set(snap.data()['eventosInscritos'] || []);
      }
    } catch (err) {
      console.error('Erro ao carregar inscrições:', err);
      this.userInscritos.set([]);
    }
  }

  async carregarEventos() {
    try {
      this.isLoading.set(true);
      const snap = await getDocs(collection(db, "eventos"));
      const lista: any[] = [];
      
      snap.forEach(docSnap => {
        const data = docSnap.data();
        let dataFormatada = '';
        let dataObj = null;
        let dia = '23';
        let mes = 'JUN';

        const rawDate = data['data'] ?? data['date'] ?? null;
        if (rawDate && rawDate.toDate) {
          dataObj = rawDate.toDate();
        } else if (typeof rawDate === 'string') {
          dataObj = new Date(rawDate);
        }

        if (dataObj && !isNaN(dataObj.getTime())) {
          dataFormatada = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) + 
                          ' às ' + 
                          dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          dia = String(dataObj.getDate()).padStart(2, '0');
          mes = dataObj.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
        }

        lista.push({
          id: docSnap.id,
          ...data,
          categoria: data['categoria'] || 'Evento',
          dataObj,
          dataFormatada,
          dia,
          mes
        });
      });

      lista.sort((a, b) => (a.dataObj?.getTime() || 0) - (b.dataObj?.getTime() || 0));
      this.eventos.set(lista);
    } catch (err) {
      console.error('Erro ao carregar eventos:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  filtrarCategoria(categoria: string) {
    this.categoriaSelecionada.set(categoria);
    this.isDropdownCatOpen.set(false);
  }

  toggleDropdownOrdenacao(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen.update(v => !v);
    this.isDropdownCatOpen.set(false);
  }

  toggleDropdownCategoria(event: Event) {
    event.stopPropagation();
    this.isDropdownCatOpen.update(v => !v);
    this.isDropdownOpen.set(false);
  }

  ordenarEventos(tipo: string) {
    this.tipoOrdenacao.set(tipo);
    this.textoOrdenacao.set(
      tipo === 'recentes' ? 'Mais recentes' : 
      tipo === 'antigos' ? 'Mais antigos' : 'Ordem alfabética'
    );
    this.isDropdownOpen.set(false);

    const lista = [...this.eventos()];
    if (tipo === 'recentes') {
      lista.sort((a, b) => (a.dataObj?.getTime() || 0) - (b.dataObj?.getTime() || 0));
    } else if (tipo === 'antigos') {
      lista.sort((a, b) => (b.dataObj?.getTime() || 0) - (a.dataObj?.getTime() || 0));
    } else if (tipo === 'alfabetica') {
      lista.sort((a, b) => (a.titulo || '').localeCompare(b.titulo || ''));
    }
    this.eventos.set(lista);
  }

  isInscrito(eventoId: string): boolean {
    return this.userInscritos().some(e => e.id === eventoId);
  }

  abrirDetalhes(evento: any) {
    this.eventoSelecionado.set(evento);
    this.showModalDetalhes.set(true);
  }

  fecharModais() {
    this.showModalDetalhes.set(false);
    this.showModalAviso.set(false);
  }

  abrirAviso(titulo: string, mensagem: string) {
    this.avisoInfo.set({ titulo, mensagem, isConfirm: false, acao: () => {} });
    this.showModalAviso.set(true);
  }

  abrirConfirmacao(titulo: string, mensagem: string, acao: () => void) {
    this.avisoInfo.set({ titulo, mensagem, isConfirm: true, acao });
    this.showModalAviso.set(true);
  }

  compartilharEvento(evento: any) {
    if (navigator.share) {
      navigator.share({
        title: evento.titulo,
        text: evento.descricao,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      this.abrirAviso('Link copiado!', 'O link deste evento foi copiado para a sua área de transferência.');
    }
  }

  async inscrever() {
    const user = this.currentUser();
    if (!user) {
      this.abrirAviso('Login necessário', 'Você precisa estar logada para se inscrever em um evento.');
      return;
    }

    const evento = this.eventoSelecionado();
    if (this.isInscrito(evento.id)) {
      this.abrirAviso('Atenção', 'Você já está inscrita nesse evento.');
      return;
    }

    try {
      const userRef = doc(db, 'usuarios', user.uid);
      const novoEventoSalvar = {
        id: evento.id,
        titulo: evento.titulo ?? '',
        descricao: evento.descricao ?? '',
        date: evento.dataObj ? evento.dataObj.toString() : ''
      };

      const novasInscricoes = [...this.userInscritos(), novoEventoSalvar];
      await updateDoc(userRef, { eventosInscritos: novasInscricoes });
      
      this.userInscritos.set(novasInscricoes);
      this.fecharModais();
      this.abrirAviso('Sucesso!', 'Sua inscrição foi realizada com sucesso.');
    } catch (err) {
      console.error(err);
      this.abrirAviso('Erro', 'Ocorreu um erro ao realizar a inscrição. Tente novamente.');
    }
  }

  cancelarInscricao() {
    const user = this.currentUser();
    const evento = this.eventoSelecionado();
    
    if (!user) {
      this.abrirAviso('Atenção', 'Você precisa estar logada para realizar essa ação.');
      return;
    }

    if (!evento) return;

    this.abrirConfirmacao(
      'Cancelar Inscrição',
      'Tem certeza que deseja cancelar sua inscrição neste evento?',
      async () => {
        try {
          const listaAtualizada = this.userInscritos().filter((e: any) => e.id !== evento.id);

          const userRef = doc(db, 'usuarios', user.uid);
          await updateDoc(userRef, {
            eventosInscritos: listaAtualizada
          });

          this.userInscritos.set(listaAtualizada);
          this.eventoSelecionado.set(null);
          this.fecharModais(); 
          
          setTimeout(() => {
            this.abrirAviso('Inscrição Cancelada', 'Sua inscrição foi cancelada com sucesso!');
          }, 300);

        } catch (error) {
          console.error("Erro ao cancelar a inscrição:", error);
          this.abrirAviso('Erro', 'Ocorreu um erro ao cancelar. Tente novamente.');
        }
      }
    );
  }
}
