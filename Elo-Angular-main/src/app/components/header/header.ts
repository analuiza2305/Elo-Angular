import { Component, Input, HostListener, OnInit, Inject, PLATFORM_ID, inject, signal, Output, EventEmitter, Injector, afterNextRender } from '@angular/core';
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
  private injector = inject(Injector);

  @Input() tipo: 'landing' | 'mae' | 'profissional' | 'parceiro' | 'adm' | 'auth' = 'landing';
  @Input() currentLanding: 'mae' | 'profissional' = 'mae';
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
  currentFlagUrl = signal<string>('https://flagcdn.com/w20/br.png');

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

      afterNextRender(() => {
        this.aplicarIdioma(localStorage.getItem('preferredLanguage') || 'pt');
      }, { injector: this.injector });
    }

    if (this.tipo !== 'landing' && this.tipo !== 'auth') {
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

  // --- TRADUÇÃO ---
  private readonly translations: Record<string, Record<string, string>> = {
    pt: {
      // Menu Header
      nav_consultorias: 'Consultorias', nav_como_funciona: 'Como funciona', nav_profissional: 'Sou Profissional',
      nav_a_plataforma: 'A Plataforma', nav_para_maes: 'Para Mães', nav_sou_mae: 'Sou Mãe',
      hero_access: 'Acessar plataforma', login_mae: 'Acesso para Mães', login_parceiro: 'Acesso para Parceiros',
      
      // --- LANDING PAGE: MÃES ---
      hero_title: 'Maternidade com o <span>apoio que você merece.</span>',
      hero_subtitle: 'Consultorias <strong>gratuitas</strong> com psicólogos e advogados, conteúdo especializado e uma comunidade que acolhe — tudo em um só sistema.',
      hero_waitlist: '+1.000 mães',
      partners_title: 'Apoiado por quem faz a diferença',
      stat_mothers: 'Mães conectadas',
      stat_consultas: 'Consultas Realizadas',
      stat_cities: 'Cidades Alcançadas',
      consult_title_1: 'Saúde Mental:',
      consult_title_1_bold: 'Consultorias',
      consult_desc_1: 'Agende sessões de escuta e acolhimento com psicólogos(as) e advogados(as) voluntárias. Um espaço seguro, 100% gratuito e confidencial para cuidar de você durante a maternidade.',
      consult_btn_1: 'AGENDAR SESSÃO',
      consult_title_2: 'Direitos da Mãe:',
      consult_title_2_bold: 'Orientação Jurídica',
      consult_desc_2: 'Tenha acesso a advogadas parceiras para tirar dúvidas sobre pensão alimentícia, licença-maternidade, guarda e outras questões legais, sem nenhum custo.',
      consult_btn_2: 'FALAR COM ADVOGADA',
      feat_title: 'Tudo o que você precisa em um só lugar',
      feat_subtitle: 'Conheça as ferramentas exclusivas criadas para facilitar a sua jornada na maternidade.',
      feat_1_title: 'Teleconsulta Integrada',
      feat_1_desc: 'Sessões de escuta e orientação jurídica por vídeo, dentro de um ambiente seguro e 100% confidencial.',
      feat_2_title: 'Fórum de Acolhimento',
      feat_2_desc: 'Comunidade moderada por especialistas para você trocar experiências e tirar dúvidas com outras mães.',
      feat_3_title: 'Agendamento Simplificado',
      feat_3_desc: 'Escolha o profissional e o melhor horário para você em apenas dois cliques. Sem burocracia.',
      social_title: 'Apoiando mães <span>reais</span>',
      social_subtitle: 'Veja o que as mães estão falando sobre a nossa rede de apoio.',
      testim_1: '"O EloMaterno me salvou em um momento de muita angústia. Consegui uma orientação jurídica rápida e gratuita que me deu paz."',
      testim_1_role: 'Mãe solo (São Paulo)',
      testim_2: '"Achei que o processo seria demorado, mas em dois toques agendei uma escuta com uma psicóloga maravilhosa. É um abraço em forma de app."',
      testim_2_role: 'Mãe de gêmeos',
      cta_title: 'Pronta para ter o apoio que você merece?',
      cta_subtitle: 'Junte-se a milhares de mães e acesse agora mesmo a sua rede de acolhimento e informação.',
      cta_btn: 'Acessar a Plataforma',
      cta_secure: 'Ambiente 100% seguro, gratuito e confidencial.',

      // --- LANDING PAGE: PROFISSIONAIS & PARCEIROS ---
      prof_hero_title: 'Fazer a diferença nunca foi<br><span class="scroller-container"><span class="scroller-content"><span class="scroller-item">tão prático.</span><span class="scroller-item">tão impactante.</span><span class="scroller-item">tão humano.</span><span class="scroller-item">tão prático.</span></span></span>',
      prof_hero_subtitle: 'Essa é a plataforma que times usam para manter o foco. Faça parte da nossa rede de apoio. Ofereça sua expertise como voluntário ou invista na transformação social.',
      prof_hero_btn_professional: 'Sou Profissional',
      prof_hero_btn_partner: 'Sou Empresa Parceira',
      prof_panel_title: 'Painel de Atendimentos',
      prof_panel_mothers: 'Mães Apoiadas',
      prof_panel_growth: '12.5% aumento',
      prof_agenda_status: 'Status da Agenda',
      prof_status_active: 'Ativo',
      prof_status_pending: 'Aguardando',
      prof_status_inactive: 'Pausado',
      prof_benefits_title: 'Por que apoiar o EloMaterno?',
      prof_benefits_subtitle: 'Transforme seu investimento em impacto real e mensurável na vida de milhares de famílias.',
      prof_benefits_card_1_title: 'Impacto ESG Direto',
      prof_benefits_card_1_desc: 'Fortaleça a pauta Social (S) do seu ESG. Apoie ativamente a saúde mental, os direitos das mulheres e a reintegração de mães no mercado de trabalho.',
      prof_benefits_card_2_title: 'Transparência de Dados',
      prof_benefits_card_2_desc: 'Tenha acesso a painéis mensuráveis. Saiba exatamente quantas mães foram acolhidas e orientadas graças ao patrocínio da sua marca.',
      prof_benefits_card_3_title: 'Visibilidade de Propósito',
      prof_benefits_card_3_desc: 'Sua marca ganha destaque especial em nossa plataforma como "Parceira Apoiadora", conectando-se a uma causa nobre e urgente.',
      prof_impact_title: 'Como funciona a sua jornada de impacto?',
      prof_impact_subtitle: 'Um processo direto e sem burocracia para você focar no que realmente importa: ajudar.',
      prof_timeline_1: 'Passo 1', prof_timeline_title_1: 'Cadastro',
      prof_timeline_2: 'Passo 2', prof_timeline_title_2: 'Localiza',
      prof_timeline_3: 'Passo 3', prof_timeline_title_3: 'Ajuda',
      prof_timeline_4: 'Passo 4', prof_timeline_title_4: 'Conclui',
      prof_for_professionals: 'Para Profissionais',
      prof_section_title_1: 'Atendimento humanizado:',
      prof_section_title_1_bold: 'Consultório Virtual',
      prof_section_desc_1: 'As consultorias são realizadas com apenas um clique. O sistema gera automaticamente um link seguro e o envia para a mãe, permitindo que a chamada seja feita diretamente pelo Google Meet.',
      prof_access_click: 'Acesso prático em um clique.',
      prof_meet: 'Chamadas integradas via Google Meet.',
      prof_agenda_title: 'Sua rotina no controle:',
      prof_agenda_title_bold: 'Gestão de Agenda',
      prof_agenda_desc: 'Organize sua disponibilidade e sincronize tudo com o Google Agenda em poucos cliques.',
      prof_agenda_benefit_1: 'Defina blocos de horários.',
      prof_agenda_benefit_2: 'Sincronia automática.',
      prof_agenda_month: 'Junho 2026',
      prof_agenda_appointment_title: 'Nova consulta agendada',
      prof_agenda_appointment_time: 'Maria S. - Hoje, 14:00',
      prof_agenda_sync_title: 'Sincronização Ativa',
      prof_agenda_sync_connected: 'Conectado à sua conta',
      prof_portal_title: 'Sua Empresa',
      prof_portal_subtitle: 'Painel de Conteúdo',
      prof_portal_post_title: 'Artigo: Retorno ao Mercado',
      prof_portal_post_desc: 'Dicas práticas para mães que buscam novas oportunidades e desejam atualizar seus currículos.',
      prof_portal_tag_1: 'Carreira',
      prof_portal_tag_2: 'Leitura: 5 min',
      prof_portal_status: 'Publicado no portal',
      prof_portal_forum_title: 'Dúvida no Fórum',
      prof_portal_forum_time: 'Há 2 horas',
      prof_portal_forum_question: '"Como funciona a questão da flexibilidade no formato de trabalho híbrido?"',
      prof_portal_forum_reply: 'Empresa respondeu',
      prof_for_partners: 'Para Empresas Parceiras',
      prof_section_title_2: 'Conexão direta:',
      prof_section_title_2_bold: 'Portal do Parceiro',
      prof_section_desc_2: 'Participe ativamente do dia a dia da nossa comunidade. Nossa plataforma oferece um espaço dedicado para sua empresa publicar conteúdos, divulgar ações e apoiar as mães de perto.',
      prof_portal_benefit_1: 'Divulgue eventos, vagas e campanhas próprias.',
      prof_portal_benefit_2: 'Publique artigos educativos e informativos.',
      prof_portal_benefit_3: 'Interaja e tire dúvidas no Fórum de Acolhimento.',
      prof_faq_title: 'Dúvidas Frequentes',
      prof_faq_subtitle: 'Tudo o que você precisa saber antes de se juntar à nossa rede.',
      prof_faq_tab_professional: 'Para Profissionais',
      prof_faq_tab_partner: 'Para Empresas Parceiras',
      prof_faq_q1: 'Preciso pagar alguma taxa para atender na plataforma?',
      prof_faq_a1: 'Não. A atuação dos profissionais (psicólogos e advogados) no EloMaterno é 100% voluntária. Nossa plataforma fornece toda a infraestrutura de vídeo e agenda gratuitamente para que você possa focar apenas em ajudar quem precisa.',
      prof_faq_q2: 'Quantas horas por semana preciso dedicar?',
      prof_faq_a2: 'Você tem total controle. Pelo nosso sistema de Gestão de Agenda, você pode abrir blocos de horários de acordo com a sua disponibilidade, seja 1 hora por semana ou 10 horas. A flexibilidade é sua.',
      prof_faq_q3: 'Quem são as mães que vou atender?',
      prof_faq_a3: 'Atendemos mães de diversas regiões que passam por uma triagem no momento do cadastro. O foco principal são mães solo ou em situação de vulnerabilidade que buscam orientação jurídica ou acolhimento psicológico.',
      prof_partner_q1: 'Como nossa empresa pode divulgar eventos ou vagas?',
      prof_partner_a1: 'Temos um painel exclusivo para Parceiros! Lá, sua empresa pode publicar eventos, feiras de empregabilidade, cursos de capacitação e vagas de emprego diretamente para a nossa comunidade de mães, fomentando a reintegração no mercado.',
      prof_partner_q2: 'É possível realizar doações ou patrocínios institucionais?',
      prof_partner_a2: 'Sim! Empresas parceiras podem realizar doações institucionais, patrocinar campanhas específicas ou investir no desenvolvimento de novas ferramentas da plataforma. Todo apoio é revertido para a ampliação do impacto social.',
      prof_partner_q3: 'Nós recebemos relatórios de impacto (ESG)?',
      prof_partner_a3: 'Com certeza. Fornecemos dashboards transparentes e relatórios mensais mostrando quantas vidas foram impactadas através do apoio da sua empresa, dados essenciais para o pilar "Social" das suas metas ESG.'
    },
    
    en: {
      // Header Menu
      nav_consultorias: 'Consultations', nav_como_funciona: 'How it works', nav_profissional: 'I’m a Professional',
      nav_a_plataforma: 'The Platform', nav_para_maes: 'For Mothers', nav_sou_mae: 'I am a Mother',
      hero_access: 'Access platform', login_mae: 'Access for Mothers', login_parceiro: 'Access for Partners',
      
      // --- LANDING PAGE: MOTHERS ---
      hero_title: 'Motherhood with the <span>support you deserve.</span>',
      hero_subtitle: '<strong>Free</strong> consultations with psychologists and lawyers, specialized content, and a welcoming community — all in one system.',
      hero_waitlist: '+1,000 mothers',
      partners_title: 'Supported by those who make a difference',
      stat_mothers: 'Connected mothers',
      stat_consultas: 'Consultations Completed',
      stat_cities: 'Cities Reached',
      consult_title_1: 'Mental Health:',
      consult_title_1_bold: 'Consultations',
      consult_desc_1: 'Schedule listening and support sessions with volunteer psychologists and lawyers. A safe, 100% free, and confidential space to care for you during motherhood.',
      consult_btn_1: 'SCHEDULE SESSION',
      consult_title_2: 'Mother\'s Rights:',
      consult_title_2_bold: 'Legal Guidance',
      consult_desc_2: 'Get access to partner lawyers to answer questions about child support, maternity leave, custody, and other legal issues at no cost.',
      consult_btn_2: 'SPEAK WITH A LAWYER',
      feat_title: 'Everything you need in one place',
      feat_subtitle: 'Discover the exclusive tools created to make your motherhood journey easier.',
      feat_1_title: 'Integrated Teleconsultation',
      feat_1_desc: 'Listening and legal guidance sessions via video in a safe and 100% confidential environment.',
      feat_2_title: 'Support Forum',
      feat_2_desc: 'Community moderated by experts for you to exchange experiences and ask questions with other mothers.',
      feat_3_title: 'Simplified Scheduling',
      feat_3_desc: 'Choose the professional and the best time for you in just two clicks. No bureaucracy.',
      social_title: 'Supporting <span>real</span> mothers',
      social_subtitle: 'See what mothers are saying about our support network.',
      testim_1: '"EloMaterno saved me in a moment of great anguish. I got quick and free legal guidance that gave me peace."',
      testim_1_role: 'Single mother (São Paulo)',
      testim_2: '"I thought the process would take long, but in two taps I scheduled a session with a wonderful psychologist. It\'s a hug in the form of an app."',
      testim_2_role: 'Mother of twins',
      cta_title: 'Ready to get the support you deserve?',
      cta_subtitle: 'Join thousands of mothers and access your support and information network right now.',
      cta_btn: 'Access the Platform',
      cta_secure: '100% safe, free, and confidential environment.',

      // --- LANDING PAGE: PROFESSIONALS & PARTNERS ---
      prof_hero_title: 'Making a difference has never been<br><span class="scroller-container"><span class="scroller-content"><span class="scroller-item">so practical.</span><span class="scroller-item">so impactful.</span><span class="scroller-item">so human.</span><span class="scroller-item">so practical.</span></span></span>',
      prof_hero_subtitle: 'This is the platform teams use to stay focused. Be part of our support network. Offer your expertise as a volunteer or invest in social transformation.',
      prof_hero_btn_professional: 'I am a Professional',
      prof_hero_btn_partner: 'I am a Partner Company',
      prof_panel_title: 'Appointments Dashboard',
      prof_panel_mothers: 'Mothers Supported',
      prof_panel_growth: '12.5% increase',
      prof_agenda_status: 'Schedule Status',
      prof_status_active: 'Active',
      prof_status_pending: 'Pending',
      prof_status_inactive: 'Paused',
      prof_benefits_title: 'Why support EloMaterno?',
      prof_benefits_subtitle: 'Turn your investment into real and measurable impact in the lives of thousands of families.',
      prof_benefits_card_1_title: 'Direct ESG Impact',
      prof_benefits_card_1_desc: 'Strengthen the Social (S) pillar of your ESG. Actively support mental health, women\'s rights, and the reintegration of mothers into the job market.',
      prof_benefits_card_2_title: 'Data Transparency',
      prof_benefits_card_2_desc: 'Get access to measurable dashboards. Know exactly how many mothers were welcomed and guided thanks to your brand\'s sponsorship.',
      prof_benefits_card_3_title: 'Visibility of Purpose',
      prof_benefits_card_3_desc: 'Your brand gains special prominence on our platform as a "Supporting Partner", connecting to a noble and urgent cause.',
      prof_impact_title: 'How does your impact journey work?',
      prof_impact_subtitle: 'A straightforward, bureaucracy-free process so you can focus on what really matters: helping.',
      prof_timeline_1: 'Step 1', prof_timeline_title_1: 'Registration',
      prof_timeline_2: 'Step 2', prof_timeline_title_2: 'Locate',
      prof_timeline_3: 'Step 3', prof_timeline_title_3: 'Help',
      prof_timeline_4: 'Step 4', prof_timeline_title_4: 'Complete',
      prof_for_professionals: 'For Professionals',
      prof_section_title_1: 'Humanized care:',
      prof_section_title_1_bold: 'Virtual Clinic',
      prof_section_desc_1: 'Consultations are held with just one click. The system automatically generates a secure link and sends it to the mother, allowing the call to be made directly via Google Meet.',
      prof_access_click: 'Practical one-click access.',
      prof_meet: 'Integrated calls via Google Meet.',
      prof_agenda_title: 'Your routine in control:',
      prof_agenda_title_bold: 'Schedule Management',
      prof_agenda_desc: 'Organize your availability and sync everything with Google Calendar in a few clicks.',
      prof_agenda_benefit_1: 'Define time blocks.',
      prof_agenda_benefit_2: 'Automatic synchronization.',
      prof_agenda_month: 'June 2026',
      prof_agenda_appointment_title: 'New appointment scheduled',
      prof_agenda_appointment_time: 'Maria S. - Today, 2:00 PM',
      prof_agenda_sync_title: 'Active Synchronization',
      prof_agenda_sync_connected: 'Connected to your account',
      prof_portal_title: 'Your Company',
      prof_portal_subtitle: 'Content Dashboard',
      prof_portal_post_title: 'Article: Return to the Market',
      prof_portal_post_desc: 'Practical tips for mothers looking for new opportunities and wanting to update their resumes.',
      prof_portal_tag_1: 'Career',
      prof_portal_tag_2: 'Read: 5 min',
      prof_portal_status: 'Published on the portal',
      prof_portal_forum_title: 'Question in the Forum',
      prof_portal_forum_time: '2 hours ago',
      prof_portal_forum_question: '"How does flexibility work in a hybrid work format?"',
      prof_portal_forum_reply: 'Company replied',
      prof_for_partners: 'For Partner Companies',
      prof_section_title_2: 'Direct connection:',
      prof_section_title_2_bold: 'Partner Portal',
      prof_section_desc_2: 'Actively participate in our community\'s daily life. Our platform offers a dedicated space for your company to publish content, promote actions, and closely support mothers.',
      prof_portal_benefit_1: 'Promote your own events, job openings, and campaigns.',
      prof_portal_benefit_2: 'Publish educational and informative articles.',
      prof_portal_benefit_3: 'Interact and answer questions in the Support Forum.',
      prof_faq_title: 'Frequently Asked Questions',
      prof_faq_subtitle: 'Everything you need to know before joining our network.',
      prof_faq_tab_professional: 'For Professionals',
      prof_faq_tab_partner: 'For Partner Companies',
      prof_faq_q1: 'Do I need to pay a fee to provide services on the platform?',
      prof_faq_a1: 'No. The work of professionals (psychologists and lawyers) on EloMaterno is 100% voluntary. Our platform provides all the video and scheduling infrastructure for free so you can focus solely on helping those in need.',
      prof_faq_q2: 'How many hours a week do I need to dedicate?',
      prof_faq_a2: 'You are in total control. Through our Schedule Management system, you can open time blocks according to your availability, whether it\'s 1 hour a week or 10 hours. The flexibility is yours.',
      prof_faq_q3: 'Who are the mothers I will be attending to?',
      prof_faq_a3: 'We assist mothers from various regions who go through a screening process upon registration. The main focus is on single mothers or those in vulnerable situations seeking legal guidance or psychological support.',
      prof_partner_q1: 'How can our company promote events or job openings?',
      prof_partner_a1: 'We have an exclusive Partner dashboard! There, your company can post events, employability fairs, training courses, and job openings directly to our community of mothers, fostering reintegration into the job market.',
      prof_partner_q2: 'Is it possible to make institutional donations or sponsorships?',
      prof_partner_a2: 'Yes! Partner companies can make institutional donations, sponsor specific campaigns, or invest in the development of new platform tools. All support is directed towards expanding social impact.',
      prof_partner_q3: 'Do we receive impact reports (ESG)?',
      prof_partner_a3: 'Absolutely. We provide transparent dashboards and monthly reports showing how many lives were impacted through your company\'s support, essential data for the "Social" pillar of your ESG goals.'
    },

    es: {
      // Header Menu
      nav_consultorias: 'Consultas', nav_como_funciona: 'Cómo funciona', nav_profissional: 'Soy profesional',
      nav_a_plataforma: 'La Plataforma', nav_para_maes: 'Para Madres', nav_sou_mae: 'Soy Madre',
      hero_access: 'Acceder a la plataforma', login_mae: 'Acceso para Madres', login_parceiro: 'Acceso para Aliados',
      
      // --- LANDING PAGE: MOTHERS ---
      hero_title: 'Maternidad con el <span>apoyo que mereces.</span>',
      hero_subtitle: 'Consultorías <strong>gratuitas</strong> con psicólogos y abogados, contenido especializado y una comunidad acogedora — todo en un solo sistema.',
      hero_waitlist: '+1.000 madres',
      partners_title: 'Apoyado por quienes marcan la diferencia',
      stat_mothers: 'Madres conectadas',
      stat_consultas: 'Consultas Realizadas',
      stat_cities: 'Ciudades Alcanzadas',
      consult_title_1: 'Salud Mental:',
      consult_title_1_bold: 'Consultorías',
      consult_desc_1: 'Programa sesiones de escucha y acogida con psicólogos(as) y abogados(as) voluntarios. Un espacio seguro, 100% gratuito y confidencial para cuidarte durante la maternidad.',
      consult_btn_1: 'PROGRAMAR SESIÓN',
      consult_title_2: 'Derechos de la Madre:',
      consult_title_2_bold: 'Orientación Jurídica',
      consult_desc_2: 'Ten acceso a abogadas asociadas para resolver dudas sobre pensión alimenticia, licencia de maternidad, custodia y otros asuntos legales sin costo alguno.',
      consult_btn_2: 'HABLAR CON ABOGADA',
      feat_title: 'Todo lo que necesitas en un solo lugar',
      feat_subtitle: 'Descubre las herramientas exclusivas creadas para facilitar tu camino en la maternidad.',
      feat_1_title: 'Teleconsulta Integrada',
      feat_1_desc: 'Sesiones de escucha y orientación jurídica por video en un entorno seguro y 100% confidencial.',
      feat_2_title: 'Foro de Apoyo',
      feat_2_desc: 'Comunidad moderada por expertos para que intercambies experiencias y resuelvas dudas con otras madres.',
      feat_3_title: 'Programación Simplificada',
      feat_3_desc: 'Elige el profesional y el mejor horario para ti en solo dos clics. Sin burocracia.',
      social_title: 'Apoyando a madres <span>reales</span>',
      social_subtitle: 'Mira lo que dicen las madres sobre nuestra red de apoyo.',
      testim_1: '"EloMaterno me salvó en un momento de gran angustia. Obtuve orientación jurídica rápida y gratuita que me dio paz."',
      testim_1_role: 'Madre soltera (São Paulo)',
      testim_2: '"Pensé que el proceso sería largo, pero en dos toques programé una sesión con una psicóloga maravillosa. Es un abrazo en forma de aplicación."',
      testim_2_role: 'Madre de gemelos',
      cta_title: '¿Lista para recibir el apoyo que mereces?',
      cta_subtitle: 'Únete a miles de madres y accede a tu red de apoyo e información ahora mismo.',
      cta_btn: 'Acceder a la Plataforma',
      cta_secure: 'Entorno 100% seguro, gratuito y confidencial.',

      // --- LANDING PAGE: PROFESSIONALS & PARTNERS ---
      prof_hero_title: 'Hacer la diferencia nunca fue<br><span class="scroller-container"><span class="scroller-content"><span class="scroller-item">tan práctico.</span><span class="scroller-item">tan impactante.</span><span class="scroller-item">tan humano.</span><span class="scroller-item">tan práctico.</span></span></span>',
      prof_hero_subtitle: 'Esta es la plataforma que usan los equipos para mantener el enfoque. Sé parte de nuestra red de apoyo. Ofrece tu experiencia como voluntario o invierte en la transformación social.',
      prof_hero_btn_professional: 'Soy Profesional',
      prof_hero_btn_partner: 'Soy Empresa Asociada',
      prof_panel_title: 'Panel de Atenciones',
      prof_panel_mothers: 'Madres Apoyadas',
      prof_panel_growth: '12.5% aumento',
      prof_agenda_status: 'Estado de la Agenda',
      prof_status_active: 'Activo',
      prof_status_pending: 'Pendiente',
      prof_status_inactive: 'Pausado',
      prof_benefits_title: '¿Por qué apoyar a EloMaterno?',
      prof_benefits_subtitle: 'Transforma tu inversión en un impacto real y medible en la vida de miles de familias.',
      prof_benefits_card_1_title: 'Impacto ESG Directo',
      prof_benefits_card_1_desc: 'Fortalece el pilar Social (S) de tu ESG. Apoya activamente la salud mental, los derechos de las mujeres y la reintegración de las madres al mercado laboral.',
      prof_benefits_card_2_title: 'Transparencia de Datos',
      prof_benefits_card_2_desc: 'Ten acceso a paneles medibles. Conoce exactamente cuántas madres fueron acogidas y orientadas gracias al patrocinio de tu marca.',
      prof_benefits_card_3_title: 'Visibilidad de Propósito',
      prof_benefits_card_3_desc: 'Tu marca adquiere un protagonismo especial en nuestra plataforma como "Empresa Asociada", conectándose a una causa noble y urgente.',
      prof_impact_title: '¿Cómo funciona tu viaje de impacto?',
      prof_impact_subtitle: 'Un proceso directo y sin burocracia para que te enfoques en lo que realmente importa: ayudar.',
      prof_timeline_1: 'Paso 1', prof_timeline_title_1: 'Registro',
      prof_timeline_2: 'Paso 2', prof_timeline_title_2: 'Localiza',
      prof_timeline_3: 'Paso 3', prof_timeline_title_3: 'Ayuda',
      prof_timeline_4: 'Paso 4', prof_timeline_title_4: 'Completa',
      prof_for_professionals: 'Para Profesionales',
      prof_section_title_1: 'Atención humanizada:',
      prof_section_title_1_bold: 'Consultorio Virtual',
      prof_section_desc_1: 'Las consultorías se realizan con un solo clic. El sistema genera automáticamente un enlace seguro y se lo envía a la madre, permitiendo que la llamada se realice directamente por Google Meet.',
      prof_access_click: 'Acceso práctico con un clic.',
      prof_meet: 'Llamadas integradas vía Google Meet.',
      prof_agenda_title: 'Tu rutina bajo control:',
      prof_agenda_title_bold: 'Gestión de Agenda',
      prof_agenda_desc: 'Organiza tu disponibilidad y sincroniza todo con Google Calendar en pocos clics.',
      prof_agenda_benefit_1: 'Define bloques de horarios.',
      prof_agenda_benefit_2: 'Sincronización automática.',
      prof_agenda_month: 'Junio 2026',
      prof_agenda_appointment_title: 'Nueva consulta programada',
      prof_agenda_appointment_time: 'Maria S. - Hoy, 14:00',
      prof_agenda_sync_title: 'Sincronización Activa',
      prof_agenda_sync_connected: 'Conectado a tu cuenta',
      prof_portal_title: 'Tu Empresa',
      prof_portal_subtitle: 'Panel de Contenido',
      prof_portal_post_title: 'Artículo: Regreso al Mercado',
      prof_portal_post_desc: 'Consejos prácticos para madres que buscan nuevas oportunidades y desean actualizar sus currículums.',
      prof_portal_tag_1: 'Carrera',
      prof_portal_tag_2: 'Lectura: 5 min',
      prof_portal_status: 'Publicado en el portal',
      prof_portal_forum_title: 'Duda en el Foro',
      prof_portal_forum_time: 'Hace 2 horas',
      prof_portal_forum_question: '"¿Cómo funciona la cuestión de la flexibilidad en el formato de trabajo híbrido?"',
      prof_portal_forum_reply: 'La empresa respondió',
      prof_for_partners: 'Para Empresas Asociadas',
      prof_section_title_2: 'Conexión directa:',
      prof_section_title_2_bold: 'Portal del Asociado',
      prof_section_desc_2: 'Participa activamente en el día a día de nuestra comunidad. Nuestra plataforma ofrece un espacio dedicado para que tu empresa publique contenidos, promueva acciones y apoye a las madres de cerca.',
      prof_portal_benefit_1: 'Promueve tus propios eventos, vacantes y campañas.',
      prof_portal_benefit_2: 'Publica artículos educativos e informativos.',
      prof_portal_benefit_3: 'Interactúa y resuelve dudas en el Foro de Apoyo.',
      prof_faq_title: 'Preguntas Frecuentes',
      prof_faq_subtitle: 'Todo lo que necesitas saber antes de unirte a nuestra red.',
      prof_faq_tab_professional: 'Para Profesionales',
      prof_faq_tab_partner: 'Para Empresas Asociadas',
      prof_faq_q1: '¿Necesito pagar alguna tarifa para atender en la plataforma?',
      prof_faq_a1: 'No. La labor de los profesionales (psicólogos y abogados) en EloMaterno es 100% voluntaria. Nuestra plataforma proporciona toda la infraestructura de video y agenda de forma gratuita para que puedas enfocarte solo en ayudar a quienes lo necesitan.',
      prof_faq_q2: '¿Cuántas horas a la semana necesito dedicar?',
      prof_faq_a2: 'Tienes control total. A través de nuestro sistema de Gestión de Agenda, puedes abrir bloques de horarios según tu disponibilidad, ya sea 1 hora a la semana o 10 horas. La flexibilidad es tuya.',
      prof_faq_q3: '¿Quiénes son las madres a las que atenderé?',
      prof_faq_a3: 'Atendemos a madres de diversas regiones que pasan por un proceso de selección al registrarse. El enfoque principal es en madres solteras o en situación de vulnerabilidad que buscan orientación legal o apoyo psicológico.',
      prof_partner_q1: '¿Cómo puede nuestra empresa promocionar eventos o vacantes?',
      prof_partner_a1: '¡Tenemos un panel exclusivo para Socios! Allí, tu empresa puede publicar eventos, ferias de empleabilidad, cursos de capacitación y vacantes de empleo directamente a nuestra comunidad de madres, fomentando la reintegración al mercado laboral.',
      prof_partner_q2: '¿Es posible realizar donaciones institucionales o patrocinios?',
      prof_partner_a2: '¡Sí! Las empresas asociadas pueden realizar donaciones institucionales, patrocinar campañas específicas o invertir en el desarrollo de nuevas herramientas de la plataforma. Todo el apoyo se destina a ampliar el impacto social.',
      prof_partner_q3: '¿Recibimos informes de impacto (ESG)?',
      prof_partner_a3: 'Absolutamente. Proporcionamos paneles transparentes e informes mensuales que muestran cuántas vidas fueron impactadas a través del apoyo de su empresa, datos esenciales para el pilar "Social" de sus objetivos ESG.'
    }
  };
  
  selecionarIdioma(lang: string) {
    this.aplicarIdioma(lang);
    this.isLangMenuOpen = false;
  }

  private aplicarIdioma(lang: string) {
    if (!isPlatformBrowser(this.platformId)) return;

    const selectedLang = this.translations[lang] ? lang : 'pt';
    const dictionary = this.translations[selectedLang];
    document.documentElement.lang = selectedLang === 'pt' ? 'pt-BR' : selectedLang;

    const flagCode = selectedLang === 'pt' ? 'br' : selectedLang === 'en' ? 'us' : 'es';
    this.currentFlagUrl.set(`https://flagcdn.com/w20/${flagCode}.png`);

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
  }

  // --- ACESSIBILIDADE AVANÇADA EM ANGULAR ---
  toggleMenu() {
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
    this.menuAberto.set(false);
  }
}