import { Component, afterNextRender, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AlertaComponent } from './components/alerta/alerta';
import { FooterSimplesComponent } from './components/footer-simples/footer-simples';
import { AnimacoesService } from './core/services/animacoes.service';

// Telas sem o footer simples: landing page (tem o footer completo), autenticação e videochamada (tela cheia)
const ROTAS_SEM_FOOTER = new Set([
  '',
  'login',
  'login-profissional',
  'cadastro',
  'cadastro-profissional',
  'verificar-email',
  'videochamada',
]);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AlertaComponent, FooterSimplesComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {
  title = 'elomaterno';

  private router = inject(Router);

  mostrarFooter = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => !ROTAS_SEM_FOOTER.has(e.urlAfterRedirects.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '')))
    ),
    { initialValue: false }
  );

  constructor() {
    const animacoes = inject(AnimacoesService);
    afterNextRender(() => animacoes.iniciar());
  }
}
