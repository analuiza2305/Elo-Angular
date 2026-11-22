import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthFormComponent } from '../../components/auth-form/auth-form';
import { AcessibilidadeService } from '../../core/services/acessibilidade.service';
import { ClicavelTecladoDirective } from '../../core/directives/clicavel-teclado.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-cadastro-profissional',
  standalone: true,
  imports: [ClicavelTecladoDirective, TranslatePipe, CommonModule, RouterModule, AuthFormComponent],
  templateUrl: './cadastro-profissional.html',
  styleUrls: ['./cadastro-profissional.css']
})
export class CadastroProfissional implements OnInit {
  /** Acessibilidade compartilhada por todas as telas (ver AcessibilidadeService). */
  readonly acc = inject(AcessibilidadeService);
  isAccessibilityOpen = signal<boolean>(false);

  ngOnInit(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.body.setAttribute('data-theme', savedTheme);
    }

    document.addEventListener('click', () => {
      this.isAccessibilityOpen.set(false);
    });
  }

  alternarTema(): void {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }

  toggleAccessibilityMenu(event: Event): void {
    event.stopPropagation();
    this.isAccessibilityOpen.update((v) => !v);
  }

}

export { CadastroProfissional as CadastroProfissionalComponent };