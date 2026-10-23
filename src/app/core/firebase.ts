import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { environment } from '../../environments/environment';

/**
 * Ponto único de inicialização do Firebase para todo o app.
 *
 * IMPORTANTE (SSR):
 * - O Angular renderiza a página tanto no browser quanto no servidor
 *   (Node, via `src/server.ts`). O SDK do Firebase Auth/Firestore
 *   depende de APIs de browser (window, indexedDB) que NÃO existem
 *   no Node, e chamar `getAuth()`/`getFirestore()` sem esse cuidado
 *   é a causa mais comum dos erros de Firebase nesse tipo de projeto.
 * - `getApps().length` evita reinicializar o app quando este módulo
 *   é importado mais de uma vez (comum com hot-reload / múltiplos
 *   componentes importando `./core/firebase`).
 * - Em qualquer página/serviço que use `auth`/`db` para operações que
 *   só fazem sentido no browser (onAuthStateChanged, listeners em
 *   tempo real, localStorage, etc.), envolva a chamada em
 *   `if (typeof window !== 'undefined') { ... }` (ou injete
 *   `PLATFORM_ID` + `isPlatformBrowser`) para não rodar durante o SSR.
 */

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(environment.firebase);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export default app;
