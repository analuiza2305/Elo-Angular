import { Component, OnInit, signal, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthFormComponent } from '../../components/auth-form/auth-form';
import { AcessibilidadeService } from '../../core/services/acessibilidade.service';
import { ClicavelTecladoDirective } from '../../core/directives/clicavel-teclado.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ClicavelTecladoDirective, TranslatePipe, CommonModule, RouterModule, AuthFormComponent],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class Login implements OnInit {
  /** Acessibilidade compartilhada por todas as telas (ver AcessibilidadeService). */
  readonly acc = inject(AcessibilidadeService);
  isAccessibilityOpen = signal<boolean>(false);
  emailVerificadoAgora = signal<boolean>(false);

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('emailVerificado') === '1') {
      this.emailVerificadoAgora.set(true);
    }

    if (isPlatformBrowser(this.platformId)) {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
      }

      document.addEventListener('click', () => {
        this.isAccessibilityOpen.set(false);
      });
    }
  }

  alternarTema(): void {
    if (isPlatformBrowser(this.platformId)) {
      const currentTheme = document.body.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
    }
  }

  toggleAccessibilityMenu(event: Event): void {
    event.stopPropagation();
    this.isAccessibilityOpen.update((v) => !v);
  }
}