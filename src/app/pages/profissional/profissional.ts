import { Component, AfterViewInit, Inject, PLATFORM_ID, ViewEncapsulation, computed, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type AbaFaq = 'profissionais' | 'parceiros';

@Component({
  selector: 'app-profissional',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, RouterLink, TranslatePipe],
  templateUrl: './profissional.html',
  // Usa o mesmo visual da página das mães (landing-sections.css) + ajustes próprios
  styleUrls: [
    '../landing-page/landing-page.css',
    '../landing-page/landing-sections.css',
    './profissional.css',
    './profissional-sections.css',
  ],
  encapsulation: ViewEncapsulation.None
})
export class ProfissionalComponent implements AfterViewInit {

  // Os textos abaixo são CHAVES do dicionário (src/app/core/i18n/translations.ts);
  // o HTML traduz com o pipe 't'.

  readonly beneficios = [
    { icone: 'ph-leaf', titulo: 'prof_benefits_card_1_title', descricao: 'prof_benefits_card_1_desc' },
    { icone: 'ph-chart-bar', titulo: 'prof_benefits_card_2_title', descricao: 'prof_benefits_card_2_desc' },
    { icone: 'ph-megaphone', titulo: 'prof_benefits_card_3_title', descricao: 'prof_benefits_card_3_desc' },
  ];

  readonly passos = [
    { icone: 'ph-address-book', titulo: 'prof_timeline_title_1', descricao: 'prof_step_desc_1' },
    { icone: 'ph-magnifying-glass', titulo: 'prof_timeline_title_2', descricao: 'prof_step_desc_2' },
    { icone: 'ph-hand-heart', titulo: 'prof_timeline_title_3', descricao: 'prof_step_desc_3' },
    { icone: 'ph-check-circle', titulo: 'prof_timeline_title_4', descricao: 'prof_step_desc_4' },
  ];

  // Mockup da agenda
  readonly diasSemana = ['cal_dom', 'cal_seg', 'cal_ter', 'cal_qua', 'cal_qui', 'cal_sex', 'cal_sab'];
  readonly diasMes = Array.from({ length: 21 }, (_, i) => i + 1);

  // ---------- FAQ ----------
  private readonly faq: Record<AbaFaq, { pergunta: string; resposta: string }[]> = {
    profissionais: [
      { pergunta: 'prof_faq_q1', resposta: 'prof_faq_a1' },
      { pergunta: 'prof_faq_q2', resposta: 'prof_faq_a2' },
      { pergunta: 'prof_faq_q3', resposta: 'prof_faq_a3' },
    ],
    parceiros: [
      { pergunta: 'prof_partner_q1', resposta: 'prof_partner_a1' },
      { pergunta: 'prof_partner_q2', resposta: 'prof_partner_a2' },
      { pergunta: 'prof_partner_q3', resposta: 'prof_partner_a3' },
    ],
  };
  readonly faqAba = signal<AbaFaq>('profissionais');
  readonly faqAberta = signal<string | null>(null);
  readonly faqAtual = computed(() => this.faq[this.faqAba()]);

  trocarAbaFaq(aba: AbaFaq): void {
    this.faqAba.set(aba);
    this.faqAberta.set(null);
  }

  alternarFaq(pergunta: string): void {
    this.faqAberta.update(atual => (atual === pergunta ? null : pergunta));
  }

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => this.initFadeInAnimation(), 100);
    }
  }

  private initFadeInAnimation(): void {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: '0px 0px -50px 0px', threshold: 0.1 });
    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  }
}
