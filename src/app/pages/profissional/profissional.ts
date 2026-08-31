import { Component, AfterViewInit, Inject, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';

@Component({
  selector: 'app-profissional',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  templateUrl: './profissional.html',
  // 1. A MÁGICA: Importa o CSS da Landing Page junto com o do profissional
  styleUrls: ['../landing-page/landing-page.css', './profissional.css'],
  // 2. A MÁGICA: Destranca o CSS para o Header ficar transparente e perfeito
  encapsulation: ViewEncapsulation.None 
})
export class ProfissionalComponent implements AfterViewInit {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        this.initFadeInAnimation();
        this.initFaqAccordion();
      }, 100);
    }
  }

  private initFadeInAnimation(): void {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -50px 0px',
      threshold: 0.1
    };
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, observerOptions);
    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  }

  private initFaqAccordion(): void {
    const faqQuestions = document.querySelectorAll('.faq-question');

    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            const isActive = item?.classList.contains('active');
            if (item) {
                if (!isActive) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            }
        });
    });

    // Lógica das Abas do FAQ de Profissionais / Parceiros
    const tabs = document.querySelectorAll('.faq-tab');
    const contents = document.querySelectorAll('.faq-content-wrapper');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        const targetId = tab.getAttribute('data-target');
        if (targetId) {
          document.getElementById(targetId)?.classList.add('active');
        }
      });
    });
  }
}