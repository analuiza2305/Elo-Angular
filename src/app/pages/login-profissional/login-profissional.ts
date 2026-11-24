import { Component, OnInit, signal, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthFormComponent } from '../../components/auth-form/auth-form';
import { AcessibilidadeService } from '../../core/services/acessibilidade.service';
import { ClicavelTecladoDirective } from '../../core/directives/clicavel-teclado.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-login-profissional',
  standalone: true,
  imports: [ClicavelTecladoDirective, TranslatePipe, CommonModule, RouterModule, AuthFormComponent],
  templateUrl: './login-profissional.html',
  styleUrls: ['./login-profissional.css']
})
export class LoginProfissionalComponent implements OnInit {
  /** Acessibilidade compartilhada por todas as telas (ver AcessibilidadeService). */
  readonly acc = inject(AcessibilidadeService);
  isAccessibilityOpen = signal<boolean>(false);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
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

export { LoginProfissionalComponent as LoginProfissional };