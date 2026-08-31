import { Component, AfterViewInit, Inject, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, RouterLink],
  templateUrl: './landing-page.html',
  styleUrls: ['./landing-page.css'],
  encapsulation: ViewEncapsulation.None 
})
export class LandingPageComponent implements AfterViewInit {

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.initTheme();
      this.initFadeInAnimation();
      this.initCounters();
      this.initPrivacySystem();
      this.initMobileMenu();
      this.initLoginDropdown();
      this.initFaqAccordion();
    }
  }

  // =========================================================
  // 1. TEMA (CLARO / ESCURO)
  // =========================================================
  private initTheme(): void {
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleIcon = themeToggle?.querySelector('i');

    const applyTheme = (isDark: boolean) => {
      document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      if (themeToggle) {
        themeToggle.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
        if (themeToggleIcon) {
          themeToggleIcon.className = isDark ? 'fa fa-sun' : 'fa fa-moon';
        }
      }
    };

    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme ? savedTheme === 'dark' : prefersDark);

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const isDark = document.body.getAttribute('data-theme') !== 'dark';
        applyTheme(isDark);
      });
    }
  }

  // =========================================================
  // 2. ANIMAÇÃO DE SCROLL (FADE-IN)
  // =========================================================
  private initFadeInAnimation(): void {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -50px 0px',
      threshold: 0.2
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

  // =========================================================
  // 3. ANIMAÇÃO DE CONTADOR (ESTATÍSTICAS)
  // =========================================================
  private initCounters(): void {
    const counters = document.querySelectorAll('.counter');
    const speed = 150;

    const counterObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target as HTMLElement;
                
                const updateCount = () => {
                    const target = +(counter.getAttribute('data-target') || '0');
                    const count = +counter.innerText;
                    const inc = target / speed;

                    if (count < target) {
                        counter.innerText = Math.ceil(count + inc).toString();
                        setTimeout(updateCount, 15);
                    } else {
                        counter.innerText = target.toString();
                    }
                };

                updateCount();
                observer.unobserve(counter);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => counterObserver.observe(counter));
  }

  // =========================================================
  // 4. SISTEMA DE PRIVACIDADE E COOKIES
  // =========================================================
  private initPrivacySystem(): void {
    const pageBody = document.querySelector('body');
    const pageOverlay = document.getElementById('page-overlay');
    const cookieBanner = document.getElementById('cookie-banner');
    const preferencesModal = document.getElementById('preferences-modal');
    const cookieWidget = document.getElementById('cookie-widget');
    
    const acceptBannerBtn = document.getElementById('banner-btn-accept');
    const prefsBannerBtn = document.getElementById('banner-btn-prefs');
    const bannerLinkPrefs = document.getElementById('banner-link-prefs');

    const closeModalBtn = document.getElementById('close-modal');
    const acceptModalBtn = document.getElementById('modal-accept-all') as HTMLButtonElement;
    const consentCheckbox = document.getElementById('consent-checkbox') as HTMLInputElement;
    
    const loginButtons = document.querySelectorAll('.btn-login-trigger');
    const consentKey = 'eloMaterno_TermosAceitos';

    const acceptPolicies = () => {
        localStorage.setItem(consentKey, 'true'); 
        if (pageBody) pageBody.classList.remove('blocked');
        if (pageOverlay) pageOverlay.classList.add('hidden');
        if (cookieBanner) cookieBanner.classList.add('hidden');
        if (preferencesModal) preferencesModal.classList.add('hidden');
        window.location.href = "formPerfil.html"; 
    };

    const showPreferences = () => {
        if (cookieBanner) cookieBanner.classList.add('hidden');
        if (preferencesModal) preferencesModal.classList.remove('hidden');
        if (pageOverlay) pageOverlay.classList.remove('hidden'); 
    };

    const showPreferencesFromWidget = () => {
        if (preferencesModal) preferencesModal.classList.remove('hidden');
        if (pageOverlay) pageOverlay.classList.remove('hidden'); 
    };

    const closeModal = () => {
        if (preferencesModal) preferencesModal.classList.add('hidden');
        if (localStorage.getItem(consentKey) !== 'true' && pageBody?.classList.contains('blocked')) {
            if (cookieBanner) cookieBanner.classList.remove('hidden');
        } else {
            if (pageOverlay) pageOverlay.classList.add('hidden');
        }
    };

    const handleLoginClick = (e: Event) => {
        e.preventDefault();
        const hasAccepted = localStorage.getItem(consentKey) === 'true';

        if (hasAccepted) {
            window.location.href = "formPerfil.html"; 
        } else {
            if (pageBody) pageBody.classList.add('blocked');
            if (pageOverlay) pageOverlay.classList.remove('hidden'); 
            if (cookieBanner) cookieBanner.classList.remove('hidden'); 
        }
    };

    loginButtons.forEach(btn => btn.addEventListener('click', handleLoginClick));
    if (acceptBannerBtn) acceptBannerBtn.addEventListener('click', acceptPolicies);
    if (prefsBannerBtn) prefsBannerBtn.addEventListener('click', showPreferences);
    if (bannerLinkPrefs) bannerLinkPrefs.addEventListener('click', (e) => { e.preventDefault(); showPreferences(); });
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (acceptModalBtn) acceptModalBtn.addEventListener('click', acceptPolicies);
    if (cookieWidget) cookieWidget.addEventListener('click', showPreferencesFromWidget);

    if (consentCheckbox && acceptModalBtn) {
        consentCheckbox.addEventListener('change', () => {
            acceptModalBtn.disabled = !consentCheckbox.checked;
            acceptModalBtn.innerText = consentCheckbox.checked ? "Confirmar e Entrar" : "Confirme o Aceite";
        });
    }

    if (cookieWidget) cookieWidget.classList.remove('hidden');
    if (pageBody) pageBody.classList.remove('blocked');
  }

  // =========================================================
  // 5. MENU HAMBÚRGUER (MOBILE)
  // =========================================================
  private initMobileMenu(): void {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navMenu = document.getElementById('nav-menu');
    const mobileAccessibilityBtn = document.getElementById('mobile-accessibility-toggle');
    const mobileThemeBtn = document.getElementById('mobile-theme-toggle');

    const closeMobileMenu = () => {
        navMenu?.classList.remove('active');
        const icon = mobileMenuBtn?.querySelector('i');
        if (icon) {
            icon.classList.remove('fa-xmark');
            icon.classList.add('fa-bars');
        }
    };

    if (mobileMenuBtn && navMenu) {
        mobileMenuBtn.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            const icon = mobileMenuBtn.querySelector('i');
            if (navMenu.classList.contains('active')) {
                icon?.classList.remove('fa-bars');
                icon?.classList.add('fa-xmark');
            } else {
                icon?.classList.remove('fa-xmark');
                icon?.classList.add('fa-bars');
            }
        });
    }

    if (mobileAccessibilityBtn) {
        mobileAccessibilityBtn.addEventListener('click', () => {
            document.getElementById('accessibility-toggle')?.click();
            closeMobileMenu();
        });
    }

    if (mobileThemeBtn) {
        mobileThemeBtn.addEventListener('click', () => {
            document.getElementById('theme-toggle')?.click();
            closeMobileMenu();
        });
    }
  }

  private initLoginDropdown(): void {
    const loginBtn = document.getElementById('login-dropdown-btn');
    const loginWrapper = loginBtn ? loginBtn.closest('.login-dropdown-wrapper') : null;

    if (loginBtn && loginWrapper) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            loginWrapper.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!loginWrapper.contains(e.target as Node)) {
                loginWrapper.classList.remove('active');
            }
        });
    }
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
  }
}