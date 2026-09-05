import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { Observable } from 'rxjs';
import { auth } from '../firebase';

/**
 * Serviço central de autenticação (Firebase Auth).
 *
 * Substitui o antigo `js/firebase.js` + `onAuthStateChanged` manual
 * usado no projeto HTML/JS puro. Qualquer página (adm, home-parc,
 * home-mae, home-psi, home-adv...) pode injetar este serviço para
 * saber quem está logado e fazer login/logout.
 *
 * `user$` só emite de fato no browser: no servidor (SSR) o Firebase
 * Auth não tem sessão para observar, então lá o observable nunca
 * emite (a página renderiza no estado "deslogado" e o Angular
 * hidrata no cliente com o valor real).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly user$: Observable<User | null> = new Observable((subscriber) => {
    if (!this.isBrowser) {
      subscriber.next(null);
      return;
    }
    return onAuthStateChanged(auth, (user) => subscriber.next(user));
  });

  login(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  register(email: string, password: string, displayName?: string) {
    return createUserWithEmailAndPassword(auth, email, password).then(async (cred) => {
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      return cred;
    });
  }

  logout() {
    return signOut(auth);
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(auth, email);
  }

  get currentUser(): User | null {
    return this.isBrowser ? auth.currentUser : null;
  }
}
