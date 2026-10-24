import { Component, OnInit, signal, computed, inject, PLATFORM_ID, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { db, auth } from '../../core/firebase';
import {
  doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, query, where, getDocs, limit, writeBatch
} from 'firebase/firestore';
import { ELOGIOS, MAX_ELOGIOS } from '../../services/reputacao';

const NOTAS_TEXTO = ['', 'Muito ruim', 'Ruim', 'Regular', 'Boa', 'Excelente'];
const ESCALA_MIN = 0.875;
const ESCALA_MAX = 1.375;
const ESCALA_PASSO = 0.125;

@Component({
  selector: 'app-pos-consulta',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-consulta.html',
  styleUrls: ['./pos-consulta.css']
})
export class PosConsultaComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  consultaId: string | null = null;
  isLoading = signal<boolean>(true);
  isSaving = signal<boolean>(false);

  // Dados da consulta
  consultaData = signal<any>(null);
  dataConsultaTexto = signal<string>('');
  outraParteNome = signal<string>('');
  outraParteFoto = signal<string>('./img/account_icon.png');
  outraParteId = signal<string>('');
  euSouMae = signal<boolean>(true);

  // Avaliação
  estrelas = [1, 2, 3, 4, 5];
  nota = signal<number>(0);
  notaHover = signal<number>(0);
  notaExibida = computed(() => this.notaHover() || this.nota());
  notaTexto = computed(() => NOTAS_TEXTO[this.notaExibida()] || 'Toque nas estrelas para avaliar');
  feedback = signal<string>('');
  readonly limiteTexto = 500;

  // Só para a mãe (alimenta a reputação do profissional)
  readonly elogiosDisponiveis = ELOGIOS;
  readonly maxElogios = MAX_ELOGIOS;
  elogios = signal<string[]>([]);
  recomenda = signal<boolean | null>(null);

  // Já enviou antes?
  jaAvaliou = signal<boolean>(false);
  // Motivo que impede avaliar agora (mesmas condições das regras do Firestore)
  bloqueio = signal<string>('');

  // Denúncia
  isDenuncia = signal<boolean>(false);
  motivoDenuncia = signal<string>('');
  descricaoDenuncia = signal<string>('');
  motivosDisponiveis = [
    'Atraso excessivo ou não comparecimento',
    'Comportamento inadequado ou desrespeitoso',
    'Quebra de sigilo ou conduta antiética',
    'Problemas técnicos graves',
    'Outro'
  ];

  // Mensagens na própria tela (sem alert)
  erroForm = signal<string>('');
  enviado = signal<'avaliacao' | 'denuncia' | null>(null);

  // Tema e acessibilidade
  isDarkMode = signal<boolean>(false);
  menuAcessAberto = signal<boolean>(false);
  escalaFonte = signal<number>(1);
  altoContraste = signal<boolean>(false);

  async ngOnInit() {
    this.restaurarPreferencias();

    this.consultaId = this.route.snapshot.queryParams['id'] || null;
    if (!this.consultaId) {
      this.isLoading.set(false);
      return;
    }
    // No F5 o login ainda está sendo restaurado
    await auth.authStateReady();
    await this.carregarConsulta();
  }

  // ==========================================
  // CARREGAMENTO
  // ==========================================
  async carregarConsulta() {
    try {
      const docSnap = await getDoc(doc(db, 'Consultas', this.consultaId!));
      if (!docSnap.exists()) return;

      const data = docSnap.data();
      this.consultaData.set(data);

      if (data['Datahora']) {
        const d = data['Datahora'].toDate ? data['Datahora'].toDate() : new Date(data['Datahora']);
        this.dataConsultaTexto.set(
          d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) + ' às ' +
          d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        );
      }

      const uid = auth.currentUser?.uid;
      const maeId = data['maeId'] || data['Mae'];
      const profissionalId = data['profissionalId'];

      const souProfissional = !!uid && uid === profissionalId;
      this.jaAvaliou.set(!!(souProfissional ? data['avaliadoPeloProfissional'] : data['avaliadoPelaMae']));
      this.bloqueio.set(this.verificarBloqueio(data, uid, souProfissional));

      if (souProfissional) {
        this.euSouMae.set(false);
        this.outraParteId.set(maeId);
        await this.buscarDadosUsuario(maeId, ['usuarios']);
      } else {
        this.euSouMae.set(true);
        this.outraParteId.set(profissionalId);
        // Consultas antigas não têm tipoProfissional: assume psicólogo
        const ordem = data['tipoProfissional'] === 'advogado'
          ? ['advogados', 'psicologos']
          : ['psicologos', 'advogados'];
        await this.buscarDadosUsuario(profissionalId, ordem);
      }
    } catch (err) {
      console.error('Erro ao carregar consulta:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Mesmas condições das regras do Firestore, para avisar antes de a pessoa preencher. */
  private verificarBloqueio(data: any, uid: string | undefined, souProfissional: boolean): string {
    const ehMae = !!uid && (data['maeId'] === uid || data['Mae'] === uid);
    if (!souProfissional && !ehMae) {
      return 'Esta consulta pertence a outra conta. Entre com a conta que participou da sessão.';
    }

    const status = String(data['status'] || '').toLowerCase();
    if (!['aceito', 'aceita', 'agendada', 'realizado', 'realizada'].includes(status)) {
      return 'Esta consulta ainda não foi confirmada pelo profissional, então não pode ser avaliada.';
    }

    // Realizada = a sessão aconteceu (mesmo que tenha começado antes do horário marcado)
    const realizada = status === 'realizado' || status === 'realizada';
    const quando: Date | null = data['Datahora']?.toDate ? data['Datahora'].toDate() : null;
    if (!realizada && quando && quando.getTime() > Date.now()) {
      const dia = quando.toLocaleDateString('pt-BR');
      const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `A avaliação fica disponível a partir do horário da sessão: ${dia} às ${hora}.`;
    }
    return '';
  }

  /** Procura o perfil nas coleções indicadas (por id e pelo campo uid dos cadastros antigos). */
  async buscarDadosUsuario(uid: string, colecoes: string[]) {
    if (!uid) return;
    const aplicar = (d: any) => {
      this.outraParteNome.set(d['nome'] || 'Usuário');
      this.outraParteFoto.set(d['avatar'] || d['fotoURL'] || './img/account_icon.png');
    };
    try {
      for (const col of colecoes) {
        const porId = await getDoc(doc(db, col, uid));
        if (porId.exists()) { aplicar(porId.data()); return; }
        if (col !== 'usuarios') {
          const legado = await getDocs(query(collection(db, col), where('uid', '==', uid), limit(1)));
          if (!legado.empty) { aplicar(legado.docs[0].data()); return; }
        }
      }
      this.outraParteNome.set('Usuário');
    } catch (err) {
      console.error('Erro ao buscar usuário:', err);
      this.outraParteNome.set('Usuário');
    }
  }

  // ==========================================
  // FORMULÁRIO
  // ==========================================
  setNota(valor: number) {
    this.nota.set(valor);
    this.erroForm.set('');
  }

  toggleElogio(elogio: string) {
    const atual = this.elogios();
    if (atual.includes(elogio)) {
      this.elogios.set(atual.filter((e) => e !== elogio));
    } else if (atual.length < MAX_ELOGIOS) {
      this.elogios.set([...atual, elogio]);
    }
  }

  setRecomenda(valor: boolean) {
    this.recomenda.set(this.recomenda() === valor ? null : valor);
  }

  toggleDenuncia() {
    this.isDenuncia.update((v) => !v);
    this.erroForm.set('');
    if (!this.isDenuncia()) {
      this.motivoDenuncia.set('');
      this.descricaoDenuncia.set('');
    }
  }

  async enviarAvaliacao() {
    this.erroForm.set('');

    if (this.isDenuncia() && (!this.motivoDenuncia() || !this.descricaoDenuncia().trim())) {
      this.erroForm.set('Escolha o motivo e descreva o que aconteceu para enviar a denúncia.');
      return;
    }
    if (!this.isDenuncia() && this.nota() === 0) {
      this.erroForm.set('Escolha de 1 a 5 estrelas para avaliar a sessão.');
      return;
    }

    const user = auth.currentUser;
    if (!user || !this.consultaId) {
      this.erroForm.set('Sua sessão expirou. Entre novamente para enviar.');
      return;
    }

    this.isSaving.set(true);
    try {
      if (!this.isDenuncia()) {
        await this.salvarAvaliacao(user.uid);
      }

      if (this.isDenuncia()) {
        await addDoc(collection(db, 'denuncias'), {
          consultaId: this.consultaId,
          denuncianteId: user.uid,
          denunciadoId: this.outraParteId(),
          motivo: this.motivoDenuncia(),
          descricao: this.descricaoDenuncia().trim(),
          status: 'pendente',
          data: serverTimestamp()
        });
      }

      // Marca a consulta (não é crítico: se falhar, o id fixo já impede avaliar duas vezes)
      try {
        await updateDoc(doc(db, 'Consultas', this.consultaId), {
          [this.euSouMae() ? 'avaliadoPelaMae' : 'avaliadoPeloProfissional']: true
        });
      } catch (e) {
        console.warn('Não foi possível marcar a consulta como avaliada', e);
      }

      this.enviado.set(this.isDenuncia() ? 'denuncia' : 'avaliacao');
    } catch (err: any) {
      console.error('Erro ao salvar:', err);
      this.erroForm.set(err?.code === 'permission-denied'
        ? 'Esta sessão já foi avaliada ou ainda não pode ser avaliada.'
        : 'Não foi possível enviar agora. Verifique sua conexão e tente de novo.');
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Mãe → `avaliacoes/{consultaId}_mae` (público, sem identificar a mãe; entra na reputação)
   *       + `avaliacoes_comentarios/{consultaId}_mae` (comentário, só a equipe lê)
   * Profissional → `avaliacoes_maes/{consultaId}` (privado, não aparece em lugar nenhum)
   * Ids fixos: a mesma pessoa não consegue avaliar a mesma consulta duas vezes.
   */
  private async salvarAvaliacao(uid: string) {
    const consultaId = this.consultaId!;
    const comentario = this.feedback().trim();
    const batch = writeBatch(db);

    if (this.euSouMae()) {
      batch.set(doc(db, 'avaliacoes', `${consultaId}_mae`), {
        consultaId,
        avaliadoId: this.outraParteId(),
        tipoAvaliador: 'mae',
        nota: this.nota(),
        elogios: this.elogios(),
        recomenda: this.recomenda(),   // true, false ou null (não respondeu)
        data: serverTimestamp()
      });
      if (comentario) {
        batch.set(doc(db, 'avaliacoes_comentarios', `${consultaId}_mae`), {
          consultaId,
          avaliadorId: uid,
          avaliadoId: this.outraParteId(),
          comentario,
          data: serverTimestamp()
        });
      }
    } else {
      batch.set(doc(db, 'avaliacoes_maes', consultaId), {
        consultaId,
        avaliadorId: uid,
        avaliadoId: this.outraParteId(),
        nota: this.nota(),
        comentario,
        data: serverTimestamp()
      });
    }

    await batch.commit();
  }

  pular() {
    if (this.euSouMae()) {
      this.router.navigate(['/home-mae']);
    } else {
      const tipoProf = this.consultaData()?.tipoProfissional;
      this.router.navigate([tipoProf === 'advogado' ? '/home-adv' : '/home-psi']);
    }
  }

  // ==========================================
  // TEMA E ACESSIBILIDADE
  // ==========================================
  private restaurarPreferencias() {
    if (!this.isBrowser) return;
    try {
      this.isDarkMode.set(localStorage.getItem('theme') === 'dark');
      const escala = Number(localStorage.getItem('fonteEscala'));
      if (escala >= ESCALA_MIN && escala <= ESCALA_MAX) this.escalaFonte.set(escala);
      this.altoContraste.set(localStorage.getItem('altoContraste') === '1');
    } catch { /* sem storage */ }
    this.aplicarTema();
    this.aplicarFonte();
  }

  alternarTema() {
    this.isDarkMode.update((v) => !v);
    this.aplicarTema();
    this.salvar('theme', this.isDarkMode() ? 'dark' : 'light');
  }

  private aplicarTema() {
    if (this.isBrowser) document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light');
  }

  toggleMenuAcess(event: Event) {
    event.stopPropagation();
    this.menuAcessAberto.update((v) => !v);
  }

  @HostListener('document:click')
  fecharMenuAcess() {
    this.menuAcessAberto.set(false);
  }

  @HostListener('document:keydown.escape')
  fecharMenuComEsc() {
    this.menuAcessAberto.set(false);
  }

  aumentarFonte() {
    this.escalaFonte.update((e) => Math.min(ESCALA_MAX, e + ESCALA_PASSO));
    this.aplicarFonte();
  }

  diminuirFonte() {
    this.escalaFonte.update((e) => Math.max(ESCALA_MIN, e - ESCALA_PASSO));
    this.aplicarFonte();
  }

  alternarContraste() {
    this.altoContraste.update((v) => !v);
    this.salvar('altoContraste', this.altoContraste() ? '1' : '0');
  }

  redefinirAcessibilidade() {
    this.escalaFonte.set(1);
    this.altoContraste.set(false);
    this.aplicarFonte();
    this.salvar('altoContraste', '0');
  }

  private aplicarFonte() {
    if (!this.isBrowser) return;
    // Muda o tamanho base (rem) do app todo, como o zoom de texto do navegador
    document.documentElement.style.fontSize = `${this.escalaFonte() * 100}%`;
    this.salvar('fonteEscala', String(this.escalaFonte()));
  }

  private salvar(chave: string, valor: string) {
    try { localStorage.setItem(chave, valor); } catch { /* sem storage */ }
  }
}