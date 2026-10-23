import { Component, OnInit, signal, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthFormComponent } from '../../components/auth-form/auth-form';

@Component({
  selector: 'app-login-profissional',
  standalone: true,
  imports: [CommonModule, RouterModule, AuthFormComponent],
  templateUrl: './login-profissional.html',
  styleUrls: ['./login-profissional.css']
})
export class LoginProfissionalComponent implements OnInit {
  isAccessibilityOpen = signal<boolean>(false);
  private speechUtterance: SpeechSynthesisUtterance | null = null;
  private daltonismoIndex = 0;
  private readonly daltonismoClasses = [
    'colorblind-protanopia',
    'colorblind-deuteranopia',
    'colorblind-tritanopia',
    'colorblind-Acromatopsia'
  ];

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

  aumentarFonte(): void {
    if (isPlatformBrowser(this.platformId)) {
      const currentSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      document.documentElement.style.fontSize = `${Math.min(currentSize + 2, 24)}px`;
    }
  }

  diminuirFonte(): void {
    if (isPlatformBrowser(this.platformId)) {
      const currentSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      document.documentElement.style.fontSize = `${Math.max(currentSize - 2, 12)}px`;
    }
  }

  alternarFiltroDaltonismo(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.daltonismoClasses.forEach((cls) => document.body.classList.remove(cls));
      this.daltonismoIndex = (this.daltonismoIndex + 1) % (this.daltonismoClasses.length + 1);
      if (this.daltonismoIndex > 0) {
        document.body.classList.add(this.daltonismoClasses[this.daltonismoIndex - 1]);
      }
    }
  }

  alternarLeituraVoz(): void {
    if (isPlatformBrowser(this.platformId) && 'speechSynthesis' in window) {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      } else {
        const textToRead = document.querySelector('main')?.textContent || document.body.textContent || '';
        this.speechUtterance = new SpeechSynthesisUtterance(textToRead);
        this.speechUtterance.lang = 'pt-BR';
        window.speechSynthesis.speak(this.speechUtterance);
      }
    }
  }

  alternarMascaraLeitura(): void {
    if (isPlatformBrowser(this.platformId)) {
      const mask = document.getElementById('reading-mask-overlay');
      if (mask) {
        mask.classList.toggle('hidden');
        mask.style.display = mask.classList.contains('hidden') ? 'none' : 'block';
      }
    }
  }

  alternarTextoDestacado(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.body.classList.toggle('bold-text-active');
    }
  }

  alternarAltoContraste(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.body.classList.toggle('high-contrast-active');
    }
  }

  aumentarEspacamentoLinhas(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.body.classList.remove('line-spacing-sm');
      document.body.classList.add('line-spacing-lg');
    }
  }

  diminuirEspacamentoLinhas(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.body.classList.remove('line-spacing-lg');
      document.body.classList.add('line-spacing-sm');
    }
  }

  redefinirAcessibilidade(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.style.fontSize = '';
      document.body.classList.remove(
        'high-contrast-active',
        'bold-text-active',
        'line-spacing-sm',
        'line-spacing-lg',
        ...this.daltonismoClasses
      );
      this.daltonismoIndex = 0;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      const mask = document.getElementById('reading-mask-overlay');
      if (mask) {
        mask.classList.add('hidden');
        mask.style.display = 'none';
      }
    }
  }
}

export { LoginProfissionalComponent as LoginProfissional };