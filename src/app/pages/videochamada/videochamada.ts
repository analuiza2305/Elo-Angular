import { Component, OnInit, OnDestroy, ElementRef, ViewChild, inject, PLATFORM_ID, Inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';

declare var JitsiMeetExternalAPI: any;

/** Domínio do JaaS (Jitsi as a Service, da 8x8). */
const JAAS_DOMAIN = '8x8.vc';
/**
 * Endereço do Cloudflare Worker que gera o token.
 * Aparece no terminal depois do `npx wrangler deploy` (termina em .workers.dev).
 */
const URL_TOKEN_VIDEO = 'https://elo-materno-video.elomaterno.workers.dev';

/** O que o Worker devolve. */
interface DadosChamada {
  token: string;
  appId: string;
  sala: string;
  moderador: boolean;
  nome: string;
}

@Component({
  selector: 'app-videochamada',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './videochamada.html',
  styleUrls: ['./videochamada.css']
})
export class VideochamadaComponent implements OnInit, OnDestroy {
  // static: true → o container está fora de qualquer *ngIf, então já existe no ngOnInit
  @ViewChild('jitsiContainer', { static: true }) jitsiContainer!: ElementRef;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  api: any;
  emSalaDeEspera = true;
  isLoading = false;
  aguardandoLiberacao = false;
  erroChamada = '';
  loadingProgress = 0;
  loadingTexto = 'Preparando a sala...';
  consultaId: string = '';
  nomeUsuario: string = '';
  avatarUsuario: string = '';
  ehProfissional = false;
  isDarkMode = false;
  detalhesConsulta: { data: string; motivo: string; outraParteLabel?: string; outraParteNome?: string } | null = null;
  isBrowser = false;

  // Estado da chamada (header)
  tempoChamada = '00:00';
  microfoneMudo = false;
  cameraDesligada = false;
  participantes = 1;

  private inicioChamada = 0;
  private timerInterval: any;
  private fallbackTimeout: any;
  private encerrando = false;
  private statusConsulta = '';
  private preparacao?: Promise<DadosChamada>;
  private scriptCarregadoDe = '';

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async ngOnInit() {
    if (!this.isBrowser) return;
    this.consultaId = this.route.snapshot.queryParams['id'] || '';

    // Mesmo tema do resto do app (salvo pela home em localStorage 'theme')
    try { this.isDarkMode = localStorage.getItem('theme') === 'dark'; } catch { /* sem storage */ }
    this.aplicarTema();

    // Espera o Firebase restaurar o login (no F5 o currentUser começa nulo)
    await auth.authStateReady();

    if (!this.consultaId) {
      this.nomeUsuario = auth.currentUser?.displayName || '';
      this.detalhesConsulta = { motivo: 'Link sem consulta', data: '—' };
      this.cdr.detectChanges();
      return;
    }

    // 1. Consulta → descobre se quem entrou é a profissional ou a mãe
    // 2. Perfil de quem entrou (nome e foto do cadastro)
    await this.carregarDetalhesConsulta();
    this.cdr.detectChanges();

    // Busca o token e baixa o Jitsi enquanto a pessoa ainda está na sala de espera
    this.preparacao = this.prepararChamada();
    this.preparacao.catch(() => { /* o erro aparece ao clicar em Entrar */ });
  }

  alternarTema() {
    this.isDarkMode = !this.isDarkMode;
    this.aplicarTema();
    try { localStorage.setItem('theme', this.isDarkMode ? 'dark' : 'light'); } catch { /* sem storage */ }
  }

  private aplicarTema() {
    document.body.setAttribute('data-theme', this.isDarkMode ? 'dark' : 'light');
    this.cdr.detectChanges();
  }

  /** "Dr(a). Ana" para a profissional, "Maria" para a mãe. */
  get saudacao(): string {
    const primeiro = this.nomeUsuario.replace(/^(dra?\.?|dr\(a\)\.?)\s+/i, '').split(' ')[0];
    if (!primeiro) return this.ehProfissional ? 'Dr(a).' : '';
    return this.ehProfissional ? `Dr(a). ${primeiro}` : primeiro;
  }

  async carregarDetalhesConsulta() {
    const uid = auth.currentUser?.uid;
    try {
      const docSnap = await getDoc(doc(db, 'Consultas', this.consultaId));
      if (!docSnap.exists()) {
        this.detalhesConsulta = { motivo: 'Consulta não encontrada', data: '—' };
        return;
      }
      const data = docSnap.data();
      let dataStr = 'Data indefinida';
      if (data['Datahora']) {
        const d = data['Datahora'].toDate ? data['Datahora'].toDate() : new Date(data['Datahora']);
        dataStr = d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }

      this.statusConsulta = String(data['status'] || '').toLowerCase();
      const profissionalId: string = data['profissionalId'] || '';
      const maeId: string = data['maeId'] || data['Mae'] || '';
      this.ehProfissional = !!uid && uid === profissionalId;

      // Nome de quem entrou e da outra pessoa, em paralelo
      const [eu, outra] = await Promise.all([
        uid ? this.buscarPerfil(uid, this.ehProfissional) : Promise.resolve(null),
        this.ehProfissional ? this.buscarPerfil(maeId, false) : this.buscarPerfil(profissionalId, true)
      ]);

      this.nomeUsuario = eu?.nome || auth.currentUser?.displayName || '';
      this.avatarUsuario = eu?.avatar || '';

      this.detalhesConsulta = {
        motivo: data['Motivo'] || 'Não informado',
        data: dataStr,
        outraParteLabel: this.ehProfissional ? 'Paciente' : 'Profissional',
        outraParteNome: outra?.nome || ''
      };
    } catch (e) {
      console.error('Erro ao buscar consulta', e);
      this.nomeUsuario = auth.currentUser?.displayName || '';
    }
  }

  /**
   * Busca nome e foto no cadastro, do mesmo jeito que a home do profissional:
   * psicologos/{uid} → psicologos onde uid == uid (cadastros antigos) → usuarios/{uid}.
   */
  private async buscarPerfil(uid: string, profissional: boolean): Promise<{ nome: string; avatar: string } | null> {
    if (!uid) return null;
    const ler = (d: any) => (d ? { nome: String(d['nome'] || ''), avatar: String(d['avatar'] || d['fotoURL'] || '') } : null);
    try {
      if (profissional) {
        const porId = await getDoc(doc(db, 'psicologos', uid));
        if (porId.exists()) return ler(porId.data());
        const legado = await getDocs(query(collection(db, 'psicologos'), where('uid', '==', uid), limit(1)));
        if (!legado.empty) return ler(legado.docs[0].data());
      }
      const usuario = await getDoc(doc(db, 'usuarios', uid));
      if (usuario.exists()) return ler(usuario.data());
    } catch (e) {
      console.warn('Não foi possível ler o perfil', uid, e);
    }
    return null;
  }

  /** Pede o token ao Worker e já carrega o script do JaaS. */
  private async prepararChamada(): Promise<DadosChamada> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      throw { code: 'unauthenticated', message: 'Faça login para entrar na chamada.' };
    }

    let resp: Response;
    try {
      resp = await fetch(URL_TOKEN_VIDEO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        // nome/avatar servem de reserva caso o Worker não consiga ler o cadastro
        body: JSON.stringify({ consultaId: this.consultaId, nome: this.nomeUsuario, avatar: this.avatarUsuario })
      });
    } catch {
      throw { code: 'rede', message: 'Sem conexão com o servidor da chamada.' };
    }
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw { code: corpo.code || 'internal', message: corpo.message || '' };
    }
    const data = corpo as DadosChamada;

    this.ehProfissional = data.moderador;
    if (data.nome && !this.nomeUsuario) {
      this.nomeUsuario = data.nome;
      this.cdr.detectChanges();
    }

    await this.carregarScriptJitsi(data.appId);
    return data;
  }

  /** O script do JaaS fica em https://8x8.vc/<AppID>/external_api.js */
  private carregarScriptJitsi(appId: string): Promise<void> {
    const src = `https://${JAAS_DOMAIN}/${appId}/external_api.js`;
    if (typeof JitsiMeetExternalAPI !== 'undefined' && this.scriptCarregadoDe === src) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => { this.scriptCarregadoDe = src; resolve(); };
      script.onerror = () => reject(new Error('script'));
      document.head.appendChild(script);
    });
  }

  async entrarNaChamada() {
    this.emSalaDeEspera = false;
    this.isLoading = true;
    this.aguardandoLiberacao = false;
    this.erroChamada = '';
    this.loadingProgress = 0;
    this.setProgresso(15, 'Preparando a sala...');

    if (!this.consultaId) {
      this.mostrarErro('Este link não tem uma consulta. Volte ao painel e entre pela consulta agendada.');
      return;
    }

    let dados: DadosChamada;
    try {
      this.preparacao ??= this.prepararChamada();
      this.setProgresso(30, 'Verificando seu acesso...');
      dados = await this.preparacao;   // normalmente já terminou na sala de espera
    } catch (e) {
      this.preparacao = undefined;      // permite tentar de novo
      this.mostrarErro(this.mensagemDeErro(e));
      return;
    }
    this.startConference(dados);
  }

  private mensagemDeErro(e: any): string {
    if (e?.message === 'script') {
      return 'Não foi possível carregar a chamada. Verifique sua conexão.';
    }
    switch (e?.code) {
      case 'unauthenticated':
      case 'invalid-argument':
      case 'not-found':
      case 'permission-denied':
      case 'failed-precondition':
      case 'rede':
        return e.message; // mensagens já em português, vindas do Worker
      default:
        console.error('Erro ao preparar a chamada', e);
        return 'Não foi possível preparar a chamada agora. Tente novamente em instantes.';
    }
  }

  private setProgresso(valor: number, texto: string) {
    this.loadingProgress = Math.max(this.loadingProgress, valor);
    this.loadingTexto = texto;
    this.cdr.detectChanges();
  }

  startConference(dados: DadosChamada) {
    if (!this.jitsiContainer?.nativeElement) {
      this.mostrarErro('Erro ao iniciar o vídeo. Recarregue a página.');
      return;
    }
    if (this.api) return;

    this.setProgresso(50, 'Conectando com segurança...');

    const options = {
      roomName: `${dados.appId}/${dados.sala}`,  // formato exigido pelo JaaS
      jwt: dados.token,
      width: '100%',
      height: '100%',
      parentNode: this.jitsiContainer.nativeElement,
      lang: 'ptBR',                              // idioma da interface do Jitsi
      userInfo: { displayName: dados.nome },
      configOverwrite: {
        defaultLanguage: 'ptBR',                  // reforço do idioma
        prejoinConfig: { enabled: false },
        prejoinPageEnabled: false,
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        disableDeepLinking: true,
        requireDisplayName: false,
        readOnlyName: true,
        disableModeratorIndicator: true,
        disableProfile: true,
        hideConferenceSubject: true,
        hideConferenceTimer: true,
        disableInviteFunctions: true,
        enableWelcomePage: false,
        enableClosePage: false,
        notifications: [],
        toolbarButtons: [
          'microphone', 'camera', 'desktop', 'fullscreen', 'chat',
          'raisehand', 'settings', 'tileview', 'hangup'
        ]
      },
      interfaceConfigOverwrite: {
        SHOW_CHROME_EXTENSION_BANNER: false,
        MOBILE_APP_PROMO: false,
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
      }
    };

    this.api = new JitsiMeetExternalAPI(JAAS_DOMAIN, options);
    this.setProgresso(75, 'Ativando câmera e microfone...');

    // Se nada acontecer em 12s, mostra o Jitsi assim mesmo (nunca prende a pessoa no loader)
    this.fallbackTimeout = setTimeout(() => this.finalizarLoading(), 12000);

    this.api.addListener('videoConferenceJoined', () => {
      this.aguardandoLiberacao = false;
      this.setProgresso(100, 'Tudo pronto!');
      setTimeout(() => this.finalizarLoading(), 300);
    });

    // Se o lobby estiver ligado no console do JaaS, a mãe espera a profissional liberar
    this.api.addListener('errorOccurred', (e: any) => {
      const nome = e?.error?.name || e?.name || '';
      if (String(nome).includes('membersOnly')) {
        clearTimeout(this.fallbackTimeout);
        this.aguardandoLiberacao = true;
        this.setProgresso(85, 'Aguardando a profissional liberar sua entrada...');
      } else if (e?.error?.isFatal) {
        this.mostrarErro('A conexão com a chamada falhou. Tente entrar novamente.');
      }
    });

    this.api.addListener('audioMuteStatusChanged', (e: any) => {
      this.microfoneMudo = e.muted;
      this.cdr.detectChanges();
    });
    this.api.addListener('videoMuteStatusChanged', (e: any) => {
      this.cameraDesligada = e.muted;
      this.cdr.detectChanges();
    });
    this.api.addListener('participantJoined', () => this.atualizarParticipantes());
    this.api.addListener('participantLeft', () => this.atualizarParticipantes());
    this.api.addListener('videoConferenceLeft', () => this.encerrarChamada());
    this.api.addListener('readyToClose', () => this.encerrarChamada());
  }

  private mostrarErro(msg: string) {
    clearTimeout(this.fallbackTimeout);
    this.erroChamada = msg;
    this.loadingTexto = msg;
    this.cdr.detectChanges();
  }

  tentarNovamente() {
    this.limpar();
    this.entrarNaChamada();
  }

  private finalizarLoading() {
    clearTimeout(this.fallbackTimeout);
    if (!this.isLoading) return;
    this.isLoading = false;
    this.iniciarTimer();
    this.cdr.detectChanges();
  }

  private atualizarParticipantes() {
    try {
      this.participantes = this.api?.getNumberOfParticipants?.() || 1;
    } catch { /* ignore */ }
    this.cdr.detectChanges();
  }

  private iniciarTimer() {
    clearInterval(this.timerInterval);
    this.inicioChamada = Date.now();
    this.timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - this.inicioChamada) / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
      const seg = (s % 60).toString().padStart(2, '0');
      this.tempoChamada = h > 0 ? `${h}:${m}:${seg}` : `${m}:${seg}`;
      this.cdr.detectChanges();
    }, 1000);
  }

  alternarMicrofone() { this.api?.executeCommand('toggleAudio'); }
  alternarCamera() { this.api?.executeCommand('toggleVideo'); }

  /** Encerrar (botão do header ou o vermelho do Jitsi) → consulta vai para "Realizadas". */
  async encerrarChamada() {
    if (this.encerrando) return;
    this.encerrando = true;
    this.limpar();
    await this.marcarComoRealizada();
    this.router.navigate(['/pos-consulta'], { queryParams: { id: this.consultaId } });
  }

  private async marcarComoRealizada() {
    // Só muda consultas confirmadas (não mexe em negadas nem em quem já está realizada)
    if (!this.consultaId || !['aceito', 'aceita', 'agendada'].includes(this.statusConsulta)) return;
    try {
      await updateDoc(doc(db, 'Consultas', this.consultaId), {
        status: 'realizado',
        realizadoEm: serverTimestamp(),
        encerradoPor: this.ehProfissional ? 'profissional' : 'mae'
      });
      this.statusConsulta = 'realizado';
    } catch (e) {
      // Não impede a pessoa de seguir para o pós-consulta
      console.warn('Não foi possível marcar a consulta como realizada', e);
    }
  }

  voltarAoPainel() {
    this.limpar();
    this.router.navigate(['/']); // ajuste para a rota do seu painel
  }

  private limpar() {
    clearInterval(this.timerInterval);
    clearTimeout(this.fallbackTimeout);
    if (this.api) {
      this.api.dispose();
      this.api = null;
    }
  }

  ngOnDestroy() {
    this.limpar();
  }
}