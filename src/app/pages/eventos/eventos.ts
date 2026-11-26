import { Component, Input, OnInit, signal, inject, computed } from '@angular/core';
import { FiltrosDropdownDirective } from '../../core/directives/filtros-dropdown.directive';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';

import { prioridadeVisibilidade, visibilidadeEfetiva } from '../../services/divulgacao';
import { AnuncioEspacoComponent } from '../../components/anuncio-espaco/anuncio-espaco';
import { CardEventoComponent } from '../../components/card-evento/card-evento';
import { EventoDetalhesComponent } from '../../components/evento-detalhes/evento-detalhes';
import { carregarEventos, ordemPadraoEventos, InscricoesEventosService } from '../../services/eventos-dados';
@Component({
  selector: 'app-eventos',
  standalone: true,
  imports: [CardEventoComponent, EventoDetalhesComponent, FiltrosDropdownDirective, CommonModule, RouterModule, HeaderComponent, AnuncioEspacoComponent],
  templateUrl: './eventos.html',
  styleUrls: ['./eventos.css']
})
export class Eventos implements OnInit {
  private router = inject(Router);

  /** Dentro do painel do parceiro: sem header e sem inscrição (é a vitrine que as mães veem). */
  @Input() embutido = false;
  /** Parceiro: mostra só o banner (a lista fica na aba "Como as mães veem"). */
  @Input() somenteTopo = false;

  private readonly inscricoes = inject(InscricoesEventosService);

  currentUser = signal<any>(null);
  eventos = signal<any[]>([]);
  isLoading = signal<boolean>(true);

  // Filtros e Dropdowns
  categoriaSelecionada = signal<string>('Todos');
  isDropdownOpen = signal<boolean>(false);
  isDropdownCatOpen = signal<boolean>(false);
  tipoOrdenacao = signal<string>('recentes');
  textoOrdenacao = signal<string>('Mais recentes');

  // Controle de Modais
  /** evento aberto no modal (components/evento-detalhes) */
  eventoSelecionado = signal<any>(null);

  eventosFiltrados = computed(() => {
    const cat = this.categoriaSelecionada();
    const lista = this.eventos();
    if (cat === 'Todos') return lista;
    return lista.filter((e: any) => e.categoria?.toLowerCase() === cat.toLowerCase());
  });

  /** Só os eventos que ainda vão acontecer ficam no topo. */
  eventosAtivos = computed(() => this.eventosFiltrados().filter((e: any) => !e.encerrado));
  /** Eventos que já aconteceram ficam guardados num bloco separado, que a mãe abre se quiser. */
  eventosEncerrados = computed(() => this.eventosFiltrados().filter((e: any) => e.encerrado));
  mostrarEncerrados = signal<boolean>(false);

  toggleEncerrados() {
    this.mostrarEncerrados.update(v => !v);
  }

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        if (!this.embutido) await this.inscricoes.carregar(user.uid);
      } else {
        this.inscricoes.carregar(null);
      }
      await this.carregarEventos();
    });

    document.addEventListener('click', () => {
      this.isDropdownOpen.set(false);
      this.isDropdownCatOpen.set(false);
    });
  }

  async carregarEventos() {
    try {
      this.isLoading.set(true);
      const lista = await carregarEventos();
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
      lista.sort((a, b) => ordemPadraoEventos(a, b));
    } else if (tipo === 'antigos') {
      lista.sort((a, b) => (b.dataObj?.getTime() || 0) - (a.dataObj?.getTime() || 0));
    } else if (tipo === 'alfabetica') {
      lista.sort((a, b) => (a.titulo || '').localeCompare(b.titulo || ''));
    }
    this.eventos.set(lista);
  }

  isInscrito(eventoId: string): boolean {
    return this.inscricoes.isInscrito(eventoId);
  }

  abrirDetalhes(evento: any) {
    this.eventoSelecionado.set(evento);
  }

  fecharModais() {
    this.eventoSelecionado.set(null);
  }
}
