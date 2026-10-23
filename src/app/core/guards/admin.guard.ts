import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { doc, getDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { db } from '../firebase';
import { AuthService } from '../services/auth.service';

/**
 * Protege a rota /admin.
 *
 * Sem este guard, qualquer pessoa que digitasse elomaterno.com/admin
 * direto na URL conseguia abrir o painel, mesmo sem estar logada como
 * admin (a rota não checava nada, só existia no app.routes.ts).
 *
 * Agora:
 * 1) Espera o Firebase Auth resolver quem (se alguém) está logado
 *    (user$ do AuthService, baseado em onAuthStateChanged).
 * 2) Se não tem ninguém logado -> manda pro /login.
 * 3) Se tem alguém logado, lê usuarios/{uid} no Firestore e confere o
 *    campo "tipo". Só libera a rota se tipo === 'admin'.
 * 4) Qualquer outro caso (tipo diferente, documento sem "tipo", erro de
 *    leitura etc.) -> manda pro /login em vez de deixar a tela do admin
 *    abrir "quebrada" ou vazia.
 */
export const adminGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authService = inject(AuthService);

  const user = await firstValueFrom(authService.user$.pipe(take(1)));

  if (!user) {
    return router.parseUrl('/login');
  }

  try {
    const snap = await getDoc(doc(db, 'usuarios', user.uid));
    if (snap.exists() && snap.data()['tipo'] === 'admin') {
      return true;
    }
  } catch (e) {
    console.warn('[adminGuard] Não foi possível confirmar o perfil de admin:', e);
  }

  return router.parseUrl('/login');
};
