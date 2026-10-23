import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { EmailVerificationService } from '../../core/services/email-verification.service';

/**
 * Tela de verificação de e-mail por código (pós-cadastro da mãe).
 *
 * Fluxo esperado: mãe se cadastra → cai aqui já logada (a conta foi
 * criada, só falta confirmar o e-mail) → digita o código de 6 dígitos
 * que recebeu → ao confirmar, desloga e volta para /login, onde ela
 * entra normalmente com e-mail e senha.
 */
@Component({
  selector: 'app-verificar-email',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './verificar-email.html',
  styleUrls: ['./verificar-email.css'],
})
export class VerificarEmail implements OnInit {
  codigo = '';
  email = signal('');
  nome = signal('');

  errorMessage = signal('');
  successMessage = signal('');
  loading = signal(false);
  reenviando = signal(false);

  constructor(
    private router: Router,
    private emailVerificationService: EmailVerificationService,
  ) {}

  async ngOnInit(): Promise<void> {
    // Se a mãe fechou a aba e voltou depois, precisamos que ela esteja
    // logada para sabermos de quem é o e-mail a confirmar — senão manda
    // pro login, onde o próprio fluxo de login reenvia o código se
    // detectar conta não verificada.
    const uid = auth.currentUser?.uid;
    if (!uid) {
      this.router.navigate(['/login']);
      return;
    }

    const snap = await getDoc(doc(db, 'usuarios', uid));
    if (snap.exists()) {
      this.email.set(snap.data()['email'] || auth.currentUser?.email || '');
      this.nome.set(snap.data()['nome'] || '');
    }
  }

  async confirmar(event: Event): Promise<void> {
    event.preventDefault();
    this.errorMessage.set('');
    this.successMessage.set('');

    const uid = auth.currentUser?.uid;
    if (!uid) {
      this.router.navigate(['/login']);
      return;
    }
    if (!this.codigo.trim()) {
      this.errorMessage.set('Digite o código que enviamos para o seu e-mail.');
      return;
    }

    this.loading.set(true);
    try {
      const resultado = await this.emailVerificationService.verificarCodigo(uid, this.codigo.trim());

      if (resultado.ok) {
        await auth.signOut();
        this.router.navigate(['/login'], { queryParams: { emailVerificado: '1' } });
        return;
      }

      if (resultado.motivo === 'expirado') {
        this.errorMessage.set('Esse código expirou. Clique em "Reenviar código" para receber um novo.');
      } else {
        this.errorMessage.set('Código incorreto. Confira o e-mail e tente novamente.');
      }
    } catch (e) {
      this.errorMessage.set('Não foi possível verificar o código agora. Tente novamente.');
    } finally {
      this.loading.set(false);
    }
  }

  async reenviarCodigo(): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid || !this.email()) return;

    this.errorMessage.set('');
    this.successMessage.set('');
    this.reenviando.set(true);
    try {
      await this.emailVerificationService.gerarEEnviarCodigo(uid, this.email(), this.nome());
      this.successMessage.set(`Enviamos um novo código para ${this.email()}.`);
    } catch (e) {
      this.errorMessage.set('Não foi possível reenviar o código agora. Tente novamente em instantes.');
    } finally {
      this.reenviando.set(false);
    }
  }
}
