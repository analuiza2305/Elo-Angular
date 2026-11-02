import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  UserCredential,
} from 'firebase/auth';
import { collection, doc, setDoc, getDoc, updateDoc, query, where, getDocs, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { EmailVerificationService } from '../../core/services/email-verification.service';

@Component({
  selector: 'app-auth-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-form.html',
  styleUrls: ['./auth-form.css'],
})
export class AuthFormComponent {
  @Input() acao: 'login' | 'cadastro' = 'login';
  @Input() publico: 'mae' | 'profissional' = 'profissional';
  @Input() permitirGoogle = false;

  nome = '';
  email = '';
  senha = '';
  senha2 = '';
  tipoDocumento = '';
  numeroDocumento = '';
  termos = false;
  /** Data de nascimento (AAAA-MM-DD). Obrigatória no cadastro de mãe: a plataforma é só para maiores de 18. */
  dataNascimento = '';
  /** Maior data aceita no campo (hoje menos 18 anos). */
  readonly dataMaxima = AuthFormComponent.hojeMenosAnos(18);
  readonly dataMinima = AuthFormComponent.hojeMenosAnos(110);

  isDropdownOpen = false;

  errorMessage = signal('');
  successMessage = signal('');
  loading = signal(false);

  // Preenchimento automático da Razão Social via API pública de CNPJ (BrasilAPI)
  razaoSocialCarregando = signal(false);
  private razaoSocialEncontrada = '';

  constructor(
    private router: Router,
    private emailVerificationService: EmailVerificationService,
  ) {}

  private static hojeMenosAnos(anos: number): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() - anos);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Idade completa em anos para uma data AAAA-MM-DD (null se inválida). */
  private idade(data: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data || '');
    if (!m) return null;
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const nasc = new Date(ano, mes - 1, dia);
    if (nasc.getFullYear() !== ano || nasc.getMonth() !== mes - 1 || nasc.getDate() !== dia) return null;
    const hoje = new Date();
    let idade = hoje.getFullYear() - ano;
    if (hoje.getMonth() < mes - 1 || (hoje.getMonth() === mes - 1 && hoje.getDate() < dia)) idade--;
    return idade;
  }

  /** Confere a data de nascimento e devolve a mensagem de erro (ou '' se estiver tudo certo). */
  private validarMaioridade(): string {
    if (!this.dataNascimento) return 'Informe sua data de nascimento.';
    const idade = this.idade(this.dataNascimento);
    if (idade === null || idade > 110) return 'Data de nascimento inválida.';
    if (idade < 18) return 'O EloMaterno é exclusivo para maiores de 18 anos.';
    return '';
  }

  private dataNascimentoTimestamp(): Timestamp {
    const [ano, mes, dia] = this.dataNascimento.split('-').map(Number);
    return Timestamp.fromDate(new Date(ano, mes - 1, dia, 12, 0, 0));
  }

  /** Gera o caminho de um avatar aleatório (1.png a 19.png) para o tipo de profissional. */
  private gerarAvatarAleatorio(tipoDocumento: string): string {
    const pasta = tipoDocumento === 'crp' ? 'psicologosavatar' : 'advogadossavatar';
    const numero = Math.floor(Math.random() * 19) + 1; // 1 a 19
    return `./img/${pasta}/${numero}.png`;
  }

  /**
   * Ao digitar/colar o CNPJ, consulta a BrasilAPI e preenche automaticamente
   * o campo "Nome completo ou Razão Social" com a razão social oficial da
   * empresa. Antes, esse campo era 100% manual (por isso "a API não
   * funcionava" — não existia nenhuma chamada de API no código).
   */
  async onNumeroDocumentoBlur(): Promise<void> {
    if (this.tipoDocumento !== 'cnpj') return;
    const cnpjLimpo = this.numeroDocumento.replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) return;

    this.razaoSocialCarregando.set(true);
    try {
      const resposta = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
      if (resposta.ok) {
        const dados = await resposta.json();
        if (dados?.razao_social) {
          this.razaoSocialEncontrada = dados.razao_social;
          this.nome = dados.razao_social;
        }
      } else {
        console.warn('CNPJ não encontrado na Receita Federal (BrasilAPI):', resposta.status);
      }
    } catch (erro) {
      console.warn('Não foi possível consultar a Razão Social automaticamente:', erro);
    } finally {
      this.razaoSocialCarregando.set(false);
    }
  }

  async esqueciSenha(event: Event) {
    event.preventDefault();
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.email.trim()) {
      this.errorMessage.set('Digite seu e-mail no campo acima antes de clicar em "Esqueci minha senha".');
      return;
    }

    this.loading.set(true);
    try {
      await sendPasswordResetEmail(auth, this.email.trim());
      this.successMessage.set(`Enviamos um link de redefinição de senha para ${this.email.trim()}.`);
    } catch (error: any) {
      if (error?.code === 'auth/invalid-email') {
        this.errorMessage.set('Digite um e-mail válido.');
      } else {
        this.successMessage.set(`Se ${this.email.trim()} estiver cadastrado, enviamos um link de redefinição.`);
      }
    } finally {
      this.loading.set(false);
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  selectDocument(tipo: string, event: Event) {
    event.stopPropagation();
    this.tipoDocumento = tipo;
    this.isDropdownOpen = false;
    this.errorMessage.set('');
  }

  getDocumentoLabel(): string {
    switch (this.tipoDocumento) {
      case 'oab': return 'OAB';
      case 'cnpj': return 'CNPJ';
      case 'crp': return 'CRP';
      default: return 'Selecione um documento:';
    }
  }

  private normalizarDocumento(valor: string): string {
    return valor.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Lê o campo "status" (pendente/aprovado/recusado) do documento do profissional. */
  private async buscarStatusProfissional(colecao: string, uid: string): Promise<string | null> {
    try {
      const docNovo = await getDoc(doc(db, colecao, uid));
      if (docNovo.exists()) return docNovo.data()['status'] || null;

      const q = query(collection(db, colecao), where('uid', '==', uid), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) return snap.docs[0].data()['status'] || null;
    } catch (e) {
      console.warn('Erro ao verificar status do profissional:', e);
    }
    return null;
  }

  private async determinarRotaAposLogin(uid: string, tipoDocumentoUsado: string): Promise<string> {
    const docLimpo = (tipoDocumentoUsado || '').toLowerCase().trim();
    if (docLimpo === 'crp') return '/home-psi';
    if (docLimpo === 'oab') return '/home-adv';
    if (docLimpo === 'cnpj') return '/home-parc';

    try {
      const userSnap = await getDoc(doc(db, 'usuarios', uid));
      if (userSnap.exists() && userSnap.data()['tipo']) {
        const t = userSnap.data()['tipo'].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (t.includes('admin')) return '/admin';
        if (t.includes('advogad') || t.includes('oab')) return '/home-adv';
        if (t.includes('psicolog') || t.includes('psi') || t.includes('crp')) return '/home-psi';
        if (t.includes('mae')) return '/home-mae';
        if (t.includes('parc') || t.includes('cnpj')) return '/home-parc';
      }

      const psiQ = query(collection(db, 'psicologos'), where('uid', '==', uid));
      if (!(await getDocs(psiQ)).empty) return '/home-psi';

      const advQ = query(collection(db, 'advogados'), where('uid', '==', uid));
      if (!(await getDocs(advQ)).empty) return '/home-adv';

      const parcQ = query(collection(db, 'parceiros'), where('uid', '==', uid));
      if (!(await getDocs(parcQ)).empty) return '/home-parc';

    } catch (e) {
      console.warn('Erro ao determinar rota do usuário:', e);
    }

    return '/home-parc';
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (this.loading()) return;
    this.errorMessage.set('');

    if (this.acao === 'cadastro') {
      if (!this.termos && this.publico === 'profissional') {
        this.errorMessage.set('Você precisa aceitar os termos de parceria.');
        return;
      }
      if (this.senha !== this.senha2) {
        this.errorMessage.set('As senhas não coincidem.');
        return;
      }
      if (this.publico === 'profissional' && (!this.tipoDocumento || !this.numeroDocumento)) {
        this.errorMessage.set('Selecione o tipo de documento e informe o número.');
        return;
      }
      if (this.publico === 'mae') {
        const erroIdade = this.validarMaioridade();
        if (erroIdade) { this.errorMessage.set(erroIdade); return; }
      }
    }

    if (this.acao === 'login' && this.publico === 'profissional') {
      if (!this.tipoDocumento || !this.numeroDocumento.trim()) {
        this.errorMessage.set('Selecione o tipo de documento e digite o número.');
        return;
      }
    }

    this.loading.set(true);
    try {
      if (this.acao === 'cadastro') {
        let authEmail = this.email;
        if (this.publico === 'profissional') {
          authEmail = `${this.tipoDocumento}_${this.normalizarDocumento(this.numeroDocumento)}@elomaterno.profissional`;
          const colecao = this.tipoDocumento === 'oab' ? 'advogados' : this.tipoDocumento === 'crp' ? 'psicologos' : 'parceiros';
          const campoDoc = this.tipoDocumento === 'oab' ? 'oab' : this.tipoDocumento === 'crp' ? 'crp' : 'cnpj';

          const existentes = await getDocs(query(collection(db, colecao), where(campoDoc, '==', this.numeroDocumento)));
          if (!existentes.empty) {
            this.errorMessage.set(`Já existe um cadastro com esse ${this.getDocumentoLabel()}.`);
            this.loading.set(false);
            return;
          }
        }

        const cred = await createUserWithEmailAndPassword(auth, authEmail, this.senha);
        const uid = cred.user.uid;

        // Cadastro de MÃE: antes disso não existia (o publico==='mae' caía
        // direto no valor padrão "parceiro"/"/home-parc" definido abaixo,
        // por isso toda mãe recém-cadastrada ia parar na home do parceiro).
        if (this.publico === 'mae') {
          await setDoc(doc(db, 'usuarios', uid), {
            nome: this.nome, email: this.email, telefone: '', tipo: 'mae', avatar: null, emailVerificado: false, criadoEm: serverTimestamp(),
            dataNascimento: this.dataNascimentoTimestamp(), maiorDeIdade: true,
            extras: { login_load: { mae: true, parceiro: false, advogado: false, psicologo: false }, consult_load: false, termos_load: false, fonte_number: 1, dark_mode: false, espacamento_number: 1, filtro_daltonismo: 'Filtros_daltonismo', leitura_voz: false, letras_destaque: false, mascara_leitura: false }
          });

          // Antes o cadastro ia direto pra /home-mae. Agora a mãe precisa
          // confirmar o e-mail com um código antes de conseguir entrar.
          try {
            await this.emailVerificationService.gerarEEnviarCodigo(uid, this.email, this.nome);
          } catch (e) {
            console.warn('Falha ao enviar e-mail de verificação:', e);
          }
          this.router.navigate(['/verificar-email']);
          this.loading.set(false);
          return;
        }

        // Cadastro PROFISSIONAL (advogado/psicólogo/parceiro-empresa)
        let tipoPerfil = 'parceiro';
        let rotaDestino = '/home-parc';
        let precisaAprovacao = false;
        let avatarGerado: string | null = null;

        if (this.tipoDocumento === 'oab') {
          tipoPerfil = 'advogado'; rotaDestino = '/home-adv'; precisaAprovacao = true;
          avatarGerado = this.gerarAvatarAleatorio('oab');
          await setDoc(doc(db, 'advogados', uid), { nome: this.nome, email: this.email, oab: this.numeroDocumento, tipo: 'advogado', status: 'pendente', avatar: avatarGerado, uid, criadoEm: serverTimestamp() });
        } else if (this.tipoDocumento === 'crp') {
          tipoPerfil = 'psicologo'; rotaDestino = '/home-psi'; precisaAprovacao = true;
          avatarGerado = this.gerarAvatarAleatorio('crp');
          await setDoc(doc(db, 'psicologos', uid), { nome: this.nome, email: this.email, crp: this.numeroDocumento, tipo: 'psicologo', status: 'pendente', avatar: avatarGerado, uid, criadoEm: serverTimestamp() });
        } else if (this.tipoDocumento === 'cnpj') {
          tipoPerfil = 'parceiro'; rotaDestino = '/home-parc';
          await setDoc(doc(db, 'parceiros', uid), { nome: this.nome, nomeEmpresa: this.nome, razaoSocial: this.razaoSocialEncontrada || this.nome, email: this.email, cnpj: this.numeroDocumento, tipo: 'parceiro', status: 'pendente', avatar: null, uid, criadoEm: serverTimestamp() });
        }

        await setDoc(doc(db, 'usuarios', uid), {
          nome: this.nome, email: this.email, documentoTipo: this.tipoDocumento, documentoNumero: this.numeroDocumento, telefone: '', tipo: tipoPerfil, avatar: avatarGerado,
          extras: { login_load: { mae: false, parceiro: tipoPerfil === 'parceiro', advogado: tipoPerfil === 'advogado', psicologo: tipoPerfil === 'psicologo' }, consult_load: false, termos_load: false, fonte_number: 1, dark_mode: false, espacamento_number: 1, filtro_daltonismo: 'Filtros_daltonismo', leitura_voz: false, letras_destaque: false, mascara_leitura: false }
        });

        if (precisaAprovacao) {
          // OAB/CRP precisam ser validados pelos admins antes de qualquer
          // acesso ao painel. Antes, o cadastro já navegava direto para
          // /home-adv ou /home-psi mesmo com status "pendente".
          await auth.signOut();
          this.successMessage.set(
            `Cadastro enviado! Seu ${this.getDocumentoLabel()} está em análise pela nossa equipe. ` +
            `Você poderá entrar assim que o cadastro for aprovado.`
          );
        } else {
          this.router.navigate([rotaDestino]);
        }

      } else if (this.publico === 'mae') {
        const cred = await signInWithEmailAndPassword(auth, this.email, this.senha);

        // Bloqueia o login de mães que ainda não confirmaram o e-mail
        // (cadastros feitos antes dessa verificação existir não têm o
        // campo emailVerificado — nesse caso liberamos o login normal).
        const userSnap = await getDoc(doc(db, 'usuarios', cred.user.uid));
        const dadosUsuario = userSnap.exists() ? userSnap.data() : null;
        if (dadosUsuario && dadosUsuario['emailVerificado'] === false) {
          try {
            await this.emailVerificationService.gerarEEnviarCodigo(cred.user.uid, this.email, dadosUsuario['nome'] || '');
          } catch (e) {
            console.warn('Falha ao reenviar e-mail de verificação:', e);
          }
          this.router.navigate(['/verificar-email']);
          this.loading.set(false);
          return;
        }

        const rota = await this.determinarRotaAposLogin(cred.user.uid, '');
        this.router.navigate([rota]);

      } else {
        const authEmailNovo = `${this.tipoDocumento}_${this.normalizarDocumento(this.numeroDocumento)}@elomaterno.profissional`;
        let cred: UserCredential;

        try {
          cred = await signInWithEmailAndPassword(auth, authEmailNovo, this.senha);
        } catch (erroMetodoNovo: any) {
          if (erroMetodoNovo?.code !== 'auth/invalid-credential' && erroMetodoNovo?.code !== 'auth/user-not-found') throw erroMetodoNovo;

          const colecao = this.tipoDocumento === 'oab' ? 'advogados' : this.tipoDocumento === 'crp' ? 'psicologos' : 'parceiros';
          const campoDoc = this.tipoDocumento === 'oab' ? 'oab' : this.tipoDocumento === 'crp' ? 'crp' : 'cnpj';
          let emailAntigo: string | null = null;

          try {
            const resultado = await getDocs(query(collection(db, colecao), where(campoDoc, '==', this.numeroDocumento.trim()), limit(1)));
            if (!resultado.empty) emailAntigo = resultado.docs[0].data()['email'] || null;
          } catch (erroBusca) {
            console.warn(`Busca falhou:`, erroBusca);
          }

          if (!emailAntigo) throw erroMetodoNovo;
          cred = await signInWithEmailAndPassword(auth, emailAntigo, this.senha);
        }

        // Bloqueia o acesso de advogados(OAB) e psicólogos(CRP) que ainda não
        // foram aprovados pelos admins (ou que foram recusados). Antes o login
        // ignorava completamente o campo "status" e deixava entrar direto.
        if (this.tipoDocumento === 'oab' || this.tipoDocumento === 'crp') {
          const colecao = this.tipoDocumento === 'oab' ? 'advogados' : 'psicologos';
          const status = await this.buscarStatusProfissional(colecao, cred.user.uid);

          if (status === 'pendente') {
            await auth.signOut();
            this.errorMessage.set(`Seu cadastro (${this.getDocumentoLabel()}) ainda está em análise pela nossa equipe. Assim que for aprovado, você poderá entrar.`);
            this.loading.set(false);
            return;
          }
          if (status === 'recusado') {
            await auth.signOut();
            this.errorMessage.set(`Seu cadastro não foi aprovado. Entre em contato com o suporte para mais informações.`);
            this.loading.set(false);
            return;
          }
        }

        const rota = await this.determinarRotaAposLogin(cred.user.uid, this.tipoDocumento);
        this.router.navigate([rota]);
      }
    } catch (error: any) {
      const codigo = error?.code || '';
      if (this.acao === 'cadastro' && codigo === 'auth/email-already-in-use') {
        this.errorMessage.set(`Já existe um cadastro com esse documento ou e-mail.`);
      } else if (codigo === 'auth/invalid-credential' || codigo === 'auth/user-not-found') {
        this.errorMessage.set('Documento, e-mail ou senha incorretos. Verifique os dados ou cadastre-se.');
      } else if (codigo === 'auth/too-many-requests') {
        this.errorMessage.set('Muitas tentativas. Aguarde um pouco antes de tentar novamente.');
      } else {
        this.errorMessage.set('Credenciais inválidas. Tente novamente.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async loginGoogle() {
    if (this.loading()) return;
    this.errorMessage.set('');

    // No cadastro, a data de nascimento vem antes da janela do Google
    if (this.acao === 'cadastro') {
      const erroIdade = this.validarMaioridade();
      if (erroIdade) {
        this.errorMessage.set(erroIdade === 'Informe sua data de nascimento.'
          ? 'Antes de continuar com o Google, informe sua data de nascimento.'
          : erroIdade);
        return;
      }
    }

    this.loading.set(true);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const ref = doc(db, 'usuarios', result.user.uid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        // Conta nova pelo botão do Google na tela de LOGIN: sem a data de nascimento
        // não dá para confirmar a maioridade, então manda para o cadastro.
        if (this.acao !== 'cadastro') {
          await auth.signOut();
          this.errorMessage.set('Ainda não existe conta com esse Google. Faça o cadastro e informe sua data de nascimento (a plataforma é para maiores de 18 anos).');
          return;
        }
        await setDoc(ref, {
          nome: result.user.displayName, email: result.user.email, telefone: '', tipo: 'mae', avatar: null,
          dataNascimento: this.dataNascimentoTimestamp(), maiorDeIdade: true,
          extras: { login_load: { mae: true, parceiro: false, advogado: false, psicologo: false }, consult_load: false, termos_load: false, fonte_number: 1, dark_mode: false, espacamento_number: 1, filtro_daltonismo: 'Filtros_daltonismo', leitura_voz: false, letras_destaque: false, mascara_leitura: false }
        });
      } else {
        await updateDoc(ref, { 'extras.login_load.mae': true });
      }
      this.router.navigate(['/home-mae']);
    } catch (e) {
      this.errorMessage.set('Não foi possível continuar com o Google.');
    } finally {
      this.loading.set(false);
    }
  }
}
