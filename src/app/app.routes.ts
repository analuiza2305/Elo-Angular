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

import { ForumComponent } from './pages/forum/forum';
import { ComentResp } from './pages/coment-resp/coment-resp';
import { Artigos } from './pages/artigos/artigos';
import { ArtigoInd } from './pages/artigo-ind/artigo-ind';
import { Eventos } from './pages/eventos/eventos';
import { Consultoria } from './pages/consultoria/consultoria';
import { ConsultasComponent } from './pages/consultas/consultas';
import { ConsultaListaPsiComponent } from './pages/consulta-lista-psi/consulta-lista-psi';
import { Chat } from './pages/chat/chat';
import { Perfil } from './pages/perfil/perfil';
import { AgendaMae } from './pages/agenda-mae/agenda-mae';
import { PerfilProfissionalComponent } from './pages/perfil-profissional/perfil-profissional';
import { ArtigoIndProfissional } from './pages/artigo-ind-profissional/artigo-ind-profissional';

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

  { path: 'forum', component: ForumComponent },
  { path: 'comentResp', component: ComentResp },
  { path: 'artigos', component: Artigos },
  { path: 'artigo-ind', component: ArtigoInd },
  { path: 'artigo_ind', component: ArtigoInd },
  { path: 'eventos', component: Eventos },
  { path: 'consultoria', component: Consultoria },
  { path: 'consultas', component: ConsultasComponent },
  { path: 'consultas-lista-psi', component: ConsultaListaPsiComponent },
  { path: 'agenda-mae', component: AgendaMae },
  { path: 'chat', component: Chat },
  { path: 'perfil', component: Perfil },

  { path: 'perfil-profissional', component: PerfilProfissionalComponent },
  { path: 'perfil-psi', component: PerfilProfissionalComponent },
  { path: 'perfil-adv', component: PerfilProfissionalComponent },
  { path: 'artigo-ind-profissional', component: ArtigoIndProfissional },  
  { path: 'artigos-favoritos', loadComponent: () => import('./pages/artigos-favoritos/artigos-favoritos').then(m => m.ArtigosFavoritos) },
  
  // Rotas Atualizadas (Videochamada e Pós Consulta)
  { path: 'videochamada', loadComponent: () => import('./pages/videochamada/videochamada').then(m => m.VideochamadaComponent) },
  { path: 'pos-consulta', loadComponent: () => import('./pages/pos-consulta/pos-consulta').then(m => m.PosConsultaComponent) },

  { path: '**', redirectTo: '' }
];