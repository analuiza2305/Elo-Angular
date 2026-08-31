import { Component, Input, HostListener, OnInit, Inject, PLATFORM_ID, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink, Router } from '@angular/router';

import { auth, db } from '../../core/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit {
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  @Input() tipo: 'landing' | 'mae' | 'profissional' | 'parceiro' | 'adm' | 'auth' = 'landing';
  @Output() menuAdm = new EventEmitter<void>();

  // Controles de Menus
  isMobileMenuOpen = false;
  isLoginDropdownOpen = false;
  isLangMenuOpen = false;
  isAccMenuOpen = false;
  isDarkMode = false;
  isUserDropdownOpen = false;

  menuAberto = signal<boolean>(false);

  // Dados do Usuário
  currentUser = signal<any>(null);
  userName = signal<string>('Usuária');
  userAvatar = signal<string>('./img/avatar_usuario.png');

  // Variáveis de Acessibilidade Avançada
  tamanhoFonte = 16;
  espacamentoLinha = 1.5;
  filtroDaltonismoIndex = 0;
  filtrosSVG = ['', 'url(#protanopia)', 'url(#deuteranopia)', 'url(#tritanopia)', 'url(#Acromatopsia)'];
  
  leituraVozAtiva = signal<boolean>(false);
  mascaraAtiva = signal<boolean>(false);
  altoContrasteAtivo = signal<boolean>(false);
  negritoAtivo = signal<boolean>(false);
  mouseY = signal<number>(0);

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const savedTheme = localStorage.getItem('theme');
      this.isDarkMode = savedTheme === 'dark';
      this.applyTheme();

      // Ativa tradução globalmente
      this.initGlobalLanguageSelector();
    }

    if (this.tipo !== 'landing' && this.tipo !== 'auth') {
      // CORREÇÃO: Adicionado o tipo 'any' para o firebaseUser
      onAuthStateChanged(auth, async (firebaseUser: any) => {
        if (firebaseUser) {
          this.currentUser.set(firebaseUser);
          if (firebaseUser.displayName) this.formatAndSetName(firebaseUser.displayName);

          try {
            let docRef = doc(db, 'usuarios', firebaseUser.uid);
            if (this.tipo === 'profissional') {
              let profDoc = await getDoc(doc(db, 'advogados', firebaseUser.uid));
              if (!profDoc.exists()) profDoc = await getDoc(doc(db, 'psicologos', firebaseUser.uid));
              if (profDoc.exists()) this.setUserData(profDoc.data());
            } else if (this.tipo === 'parceiro') {
              let parcDoc = await getDoc(doc(db, 'parceiros', firebaseUser.uid));
              if (parcDoc.exists()) this.setUserData(parcDoc.data());
            } else {
              let userDoc = await getDoc(docRef);
              if (userDoc.exists()) this.setUserData(userDoc.data());
            }
          } catch (e) { console.error(e); }
        }
      });
    }
  }

  private setUserData(data: any) {
    if (data['nome']) this.formatAndSetName(data['nome']);
    if (data['fotoURL'] || data['avatar']) this.userAvatar.set(data['fotoURL'] || data['avatar']);
  }

  private formatAndSetName(fullName: string) {
    const names = fullName.trim().split(' ');
    this.userName.set(names.length > 1 ? `${names[0]} ${names[names.length - 1]}` : names[0]);
  }

  // --- TRADUÇÃO COMPLETA (MANTIDA INTACTA) ---
  private initGlobalLanguageSelector() {
    const translations: Record<string, Record<string, string>> = {
      pt: {
        nav_consultorias: 'Consultorias', nav_como_funciona: 'Como funciona', nav_profissional: 'Sou Profissional',
        hero_access: 'Acessar plataforma', login_mae: 'Acesso para Mães', login_parceiro: 'Acesso para Parceiros',
        prof_hero_title: 'Faça parte da nossa <span>rede de apoio</span>',
        prof_hero_subtitle: 'Conecte-se com mães que precisam da sua expertise jurídica ou psicológica. Ofereça acolhimento, orientação e faça a diferença.',
        prof_cta_btn: 'Cadastrar como Profissional'
      },
      en: {
        nav_consultorias: 'Consultations', nav_como_funciona: 'How it works', nav_profissional: 'I’m a Professional',
        hero_access: 'Access platform', login_mae: 'Access for Mothers', login_parceiro: 'Access for Partners',
        prof_hero_title: 'Be part of our <span>support network</span>',
        prof_hero_subtitle: 'Connect with mothers who need your legal or psychological expertise. Offer care, guidance, and make a difference.',
        prof_cta_btn: 'Register as a Professional'
      },
      es: {
        nav_consultorias: 'Consultas', nav_como_funciona: 'Cómo funciona', nav_profissional: 'Soy profesional',
        hero_access: 'Acceder a la plataforma', login_mae: 'Acceso para Madres', login_parceiro: 'Acceso para Aliados',
        prof_hero_title: 'Forma parte de nuestra <span>red de apoyo</span>',
        prof_hero_subtitle: 'Conéctate con madres que necesitan tu experiencia jurídica o psicológica. Ofrece acogida, orientación y marca la diferencia.',
        prof_cta_btn: 'Registrarse como Profesional'
      }
    };

    const applyLanguage = (lang: string) => {
      const selectedLang = translations[lang] ? lang : 'pt';
      const dictionary = translations[selectedLang];
      document.documentElement.lang = selectedLang === 'pt' ? 'pt-BR' : selectedLang;

      const currentFlag = document.getElementById('current-flag') as HTMLImageElement;
      if (currentFlag) {
        const flagCode = selectedLang === 'pt' ? 'br' : selectedLang === 'en' ? 'us' : 'es';
        currentFlag.src = `https://flagcdn.com/w20/${flagCode}.png`;
      }

      document.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        if (key && dictionary[key]) {
          if (element.getAttribute('data-i18n-html') === 'true') {
            element.innerHTML = dictionary[key];
          } else {
            element.textContent = dictionary[key];
          }
        }
      });
      localStorage.setItem('preferredLanguage', selectedLang);
    };

    const langMenu = document.getElementById('language-menu');
    if (langMenu) {
      langMenu.querySelectorAll('li').forEach((item) => {
        item.addEventListener('click', () => {
          const lang = item.getAttribute('data-lang');
          if (lang) applyLanguage(lang);
          this.isLangMenuOpen = false;
        });
      });
    }
    applyLanguage(localStorage.getItem('preferredLanguage') || 'pt');
  }

  // --- ACESSIBILIDADE AVANÇADA EM ANGULAR ---
  toggleMenu() {
    // CORREÇÃO: tipagem boolean no update
    this.menuAberto.update((v: boolean) => !v);
  }

  aumentarFonte() {
    if (this.tamanhoFonte < 24) {
      this.tamanhoFonte += 2;
      document.documentElement.style.fontSize = `${this.tamanhoFonte}px`;
    }
  }

  diminuirFonte() {
    if (this.tamanhoFonte > 12) {
      this.tamanhoFonte -= 2;
      document.documentElement.style.fontSize = `${this.tamanhoFonte}px`;
    }
  }

  alternarFiltroDaltonismo() {
    this.filtroDaltonismoIndex = (this.filtroDaltonismoIndex + 1) % this.filtrosSVG.length;
    document.body.style.filter = this.filtrosSVG[this.filtroDaltonismoIndex];
  }

  lerEmVozAlta() {
    this.leituraVozAtiva.update((v: boolean) => !v);
    if (!this.leituraVozAtiva()) {
      window.speechSynthesis.cancel();
      return;
    }
    const textoSelecionado = window.getSelection()?.toString();
    const textoParaLer = textoSelecionado || document.querySelector('main')?.innerText || 'Selecione um texto para ler.';
    const fala = new SpeechSynthesisUtterance(textoParaLer);
    fala.lang = 'pt-BR';
    window.speechSynthesis.speak(fala);
  }

  alternarMascara() {
    this.mascaraAtiva.update((v: boolean) => !v);
  }

  alternarNegrito() {
    this.negritoAtivo.update((v: boolean) => !v);
    if (this.negritoAtivo()) document.body.classList.add('acessibilidade-negrito');
    else document.body.classList.remove('acessibilidade-negrito');
  }

  alternarAltoContraste() {
    this.altoContrasteAtivo.update((v: boolean) => !v);
    if (this.altoContrasteAtivo()) document.body.classList.add('acessibilidade-alto-contraste');
    else document.body.classList.remove('acessibilidade-alto-contraste');
  }

  aumentarEspacamento() {
    if (this.espacamentoLinha < 2.5) {
      this.espacamentoLinha += 0.2;
      document.body.style.lineHeight = `${this.espacamentoLinha}`;
    }
  }

  diminuirEspacamento() {
    if (this.espacamentoLinha > 1.0) {
      this.espacamentoLinha -= 0.2;
      document.body.style.lineHeight = `${this.espacamentoLinha}`;
    }
  }

  redefinirAcessibilidade() {
    this.tamanhoFonte = 16;
    this.espacamentoLinha = 1.5;
    this.filtroDaltonismoIndex = 0;
    
    document.documentElement.style.fontSize = '16px';
    document.body.style.lineHeight = '';
    document.body.style.filter = '';
    
    this.negritoAtivo.set(false);
    this.altoContrasteAtivo.set(false);
    this.mascaraAtiva.set(false);
    this.leituraVozAtiva.set(false);
    
    window.speechSynthesis.cancel();
    document.body.classList.remove('acessibilidade-negrito', 'acessibilidade-alto-contraste');
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.mascaraAtiva()) {
      this.mouseY.set(event.clientY - 50); 
    }
  }

  // --- AÇÕES DE CLIQUE DE MENUS E TEMA (MANTIDAS) ---
  toggleMobileMenu() { this.isMobileMenuOpen = !this.isMobileMenuOpen; }
  toggleMenuAdm() { this.menuAdm.emit(); }
  
  toggleLoginDropdown(event: Event) {
    event.stopPropagation();
    this.isLoginDropdownOpen = !this.isLoginDropdownOpen;
    this.isAccMenuOpen = false;
    this.isLangMenuOpen = false;
  }

  toggleUserDropdown(event: Event) {
    event.stopPropagation();
    this.isUserDropdownOpen = !this.isUserDropdownOpen;
    this.isAccMenuOpen = false;
    this.isLangMenuOpen = false;
  }

  toggleAccMenu(event: Event) {
    event.stopPropagation();
    this.isAccMenuOpen = !this.isAccMenuOpen;
    this.isLoginDropdownOpen = false;
    this.isLangMenuOpen = false;
  }

  toggleLangMenu(event: Event) {
    event.stopPropagation();
    this.isLangMenuOpen = !this.isLangMenuOpen;
    this.isLoginDropdownOpen = false;
    this.isAccMenuOpen = false;
  }

  toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    this.applyTheme();
  }

  private applyTheme() {
    if (isPlatformBrowser(this.platformId)) {
      document.body.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
      localStorage.setItem('theme', this.isDarkMode ? 'dark' : 'light');
    }
  }

  async logout() {
    await signOut(auth);
    this.router.navigate(['/login']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    this.isLoginDropdownOpen = false;
    this.isAccMenuOpen = false;
    this.isUserDropdownOpen = false;
    this.isLangMenuOpen = false;
    this.menuAberto.set(false); // Fecha o menu de acessibilidade ao clicar fora
  }
}