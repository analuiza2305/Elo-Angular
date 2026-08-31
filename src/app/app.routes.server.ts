import { RenderMode, ServerRoute } from '@angular/ssr';

// A landing page é a única pública/institucional — vale a pena pré-renderizar
// pra SEO e carregamento inicial rápido.
//
// Todas as outras rotas são painéis internos, autenticados via Firebase Auth
// (mãe, psicólogo, advogado, parceiro, admin, chat, fórum, etc). Elas usam
// `document`, `localStorage`, `alert`, `window` etc. direto dentro do
// ngOnInit — o que quebra quando o Angular tenta rodar esse código no
// servidor (Node.js) durante o build (Prerender) ou a cada requisição
// (Server). Como não há ganho real de SEO em pré-renderizar uma página que
// só existe depois de login, a solução correta é deixar essas rotas
// renderizarem só no navegador (Client), onde document/localStorage/alert
// sempre existem.
export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
