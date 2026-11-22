import { Component, Input, OnInit, signal, PLATFORM_ID, inject, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { lerPreferenciaLocal } from '../../services/preferencia-suporte';

export interface PassoGuia { icone: string; titulo: string; texto: string; }

/**
 * Guia em slides (um passo por vez), usado na home e em Consultas.
 * Abre sozinho a cada visita até a mãe marcar "Não mostrar de novo".
 * Ela sempre pode abrir de novo pelo botão da página.
 */
@Component({
  selector: 'app-guia-passos',
  standalone: true,
  templateUrl: './guia-passos.html',
  styleUrls: ['./guia-passos.css']
})
export class GuiaPassosComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);

  @Input({ required: true }) passos: PassoGuia[] = [];
  /** Nome usado para lembrar a escolha da mãe (ex.: 'inicio', 'consultas'). */
  @Input({ required: true }) chave = '';
  /** Abre sozinho quando a página carrega (se ela não pediu para não mostrar). */
  @Input() abrirSozinho = true;

  aberto = signal(false);
  passo = signal(0);
  naoMostrar = signal(false);

  private get chaveStorage() { return 'guiaMae:' + this.chave; }

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    try { this.naoMostrar.set(localStorage.getItem(this.chaveStorage) === 'nao-mostrar'); } catch { /* sem storage */ }
    if (this.abrirSozinho) setTimeout(() => this.abrirSeDeve(), 600);
  }

  /** Abre só se a mãe não pediu para esconder e ainda não viu nesta visita. */
  abrirSeDeve() {
    if (!isPlatformBrowser(this.platformId)) return;
    // Quem escolheu o assistente (IA) no cadastro/perfil não recebe os guias abrindo sozinhos
    if (lerPreferenciaLocal() === 'ia') return;
    try {
      if (localStorage.getItem(this.chaveStorage) === 'nao-mostrar') return;
      if (sessionStorage.getItem(this.chaveStorage) === 'visto') return;
    } catch { /* sem storage: abre */ }
    this.abrir();
  }

  abrir() { this.passo.set(0); this.aberto.set(true); }

  fechar() {
    this.aberto.set(false);
    try {
      sessionStorage.setItem(this.chaveStorage, 'visto');
      if (this.naoMostrar()) localStorage.setItem(this.chaveStorage, 'nao-mostrar');
      else localStorage.removeItem(this.chaveStorage);
    } catch { /* sem storage */ }
  }

  proximo() { if (this.passo() < this.passos.length - 1) this.passo.set(this.passo() + 1); else this.fechar(); }
  voltar() { if (this.passo() > 0) this.passo.set(this.passo() - 1); }

  @HostListener('document:keydown.escape')
  aoEsc() { if (this.aberto()) this.fechar(); }
}
