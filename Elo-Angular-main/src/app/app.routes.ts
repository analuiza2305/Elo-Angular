import { Routes } from '@angular/router';

import { LandingPageComponent } from './pages/landing-page/landing-page';
import { Login } from './pages/login/login';
import { LoginProfissionalComponent } from './pages/login-profissional/login-profissional';
import { Cadastro } from './pages/cadastro/cadastro';
import { VerificarEmail } from './pages/verificar-email/verificar-email';                          
import { CadastroProfissional } from './pages/cadastro-profissional/cadastro-profissional'; 
import { HomeAdv } from './pages/home-adv/home-adv';
import { HomePsi } from './pages/home-psi/home-psi';
import { HomeMaeComponent } from './pages/home-mae/home-mae';
import { HomeParc } from './pages/home-parc/home-parc';
import { Adm } from './pages/adm/adm';
import { ProfissionalComponent } from './pages/profissional/profissional'; 
import { adminGuard } from './core/guards/admin.guard';

// Páginas criadas via CLI:
import { ForumComponent } from './pages/forum/forum';
import { ComentResp } from './pages/coment-resp/coment-resp';
import { Artigos } from './pages/artigos/artigos';
import { ArtigoInd } from './pages/artigo-ind/artigo-ind';
import { Eventos } from './pages/eventos/eventos';
import { Consultoria } from './pages/consultoria/consultoria';
import { ConsultasComponent } from './pages/consultas/consultas';
import { Chat } from './pages/chat/chat';
import { Perfil } from './pages/perfil/perfil';

// Importando a nova página de Agenda da Mãe
import { AgendaMae } from './pages/agenda-mae/agenda-mae';

export const routes: Routes = [
  { path: '', component: LandingPageComponent },
  { path: 'login', component: Login },
  { path: 'login-profissional', component: LoginProfissionalComponent },
  { path: 'cadastro', component: Cadastro },
  { path: 'verificar-email', component: VerificarEmail },                            
  { path: 'cadastro-profissional', component: CadastroProfissional }, 
  { path: 'home-adv', component: HomeAdv },
  { path: 'home-psi', component: HomePsi },
  { path: 'home-mae', component: HomeMaeComponent },
  { path: 'home-parc', component: HomeParc },
  { path: 'admin', component: Adm, canActivate: [adminGuard] },
  { path: 'profissionais', component: ProfissionalComponent },

  // Rotas da comunidade e consultas:
  { path: 'forum', component: ForumComponent },
  { path: 'comentResp', component: ComentResp },
  { path: 'artigos', component: Artigos },
  { path: 'artigo-ind', component: ArtigoInd },
  { path: 'artigo_ind', component: ArtigoInd },
  { path: 'eventos', component: Eventos },
  { path: 'consultoria', component: Consultoria },
  { path: 'consultas', component: ConsultasComponent },
  { path: 'agenda-mae', component: AgendaMae }, // Rota mapeada
  { path: 'chat', component: Chat },
  { path: 'perfil', component: Perfil },
  
  // Rota corrigida apontando para arquivos sem .component
  { path: 'artigos-favoritos', loadComponent: () => import('./pages/artigos-favoritos/artigos-favoritos').then(m => m.ArtigosFavoritos) },

  { path: '**', redirectTo: '' }
];