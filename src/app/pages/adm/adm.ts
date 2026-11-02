import { Component, OnInit, OnDestroy, AfterViewInit, inject, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';

import { CommonModule, registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { FormsModule } from '@angular/forms';
import {
  collection,
  getDocs,
  getCountFromServer,
  getDoc,
  addDoc,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch,
  Unsubscribe
} from 'firebase/firestore';
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from 'firebase/auth';

import { Chart, registerables } from 'chart.js';


import { HeaderComponent } from '../../components/header/header';

// COLOQUE AQUI O CAMINHO REAL DO FIREBASE DO SEU PROJETO
import { auth, db } from '../../core/firebase';
import { AlertaService } from '../../core/services/alerta.service';
import { Assinante, PagamentoPlano, PlanoService, RelatorioFinanceiro, formatarBRL } from '../../services/plano';
import { AdmPlanosComponent } from './adm-planos/adm-planos';

Chart.register(...registerables);

interface ProfissionalData {
  id: string;
  colTipo: string;
  nome: string;
  registro: string;
  status: string;
}

interface UsuarioData {
  id: string;
  colName: string;
  colLabel: string;
  nome: string;
  emailOrDoc: string;
  status: string;
  uniqueId: string;
}

interface AtividadeItem {
  icone: string;
  corIcone: string;
  titulo: string;
  descricao: string;
}

/**
 * Dados da aba "Mães" (antiga "Usuários").
 * Vem exclusivamente da coleção `usuarios` filtrada por tipo === 'mae'.
 *
 * TODO: os campos `criadoEm`, `cidade`, `uf`, `dataNascimento`,
 * `endereco` e `filhos` ainda não são preenchidos no fluxo de cadastro
 * (auth-form.ts). Assim que o cadastro passar a salvar esses campos,
 * eles aparecem aqui automaticamente — por enquanto exibimos "—" /
 * "Não informado" quando estiverem ausentes, sem inventar valores.
 */
interface MaeData {
  id: string;
  nome: string;
  email: string;
  avatar: string;
  status: string; // 'ativo' | 'inativo'
  criadoEm: any;
  cidade: string;
  uf: string;
  dataNascimento: string;
  endereco: string;
  telefone: string;
  filhos: string;
  motivoSuspensao?: string;
  observacoesSuspensao?: string;
  suspensoEm?: any;
  observacoesReativacao?: string;
  reativadoEm?: any;
  /** Quantas advertências do fórum ela já recebeu (somado a cada advertência de post). */
  advertenciasForum: number;
}

/**
 * Avaliação feita por um profissional sobre uma mãe.
 * TODO: ainda não existe nenhuma tela no app que crie esses documentos.
 * A estrutura já está pronta para quando isso existir:
 * usuarios/{maeId}/avaliacoes/{avaliacaoId}
 */
interface AvaliacaoMae {
  id: string;
  profissionalNome: string;
  especialidade: string;
  registro: string;
  nota: number;
  comentario: string;
}

interface AbaEmConstrucao {
  chave: string;
  titulo: string;
  subtitulo: string;
}

/** Um dos 4 cartões de indicador no topo da aba "Relatórios". */
interface RelatorioStatCard {
  label: string;
  valor: string;
  /** Variação % sobre o mês anterior; null quando não há base de comparação. */
  variacao: number | null;
  comparativo: string;
  icone: string;
  cor: 'purple' | 'pink' | 'green' | 'blue';
  /** true quando subir é ruim (ex.: custos). */
  invertido?: boolean;
}

/** Fatia de um dos donuts "Receita por plano" / "Assinantes por plano". */
interface RelatorioDistribuicao {
  nome: string;
  percentual: number;
  valor: string;
  cor: string;
}

/** Cartão de destaque/insight no rodapé da aba "Relatórios". */
interface RelatorioInsight {
  tipo: 'alerta' | 'perigo' | 'sucesso';
  icone: string;
  titulo: string;
  texto: string;
}

// =========================================================
// CONFIGURAÇÕES
// =========================================================

/** Linha da tabela "Administradores da plataforma". */
interface AdminUsuario {
  id: string;
  nome: string;
  email: string;
  avatar?: string;
  nivelAcesso: string;
  permissoes: string;
  status: 'ativo' | 'inativo';
}

/** Linha da tabela "Permissões por nível". */
interface PermissaoPorNivel {
  nome: string;
  superAdmin: boolean;
  administrador: boolean;
  moderador: boolean;
}

/** Dispositivo logado listado no modal "Segurança". */
interface DispositivoConectado {
  nome: string;
  status: 'conectado' | 'desconectado';
  dataAcesso: string;
}

/** Linha da tabela do modal "Notificações". */
interface NotificacaoConfig {
  titulo: string;
  descricao: string;
  ativo: boolean;
}

/**
 * Moderação aplicada a um post do fórum pelo admin. Fica salva dentro do
 * próprio documento em `posts/{id}` (campo `moderacao`), então o fórum
 * público (src/app/pages/forum/forum.ts) consegue ler e esconder os posts
 * removidos sem precisar de nenhuma coleção nova.
 */
interface PostModeracao {
  advertido?: boolean;
  motivoAdvertencia?: string;
  observacoesAdvertencia?: string;
  dataAdvertencia?: any;
  denuncias?: number;
  removido?: boolean;
  motivoRemocao?: string;
  dataRemocao?: any;
}

/** Post real da coleção `posts` (a mesma usada no fórum público), visto pelo admin. */
interface PostForum {
  id: string;
  dataTs: number;
  /** uid de quem postou, ou 'anonimo' quando a mãe marcou "postar como anônima". */
  autorId: string;
  titulo: string;
  conteudo: string;
  autorNome: string;
  autorFoto: string;
  categoria: string;
  dataFormatada: string;
  /** Igual ao campo usado no fórum público (forum.ts) — indica se algum profissional já respondeu o post. */
  respondido: boolean;
  moderacao?: PostModeracao;
}

type FiltroPostsForum = 'todos' | 'denunciados' | 'removidos' | 'advertidos';

/**
 * Moderação aplicada a um conteúdo (artigo ou evento) pelo admin. Fica salva
 * dentro do próprio documento em `artigos/{id}` ou `eventos/{id}` (campo
 * `moderacao`), no mesmo padrão já usado pelos posts do fórum (ver
 * `PostModeracao` acima).
 *
 * TODO: ainda não existe, em nenhuma tela da mãe, um botão de "denunciar"
 * para artigos/eventos (só o fórum tem isso hoje). Por isso `denuncias` e
 * `motivoDenuncia` começam sempre zerados/vazios pra conteúdo novo — assim
 * que essa tela existir, ela só precisa escrever nesses mesmos campos que
 * a Moderação de Conteúdo já sabe ler.
 */
interface ConteudoModeracao {
  denuncias?: number;
  motivoDenuncia?: string;
  removido?: boolean;
  motivoRemocao?: string;
  dataRemocao?: any;
}

/** Conteúdo (artigo ou evento) publicado por parceiros/profissionais, unindo as coleções `artigos` e `eventos` pra a aba "Moderação". */
interface ConteudoAdm {
  id: string;
  origem: 'artigos' | 'eventos';
  tipo: 'Artigo' | 'Evento';
  titulo: string;
  assunto: string;
  usuarioNome: string;
  dataFormatada: string;
  dataOrdenacao: number;
  moderacao?: ConteudoModeracao;
}

type FiltroConteudoModeracao = 'todos' | 'eventos' | 'artigos' | 'denuncias';

/**
 * Dados da sub-aba "Aprovação" (dentro de "Parceiros").
 *
 * TODO: ainda não existe uma coleção `solicitacoesProfissionais` no Firestore
 * pra esse fluxo de aprovação. Estrutura montada aqui só pra a tela existir;
 * assim que o backend tiver o cadastro/aprovação de profissionais, troca os
 * dados de exemplo por um onSnapshot de verdade, igual ao de `maes`.
 */
interface SolicitacaoProfissional {
  id: string;
  /** coleção real onde o cadastro está: psicologos ou advogados */
  colecao?: 'psicologos' | 'advogados';
  uid?: string;
  novo?: boolean;
  nome: string;
  categoria: string;
  registro: string;
  avatar: string;
  cadastro: string;
  documentacaoCompleta: boolean;
  status: 'em_analise' | 'pendencia' | 'aprovado';
  ultimaAnalise: { data: string; admin: string } | null;
  observacoes: string;
  detalhes: {
    dataNascimento: string;
    idade: number;
    email: string;
    telefone: string;
    endereco: string;
    especialidade: string;
    perfilPublico: { label: string; ok: boolean }[];
  };
}

/** Avaliação feita por uma mãe sobre um profissional já aprovado (sub-aba "Profissionais"). */
interface AvaliacaoProfissionalLista {
  id: string;
  autorNome: string;
  autorTipo: string;
  nota: number;
  comentario: string;
}

/**
 * Dados da sub-aba "Profissionais" (listagem completa dos profissionais já
 * aprovados na plataforma, dentro de "Parceiros").
 *
 * TODO: ainda não existe uma coleção com essas métricas (consultas,
 * conteúdos, engajamento, satisfação, avaliações) no Firestore. Estrutura
 * montada aqui só pra a tela existir; assim que o backend expuser esses
 * dados (provavelmente `profissionais` + subcoleções de consultas/avaliações),
 * troca os dados de exemplo por um onSnapshot de verdade, igual ao de `maes`.
 */
interface ProfissionalLista {
  id: string;
  colecao?: 'psicologos' | 'advogados';
  uid?: string;
  nome: string;
  nomeCompleto: string;
  categoria: string;
  registro: string;
  avatar: string;
  status: 'ativo' | 'inativo';
  novo: boolean;
  consultas: number;
  conteudos: number;
  engajamento: number;
  satisfacao: number;
  ultimoAcesso: string;
  detalhes: {
    dataNascimento: string;
    idade: number;
    email: string;
    telefone: string;
    endereco: string;
    profissao: string;
  };
  totalConsultas: number;
  avaliacoes: AvaliacaoProfissionalLista[];
  advertencias: number;
  ultimaAdvertencia?: { motivo: string; dias: number; observacoes: string; data: string } | null;
  motivoSuspensao?: string;
  observacoesSuspensao?: string;
  suspensoEm?: string;
}

/** Avaliação feita por uma mãe sobre uma empresa parceira (sub-aba "Parceiros"). */
interface AvaliacaoParceiroLista {
  id: string;
  autorNome: string;
  autorTipo: string;
  nota: number;
  comentario: string;
}

/**
 * Dados da sub-aba "Parceiros" (listagem completa das empresas parceiras já
 * aprovadas na plataforma, dentro de "Parceiros"). Espelha `ProfissionalLista`.
 *
 * TODO: ainda não existe uma coleção com essas métricas (eventos, artigos,
 * engajamento, satisfação, avaliações) no Firestore. Estrutura montada aqui
 * só pra a tela existir; assim que o backend expuser esses dados, troca os
 * dados de exemplo por um onSnapshot de verdade, igual ao de `maes`.
 */
interface ParceiroEmpresaLista {
  id: string;
  nome: string;
  nomeCompleto: string;
  categoria: string;
  cnpj: string;
  avatar: string;
  status: 'ativo' | 'inativo';
  novo: boolean;
  eventos: number;
  artigos: number;
  engajamento: number;
  satisfacao: number;
  ultimoAcesso: string;
  detalhes: {
    email: string;
    telefone: string;
    endereco: string;
    cnpj: string;
    segmento: string;
  };
  totalInteracoes: number;
  avaliacoes: AvaliacaoParceiroLista[];
  advertencias: number;
  ultimaAdvertencia?: { motivo: string; dias: number; observacoes: string; data: string } | null;
  motivoSuspensao?: string;
  observacoesSuspensao?: string;
  suspensoEm?: string;
}

/** Quem vê o quê na aba "Usuários". */
type VisaoUsuarios = 'todos' | 'maes' | 'profissionais' | 'parceiros' | 'aprovacao';
type TipoUsuario = 'mae' | 'psicologo' | 'advogado' | 'parceiro';
type SituacaoUsuario = 'ativo' | 'pendente' | 'suspenso' | 'recusado';

/**
 * Linha da lista "Todos" da aba Usuários: junta mães, psicólogos, advogados e
 * parceiros num formato só. Guarda também o objeto original pra abrir o perfil certo.
 */
interface UsuarioUnificado {
  chave: string;
  tipo: TipoUsuario;
  tipoRotulo: string;
  nome: string;
  email: string;
  /** CRP / OAB / CNPJ (ou cidade, no caso das mães) */
  detalhe: string;
  avatar: string;
  cadastroTs: number;
  cadastro: string;
  situacao: SituacaoUsuario;
  mae?: MaeData;
  solicitacao?: SolicitacaoProfissional;
  profissional?: ProfissionalLista;
  parceiro?: ParceiroEmpresaLista;
}

/** Denúncia feita por uma usuária (coleção `denuncias`). */
interface DenunciaAdm {
  id: string;
  tipo: 'post' | 'artigo' | 'evento';
  alvoId: string;
  alvoTitulo: string;
  alvoDono: string;
  motivo: string;
  detalhes: string;
  denuncianteNome: string;
  /** aberta = pendente; em_analise = alguém da equipe já está vendo; resolvida/descartada = encerrada */
  status: 'aberta' | 'em_analise' | 'resolvida' | 'descartada';
  ts: number;
  dataFormatada: string;
  parecer: string;
  analisadoPor: string;
  analisadoEmFormatado: string;
}

/** Linha de "Precisa da sua atenção" na Home. */
interface ItemAtencao {
  icone: string;
  cor: string;
  texto: string;
  total: number;
  aba: string;
  visao?: VisaoUsuarios;
}

/** Resumo dos últimos posts da mãe (drawer do perfil). */
interface PostResumoMae {
  id: string;
  titulo: string;
  dataFormatada: string;
  ts: number;
  estado: 'ok' | 'advertido' | 'removido';
}

/** Item do sino de notificações do admin (montado a partir do banco). */
interface NotificacaoAdm {
  id: string;
  icone: string;
  cor: string;
  titulo: string;
  descricao: string;
  aba: string;
  subAba?: 'aprovacao' | 'profissionais' | 'parceiros';
  naoLida: boolean;
}

/** Resposta de um post do fórum, vista pelo admin. */
interface RespostaForumAdm {
  id: string;
  autorNome: string;
  autorFoto: string;
  papel: string;
  ehEspecialista: boolean;
  conteudo: string;
  dataFormatada: string;
}

// Necessário para o pipe `number:...:'pt-BR'` usado no template
registerLocaleData(localePt, 'pt-BR');

@Component({
  selector: 'app-adm',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, AdmPlanosComponent],
  templateUrl: './adm.html',
  styleUrl: './adm.css',
})
export class Adm implements OnInit, OnDestroy, AfterViewInit {

  abaAtiva: string = 'home';

  sidebarAberta: boolean = false;

  psicologosAtivos: number = 0;
  advogadosAtivos: number = 0;

  // --- Cartões da Home (todos calculados a partir do banco, em recalcularIndicadores()) ---
  maesNaRede: number = 0;
  maesAtivasNaRede: number = 0;
  atendimentosRealizados: number = 0;
  itensAtencao: ItemAtencao[] = [];

  atividadesRecentes: AtividadeItem[] = [];

  // Nome/avatar exibidos no cartão de perfil da sidebar
  adminNome: string = 'Admin EloMaterno';
  adminAvatar: string = './img/avatar_usuario.png';

  // Abas do novo menu que ainda não têm tela própria implementada
  abasEmConstrucao: AbaEmConstrucao[] = [];


  // --- Aba "Parceiros" (sub-abas: Aprovação / Profissionais / Parceiros) ---
  parceirosSubAba: 'aprovacao' | 'profissionais' | 'parceiros' = 'aprovacao';

  // --- Denúncias (feitas pelas mães no fórum, artigos e eventos) ---
  denunciasLista: DenunciaAdm[] = [];
  denunciasAbertas: number = 0;
  buscaDenuncias: string = '';
  filtroTipoDenuncia: 'todas' | 'post' | 'artigo' | 'evento' = 'todas';
  filtroStatusDenuncia: 'aberta' | 'resolvida' | 'todas' = 'aberta';
  denunciaSelecionada: DenunciaAdm | null = null;
  parecerDenuncia: string = '';
  salvandoDenuncia: boolean = false;
  erroDenuncia: string = '';
  filtroDonoDenuncia: string = '';
  denunciaDe: string = '';
  denunciaAte: string = '';
  private primeiraCargaDenuncias = false;

  // --- Filtros extras das outras abas ---
  usuariosDe: string = '';
  usuariosAte: string = '';
  maeDe: string = '';
  maeAte: string = '';
  profCategoria: 'todas' | 'Psicólogo(a)' | 'Advogado(a)' = 'todas';
  forumDe: string = '';
  forumAte: string = '';
  forumCategoria: string = '';
  modDe: string = '';
  modAte: string = '';
  modParceiro: string = '';

  /** true se a data (em ms) cai dentro do período escolhido (campos vazios = sem limite). */
  noPeriodo(ts: number, de: string, ate: string): boolean {
    if (!de && !ate) return true;
    if (!ts) return false;
    if (de && ts < new Date(de + 'T00:00:00').getTime()) return false;
    if (ate && ts > new Date(ate + 'T23:59:59').getTime()) return false;
    return true;
  }

  // --- Aba "Usuários" (todos: mães, profissionais e parceiros num lugar só) ---
  usuariosVisao: VisaoUsuarios = 'todos';
  usuariosTodos: UsuarioUnificado[] = [];
  termoBuscaUsuarios: string = '';
  filtroSituacaoUsuarios: 'todas' | SituacaoUsuario = 'todas';
  paginaUsuariosAtual: number = 1;
  readonly itensPorPaginaUsuarios: number = 10;
  resumoUsuarios = { total: 0, maes: 0, profissionais: 0, parceiros: 0, pendentes: 0 };

  // TODO: ainda não existe uma coleção `solicitacoesProfissionais` no Firestore.
  // Dados de exemplo aqui só pra montar a tela; assim que o backend tiver
  // o fluxo de cadastro/aprovação de profissionais, troca isso por um
  // onSnapshot igual ao que já existe pra `maes`.
  solicitacoesProfissionais: SolicitacaoProfissional[] = [];

  // parceirosLista (empresas parceiras) definida mais abaixo, junto com o resto da sub-aba "Parceiros".

  termoBuscaAprovacao: string = '';
  filtroStatusAprovacao: 'todos' | 'em_analise' | 'pendencia' | 'aprovado' = 'todos';
  profissionalSelecionado: SolicitacaoProfissional | null = null;

  get profissionaisStats() {
    return {
      total: this.solicitacoesProfissionais.length,
      aprovados: this.contarPorStatusAprovacao('aprovado'),
      emAnalise: this.contarPorStatusAprovacao('em_analise'),
      pendencias: this.contarPorStatusAprovacao('pendencia'),
      novos: this.solicitacoesProfissionais.filter(s => !!s.novo).length,
    };
  }

  get solicitacoesFiltradas(): SolicitacaoProfissional[] {
    const termo = this.termoBuscaAprovacao.trim().toLowerCase();

    return this.solicitacoesProfissionais.filter(sol => {
      const bateTermo =
        !termo ||
        sol.nome.toLowerCase().includes(termo) ||
        sol.registro.toLowerCase().includes(termo);

      const bateStatus =
        this.filtroStatusAprovacao === 'todos' || sol.status === this.filtroStatusAprovacao;

      return bateTermo && bateStatus;
    });
  }

  contarPorStatusAprovacao(status: 'em_analise' | 'pendencia' | 'aprovado'): number {
    return this.solicitacoesProfissionais.filter(s => s.status === status).length;
  }

  mudarSubAbaParceiros(sub: 'aprovacao' | 'profissionais' | 'parceiros'): void {
    this.parceirosSubAba = sub;
    // "Aprovações" agora é uma aba própria do menu; as outras duas continuam dentro de Usuários.
    if (sub === 'aprovacao') {
      this.abaAtiva = 'aprovacoes';
    } else {
      this.usuariosVisao = sub;
    }
    this.profissionalSelecionado = null;
  }

  /** Troca a "visão" da aba Usuários (Todos / Mães / Profissionais / Parceiros / Aprovações). */
  mudarVisaoUsuarios(visao: VisaoUsuarios): void {
    if (visao === 'aprovacao' || visao === 'profissionais' || visao === 'parceiros') {
      this.mudarSubAbaParceiros(visao);
      return;
    }
    this.usuariosVisao = visao;
    this.profissionalSelecionado = null;
  }

  /** Lista "Todos" já filtrada por busca e situação. */
  get usuariosFiltrados(): UsuarioUnificado[] {
    const termo = this.termoBuscaUsuarios.trim().toLowerCase();
    return this.usuariosTodos.filter((u) => {
      const bateSituacao = this.filtroSituacaoUsuarios === 'todas' || u.situacao === this.filtroSituacaoUsuarios;
      const bateTermo = !termo
        || u.nome.toLowerCase().includes(termo)
        || u.email.toLowerCase().includes(termo)
        || u.detalhe.toLowerCase().includes(termo);
      return bateSituacao && bateTermo && this.noPeriodo(u.cadastroTs, this.usuariosDe, this.usuariosAte);
    });
  }

  get totalPaginasUsuarios(): number {
    return Math.max(1, Math.ceil(this.usuariosFiltrados.length / this.itensPorPaginaUsuarios));
  }

  get usuariosPaginados(): UsuarioUnificado[] {
    if (this.paginaUsuariosAtual > this.totalPaginasUsuarios) this.paginaUsuariosAtual = this.totalPaginasUsuarios;
    const inicio = (this.paginaUsuariosAtual - 1) * this.itensPorPaginaUsuarios;
    return this.usuariosFiltrados.slice(inicio, inicio + this.itensPorPaginaUsuarios);
  }

  irParaPaginaUsuarios(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginasUsuarios) return;
    this.paginaUsuariosAtual = pagina;
  }

  filtrarSituacaoUsuarios(situacao: 'todas' | SituacaoUsuario): void {
    this.filtroSituacaoUsuarios = situacao;
    this.paginaUsuariosAtual = 1;
  }

  rotuloSituacaoUsuario(s: SituacaoUsuario): string {
    return { ativo: 'Ativo', pendente: 'Em análise', suspenso: 'Suspenso', recusado: 'Pendência' }[s];
  }

  /** Clique em "Ver perfil" na lista Todos: vai pra visão certa e já abre o perfil. */
  abrirUsuario(u: UsuarioUnificado): void {
    if (u.tipo === 'mae' && u.mae) {
      this.mudarVisaoUsuarios('maes');
      void this.abrirPerfilMae(u.mae);
    } else if (u.tipo === 'parceiro' && u.parceiro) {
      this.mudarVisaoUsuarios('parceiros');
      this.abrirPerfilParceiroLista(u.parceiro);
    } else if (u.solicitacao && u.solicitacao.status !== 'aprovado') {
      this.mudarVisaoUsuarios('aprovacao');
      this.abrirDetalheProfissional(u.solicitacao);
    } else if (u.profissional) {
      this.mudarVisaoUsuarios('profissionais');
      this.abrirPerfilProfissionalLista(u.profissional);
    }
  }

  /** Atalho dos cartões de "Precisa da sua atenção" (Home). */
  irParaAtencao(item: ItemAtencao): void {
    this.mudarAba(item.aba);
    if (item.visao) this.mudarVisaoUsuarios(item.visao);
  }

  filtrarStatusAprovacao(status: 'todos' | 'em_analise' | 'pendencia' | 'aprovado'): void {
    this.filtroStatusAprovacao = status;
  }

  classeStatusAprovacao(status: string): string {
    if (status === 'aprovado') return 'ativo';
    if (status === 'pendencia') return 'recusado';
    return 'pendente'; // em_analise
  }

  rotuloStatusAprovacao(status: string): string {
    if (status === 'aprovado') return 'Aprovado';
    if (status === 'pendencia') return 'Pendência';
    return 'Em análise';
  }

  abrirDetalheProfissional(sol: SolicitacaoProfissional): void {
    this.profissionalSelecionado = sol;
  }

  fecharDetalheProfissional(): void {
    this.profissionalSelecionado = null;
  }

  async aprovarProfissional(sol: SolicitacaoProfissional): Promise<void> {
    await this.decidirProfissional(sol, 'aprovado');
  }

  async recusarProfissional(sol: SolicitacaoProfissional): Promise<void> {
    await this.decidirProfissional(sol, 'recusado');
  }

  /** Grava a decisão no Firestore (o profissional só entra no painel com status "aprovado"). */
  private async decidirProfissional(sol: SolicitacaoProfissional, status: 'aprovado' | 'recusado'): Promise<void> {
    if (!sol.colecao) {
      this.mostrarToastAdm('Cadastro sem coleção de origem — recarregue a página.', 'erro');
      return;
    }
    try {
      await updateDoc(doc(db, sol.colecao, sol.id), {
        status,
        analisadoEm: serverTimestamp(),
        analisadoPor: this.adminNome,
        observacaoAdmin: (sol.observacoes || '').trim()
      });

      sol.status = status === 'aprovado' ? 'aprovado' : 'pendencia';
      sol.ultimaAnalise = { data: this.formatarDataHoje(), admin: this.adminNome };

      this.avisarProfissionalDaDecisao(sol, status);
      this.mostrarToastAdm(
        status === 'aprovado' ? `${sol.nome} foi aprovado(a).` : `${sol.nome} foi marcado(a) com pendência.`,
        status === 'aprovado' ? 'ok' : 'aviso'
      );
    } catch (erro) {
      console.error('Erro ao salvar decisão do profissional:', erro);
      this.mostrarToastAdm('Não foi possível salvar a decisão. Verifique as regras do Firestore.', 'erro');
    }
  }

  /** Deixa uma notificação para o profissional (coleção `notificacoes`). Falhar aqui nunca atrapalha a aprovação. */
  private async avisarProfissionalDaDecisao(sol: SolicitacaoProfissional, status: 'aprovado' | 'recusado'): Promise<void> {
    try {
      await addDoc(collection(db, 'notificacoes'), {
        destinatarioId: sol.uid || sol.id,
        tipo: 'aprovacao_profissional',
        titulo: status === 'aprovado' ? 'Cadastro aprovado!' : 'Seu cadastro precisa de ajustes',
        mensagem: status === 'aprovado'
          ? 'Seu cadastro foi aprovado. Você já pode acessar o seu painel.'
          : (sol.observacoes?.trim() || 'Confira seus dados e documentos e envie novamente.'),
        lida: false,
        criadoEm: serverTimestamp()
      });
    } catch (e) {
      console.warn('Aviso ao profissional não gravado:', e);
    }
  }

  async salvarObservacaoProfissional(sol: SolicitacaoProfissional): Promise<void> {
    if (!sol.colecao) return;
    try {
      await updateDoc(doc(db, sol.colecao, sol.id), { observacaoAdmin: (sol.observacoes || '').trim() });
      this.mostrarToastAdm('Observação salva.', 'ok');
    } catch (erro) {
      console.error('Erro ao salvar observação:', erro);
      this.mostrarToastAdm('Não foi possível salvar a observação.', 'erro');
    }
  }

  private formatarDataHoje(): string {
    const hoje = new Date();
    return hoje.toLocaleDateString('pt-BR');
  }

  // TODO: ainda não existe uma coleção com essas métricas no Firestore.
  // Dados de exemplo aqui só pra montar a tela (sub-aba "Profissionais");
  // assim que o backend tiver esse dado, troca por um onSnapshot de verdade.
  profissionaisLista: ProfissionalLista[] = [];

  termoBuscaProfissionaisLista: string = '';
  filtroStatusProfissionaisLista: 'todos' | 'ativos' | 'inativos' | 'novos' = 'todos';
  profissionalListaSelecionado: ProfissionalLista | null = null;

  /** Lista de profissionais (sub-aba "Profissionais") já filtrada pela busca e pelo status/segmento selecionado. */
  get profissionaisListaFiltrados(): ProfissionalLista[] {
    return this.profissionaisListaBase.filter((p) => this.profCategoria === 'todas' || p.categoria === this.profCategoria);
  }

  private get profissionaisListaBase(): ProfissionalLista[] {
    const termo = this.termoBuscaProfissionaisLista.trim().toLowerCase();

    return this.profissionaisLista.filter(prof => {
      const bateTermo =
        !termo ||
        prof.nome.toLowerCase().includes(termo) ||
        prof.registro.toLowerCase().includes(termo);

      const bateFiltro =
        this.filtroStatusProfissionaisLista === 'todos' ||
        (this.filtroStatusProfissionaisLista === 'ativos' && prof.status === 'ativo') ||
        (this.filtroStatusProfissionaisLista === 'inativos' && prof.status === 'inativo') ||
        (this.filtroStatusProfissionaisLista === 'novos' && prof.novo);

      return bateTermo && bateFiltro;
    });
  }

  contarProfissionaisLista(filtro: 'ativos' | 'inativos' | 'novos'): number {
    if (filtro === 'ativos') return this.profissionaisLista.filter(p => p.status === 'ativo').length;
    if (filtro === 'inativos') return this.profissionaisLista.filter(p => p.status === 'inativo').length;
    return this.profissionaisLista.filter(p => p.novo).length;
  }

  filtrarProfissionaisLista(filtro: 'todos' | 'ativos' | 'inativos' | 'novos'): void {
    this.filtroStatusProfissionaisLista = filtro;
  }

  /** Média (0 a 5) das avaliações do profissional selecionado na listagem. */
  get profissionalListaAvaliacaoMedia(): number {
    const avaliacoes = this.profissionalListaSelecionado?.avaliacoes ?? [];
    if (!avaliacoes.length) {
      return 0;
    }
    const soma = avaliacoes.reduce((acc, a) => acc + (Number(a.nota) || 0), 0);
    return Math.round((soma / avaliacoes.length) * 10) / 10;
  }

  abrirPerfilProfissionalLista(prof: ProfissionalLista): void {
    this.profissionalListaSelecionado = prof;
  }

  fecharPerfilProfissionalLista(): void {
    this.profissionalListaSelecionado = null;
  }

  // --- Modal "Advertir conta" (profissional) ---
  profissionalParaAdvertir: ProfissionalLista | null = null;
  motivoAdvertencia: string = '';
  diasSuspensaoAdvertencia: number = 3;
  observacoesAdvertencia: string = '';
  advertindoConta: boolean = false;
  erroAdvertencia: string = '';

  readonly diasSuspensaoOpcoes: number[] = [1, 3, 5, 7, 14, 30];

  advertirProfissionalLista(prof: ProfissionalLista): void {
    this.profissionalParaAdvertir = prof;
    this.motivoAdvertencia = '';
    this.diasSuspensaoAdvertencia = 3;
    this.observacoesAdvertencia = '';
    this.erroAdvertencia = '';
  }

  fecharModalAdvertencia(): void {
    if (this.advertindoConta) {
      return;
    }
    this.profissionalParaAdvertir = null;
    this.motivoAdvertencia = '';
    this.observacoesAdvertencia = '';
    this.erroAdvertencia = '';
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  async confirmarAdvertencia(): Promise<void> {
    const prof = this.profissionalParaAdvertir;
    if (!prof) {
      return;
    }

    if (!this.motivoAdvertencia) {
      this.erroAdvertencia = 'Selecione um motivo para a advertência.';
      return;
    }

    this.advertindoConta = true;
    this.erroAdvertencia = '';

    const observacoes = this.observacoesAdvertencia.trim();

    try {
      prof.advertencias = (prof.advertencias || 0) + 1;
      prof.ultimaAdvertencia = {
        motivo: this.motivoAdvertencia,
        dias: this.diasSuspensaoAdvertencia,
        observacoes,
        data: this.formatarDataHoje(),
      };

      // Regra do design: na 3ª advertência, a conta é suspensa automaticamente.
      if (prof.advertencias >= 3) {
        prof.status = 'inativo';
        prof.motivoSuspensao = this.motivoAdvertencia;
        prof.observacoesSuspensao = observacoes;
        prof.suspensoEm = this.formatarDataHoje();
      }

      await this.salvarModeracaoCadastro('profissional', prof);

      if (this.profissionalListaSelecionado?.id === prof.id) {
        this.profissionalListaSelecionado = { ...prof };
      }

      this.profissionalParaAdvertir = null;
      this.motivoAdvertencia = '';
      this.observacoesAdvertencia = '';
    } catch (error) {
      console.error('Erro ao advertir profissional:', error);
      this.erroAdvertencia = 'Não foi possível advertir a conta agora. Tente novamente.';
    } finally {
      this.advertindoConta = false;
    }
  }

  // --- Modal "Suspender conta" (profissional) ---
  profissionalParaSuspender: ProfissionalLista | null = null;
  motivoSuspensaoProfissional: string = '';
  observacoesSuspensaoProfissional: string = '';
  suspendendoContaProfissional: boolean = false;
  erroSuspensaoProfissional: string = '';

  suspenderProfissionalLista(prof: ProfissionalLista): void {
    this.profissionalParaSuspender = prof;
    this.motivoSuspensaoProfissional = '';
    this.observacoesSuspensaoProfissional = '';
    this.erroSuspensaoProfissional = '';
  }

  fecharModalSuspensaoProfissional(): void {
    if (this.suspendendoContaProfissional) {
      return;
    }
    this.profissionalParaSuspender = null;
    this.motivoSuspensaoProfissional = '';
    this.observacoesSuspensaoProfissional = '';
    this.erroSuspensaoProfissional = '';
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  async confirmarSuspensaoProfissional(): Promise<void> {
    const prof = this.profissionalParaSuspender;
    if (!prof) {
      return;
    }

    if (!this.motivoSuspensaoProfissional) {
      this.erroSuspensaoProfissional = 'Selecione um motivo para a suspensão.';
      return;
    }

    this.suspendendoContaProfissional = true;
    this.erroSuspensaoProfissional = '';

    const observacoes = this.observacoesSuspensaoProfissional.trim();

    try {
      prof.status = 'inativo';
      prof.motivoSuspensao = this.motivoSuspensaoProfissional;
      prof.observacoesSuspensao = observacoes;
      prof.suspensoEm = this.formatarDataHoje();

      await this.salvarModeracaoCadastro('profissional', prof);

      if (this.profissionalListaSelecionado?.id === prof.id) {
        this.profissionalListaSelecionado = { ...prof };
      }

      this.profissionalParaSuspender = null;
      this.motivoSuspensaoProfissional = '';
      this.observacoesSuspensaoProfissional = '';
    } catch (error) {
      console.error('Erro ao suspender profissional:', error);
      this.erroSuspensaoProfissional = 'Não foi possível suspender a conta agora. Tente novamente.';
    } finally {
      this.suspendendoContaProfissional = false;
    }
  }

  // ==========================================================================
  // SUB-ABA "PARCEIROS" (empresas parceiras) — espelha a sub-aba "Profissionais"
  // ==========================================================================

  // TODO: ainda não existe uma coleção `parceiros` (empresas) no Firestore.
  // Dados de exemplo aqui só pra montar a tela; assim que o backend tiver
  // esse dado, troca por um onSnapshot de verdade.
  parceirosLista: ParceiroEmpresaLista[] = [];

  termoBuscaParceirosLista: string = '';
  filtroStatusParceirosLista: 'todos' | 'ativos' | 'inativos' | 'novos' = 'todos';
  parceiroListaSelecionado: ParceiroEmpresaLista | null = null;

  /** Lista de parceiros (sub-aba "Parceiros") já filtrada pela busca e pelo status selecionado. */
  get parceirosListaFiltrados(): ParceiroEmpresaLista[] {
    const termo = this.termoBuscaParceirosLista.trim().toLowerCase();

    return this.parceirosLista.filter(parc => {
      const bateTermo =
        !termo ||
        parc.nome.toLowerCase().includes(termo) ||
        parc.cnpj.toLowerCase().includes(termo);

      const bateFiltro =
        this.filtroStatusParceirosLista === 'todos' ||
        (this.filtroStatusParceirosLista === 'ativos' && parc.status === 'ativo') ||
        (this.filtroStatusParceirosLista === 'inativos' && parc.status === 'inativo') ||
        (this.filtroStatusParceirosLista === 'novos' && parc.novo);

      return bateTermo && bateFiltro;
    });
  }

  contarParceirosLista(filtro: 'ativos' | 'inativos' | 'novos'): number {
    if (filtro === 'ativos') return this.parceirosLista.filter(p => p.status === 'ativo').length;
    if (filtro === 'inativos') return this.parceirosLista.filter(p => p.status === 'inativo').length;
    return this.parceirosLista.filter(p => p.novo).length;
  }

  filtrarParceirosLista(filtro: 'todos' | 'ativos' | 'inativos' | 'novos'): void {
    this.filtroStatusParceirosLista = filtro;
  }

  /** Média (0 a 5) das avaliações do parceiro selecionado na listagem. */
  get parceiroListaAvaliacaoMedia(): number {
    const avaliacoes = this.parceiroListaSelecionado?.avaliacoes ?? [];
    if (!avaliacoes.length) {
      return 0;
    }
    const soma = avaliacoes.reduce((acc, a) => acc + (Number(a.nota) || 0), 0);
    return Math.round((soma / avaliacoes.length) * 10) / 10;
  }

  abrirPerfilParceiroLista(parc: ParceiroEmpresaLista): void {
    this.parceiroListaSelecionado = parc;
  }

  fecharPerfilParceiroLista(): void {
    this.parceiroListaSelecionado = null;
  }

  // --- Modal "Advertir conta" (parceiro) ---
  parceiroParaAdvertir: ParceiroEmpresaLista | null = null;
  motivoAdvertenciaParceiro: string = '';
  diasSuspensaoAdvertenciaParceiro: number = 3;
  observacoesAdvertenciaParceiro: string = '';
  advertindoContaParceiro: boolean = false;
  erroAdvertenciaParceiro: string = '';

  advertirParceiroLista(parc: ParceiroEmpresaLista): void {
    this.parceiroParaAdvertir = parc;
    this.motivoAdvertenciaParceiro = '';
    this.diasSuspensaoAdvertenciaParceiro = 3;
    this.observacoesAdvertenciaParceiro = '';
    this.erroAdvertenciaParceiro = '';
  }

  fecharModalAdvertenciaParceiro(): void {
    if (this.advertindoContaParceiro) {
      return;
    }
    this.parceiroParaAdvertir = null;
    this.motivoAdvertenciaParceiro = '';
    this.observacoesAdvertenciaParceiro = '';
    this.erroAdvertenciaParceiro = '';
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  async confirmarAdvertenciaParceiro(): Promise<void> {
    const parc = this.parceiroParaAdvertir;
    if (!parc) {
      return;
    }

    if (!this.motivoAdvertenciaParceiro) {
      this.erroAdvertenciaParceiro = 'Selecione um motivo para a advertência.';
      return;
    }

    this.advertindoContaParceiro = true;
    this.erroAdvertenciaParceiro = '';

    const observacoes = this.observacoesAdvertenciaParceiro.trim();

    try {
      parc.advertencias = (parc.advertencias || 0) + 1;
      parc.ultimaAdvertencia = {
        motivo: this.motivoAdvertenciaParceiro,
        dias: this.diasSuspensaoAdvertenciaParceiro,
        observacoes,
        data: this.formatarDataHoje(),
      };

      // Regra do design: na 3ª advertência, a conta é suspensa automaticamente.
      if (parc.advertencias >= 3) {
        parc.status = 'inativo';
        parc.motivoSuspensao = this.motivoAdvertenciaParceiro;
        parc.observacoesSuspensao = observacoes;
        parc.suspensoEm = this.formatarDataHoje();
      }

      await this.salvarModeracaoCadastro('parceiro', parc);

      if (this.parceiroListaSelecionado?.id === parc.id) {
        this.parceiroListaSelecionado = { ...parc };
      }

      this.parceiroParaAdvertir = null;
      this.motivoAdvertenciaParceiro = '';
      this.observacoesAdvertenciaParceiro = '';
    } catch (error) {
      console.error('Erro ao advertir parceiro:', error);
      this.erroAdvertenciaParceiro = 'Não foi possível advertir a conta agora. Tente novamente.';
    } finally {
      this.advertindoContaParceiro = false;
    }
  }

  // --- Modal "Suspender conta" (parceiro) ---
  parceiroParaSuspender: ParceiroEmpresaLista | null = null;
  motivoSuspensaoParceiro: string = '';
  observacoesSuspensaoParceiro: string = '';
  suspendendoContaParceiro: boolean = false;
  erroSuspensaoParceiro: string = '';

  suspenderParceiroLista(parc: ParceiroEmpresaLista): void {
    this.parceiroParaSuspender = parc;
    this.motivoSuspensaoParceiro = '';
    this.observacoesSuspensaoParceiro = '';
    this.erroSuspensaoParceiro = '';
  }

  fecharModalSuspensaoParceiro(): void {
    if (this.suspendendoContaParceiro) {
      return;
    }
    this.parceiroParaSuspender = null;
    this.motivoSuspensaoParceiro = '';
    this.observacoesSuspensaoParceiro = '';
    this.erroSuspensaoParceiro = '';
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  async confirmarSuspensaoParceiro(): Promise<void> {
    const parc = this.parceiroParaSuspender;
    if (!parc) {
      return;
    }

    if (!this.motivoSuspensaoParceiro) {
      this.erroSuspensaoParceiro = 'Selecione um motivo para a suspensão.';
      return;
    }

    this.suspendendoContaParceiro = true;
    this.erroSuspensaoParceiro = '';

    const observacoes = this.observacoesSuspensaoParceiro.trim();

    try {
      parc.status = 'inativo';
      parc.motivoSuspensao = this.motivoSuspensaoParceiro;
      parc.observacoesSuspensao = observacoes;
      parc.suspensoEm = this.formatarDataHoje();

      await this.salvarModeracaoCadastro('parceiro', parc);

      if (this.parceiroListaSelecionado?.id === parc.id) {
        this.parceiroListaSelecionado = { ...parc };
      }

      this.parceiroParaSuspender = null;
      this.motivoSuspensaoParceiro = '';
      this.observacoesSuspensaoParceiro = '';
    } catch (error) {
      console.error('Erro ao suspender parceiro:', error);
      this.erroSuspensaoParceiro = 'Não foi possível suspender a conta agora. Tente novamente.';
    } finally {
      this.suspendendoContaParceiro = false;
    }
  }

  solicitacoes: ProfissionalData[] = [];
  usuarios: UsuarioData[] = [];

  // --- Aba "Mães" ---
  maes: MaeData[] = [];
  termoBuscaMae: string = '';
  filtroStatusMae: 'todas' | 'ativas' | 'inativas' = 'todas';

  maeSelecionada: MaeData | null = null;
  maePerfilCarregando: boolean = false;
  maeTotalInteracoes: number = 0;
  maeAvaliacoes: AvaliacaoMae[] = [];
  maePostsRecentes: PostResumoMae[] = [];

  // --- Modal "Suspender conta" ---
  maeParaSuspender: MaeData | null = null;
  motivoSuspensao: string = '';
  observacoesSuspensao: string = '';
  suspendendoConta: boolean = false;
  erroSuspensao: string = '';

  readonly motivosSuspensao: { valor: string; texto: string }[] = [
    { valor: 'uso_inadequado', texto: 'Uso inadequado da plataforma' },
    { valor: 'conteudo_improprio', texto: 'Conteúdo impróprio' },
    { valor: 'denuncia', texto: 'Denúncia de outros usuários' },
    { valor: 'inatividade', texto: 'Inatividade prolongada' },
    { valor: 'outro', texto: 'Outro' },
  ];

  // --- Modal "Reativar conta" ---
  maeParaReativar: MaeData | null = null;
  observacoesReativacao: string = '';
  reativandoConta: boolean = false;
  erroReativacao: string = '';

  // --- Paginação da tabela de mães ---
  paginaMaeAtual: number = 1;
  itensPorPaginaMae: number = 8;

  get profissionaisAtivos(): number {
    return this.psicologosAtivos + this.advogadosAtivos;
  }

  get adminPrimeiroNome(): string {
    return this.adminNome.split(' ')[0];
  }

  /** Lista de mães já filtrada pela busca (nome/email) e pelo status selecionado. */
  get maesFiltradas(): MaeData[] {
    const termo = this.termoBuscaMae.trim().toLowerCase();

    return this.maes.filter(mae => {
      const bateTermo =
        !termo ||
        mae.nome.toLowerCase().includes(termo) ||
        mae.email.toLowerCase().includes(termo);

      const bateStatus =
        this.filtroStatusMae === 'todas' ||
        (this.filtroStatusMae === 'ativas' && mae.status === 'ativo') ||
        (this.filtroStatusMae === 'inativas' && mae.status !== 'ativo');

      return bateTermo && bateStatus && this.noPeriodo(this.dataDoDoc(mae.criadoEm)?.getTime() ?? 0, this.maeDe, this.maeAte);
    });
  }

  /** Total de páginas para a lista filtrada de mães. */
  get totalPaginasMae(): number {
    return Math.max(1, Math.ceil(this.maesFiltradas.length / this.itensPorPaginaMae));
  }

  /** Fatia da lista filtrada correspondente à página atual. */
  get maesPaginadas(): MaeData[] {
    if (this.paginaMaeAtual > this.totalPaginasMae) {
      this.paginaMaeAtual = this.totalPaginasMae;
    }
    const inicio = (this.paginaMaeAtual - 1) * this.itensPorPaginaMae;
    return this.maesFiltradas.slice(inicio, inicio + this.itensPorPaginaMae);
  }

  irParaPaginaMae(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginasMae) {
      return;
    }
    this.paginaMaeAtual = pagina;
  }

  /** Texto legível do motivo de suspensão salvo (ex.: 'uso_inadequado'). */
  textoMotivoSuspensao(valor: string | undefined): string {
    return this.motivosSuspensao.find((m) => m.valor === valor)?.texto || valor || 'Motivo não informado';
  }

  /** Gera as iniciais do nome para usar como avatar quando não há foto. */
  iniciaisNome(nome: string): string {
    if (!nome) {
      return '?';
    }
    const partes = nome.trim().split(/\s+/);
    const primeira = partes[0]?.[0] || '';
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (primeira + ultima).toUpperCase();
  }

  /** Média (0 a 5) das avaliações carregadas para a mãe selecionada. */
  get maeAvaliacaoMedia(): number {
    if (!this.maeAvaliacoes.length) {
      return 0;
    }
    const soma = this.maeAvaliacoes.reduce((acc, a) => acc + (Number(a.nota) || 0), 0);
    return Math.round((soma / this.maeAvaliacoes.length) * 10) / 10;
  }

  // =========================================================
  // RELATÓRIOS (financeiro)
  // Receita = compras de planos registradas em `pagamentosPlanos`.
  // Custos  = informados pelo admin por mês (`custosPlataforma/{yyyy-MM}`).
  // Lucro   = receita - custos.
  // Tudo é calculado pelo PlanoService.montarRelatorio().
  // =========================================================

  private readonly planoService = inject(PlanoService);

  relatoriosMesesDisponiveis: { chave: string; rotulo: string }[] = this.planoService.mesesDisponiveis(12);
  relatoriosMesSelecionado: string = this.relatoriosMesesDisponiveis[0].chave;
  relatoriosCarregando: boolean = false;
  relatoriosErro: string = '';

  relatoriosStats: RelatorioStatCard[] = [];
  relatoriosLabelsMeses: string[] = [];
  relatoriosReceitaSerie: number[] = [];
  relatoriosCustosSerie: number[] = [];
  relatoriosLucroSerie: number[] = [];
  /** Donut 1: receita do mês por plano. */
  relatoriosReceitaOrigem: RelatorioDistribuicao[] = [];
  /** Donut 2: assinantes ativos por plano. */
  relatoriosAssinantesPlano: RelatorioDistribuicao[] = [];
  relatoriosInsights: RelatorioInsight[] = [];

  /** Campo "Custos do mês" (R$). null = ainda não informado. */
  relatoriosCustoInput: number | null = null;
  relatoriosSalvandoCusto: boolean = false;
  relatoriosCustosInformados: boolean = false;

  private relatoriosPagamentos: PagamentoPlano[] = [];
  private relatoriosAssinantes: Assinante[] = [];
  private relatoriosCustos: Record<string, number> = {};
  private relatorioAtual: RelatorioFinanceiro | null = null;

  private relatoriosFinanceiroChart: any = null;
  private relatoriosOrigemChart: any = null;
  private relatoriosAssinantesChart: any = null;

  private readonly coresDonutRelatorios = ['#6C4BBF', '#e685a6', '#8ee0c4', '#5aa9e6', '#f0a23b', '#b39ddb'];

  brl(valor: number): string {
    return formatarBRL(valor);
  }

  /** Lê pagamentos, custos e assinantes do Firestore e redesenha o relatório. */
  async carregarRelatorioFinanceiro(): Promise<void> {
    this.relatoriosCarregando = true;
    this.relatoriosErro = '';
    this.atualizarTela();
    try {
      const maisAntigo = this.relatoriosMesesDisponiveis[this.relatoriosMesesDisponiveis.length - 1].chave;
      const [pagamentos, custos, assinantes] = await Promise.all([
        this.planoService.pagamentos(this.planoService.inicioDoHistorico(maisAntigo, 7)),
        this.planoService.custosMensais(),
        this.planoService.assinantes(),
      ]);
      this.relatoriosPagamentos = pagamentos;
      this.relatoriosCustos = custos;
      this.relatoriosAssinantes = assinantes;
      this.recalcularRelatorio();
    } catch (e) {
      console.error('Erro ao carregar o relatório financeiro:', e);
      this.relatoriosErro = 'Não foi possível carregar os dados financeiros. Verifique as regras do Firestore (pagamentosPlanos, assinaturas e custosPlataforma).';
    } finally {
      this.relatoriosCarregando = false;
      this.atualizarTela();
    }
  }

  /** Trocou o mês no seletor: recalcula com o que já foi carregado. */
  aoMudarMesRelatorio(): void {
    this.recalcularRelatorio();
    this.atualizarTela();
  }

  private variacaoPercentual(atual: number, anterior: number | undefined): number | null {
    if (anterior === undefined || anterior === 0) return null;
    return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
  }

  private distribuicao(itens: { nome: string; valor: number; texto: string }[]): RelatorioDistribuicao[] {
    const total = itens.reduce((s, i) => s + i.valor, 0);
    if (!total) return [];
    return itens.map((i, idx) => ({
      nome: i.nome,
      percentual: Math.round((i.valor / total) * 1000) / 10,
      valor: i.texto,
      cor: this.coresDonutRelatorios[idx % this.coresDonutRelatorios.length],
    }));
  }

  private recalcularRelatorio(): void {
    const r = this.planoService.montarRelatorio(
      this.relatoriosPagamentos, this.relatoriosCustos, this.relatoriosAssinantes, this.relatoriosMesSelecionado);
    this.relatorioAtual = r;
    const { atual, anterior } = r;

    this.relatoriosCustosInformados = r.custosInformados;
    this.relatoriosCustoInput = r.custosInformados ? atual.custos : null;

    this.relatoriosStats = [
      {
        label: 'Receita de planos', valor: this.brl(atual.receita), icone: 'fa-wallet', cor: 'purple',
        variacao: this.variacaoPercentual(atual.receita, anterior?.receita),
        comparativo: 'comparado com o mês anterior',
      },
      {
        label: 'Custos', valor: r.custosInformados ? this.brl(atual.custos) : 'Não informado', icone: 'fa-sack-dollar', cor: 'pink', invertido: true,
        variacao: r.custosInformados ? this.variacaoPercentual(atual.custos, anterior?.custos) : null,
        comparativo: r.custosInformados ? 'comparado com o mês anterior' : 'informe os custos do mês abaixo',
      },
      {
        label: 'Lucro', valor: this.brl(atual.lucro), icone: 'fa-arrow-trend-up', cor: 'green',
        variacao: this.variacaoPercentual(atual.lucro, anterior?.lucro),
        comparativo: 'comparado com o mês anterior',
      },
      {
        label: 'Novas assinaturas', valor: String(atual.vendas), icone: 'fa-user-plus', cor: 'blue',
        variacao: this.variacaoPercentual(atual.vendas, anterior?.vendas),
        comparativo: `${r.assinaturasAtivas} assinatura(s) ativa(s) hoje`,
      },
    ];

    this.relatoriosLabelsMeses = r.meses.map((m) => m.rotuloCurto);
    this.relatoriosReceitaSerie = r.meses.map((m) => m.receita);
    this.relatoriosCustosSerie = r.meses.map((m) => m.custos);
    this.relatoriosLucroSerie = r.meses.map((m) => m.lucro);

    this.relatoriosReceitaOrigem = this.distribuicao(
      r.porPlano.map((p) => ({ nome: p.planoNome, valor: p.receita, texto: this.brl(p.receita) })));
    this.relatoriosAssinantesPlano = this.distribuicao(
      r.assinantesPorPlano.map((p) => ({ nome: p.planoNome, valor: p.ativos, texto: `${p.ativos} assinante(s)` })));

    // ---- destaques do período ----
    const insights: RelatorioInsight[] = [];
    if (!r.custosInformados) {
      insights.push({ tipo: 'alerta', icone: 'fa-triangle-exclamation', titulo: 'Custos do mês não informados', texto: 'Enquanto isso, o lucro mostrado é igual à receita.' });
    }
    const varReceita = this.variacaoPercentual(atual.receita, anterior?.receita);
    if (varReceita !== null && varReceita !== 0) {
      insights.push(varReceita > 0
        ? { tipo: 'sucesso', icone: 'fa-arrow-up', titulo: `Receita de planos subiu ${varReceita}%`, texto: `${this.brl(atual.receita)} em ${atual.rotulo}` }
        : { tipo: 'perigo', icone: 'fa-arrow-down', titulo: `Receita de planos caiu ${Math.abs(varReceita)}%`, texto: `${this.brl(atual.receita)} em ${atual.rotulo}` });
    }
    if (atual.vendas === 0) {
      insights.push({ tipo: 'alerta', icone: 'fa-circle-info', titulo: 'Nenhuma assinatura vendida neste mês', texto: 'Quando um profissional contratar um plano, ele aparece aqui.' });
    } else if (r.porPlano[0]) {
      const top = r.porPlano[0];
      insights.push({ tipo: 'sucesso', icone: 'fa-crown', titulo: `Plano mais vendido: ${top.planoNome}`, texto: `${top.vendas} venda(s) · ${this.brl(top.receita)}` });
    }
    if (atual.lucro < 0) {
      insights.push({ tipo: 'perigo', icone: 'fa-arrow-down', titulo: 'Resultado negativo no mês', texto: `Os custos superaram a receita em ${this.brl(Math.abs(atual.lucro))}.` });
    }
    this.relatoriosInsights = insights;

    setTimeout(() => this.atualizarGraficosRelatorios(), 0);
  }

  /** Salva o custo do mês selecionado e recalcula o lucro. */
  async salvarCustoMesRelatorio(): Promise<void> {
    const valor = Number(this.relatoriosCustoInput);
    if (this.relatoriosCustoInput === null || String(this.relatoriosCustoInput).trim() === '' || !isFinite(valor) || valor < 0) {
      this.mostrarToastAdm('Informe um valor de custo válido (zero ou mais).', 'erro');
      return;
    }
    this.relatoriosSalvandoCusto = true;
    try {
      await this.planoService.salvarCustoMensal(this.relatoriosMesSelecionado, valor);
      this.relatoriosCustos = { ...this.relatoriosCustos, [this.relatoriosMesSelecionado]: valor };
      this.recalcularRelatorio();
      this.mostrarToastAdm('Custos do mês salvos. O lucro foi recalculado.', 'ok');
    } catch (e) {
      console.error('Erro ao salvar custos:', e);
      this.mostrarToastAdm('Não foi possível salvar os custos. Verifique as regras do Firestore.', 'erro');
    } finally {
      this.relatoriosSalvandoCusto = false;
      this.atualizarTela();
    }
  }

  /** Baixa um CSV (abre no Excel) com o resumo do mês, a receita por plano e cada compra. */
  exportarRelatorio(): void {
    const r = this.relatorioAtual;
    if (!r || typeof document === 'undefined') return;
    const num = (v: number) => v.toFixed(2).replace('.', ',');
    const cel = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const dataBR = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR') : '');
    const linhas: (string | number)[][] = [
      ['Relatório financeiro', r.atual.rotulo],
      ['Receita de planos (R$)', num(r.atual.receita)],
      ['Custos (R$)', r.custosInformados ? num(r.atual.custos) : 'não informado'],
      ['Lucro (R$)', num(r.atual.lucro)],
      ['Assinaturas vendidas no mês', r.atual.vendas],
      ['Assinaturas ativas hoje', r.assinaturasAtivas],
      [],
      ['Receita por plano'],
      ['Plano', 'Vendas', 'Receita (R$)'],
      ...r.porPlano.map((p) => [p.planoNome, p.vendas, num(p.receita)]),
      [],
      ['Compras do mês'],
      ['Data', 'Profissional', 'E-mail', 'Tipo', 'Plano', 'Valor (R$)'],
      ...r.pagamentosDoMes.map((p) => [dataBR(p.criadoEm), p.nome || p.uid, p.email, p.tipo === 'advogado' ? 'Advogado(a)' : 'Psicólogo(a)', p.planoNome, num(p.valor)]),
    ];
    const csv = '\uFEFF' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-financeiro-${this.relatoriosMesSelecionado}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private formatarEixoMoeda = (valor: any) => 'R$ ' + Number(valor).toLocaleString('pt-BR');

  /** Desenha (ou atualiza) o gráfico de linha "Resultado financeiro". */
  private atualizarGraficoFinanceiroRelatorios(): void {
    const ctx = document.getElementById('relatoriosFinanceiroChart') as HTMLCanvasElement;
    if (!ctx) {
      return;
    }

    if (this.relatoriosFinanceiroChart) {
      this.relatoriosFinanceiroChart.data.labels = this.relatoriosLabelsMeses;
      this.relatoriosFinanceiroChart.data.datasets[0].data = this.relatoriosReceitaSerie;
      this.relatoriosFinanceiroChart.data.datasets[1].data = this.relatoriosCustosSerie;
      this.relatoriosFinanceiroChart.data.datasets[2].data = this.relatoriosLucroSerie;
      this.relatoriosFinanceiroChart.update();
      return;
    }

    this.relatoriosFinanceiroChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.relatoriosLabelsMeses,
        datasets: [
          { label: 'Receita', data: this.relatoriosReceitaSerie, borderColor: '#6C4BBF', backgroundColor: 'rgba(108,75,191,0.12)', tension: 0.35, fill: false, pointRadius: 3 },
          { label: 'Custos', data: this.relatoriosCustosSerie, borderColor: '#3fb28f', backgroundColor: 'rgba(63,178,143,0.12)', tension: 0.35, fill: false, pointRadius: 3 },
          { label: 'Lucro', data: this.relatoriosLucroSerie, borderColor: '#e685a6', backgroundColor: 'rgba(230,133,166,0.12)', tension: 0.35, fill: false, pointRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: { label: (item: any) => ` ${item.dataset.label}: ${this.brl(item.raw)}` },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: this.formatarEixoMoeda } },
        },
      },
    });
  }

  /** Desenha (ou atualiza) um dos donuts ("Receita por plano" / "Assinantes por plano"). */
  private atualizarDonutRelatorios(
    canvasId: string,
    dados: RelatorioDistribuicao[],
    instancia: 'origem' | 'assinantes'
  ): void {
    const ctx = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!ctx) {
      return;
    }

    // Sem dados: um anel cinza, só para a área não ficar vazia.
    const semDados = dados.length === 0;
    const labels = semDados ? ['Sem dados'] : dados.map(d => d.nome);
    const valores = semDados ? [1] : dados.map(d => d.percentual);
    const cores = semDados ? ['#e6e0f2'] : dados.map(d => d.cor);

    const chartAtual = instancia === 'origem' ? this.relatoriosOrigemChart : this.relatoriosAssinantesChart;

    if (chartAtual) {
      chartAtual.data.labels = labels;
      chartAtual.data.datasets[0].data = valores;
      chartAtual.data.datasets[0].backgroundColor = cores;
      chartAtual.options.plugins.tooltip.enabled = !semDados;
      chartAtual.update();
      return;
    }

    const novoChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: valores,
          backgroundColor: cores,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !semDados,
            callbacks: {
              label: (item: any) => ` ${item.label}: ${item.raw}%`,
            },
          },
        },
      },
    });

    if (instancia === 'origem') {
      this.relatoriosOrigemChart = novoChart;
    } else {
      this.relatoriosAssinantesChart = novoChart;
    }
  }

  /** Desenha/atualiza todos os gráficos da aba "Relatórios". */
  atualizarGraficosRelatorios(): void {
    this.atualizarGraficoFinanceiroRelatorios();
    this.atualizarDonutRelatorios('relatoriosOrigemChart', this.relatoriosReceitaOrigem, 'origem');
    this.atualizarDonutRelatorios('relatoriosAssinantesChart', this.relatoriosAssinantesPlano, 'assinantes');
  }

  // =========================================================
  // CONFIGURAÇÕES
  // TODO: ainda não existe nenhuma coleção `admins`/`permissoes` no
  // Firestore deste projeto. Os dados abaixo são de exemplo só para a tela
  // não ficar vazia; assim que o backend expuser essas coleções, é só
  // trocar os valores fixos por leituras/escritas reais (onSnapshot,
  // updateDoc, etc.), seguindo o mesmo padrão já usado para "Mães" e
  // "Parceiros" mais acima nesta classe.
  // =========================================================

  /** Qual "tela" da aba Configurações está sendo exibida. */
  configSubTela: 'principal' | 'administradores' = 'principal';

  /** Sub-aba dentro da tela "Administradores" (Administradores | Permissões). */
  configAdministradoresSubAba: 'administradores' | 'permissoes' = 'administradores';

  /** Qual modal de Configurações está aberto no momento (nenhum = null). */
  configModalAberto: 'perfil' | 'seguranca' | 'notificacoes' | 'termo' | null = null;

  configAdminLogado = {
    nome: 'Ana Luiza Bertarelli',
    cargo: 'Super admin',
    desde: '23/02/26',
    email: 'bertarellianaluiza@gmail.com',
    telefone: '(11) 98159-0183',
    setor: 'Desenvolvedora',
    permissoesPerfil: ['Função disponível', 'Função disponível', 'Função disponível', 'Função disponível'],
    cidade: 'São Paulo',
    genero: 'Cis',
    cpf: '111.111.111-11',
  };

  configAdministradoresLista: AdminUsuario[] = [
    { id: '1', nome: 'Michelly Moreira', email: 'michelly@elomaterno', nivelAcesso: 'Super admin', permissoes: 'Todas.', status: 'ativo' },
    { id: '2', nome: 'Michelly Moreira', email: 'michelly@elomaterno', nivelAcesso: 'Super admin', permissoes: 'Todas.', status: 'ativo' },
    { id: '3', nome: 'Michelly Moreira', email: 'michelly@elomaterno', nivelAcesso: 'Super admin', permissoes: 'Todas.', status: 'ativo' },
    { id: '4', nome: 'Michelly Moreira', email: 'michelly@elomaterno', nivelAcesso: 'Super admin', permissoes: 'Todas.', status: 'ativo' },
  ];

  configPermissoesPorNivel: PermissaoPorNivel[] = [
    { nome: 'A definir', superAdmin: true, administrador: true, moderador: true },
    { nome: 'A definir', superAdmin: true, administrador: true, moderador: false },
    { nome: 'A definir', superAdmin: true, administrador: false, moderador: false },
    { nome: 'A definir', superAdmin: true, administrador: false, moderador: false },
  ];

  configSenhaUltimaAlteracao: string = '23/07/26';

  configDispositivos: DispositivoConectado[] = [
    { nome: 'Windows', status: 'conectado', dataAcesso: '23/07/26' },
  ];

  configNotificacoes: NotificacaoConfig[] = [
    { titulo: 'Novas denúncias', descricao: 'Notificar quando um conteúdo for denunciado', ativo: true },
    { titulo: 'Novas denúncias', descricao: 'Notificar quando um conteúdo for denunciado', ativo: true },
    { titulo: 'Novas denúncias', descricao: 'Notificar quando um conteúdo for denunciado', ativo: true },
    { titulo: 'Novas denúncias', descricao: 'Notificar quando um conteúdo for denunciado', ativo: true },
  ];

  configTermoExpandido: boolean = false;
  configTermoAceito: boolean = false;

  /** Abre um dos modais de Configurações ('perfil' | 'seguranca' | 'notificacoes' | 'termo'). */
  abrirConfigModal(modal: 'perfil' | 'seguranca' | 'notificacoes' | 'termo'): void {
    this.configModalAberto = modal;
  }

  /** Fecha qualquer modal de Configurações aberto. */
  fecharConfigModal(): void {
    this.configModalAberto = null;
  }

  /** Vai para a tela "Administradores/Permissões" (botão "Acessar" do card "Outros administradores"). */
  abrirGerirAdministradores(): void {
    this.configSubTela = 'administradores';
    this.configAdministradoresSubAba = 'administradores';
  }

  /** Volta da tela "Administradores/Permissões" para a tela principal de Configurações. */
  voltarConfigPrincipal(): void {
    this.configSubTela = 'principal';
  }

  /** Alterna entre as sub-abas "Administradores" e "Permissões". */
  mudarConfigAdministradoresSubAba(aba: 'administradores' | 'permissoes'): void {
    this.configAdministradoresSubAba = aba;
  }

  /** TODO: abrirá o fluxo de convite por e-mail assim que existir no backend. */
  convidarAdministrador(): void {
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção `admins` existir. */
  alternarNotificacao(item: NotificacaoConfig): void {
    item.ativo = !item.ativo;
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção `permissoes` existir. */
  alternarPermissaoNivel(item: PermissaoPorNivel, nivel: 'superAdmin' | 'administrador' | 'moderador'): void {
    item[nivel] = !item[nivel];
  }

  /** Mostra/recolhe o item 4 ("Consequências") do termo de uso do admin. */
  alternarTermoExpandido(): void {
    this.configTermoExpandido = !this.configTermoExpandido;
  }

  /** TODO: só atualiza em memória — plugar no Firestore (campo `termoAceito`) quando existir. */
  alternarTermoAceito(): void {
    this.configTermoAceito = !this.configTermoAceito;
  }

  /** TODO: abrirá o formulário de edição de dados pessoais (cidade/gênero/CPF). */
  alterarDadoPessoal(campo: 'cidade' | 'genero' | 'cpf'): void {
  }

  /** TODO: abrirá o formulário de edição de perfil (nome/e-mail/telefone/avatar). */
  editarPerfilAdmin(): void {
  }

  /** Envia o e-mail de redefinição de senha do Firebase para o e-mail do admin logado. */
  alterarSenha(): void {
    const email = auth.currentUser?.email;
    if (!email) {
      this.mostrarToastAdm('Não encontramos um e-mail para esta conta.', 'erro');
      return;
    }
    sendPasswordResetEmail(auth, email)
      .then(() => this.mostrarToastAdm(`Enviamos um link de redefinição para ${email}.`, 'ok'))
      .catch((e) => { console.error(e); this.mostrarToastAdm('Não foi possível enviar o e-mail agora.', 'erro'); });
  }

  private alterarSenhaLegado(): void {
  }

  /** TODO: só atualiza em memória — plugar na revogação real da sessão do dispositivo. */
  desconectarDispositivo(dispositivo: DispositivoConectado): void {
    dispositivo.status = 'desconectado';
  }

  /** Encerra a sessão do admin e volta para o login. */
  async sairDaConta(): Promise<void> {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Erro ao sair:', e);
    }
    this.router.navigateByUrl('/login-profissional');
  }

  /** TODO: plugar no fluxo real de exclusão de conta (com confirmação extra). */
  deletarConta(): void {
  }

  private redeChart: any = null;
  private unsubscribes: Unsubscribe[] = [];


  // ==========================================================================
  // NOVO — ADMIN LIGADO AO BANCO (aprovações, profissionais, parceiros, avisos, fórum)
  // ==========================================================================
  private router = inject(Router);
  private readonly alerta = inject(AlertaService);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    this.avisarAngularQuandoAsyncTerminar();
  }

  /**
   * POR QUE ISSO EXISTE — o bug de "entrei no admin e ficou tudo quebrado/vazio".
   *
   * Este projeto roda SEM zone.js (Angular 21 é "zoneless" por padrão). Nesse
   * modo o Angular só redesenha a tela quando um signal muda, quando acontece
   * um evento de clique/input no template, ou quando alguém chama
   * markForCheck(). O admin guarda tudo em campos comuns (this.maes,
   * this.postsForum, this.adminNome...) e preenche esses campos DENTRO dos
   * callbacks do Firestore — que chegam depois, de forma assíncrona. Resultado:
   * os dados chegavam, mas a tela continuava desenhada com os valores
   * iniciais (zeros, listas vazias, "Admin EloMaterno") até a pessoa clicar
   * em qualquer coisa. Por isso parecia que "tudo quebrava" na entrada.
   *
   * Solução: (1) os callbacks do Firestore chamam atualizarTela() e
   * (2) todo método async da classe avisa o Angular quando termina, sem
   * precisar lembrar de colocar markForCheck() em cada um (este método
   * embrulha eles uma vez só, aqui).
   */
  private avisarAngularQuandoAsyncTerminar(): void {
    const proto = Object.getPrototypeOf(this);
    for (const nome of Object.getOwnPropertyNames(proto)) {
      if (nome === 'constructor' || nome.startsWith('ng')) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, nome);
      if (!desc || typeof desc.value !== 'function') continue; // getters ficam de fora
      const original = desc.value as (...args: any[]) => any;
      (this as any)[nome] = (...args: any[]) => {
        const resultado = original.apply(this, args);
        // Só embrulha o que devolve Promise. Métodos síncronos chamados pelo
        // template (formatarData, estrelas...) NÃO podem chamar markForCheck
        // durante a renderização, senão entram em loop.
        if (resultado && typeof resultado.then === 'function') {
          resultado.then(() => this.atualizarTela(), () => this.atualizarTela());
        }
        return resultado;
      };
    }
  }

  /** Pede pro Angular redesenhar a tela (necessário em modo zoneless depois de qualquer coisa assíncrona). */
  private atualizarTela(): void {
    this.cdr.markForCheck();
  }

  private cadastrosBrutos: Record<string, any[]> = { psicologos: [], advogados: [], parceiros: [] };
  private primeiraCargaCadastros: Record<string, boolean> = { psicologos: false, advogados: false, parceiros: false };
  private artigosBrutos: any[] = [];
  private eventosBrutos: any[] = [];
  private consultasBrutas: any[] = [];

  /** Escuta em tempo real: psicologos, advogados, parceiros, artigos, eventos e Consultas. */
  escutarCadastros(): void {
    (['psicologos', 'advogados', 'parceiros'] as const).forEach((colecao) => {
      const unsub = onSnapshot(
        collection(db, colecao),
        (snap) => {
          if (this.primeiraCargaCadastros[colecao]) {
            snap.docChanges().forEach((mudanca) => {
              const d = mudanca.doc.data() as any;
              if (mudanca.type === 'added' && (d['status'] || 'pendente') === 'pendente') {
                this.avisarNovoCadastro(colecao, d);
              }
            });
          }
          this.primeiraCargaCadastros[colecao] = true;
          this.cadastrosBrutos[colecao] = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) }));
          this.reconstruirCadastros();
        },
        (erro) => console.error(`Erro ao escutar ${colecao}:`, erro)
      );
      this.unsubscribes.push(unsub);
    });

    this.unsubscribes.push(onSnapshot(collection(db, 'artigos'), (snap) => {
      this.artigosBrutos = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) }));
      this.reconstruirCadastros();
    }, (e) => console.error('Erro ao escutar artigos:', e)));

    this.unsubscribes.push(onSnapshot(collection(db, 'eventos'), (snap) => {
      this.eventosBrutos = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) }));
      this.reconstruirCadastros();
    }, (e) => console.error('Erro ao escutar eventos:', e)));

    this.unsubscribes.push(onSnapshot(collection(db, 'Consultas'), (snap) => {
      this.consultasBrutas = snap.docs.map((x) => ({ id: x.id, ...(x.data() as any) }));
      this.reconstruirCadastros();
    }, (e) => console.error('Erro ao escutar Consultas:', e)));
  }

  private textoOuTraco(valor: any): string {
    const v = (valor ?? '').toString().trim();
    return v || '—';
  }

  private dataDoDoc(valor: any): Date | null {
    if (!valor) return null;
    try {
      const d: Date = typeof valor.toDate === 'function' ? valor.toDate() : new Date(valor);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }

  private recente(valor: any, dias = 30): boolean {
    const d = this.dataDoDoc(valor);
    return !!d && (Date.now() - d.getTime()) < dias * 86400000;
  }

  private enderecoDoDoc(d: any): string {
    const partes = [d['endereco'], d['cidade'], d['uf'] || d['estado']].filter((x) => !!x);
    return partes.length ? partes.join(' - ') : '—';
  }

  /** Monta as listas das telas (Aprovação, Profissionais e Parceiros) a partir do que veio do banco. */
  private reconstruirCadastros(): void {
    const consultasDe = (uid: string, campo: 'Psicologo' | 'Advogado') =>
      this.consultasBrutas.filter((c) => c[campo] === uid);

    const solicitacoes: SolicitacaoProfissional[] = [];
    const profissionais: ProfissionalLista[] = [];

    (['psicologos', 'advogados'] as const).forEach((colecao) => {
      const ehPsi = colecao === 'psicologos';
      this.cadastrosBrutos[colecao].forEach((d: any) => {
        const uid = d['uid'] || d.id;
        const bruto = d['status'] || 'pendente';
        const status: 'em_analise' | 'pendencia' | 'aprovado' =
          bruto === 'aprovado' ? 'aprovado' : bruto === 'recusado' ? 'pendencia' : 'em_analise';
        const registro = ehPsi ? `CRP ${d['crp'] || '-'}` : `OAB ${d['oab'] || '-'}`;
        const categoria = ehPsi ? 'Psicólogo(a)' : 'Advogado(a)';
        const avatar = d['fotoURL'] || d['avatar'] || '';
        const nascimento = d['dataNascimento'] || '';
        const analisadoEm = this.dataDoDoc(d['analisadoEm']);

        solicitacoes.push({
          id: d.id,
          colecao,
          uid,
          novo: status === 'em_analise',
          nome: d['nome'] || '-',
          categoria,
          registro,
          avatar,
          cadastro: this.formatarData(d['criadoEm']),
          documentacaoCompleta: !!(d['email'] && (d['crp'] || d['oab'])),
          status,
          ultimaAnalise: analisadoEm ? { data: analisadoEm.toLocaleDateString('pt-BR'), admin: d['analisadoPor'] || 'Admin' } : null,
          observacoes: d['observacaoAdmin'] || '',
          detalhes: {
            dataNascimento: nascimento ? this.formatarDataNascimento(nascimento) : '—',
            idade: nascimento ? (this.calcularIdade(nascimento) ?? 0) : 0,
            email: this.textoOuTraco(d['email']),
            telefone: this.textoOuTraco(d['telefone']),
            endereco: this.enderecoDoDoc(d),
            especialidade: this.textoOuTraco(d['especialidade'] || (ehPsi ? 'Psicologia' : 'Direito')),
            perfilPublico: [
              { label: 'Foto de perfil', ok: !!avatar },
              { label: ehPsi ? 'Registro profissional (CRP)' : 'Registro profissional (OAB)', ok: !!(d['crp'] || d['oab']) },
              { label: 'E-mail informado', ok: !!d['email'] },
              { label: 'Telefone informado', ok: !!d['telefone'] },
              { label: 'Especialidade informada', ok: !!d['especialidade'] },
            ],
          },
        });

        if (bruto === 'aprovado') {
          const campo = ehPsi ? 'Psicologo' : 'Advogado';
          const minhas = consultasDe(uid, campo);
          const atendidas = minhas.filter((c) => c['status'] === 'aceito' || c['status'] === 'realizado').length;
          const conteudos = this.artigosBrutos.filter((a) => a['profissionalId'] === uid || a['psicologoId'] === uid || a['advogadoId'] === uid).length;
          profissionais.push({
            id: d.id,
            colecao,
            uid,
            nome: d['nome'] || '-',
            nomeCompleto: d['nome'] || '-',
            categoria,
            registro,
            avatar,
            status: d['suspenso'] ? 'inativo' : 'ativo',
            novo: this.recente(d['analisadoEm'] || d['criadoEm']),
            consultas: minhas.length,
            conteudos,
            engajamento: minhas.length ? Math.round((atendidas / minhas.length) * 100) : 0,
            satisfacao: 0,
            ultimoAcesso: '—',
            detalhes: {
              dataNascimento: nascimento ? this.formatarDataNascimento(nascimento) : '—',
              idade: nascimento ? (this.calcularIdade(nascimento) ?? 0) : 0,
              email: this.textoOuTraco(d['email']),
              telefone: this.textoOuTraco(d['telefone']),
              endereco: this.enderecoDoDoc(d),
              profissao: categoria,
            },
            totalConsultas: minhas.length,
            avaliacoes: [],
            advertencias: d['advertencias'] || 0,
            ultimaAdvertencia: d['ultimaAdvertencia'] || null,
            motivoSuspensao: d['motivoSuspensao'] || '',
            observacoesSuspensao: d['observacoesSuspensao'] || '',
            suspensoEm: d['suspensoEm'] || '',
          });
        }
      });
    });

    // pendentes primeiro, depois por nome
    const ordem = { em_analise: 0, pendencia: 1, aprovado: 2 } as const;
    solicitacoes.sort((a, b) => ordem[a.status] - ordem[b.status] || a.nome.localeCompare(b.nome));
    profissionais.sort((a, b) => a.nome.localeCompare(b.nome));

    const parceiros: ParceiroEmpresaLista[] = this.cadastrosBrutos['parceiros'].map((d: any) => {
      const uid = d['uid'] || d.id;
      const nome = d['nomeEmpresa'] || d['nome'] || '-';
      const meusArtigos = this.artigosBrutos.filter((a) => a['parceiroId'] === uid || (!!nome && a['postadoPor'] === nome)).length;
      const meusEventos = this.eventosBrutos.filter((e) => e['parceiroId'] === uid || (!!nome && e['enviadoPor'] === nome)).length;
      return {
        id: d.id,
        nome,
        nomeCompleto: d['razaoSocial'] || nome,
        categoria: d['segmento'] || 'Empresa parceira',
        cnpj: this.textoOuTraco(d['cnpj']),
        avatar: d['fotoURL'] || d['avatar'] || '',
        status: d['suspenso'] ? 'inativo' : 'ativo',
        novo: this.recente(d['criadoEm']) || (d['status'] || 'pendente') === 'pendente',
        eventos: meusEventos,
        artigos: meusArtigos,
        engajamento: 0,
        satisfacao: 0,
        ultimoAcesso: '—',
        detalhes: {
          email: this.textoOuTraco(d['email']),
          telefone: this.textoOuTraco(d['telefone']),
          endereco: this.enderecoDoDoc(d),
          cnpj: this.textoOuTraco(d['cnpj']),
          segmento: this.textoOuTraco(d['segmento'] || d['nomeFantasia']),
        },
        totalInteracoes: meusArtigos + meusEventos,
        avaliacoes: [],
        advertencias: d['advertencias'] || 0,
        ultimaAdvertencia: d['ultimaAdvertencia'] || null,
        motivoSuspensao: d['motivoSuspensao'] || '',
        observacoesSuspensao: d['observacoesSuspensao'] || '',
        suspensoEm: d['suspensoEm'] || '',
      } as ParceiroEmpresaLista;
    }).sort((a, b) => a.nome.localeCompare(b.nome));

    // mantém abertos os painéis que o admin estava olhando (e o que ele já digitou nas observações)
    const selSol = this.profissionalSelecionado;
    this.solicitacoesProfissionais = solicitacoes;
    if (selSol) {
      const atual = solicitacoes.find((x) => x.id === selSol.id && x.colecao === selSol.colecao) || null;
      if (atual) atual.observacoes = selSol.observacoes;
      this.profissionalSelecionado = atual;
    }
    const selProf = this.profissionalListaSelecionado;
    this.profissionaisLista = profissionais;
    if (selProf) this.profissionalListaSelecionado = profissionais.find((x) => x.id === selProf.id) || null;
    const selParc = this.parceiroListaSelecionado;
    this.parceirosLista = parceiros;
    if (selParc) this.parceiroListaSelecionado = parceiros.find((x) => x.id === selParc.id) || null;

    this.reconstruirNotificacoes();
    this.atualizarTela();
  }

  /** Grava advertência/suspensão de um profissional ou parceiro no documento dele. */
  private async salvarModeracaoCadastro(tipo: 'profissional' | 'parceiro', item: any): Promise<void> {
    const colecao = tipo === 'parceiro' ? 'parceiros' : item.colecao;
    if (!colecao) return;
    try {
      await updateDoc(doc(db, colecao, item.id), {
        advertencias: item.advertencias || 0,
        ultimaAdvertencia: item.ultimaAdvertencia || null,
        suspenso: item.status === 'inativo',
        motivoSuspensao: item.motivoSuspensao || '',
        observacoesSuspensao: item.observacoesSuspensao || '',
        suspensoEm: item.suspensoEm || '',
        moderadoPor: this.adminNome,
        moderadoEm: serverTimestamp()
      });
    } catch (erro) {
      console.error('Erro ao salvar moderação da conta:', erro);
      this.mostrarToastAdm('Não foi possível salvar no banco. Verifique as regras do Firestore.', 'erro');
      throw erro;
    }
  }

  // ---------------- avisos (toast + sino) ----------------
  toastAdm: { texto: string; tipo: 'ok' | 'aviso' | 'erro' | 'novo' } | null = null;
  private toastTimer: any = null;
  painelNotificacoesAberto = false;
  notificacoesAdm: NotificacaoAdm[] = [];
  private notificacoesLidas = new Set<string>(this.lerNotificacoesLidas());

  get naoLidasAdm(): number {
    return this.notificacoesAdm.filter((n) => n.naoLida).length;
  }

  /** Quantos cadastros de profissionais esperam análise (vira a bolinha no menu "Parceiros"). */
  get pendentesAprovacao(): number {
    return this.solicitacoesProfissionais.filter((s) => s.status === 'em_analise').length;
  }

  mostrarToastAdm(texto: string, tipo: 'ok' | 'aviso' | 'erro' | 'novo' = 'ok'): void {
    this.toastAdm = { texto, tipo };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastAdm = null; this.atualizarTela(); }, 5000);
  }

  private avisarNovoCadastro(colecao: string, d: any): void {
    const quem = colecao === 'psicologos' ? 'psicólogo(a)' : colecao === 'advogados' ? 'advogado(a)' : 'parceiro';
    this.mostrarToastAdm(`Novo cadastro de ${quem}: ${d['nomeEmpresa'] || d['nome'] || 'sem nome'}`, 'novo');
  }

  private lerNotificacoesLidas(): string[] {
    try { return JSON.parse(localStorage.getItem('adm_notificacoes_lidas') || '[]'); } catch { return []; }
  }

  /** Cadastros esperando aprovação, parceiros novos e posts/conteúdos denunciados viram notificações. */
  private reconstruirNotificacoes(): void {
    const itens: NotificacaoAdm[] = [];

    this.solicitacoesProfissionais.filter((s) => s.status === 'em_analise').forEach((s) => {
      itens.push({
        id: `prof:${s.colecao}:${s.id}`,
        icone: 'fa-solid fa-user-doctor', cor: 'icone-azul',
        titulo: `Novo cadastro de ${s.categoria.toLowerCase()}`,
        descricao: `${s.nome} (${s.registro}) aguarda a sua aprovação.`,
        aba: 'parceiros', subAba: 'aprovacao', naoLida: false
      });
    });

    this.parceirosLista.filter((p) => p.novo).forEach((p) => {
      itens.push({
        id: `parc:${p.id}`,
        icone: 'fa-solid fa-handshake', cor: 'icone-roxo',
        titulo: 'Novo parceiro na plataforma',
        descricao: `${p.nome} acabou de se cadastrar.`,
        aba: 'parceiros', subAba: 'parceiros', naoLida: false
      });
    });

    this.denunciasLista.filter((d) => this.denunciaEmAberto(d)).forEach((d) => {
      itens.push({
        id: `den:${d.id}`,
        icone: 'fa-solid fa-flag', cor: 'icone-laranja',
        titulo: `${this.rotuloTipoDenuncia(d.tipo)} denunciado`,
        descricao: `"${d.alvoTitulo.slice(0, 60)}" — motivo: ${d.motivo}`,
        aba: 'denuncias', naoLida: false
      });
    });

    itens.forEach((n) => (n.naoLida = !this.notificacoesLidas.has(n.id)));
    this.notificacoesAdm = itens;

    // tudo que muda as notificações (cadastros, posts, conteúdo) também muda os números da Home
    this.recalcularIndicadores();
    this.atualizarTela();
  }

  private conteudoModeracaoNotificavel(): ConteudoAdm[] {
    return [...this.artigosModeracao, ...this.eventosModeracao]
      .filter((c) => (c.moderacao?.denuncias || 0) > 0 && !c.moderacao?.removido);
  }

  alternarPainelNotificacoes(): void {
    this.painelNotificacoesAberto = !this.painelNotificacoesAberto;
  }

  marcarTodasNotificacoesLidas(): void {
    this.notificacoesAdm.forEach((n) => { n.naoLida = false; this.notificacoesLidas.add(n.id); });
    try { localStorage.setItem('adm_notificacoes_lidas', JSON.stringify([...this.notificacoesLidas])); } catch { /* ok */ }
  }

  abrirNotificacaoAdm(n: NotificacaoAdm): void {
    this.notificacoesLidas.add(n.id);
    n.naoLida = false;
    try { localStorage.setItem('adm_notificacoes_lidas', JSON.stringify([...this.notificacoesLidas])); } catch { /* ok */ }
    this.mudarAba(n.aba);
    if (n.subAba) this.mudarSubAbaParceiros(n.subAba);
    this.painelNotificacoesAberto = false;
  }

  // ---------------- fórum: abrir o post e ver as respostas ----------------
  postForumAberto: PostForum | null = null;
  respostasPostForum: RespostaForumAdm[] = [];
  carregandoRespostasForum = false;
  contagemRespostasPorPost: Record<string, number> = {};
  private unsubRespostasForum: Unsubscribe | null = null;
  private cachePapelAutor = new Map<string, { nome: string; foto: string; papel: string; ehEspecialista: boolean }>();

  /** Conta as respostas de cada post (aparece no botão "Ver respostas"). */
  private async contarRespostasDosPosts(): Promise<void> {
    const alvo = this.postsForum.slice(0, 60);
    await Promise.all(alvo.map(async (p) => {
      try {
        const total = (await getCountFromServer(collection(db, 'posts', p.id, 'comentarios'))).data().count;
        this.contagemRespostasPorPost[p.id] = total;
      } catch { /* sem permissão ou sem rede: deixa sem número */ }
    }));
  }

  private async descobrirPapelDoAutor(autorId: string, nomeSalvo: string, fotoSalva: string) {
    if (!autorId) return { nome: nomeSalvo, foto: fotoSalva, papel: 'Usuária', ehEspecialista: false };
    const cache = this.cachePapelAutor.get(autorId);
    if (cache) return cache;

    let resultado = { nome: nomeSalvo, foto: fotoSalva, papel: 'Usuária', ehEspecialista: false };
    try {
      const idLimpo = autorId.startsWith('parc_') ? autorId.slice(5) : autorId;
      const tentativas: { col: string; papel: string; especialista: boolean }[] = autorId.startsWith('parc_')
        ? [{ col: 'parceiros', papel: 'Parceiro', especialista: false }]
        : [
            { col: 'psicologos', papel: 'Psicólogo(a)', especialista: true },
            { col: 'advogados', papel: 'Advogado(a)', especialista: true },
            { col: 'usuarios', papel: 'Mãe', especialista: false },
          ];
      for (const t of tentativas) {
        const snap = await getDoc(doc(db, t.col, idLimpo));
        if (snap.exists()) {
          const d = snap.data() as any;
          resultado = {
            nome: d['nomeEmpresa'] || d['nome'] || nomeSalvo,
            foto: d['fotoURL'] || d['avatar'] || fotoSalva,
            papel: t.papel,
            ehEspecialista: t.especialista
          };
          break;
        }
      }
    } catch (e) {
      console.warn('Não foi possível identificar o autor da resposta:', e);
    }
    this.cachePapelAutor.set(autorId, resultado);
    return resultado;
  }

  abrirPostForum(post: PostForum): void {
    this.postForumAberto = post;
    this.respostasPostForum = [];
    this.carregandoRespostasForum = true;
    this.unsubRespostasForum?.();

    const q = query(collection(db, 'posts', post.id, 'comentarios'), orderBy('data', 'asc'));
    this.unsubRespostasForum = onSnapshot(
      q,
      async (snap) => {
        const lista: RespostaForumAdm[] = [];
        for (const docSnap of snap.docs) {
          const c = docSnap.data() as any;
          const autor = await this.descobrirPapelDoAutor(c['autorId'] || '', c['autorNome'] || 'Usuária', c['autorFoto'] || './img/account_icon.png');
          lista.push({
            id: docSnap.id,
            autorNome: autor.nome,
            autorFoto: autor.foto,
            papel: autor.papel,
            ehEspecialista: autor.ehEspecialista,
            conteudo: c['conteudo'] || '',
            dataFormatada: c['data']?.toDate ? c['data'].toDate().toLocaleString('pt-BR') : 'Agora'
          });
        }
        this.respostasPostForum = lista;
        this.contagemRespostasPorPost[post.id] = lista.length;
        this.carregandoRespostasForum = false;
        this.atualizarTela();
      },
      (erro) => {
        console.error('Erro ao carregar respostas do post:', erro);
        this.carregandoRespostasForum = false;
        this.atualizarTela();
      }
    );
  }

  fecharPostForum(): void {
    this.unsubRespostasForum?.();
    this.unsubRespostasForum = null;
    this.postForumAberto = null;
    this.respostasPostForum = [];
  }

  get respostasEspecialistasForum(): number {
    return this.respostasPostForum.filter((r) => r.ehEspecialista).length;
  }

  // =========================================================
  // DENÚNCIAS
  // =========================================================

  get denunciasFiltradas(): DenunciaAdm[] {
    const termo = this.buscaDenuncias.trim().toLowerCase();
    return this.denunciasLista.filter((d) =>
      (this.filtroTipoDenuncia === 'todas' || d.tipo === this.filtroTipoDenuncia)
      && (this.filtroStatusDenuncia === 'todas' || (this.filtroStatusDenuncia === 'aberta' ? this.denunciaEmAberto(d) : !this.denunciaEmAberto(d)))
      && (!this.filtroDonoDenuncia || d.alvoDono === this.filtroDonoDenuncia)
      && this.noPeriodo(d.ts, this.denunciaDe, this.denunciaAte)
      && (!termo || d.alvoTitulo.toLowerCase().includes(termo) || d.alvoDono.toLowerCase().includes(termo)
          || d.motivo.toLowerCase().includes(termo) || d.denuncianteNome.toLowerCase().includes(termo)));
  }

  get donosDenuncias(): string[] {
    return [...new Set(this.denunciasLista.map((d) => d.alvoDono).filter((n) => !!n))].sort((a, b) => a.localeCompare(b));
  }

  contarDenuncias(tipo: 'post' | 'artigo' | 'evento'): number {
    return this.denunciasLista.filter((d) => this.denunciaEmAberto(d) && d.tipo === tipo).length;
  }

  denunciaEmAberto(d: DenunciaAdm): boolean {
    return d.status === 'aberta' || d.status === 'em_analise';
  }

  rotuloStatusDenuncia(status: string): string {
    return { aberta: 'Pendente', em_analise: 'Em análise', resolvida: 'Resolvida', descartada: 'Descartada' }[status] || status;
  }

  classeStatusDenuncia(status: string): string {
    return status === 'aberta' ? 'pendente' : status === 'em_analise' ? 'recusado' : status === 'resolvida' ? 'ativo' : 'inativo';
  }

  rotuloTipoDenuncia(tipo: string): string {
    return tipo === 'post' ? 'Post do fórum' : tipo === 'artigo' ? 'Artigo' : 'Evento';
  }

  /** Escuta as denúncias em tempo real e avisa o admin na hora quando chega uma nova. */
  escutarDenuncias(): void {
    const unsub = onSnapshot(
      collection(db, 'denunciasConteudo'),
      (snap) => {
        if (this.primeiraCargaDenuncias) {
          snap.docChanges().forEach((m) => {
            const d = m.doc.data() as any;
            if (m.type === 'added' && d['status'] === 'aberta') {
              this.mostrarToastAdm(`Nova denúncia (${this.rotuloTipoDenuncia(d['tipo']).toLowerCase()}): ${d['alvoTitulo'] || 'sem título'}`, 'novo');
            }
          });
        }
        this.primeiraCargaDenuncias = true;

        this.denunciasLista = snap.docs.map((x) => {
          const d = x.data() as any;
          const dt = this.dataDoDoc(d['criadoEm']);
          return {
            id: x.id,
            tipo: d['tipo'],
            alvoId: d['alvoId'] || '',
            alvoTitulo: d['alvoTitulo'] || 'Sem título',
            alvoDono: d['alvoDono'] || '',
            motivo: d['motivo'] || '',
            detalhes: d['detalhes'] || '',
            denuncianteNome: d['denuncianteNome'] || 'Usuária',
            status: d['status'] || 'aberta',
            ts: dt?.getTime() ?? Date.now(),
            dataFormatada: dt ? dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Agora',
            parecer: d['parecer'] || '',
            analisadoPor: d['analisadoPor'] || '',
            analisadoEmFormatado: this.dataDoDoc(d['analisadoEm'])?.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) || ''
          } as DenunciaAdm;
        }).sort((a, b) => b.ts - a.ts);

        // mantém o painel de detalhes (se aberto) com os dados mais novos
        if (this.denunciaSelecionada) {
          this.denunciaSelecionada = this.denunciasLista.find((x) => x.id === this.denunciaSelecionada!.id) ?? null;
        }
        this.reconstruirNotificacoes();
        this.atualizarTela();
      },
      (erro) => console.error('Erro ao escutar denúncias:', erro)
    );
    this.unsubscribes.push(unsub);
  }

  /** Abre o conteúdo denunciado (post no fórum, ou artigo/evento na análise de denúncia). */
  abrirAlvoDenuncia(d: DenunciaAdm): void {
    if (d.tipo === 'post') {
      const post = this.postsForum.find((p) => p.id === d.alvoId);
      if (!post) { this.mostrarToastAdm('Esse post não existe mais.', 'aviso'); return; }
      this.abrirPostForum(post);
      return;
    }
    const item = this.conteudoModeracao.find((c) => c.id === d.alvoId && c.origem === (d.tipo === 'artigo' ? 'artigos' : 'eventos'));
    if (!item) { this.mostrarToastAdm('Esse conteúdo não existe mais.', 'aviso'); return; }
    this.abrirModalAnalisarDenuncia(item);
  }

  abrirDetalheDenuncia(d: DenunciaAdm): void {
    this.denunciaSelecionada = d;
    this.parecerDenuncia = '';
    this.erroDenuncia = '';
  }

  fecharDetalheDenuncia(): void {
    if (this.salvandoDenuncia) return;
    this.denunciaSelecionada = null;
  }

  /**
   * Registra a análise: muda o status e guarda quem analisou, quando e o parecer.
   * Resolver ou descartar exige parecer (fica no histórico da denúncia).
   */
  async registrarAnaliseDenuncia(status: 'em_analise' | 'resolvida' | 'descartada'): Promise<void> {
    const d = this.denunciaSelecionada;
    if (!d) return;
    const parecer = this.parecerDenuncia.trim();
    if (status !== 'em_analise' && parecer.length < 5) {
      this.erroDenuncia = 'Escreva um parecer curto (o que foi decidido e por quê) para encerrar a denúncia.';
      return;
    }
    this.salvandoDenuncia = true;
    this.erroDenuncia = '';
    try {
      const dados: any = { status, analisadoPor: this.adminNome, analisadoEm: serverTimestamp() };
      if (parecer) dados.parecer = parecer;
      await updateDoc(doc(db, 'denunciasConteudo', d.id), dados);
      this.mostrarToastAdm(
        status === 'em_analise' ? 'Denúncia marcada como em análise.' : status === 'resolvida' ? 'Denúncia resolvida e registrada.' : 'Denúncia descartada e registrada.',
        'ok'
      );
      this.parecerDenuncia = '';
      if (status !== 'em_analise') this.denunciaSelecionada = null;
    } catch (e) {
      console.error('Erro ao registrar análise da denúncia:', e);
      this.erroDenuncia = 'Não foi possível registrar agora. Tente novamente.';
    } finally {
      this.salvandoDenuncia = false;
    }
  }

  /** Quando o admin age sobre um conteúdo (advertir/remover), as denúncias abertas dele ficam resolvidas. */
  private async resolverDenunciasDoAlvo(tipo: 'post' | 'artigo' | 'evento', alvoId: string): Promise<void> {
    const abertas = this.denunciasLista.filter((d) => this.denunciaEmAberto(d) && d.tipo === tipo && d.alvoId === alvoId);
    if (!abertas.length) return;
    try {
      const lote = writeBatch(db);
      abertas.forEach((d) => lote.update(doc(db, 'denunciasConteudo', d.id), { status: 'resolvida', analisadoPor: this.adminNome, analisadoEm: serverTimestamp(), parecer: d.parecer || 'Resolvida automaticamente: o conteúdo foi advertido/removido pela moderação.' }));
      await lote.commit();
    } catch (e) {
      console.warn('Não foi possível resolver as denúncias do conteúdo:', e);
    }
  }

  ngOnInit(): void {
    this.escutarDenuncias();
    this.escutarCadastros();
    this.escutarMudancas();
    this.escutarAdminLogado();
    this.carregarPostsForum();
    this.carregarConteudoModeracao();
  }

  ngAfterViewInit(): void {
    this.atualizarGraficoRede();
    this.atualizarGraficosRelatorios();
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(unsub => unsub());
    this.unsubRespostasForum?.();
    clearTimeout(this.toastTimer);

    if (this.redeChart) {
      this.redeChart.destroy();
    }

    if (this.conteudoDonutChart) {
      this.conteudoDonutChart.destroy();
    }

    if (this.relatoriosFinanceiroChart) {
      this.relatoriosFinanceiroChart.destroy();
    }

    if (this.relatoriosOrigemChart) {
      this.relatoriosOrigemChart.destroy();
    }

    if (this.relatoriosAssinantesChart) {
      this.relatoriosAssinantesChart.destroy();
    }
  }

  /** Preenche o cartão de perfil da sidebar com os dados de quem está logado. */
  escutarAdminLogado(): void {
    const unsub = onAuthStateChanged(auth, async (firebaseUser: any) => {
      if (!firebaseUser) {
        this.router.navigateByUrl('/login-profissional');
        return;
      }
      if (firebaseUser.displayName) {
        this.adminNome = firebaseUser.displayName;
      }
      if (firebaseUser.photoURL) {
        this.adminAvatar = firebaseUser.photoURL;
      }
      this.atualizarTela();
      // o nome e a foto de verdade ficam no documento do usuário
      try {
        const snap = await getDoc(doc(db, 'usuarios', firebaseUser.uid));
        if (snap.exists()) {
          const d = snap.data() as any;
          if (d['nome']) this.adminNome = d['nome'];
          if (d['avatar']) this.adminAvatar = d['avatar'];
        }
      } catch (e) {
        console.warn('Não foi possível ler o perfil do admin:', e);
      }
      this.atualizarTela();
    });
    this.unsubscribes.push(unsub);
  }

  mudarAba(aba: string): void {
    // A antiga aba "Parceiros" foi unida à aba "Usuários".
    if (aba === 'parceiros') aba = 'usuarios';
    this.abaAtiva = aba;
    this.sidebarAberta = false;

    if (aba === 'home') {
      setTimeout(() => this.atualizarGraficoRede(), 0);
    }

    // Os canvases dos gráficos de Relatórios ficam ocultos via CSS ([class.hidden])
    // em vez de destruídos (*ngIf), então ao reabrir a aba só precisamos garantir
    // que o Chart.js recalcule o tamanho depois que a seção volta a ficar visível.
    if (aba === 'relatorios') {
      setTimeout(() => this.atualizarGraficosRelatorios(), 0);
      // sempre busca os números mais recentes ao abrir a aba
      this.carregarRelatorioFinanceiro();
    }

    // Sempre que a pessoa entra na aba Configurações pelo menu lateral,
    // volta para a tela principal (e fecha qualquer modal que tenha ficado aberto).
    if (aba === 'configuracoes') {
      this.configSubTela = 'principal';
      this.configModalAberto = null;
    }
  }

  abrirOuFecharSidebar(): void {
  this.sidebarAberta = !this.sidebarAberta;
}

  fecharSidebar(): void {
  this.sidebarAberta = false;
  }

  /** Mantido por compatibilidade: agora só recalcula os números (tudo vem dos listeners ao vivo). */
  async atualizarDashboard(): Promise<void> {
    this.recalcularIndicadores();
  }

  /**
   * Recalcula tudo que a Home e a aba Usuários mostram, a partir do que os
   * listeners em tempo real já trouxeram. Nenhum número aqui é inventado.
   */
  private recalcularIndicadores(): void {
    this.psicologosAtivos = this.cadastrosBrutos['psicologos'].filter((d) => d['status'] === 'aprovado').length;
    this.advogadosAtivos = this.cadastrosBrutos['advogados'].filter((d) => d['status'] === 'aprovado').length;
    this.maesAtivasNaRede = this.maes.filter((m) => m.status === 'ativo').length;
    this.atendimentosRealizados = this.consultasBrutas.filter((c) => c['status'] === 'aceito' || c['status'] === 'realizado').length;
    this.denunciasAbertas = this.denunciasLista.filter((d) => this.denunciaEmAberto(d)).length;

    this.itensAtencao = [
      { icone: 'fa-solid fa-user-clock', cor: 'icone-azul', texto: 'Cadastros de profissionais aguardando aprovação', total: this.pendentesAprovacao, aba: 'usuarios', visao: 'aprovacao' },
      { icone: 'fa-solid fa-flag', cor: 'icone-laranja', texto: 'Denúncias em aberto (posts, artigos e eventos)', total: this.denunciasAbertas, aba: 'denuncias' }
    ];

    this.reconstruirUsuariosTodos();
    this.atualizarAtividadesRecentes();
    this.atualizarGraficoRede();
  }

  /** Monta a lista "Todos" da aba Usuários juntando mães, profissionais e parceiros. */
  private reconstruirUsuariosTodos(): void {
    const lista: UsuarioUnificado[] = [];

    this.maes.forEach((m) => {
      lista.push({
        chave: `mae:${m.id}`, tipo: 'mae', tipoRotulo: 'Mãe',
        nome: m.nome, email: m.email,
        detalhe: m.cidade ? `${m.cidade}${m.uf ? ' - ' + m.uf : ''}` : '—',
        avatar: m.avatar,
        cadastroTs: this.dataDoDoc(m.criadoEm)?.getTime() ?? 0,
        cadastro: this.formatarData(m.criadoEm),
        situacao: m.status === 'ativo' ? 'ativo' : 'suspenso',
        mae: m
      });
    });

    this.solicitacoesProfissionais.forEach((s) => {
      const prof = this.profissionaisLista.find((x) => x.id === s.id && x.colecao === s.colecao);
      const bruto = (this.cadastrosBrutos[s.colecao || ''] || []).find((x: any) => x.id === s.id);
      const ehPsi = s.colecao === 'psicologos';
      const situacao: SituacaoUsuario =
        s.status === 'aprovado' ? (prof?.status === 'inativo' ? 'suspenso' : 'ativo')
        : s.status === 'pendencia' ? 'recusado'
        : 'pendente';
      lista.push({
        chave: `${s.colecao}:${s.id}`, tipo: ehPsi ? 'psicologo' : 'advogado', tipoRotulo: ehPsi ? 'Psicólogo(a)' : 'Advogado(a)',
        nome: s.nome, email: s.detalhes.email, detalhe: s.registro, avatar: s.avatar,
        cadastroTs: this.dataDoDoc(bruto?.['criadoEm'])?.getTime() ?? 0,
        cadastro: s.cadastro,
        situacao, solicitacao: s, profissional: prof
      });
    });

    this.parceirosLista.forEach((p) => {
      const bruto = (this.cadastrosBrutos['parceiros'] || []).find((x: any) => x.id === p.id);
      lista.push({
        chave: `parceiros:${p.id}`, tipo: 'parceiro', tipoRotulo: 'Parceiro',
        nome: p.nome, email: p.detalhes.email, detalhe: p.cnpj !== '—' ? `CNPJ ${p.cnpj}` : p.categoria, avatar: p.avatar,
        cadastroTs: this.dataDoDoc(bruto?.['criadoEm'])?.getTime() ?? 0,
        cadastro: this.formatarData(bruto?.['criadoEm']),
        situacao: p.status === 'inativo' ? 'suspenso' : 'ativo',
        parceiro: p
      });
    });

    // quem precisa de ação (em análise) vem primeiro; depois os mais recentes
    lista.sort((a, b) =>
      (a.situacao === 'pendente' ? 0 : 1) - (b.situacao === 'pendente' ? 0 : 1)
      || b.cadastroTs - a.cadastroTs
      || a.nome.localeCompare(b.nome));

    this.usuariosTodos = lista;
    this.resumoUsuarios = {
      total: lista.length,
      maes: this.maes.length,
      profissionais: this.solicitacoesProfissionais.length,
      parceiros: this.parceirosLista.length,
      pendentes: this.pendentesAprovacao
    };
  }

  /**
   * Gráfico "Quem está na rede" (rosca) — números reais: mães, psicólogos e
   * advogados aprovados e parceiros. (Antes era uma linha com série inventada.)
   */
  atualizarGraficoRede(): void {
    const canvas = document.getElementById('redeChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    const dados = [this.maesNaRede, this.psicologosAtivos, this.advogadosAtivos, this.parceirosLista.length];

    if (this.redeChart) {
      this.redeChart.data.datasets[0].data = dados;
      this.redeChart.update();
      return;
    }

    this.redeChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Mães', 'Psicólogos(as)', 'Advogados(as)', 'Parceiros'],
        datasets: [{
          data: dados,
          backgroundColor: ['#52427D', '#8E65BF', '#E685A6', '#5BB5A2'],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } } }
      }
    });
  }

  async carregarSolicitacoes(): Promise<void> {

    const colecoes = [
      {
        tipo: 'psicologo',
        ref: collection(db, 'psicologos')
      },

      {
        tipo: 'advogado',
        ref: collection(db, 'advogados')
      }
    ];

    const tempSolicitacoes: ProfissionalData[] = [];

    for (const col of colecoes) {

      const snap = await getDocs(col.ref);

      snap.forEach((docSnap) => {

        const data = docSnap.data();

        const status =
          data['status'] || 'pendente';

        if (status === 'pendente') {

          tempSolicitacoes.push({
            id: docSnap.id,

            colTipo: col.tipo,

            nome: data['nome'] || '-',

            registro:
              col.tipo === 'psicologo'
                ? (data['crp'] || '-')
                : (data['oab'] || '-'),

            status
          });
        }
      });
    }

    this.solicitacoes = tempSolicitacoes;

    this.atualizarAtividadesRecentes();
  }

  /**
   * "Atividade recente" da Home: junta cadastros novos, aprovações e posts
   * moderados, ordenados pela data real (quando o documento tem data).
   */
  private atualizarAtividadesRecentes(): void {
    const eventos: { quando: number; item: AtividadeItem }[] = [];

    this.maes.forEach((m) => {
      const d = this.dataDoDoc(m.criadoEm);
      if (!d) return;
      eventos.push({ quando: d.getTime(), item: {
        icone: 'fa-solid fa-user-plus', corIcone: 'icone-roxo',
        titulo: 'Nova mãe cadastrada', descricao: `${m.nome} entrou para a rede EloMaterno.`
      } });
    });

    (['psicologos', 'advogados', 'parceiros'] as const).forEach((colecao) => {
      this.cadastrosBrutos[colecao].forEach((d: any) => {
        const nome = d['nomeEmpresa'] || d['nome'] || 'Sem nome';
        const quem = colecao === 'psicologos' ? 'psicólogo(a)' : colecao === 'advogados' ? 'advogado(a)' : 'parceiro';
        const criado = this.dataDoDoc(d['criadoEm']);
        const analisado = this.dataDoDoc(d['analisadoEm']);
        if (d['status'] === 'aprovado' && analisado) {
          eventos.push({ quando: analisado.getTime(), item: {
            icone: 'fa-solid fa-circle-check', corIcone: 'icone-verde',
            titulo: 'Profissional aprovado', descricao: `${nome} (${quem}) está ativo na plataforma.`
          } });
        } else if ((d['status'] || 'pendente') === 'pendente' && criado) {
          eventos.push({ quando: criado.getTime(), item: {
            icone: 'fa-solid fa-user-doctor', corIcone: 'icone-azul',
            titulo: 'Novo cadastro aguardando análise', descricao: `${nome} enviou um cadastro de ${quem}.`
          } });
        }
      });
    });

    this.postsForum.forEach((p) => {
      const adv = this.dataDoDoc(p.moderacao?.dataAdvertencia);
      const rem = this.dataDoDoc(p.moderacao?.dataRemocao);
      if (rem) {
        eventos.push({ quando: rem.getTime(), item: {
          icone: 'fa-solid fa-ban', corIcone: 'icone-laranja',
          titulo: 'Post removido do fórum', descricao: `Post de ${p.autorNome} foi removido pela moderação.`
        } });
      } else if (adv) {
        eventos.push({ quando: adv.getTime(), item: {
          icone: 'fa-solid fa-triangle-exclamation', corIcone: 'icone-laranja',
          titulo: 'Advertência no fórum', descricao: `Post de ${p.autorNome} recebeu advertência.`
        } });
      }
    });

    eventos.sort((a, b) => b.quando - a.quando);
    this.atividadesRecentes = eventos.slice(0, 5).map((e) => e.item);
  }

  async aprovar(
    id: string,
    colTipo: string
  ): Promise<void> {

    const colName =
      colTipo === 'psicologo'
        ? 'psicologos'
        : 'advogados';

    const docRef = doc(
      db,
      colName,
      id
    );

    await updateDoc(
      docRef,
      {
        status: 'aprovado'
      }
    );

    this.alerta.sucesso('O profissional já pode acessar a plataforma.', 'Profissional aprovado!');

    await this.carregarSolicitacoes();
    await this.carregarUsuarios();
    await this.atualizarDashboard();
  }

  async recusar(
    id: string,
    colTipo: string
  ): Promise<void> {

    const colName =
      colTipo === 'psicologo'
        ? 'psicologos'
        : 'advogados';

    const docRef = doc(
      db,
      colName,
      id
    );

    await updateDoc(
      docRef,
      {
        status: 'recusado'
      }
    );

    this.alerta.info('O cadastro foi marcado como recusado.', 'Profissional recusado');

    await this.carregarSolicitacoes();
    await this.atualizarDashboard();
  }

async carregarUsuarios(): Promise<void> {

  const colecoesConfig = [

    {
      tipoLabel: 'Psicólogo',
      nomeColecao: 'psicologos',
      ref: collection(db, 'psicologos')
    },

    {
      tipoLabel: 'Advogado',
      nomeColecao: 'advogados',
      ref: collection(db, 'advogados')
    },

    {
      tipoLabel: 'Mãe',
      nomeColecao: 'usuarios',
      ref: collection(db, 'usuarios')
    }

  ];

  try {

    const snapshots = await Promise.all(
      colecoesConfig.map(col => getDocs(col.ref))
    );

    const tempUsuarios: UsuarioData[] = [];

    snapshots.forEach((snap, index) => {

      const col = colecoesConfig[index];

      snap.forEach((docSnap) => {

        const data = docSnap.data();

        // A coleção "usuarios" pode possuir outros tipos.
        // Aqui pegamos somente usuários que são mães.
        if (
          col.nomeColecao === 'usuarios' &&
          data['tipo'] !== 'mae'
        ) {
          return;
        }

        const status =
          data['status'] || 'aprovado';

        tempUsuarios.push({

          id: docSnap.id,

          colName: col.nomeColecao,

          colLabel: col.tipoLabel,

          nome:
            data['nome'] || 'Sem nome',

          emailOrDoc:
            data['email'] ||
            data['crp'] ||
            data['oab'] ||
            '-',

          status,

          uniqueId:
            `${col.nomeColecao}-${docSnap.id}`

        });

      });

    });

    this.usuarios = tempUsuarios;

    this.maesNaRede = tempUsuarios.filter(u => u.colName === 'usuarios').length;

    this.atualizarAtividadesRecentes();

    console.log('Usuários carregados:', this.usuarios);

  } catch (error) {

    console.error(
      'Erro ao carregar usuários:',
      error
    );

  }
}

  async removerUsuario(
    id: string,
    colName: string
  ): Promise<void> {

    const confirmar =
      await this.alerta.confirmar(
        'Esta ação não pode ser desfeita.',
        { titulo: 'Remover este usuário?', textoOk: 'Remover', perigo: true }
      );

    if (!confirmar) {
      return;
    }

    const docRef =
      doc(db, colName, id);

    await deleteDoc(docRef);

    this.alerta.sucesso('O usuário foi removido da plataforma.', 'Usuário removido');

    await this.carregarUsuarios();
    await this.atualizarDashboard();
  }

  /**
   * Escuta a coleção `usuarios` em tempo real. As mães (tipo === 'mae') saem
   * direto do snapshot — antes, cada mudança em psicologos/advogados/usuarios
   * disparava 4 leituras completas das coleções (e os 3 listeners juntos
   * faziam isso na hora que a tela abria). Psicólogos e advogados já são
   * escutados em escutarCadastros().
   */
  escutarMudancas(): void {
    const unsub = onSnapshot(
      collection(db, 'usuarios'),
      (snap) => {
        this.maes = snap.docs
          .filter((d) => (d.data() as any)['tipo'] === 'mae')
          .map((d) => this.mapearMae(d))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        this.maesNaRede = this.maes.length;

        // mantém aberto (e atualizado) o perfil que o admin está olhando
        if (this.maeSelecionada) {
          const atual = this.maes.find((m) => m.id === this.maeSelecionada!.id);
          if (atual) this.maeSelecionada = atual;
        }

        this.recalcularIndicadores();
        this.atualizarTela();
      },
      (erro) => console.error('Erro ao escutar usuários:', erro)
    );
    this.unsubscribes.push(unsub);
  }

  // =========================================================
  // ABA "MÃES" — antiga aba "Usuários", agora uma das visões de Usuários
  // =========================================================

  private mapearMae(docSnap: any): MaeData {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      nome: data['nome'] || 'Sem nome',
      email: data['email'] || '-',
      avatar: data['avatar'] || data['fotoURL'] || '',
      status: data['status'] || 'ativo',
      criadoEm: data['criadoEm'] || null,
      cidade: data['cidade'] || '',
      uf: data['uf'] || data['estado'] || '',
      dataNascimento: data['dataNascimento'] || '',
      endereco: data['endereco'] || '',
      telefone: data['telefone'] || '',
      filhos: data['filhos'] || '',
      motivoSuspensao: data['motivoSuspensao'] || '',
      observacoesSuspensao: data['observacoesSuspensao'] || '',
      suspensoEm: data['suspensoEm'] || null,
      advertenciasForum: data['advertenciasForum'] || 0
    } as MaeData;
  }

  filtrarStatusMae(filtro: 'todas' | 'ativas' | 'inativas'): void {
    this.filtroStatusMae = filtro;
    this.paginaMaeAtual = 1;
  }

  onBuscaMaeChange(): void {
    this.paginaMaeAtual = 1;
  }

  /** Abre o painel "Perfil da mãe" e busca os dados complementares (interações/avaliações). */
  async abrirPerfilMae(mae: MaeData): Promise<void> {
    this.maeSelecionada = mae;
    this.maePerfilCarregando = true;
    this.maeTotalInteracoes = 0;
    this.maeAvaliacoes = [];
    this.maePostsRecentes = [];

    try {
      // Só posts publicados com o nome dela (os anônimos não aparecem aqui, de propósito).
      const snap = await getDocs(query(collection(db, 'posts'), where('autorId', '==', mae.id)));
      this.maeTotalInteracoes = snap.size;
      this.maePostsRecentes = snap.docs
        .map((d) => {
          const p = d.data() as any;
          const dt = this.dataDoDoc(p['data']);
          const estado: PostResumoMae['estado'] = p['moderacao']?.removido ? 'removido' : p['moderacao']?.advertido ? 'advertido' : 'ok';
          return {
            id: d.id,
            titulo: p['titulo'] || (p['conteudo'] || '').slice(0, 60) || 'Sem título',
            dataFormatada: dt ? dt.toLocaleDateString('pt-BR') : '—',
            ts: dt?.getTime() ?? 0,
            estado
          } as PostResumoMae;
        })
        .sort((x, y) => y.ts - x.ts)
        .slice(0, 5);
    } catch (error) {
      console.error('Erro ao carregar os posts da mãe:', error);
    }

    try {
      // Ver TODO na interface AvaliacaoMae: coleção ainda não é populada por nenhuma tela do app.
      const avaliacoesSnap = await getDocs(collection(db, 'usuarios', mae.id, 'avaliacoes'));
      this.maeAvaliacoes = avaliacoesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as AvaliacaoMae)
      );
    } catch (error) {
      console.error('Erro ao carregar avaliações da mãe:', error);
    }

    this.maePerfilCarregando = false;
  }

  fecharPerfilMae(): void {
    this.maeSelecionada = null;
  }

  /** Suspende ou reativa a mãe (persistido em usuarios/{id}.status). Mantido como fallback interno. */
  private async atualizarStatusMae(mae: MaeData, novoStatus: 'ativo' | 'inativo', extras: Record<string, any> = {}): Promise<void> {
    await updateDoc(doc(db, 'usuarios', mae.id), { status: novoStatus, ...extras });
    mae.status = novoStatus;
    if (this.maeSelecionada?.id === mae.id) {
      this.maeSelecionada = { ...this.maeSelecionada, status: novoStatus, ...extras };
    }
  }

  /** Abre o modal "Suspender conta" para a mãe selecionada na tabela. */
  abrirModalSuspensao(mae: MaeData): void {
    this.maeParaSuspender = mae;
    this.motivoSuspensao = '';
    this.observacoesSuspensao = '';
    this.erroSuspensao = '';
  }

  /** Fecha o modal "Suspender conta" sem alterar nada (ignorado enquanto salva). */
  fecharModalSuspensao(): void {
    if (this.suspendendoConta) {
      return;
    }
    this.maeParaSuspender = null;
    this.motivoSuspensao = '';
    this.observacoesSuspensao = '';
    this.erroSuspensao = '';
  }

  /** Confirma a suspensão: valida o motivo e persiste em usuarios/{id}. */
  async confirmarSuspensao(): Promise<void> {
    const mae = this.maeParaSuspender;
    if (!mae) {
      return;
    }

    if (!this.motivoSuspensao) {
      this.erroSuspensao = 'Selecione um motivo para a suspensão.';
      return;
    }

    this.suspendendoConta = true;
    this.erroSuspensao = '';

    const observacoes = this.observacoesSuspensao.trim();

    try {
      await this.atualizarStatusMae(mae, 'inativo', {
        motivoSuspensao: this.motivoSuspensao,
        observacoesSuspensao: observacoes,
        suspensoEm: serverTimestamp(),
      });

      this.maeParaSuspender = null;
      this.motivoSuspensao = '';
      this.observacoesSuspensao = '';
    } catch (error) {
      console.error('Erro ao suspender mãe:', error);
      this.erroSuspensao = 'Não foi possível suspender a conta agora. Tente novamente.';
    } finally {
      this.suspendendoConta = false;
    }
  }

  /** Abre o modal "Reativar conta" para a mãe selecionada na tabela. */
  abrirModalReativacao(mae: MaeData): void {
    this.maeParaReativar = mae;
    this.observacoesReativacao = '';
    this.erroReativacao = '';
  }

  /** Fecha o modal "Reativar conta" sem alterar nada (ignorado enquanto salva). */
  fecharModalReativacao(): void {
    if (this.reativandoConta) {
      return;
    }
    this.maeParaReativar = null;
    this.observacoesReativacao = '';
    this.erroReativacao = '';
  }

  /** Confirma a reativação: persiste em usuarios/{id}. */
  async confirmarReativacao(): Promise<void> {
    const mae = this.maeParaReativar;
    if (!mae) {
      return;
    }

    this.reativandoConta = true;
    this.erroReativacao = '';

    const observacoes = this.observacoesReativacao.trim();

    try {
      await this.atualizarStatusMae(mae, 'ativo', {
        observacoesReativacao: observacoes,
        reativadoEm: serverTimestamp(),
      });

      this.maeParaReativar = null;
      this.observacoesReativacao = '';
    } catch (error) {
      console.error('Erro ao reativar mãe:', error);
      this.erroReativacao = 'Não foi possível reativar a conta agora. Tente novamente.';
    } finally {
      this.reativandoConta = false;
    }
  }

  /** Formata um Timestamp do Firestore (ou string de data) como "12 Set 2024". */
  formatarData(valor: any): string {
    if (!valor) {
      return '—';
    }
    try {
      const data: Date = typeof valor.toDate === 'function' ? valor.toDate() : new Date(valor);
      if (isNaN(data.getTime())) {
        return '—';
      }
      const formatado = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(data);
      return formatado.replace('.', '');
    } catch {
      return '—';
    }
  }

  /** Formata uma data de nascimento (string) como "16/05/2008". */
  formatarDataNascimento(dataNascimento: string): string {
    if (!dataNascimento) {
      return '';
    }
    const data = new Date(dataNascimento);
    if (isNaN(data.getTime())) {
      return dataNascimento;
    }
    return new Intl.DateTimeFormat('pt-BR').format(data);
  }

  /** Calcula a idade a partir de uma data de nascimento (string). */
  calcularIdade(dataNascimento: string): number | null {
    if (!dataNascimento) {
      return null;
    }
    const nascimento = new Date(dataNascimento);
    if (isNaN(nascimento.getTime())) {
      return null;
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const diferencaMes = hoje.getMonth() - nascimento.getMonth();
    if (diferencaMes < 0 || (diferencaMes === 0 && hoje.getDate() < nascimento.getDate())) {
      idade--;
    }
    return idade;
  }

  /** Usado no template para desenhar as 5 estrelas (preenchida/vazia) de uma nota. */
  estrelas(nota: number): boolean[] {
    const arredondado = Math.round(nota || 0);
    return Array.from({ length: 5 }, (_, i) => i < arredondado);
  }

  // ==========================================================================
  // ABA "FÓRUM" — moderação dos posts reais da coleção `posts`
  // (mesma coleção que src/app/pages/forum/forum.ts usa no fórum público)
  // ==========================================================================

  postsForum: PostForum[] = [];
  carregandoPostsForum: boolean = true;
  buscaPostsForum: string = '';
  filtroPostsForum: FiltroPostsForum = 'todos';

  readonly motivosAdvertenciaPost: string[] = [
    'Divulgação de conteúdo (spam)',
    'Conteúdo impróprio',
    'Discurso de ódio ou preconceito',
    'Assédio ou ameaça',
    'Informação falsa (desinformação)',
    'Outro'
  ];

  /** Escuta em tempo real a coleção 'posts' — os posts que aparecem aqui são os reais do fórum. */
  carregarPostsForum(): void {
    this.carregandoPostsForum = true;

    const q = query(collection(db, 'posts'), orderBy('data', 'desc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        this.postsForum = snapshot.docs.map((docSnap) => {
          const p = docSnap.data() as any;

          return {
            id: docSnap.id,
            autorId: p['autorId'] || '',
            dataTs: p['data']?.toDate ? p['data'].toDate().getTime() : 0,
            titulo: p['titulo'] || '',
            conteudo: p['conteudo'] || '',
            autorNome: p['autorNome'] || 'Usuária',
            autorFoto: p['autorFoto'] || './img/account_icon.png',
            categoria: p['categoria'] || '',
            dataFormatada: p['data']?.toDate
              ? p['data'].toDate().toLocaleString('pt-BR')
              : 'Agora',
            respondido: !!p['respondido'],
            moderacao: p['moderacao'] || {}
          } as PostForum;
        });

        this.carregandoPostsForum = false;
        this.contarRespostasDosPosts();
        this.reconstruirNotificacoes();
        this.atualizarTela();
      },
      (erro) => {
        console.error('Erro ao carregar posts do fórum:', erro);
        this.carregandoPostsForum = false;
        this.atualizarTela();
      }
    );

    this.unsubscribes.push(unsub);
  }

  get contagemPostsForum() {
    const posts = this.postsForum;

    return {
      todos: posts.length,
      denunciados: posts.filter(
        p => (p.moderacao?.denuncias || 0) > 0 && !p.moderacao?.removido
      ).length,
      removidos: posts.filter(p => !!p.moderacao?.removido).length,
      advertidos: posts.filter(
        p => !!p.moderacao?.advertido && !p.moderacao?.removido
      ).length
    };
  }

  get postsFiltradosForum(): PostForum[] {
    return this.postsFiltradosForumBase.filter((p) =>
      (!this.forumCategoria || p.categoria === this.forumCategoria)
      && this.noPeriodo(p.dataTs, this.forumDe, this.forumAte));
  }

  get categoriasForumAdm(): string[] {
    return [...new Set(this.postsForum.map((p) => p.categoria).filter((c) => !!c))].sort();
  }

  private get postsFiltradosForumBase(): PostForum[] {
    const termo = this.buscaPostsForum.toLowerCase().trim();

    return this.postsForum.filter((p) => {
      const matchBusca =
        !termo ||
        p.titulo?.toLowerCase().includes(termo) ||
        p.conteudo?.toLowerCase().includes(termo) ||
        p.autorNome?.toLowerCase().includes(termo);

      if (!matchBusca) {
        return false;
      }

      switch (this.filtroPostsForum) {
        case 'denunciados':
          return (p.moderacao?.denuncias || 0) > 0 && !p.moderacao?.removido;
        case 'removidos':
          return !!p.moderacao?.removido;
        case 'advertidos':
          return !!p.moderacao?.advertido && !p.moderacao?.removido;
        default:
          return true;
      }
    });
  }

  filtrarPostsForum(filtro: FiltroPostsForum): void {
    this.filtroPostsForum = filtro;
  }

  /**
   * Classe de sombra do card conforme o estado de moderação do post (igual
   * ao protótipo do Figma): vermelha se removido, amarela se advertido,
   * laranja se denunciado, e roxa (neutra) se estiver tudo em ordem — a
   * mesma cor dos 4 cartões de filtro acima.
   */
  categoriaCardPost(post: PostForum): string {
    if (post.moderacao?.removido) {
      return 'card-perigo';
    }
    if (post.moderacao?.advertido) {
      return 'card-alerta';
    }
    if ((post.moderacao?.denuncias || 0) > 0) {
      return 'card-laranja';
    }
    return 'card-neutro';
  }

  // --- Quem será avisada quando o admin advertir/remover um post ---
  /**
   * Toda advertência/remoção de post PRECISA avisar a autora. Posts normais têm
   * o uid dela em `autorId`. Posts anônimos guardam só 'anonimo' lá — por isso
   * o fórum agora salva o uid real numa coleção separada (`postsAutores/{postId}`),
   * lida só aqui, na moderação. A identidade continua oculta para as outras mães.
   */
  autoraDoPost: { uid: string | null; nome: string; anonima: boolean; carregando: boolean } | null = null;

  private async identificarAutoraDoPost(post: PostForum): Promise<{ uid: string | null; nome: string; anonima: boolean }> {
    if (post.autorId && post.autorId !== 'anonimo') {
      return { uid: post.autorId, nome: post.autorNome, anonima: false };
    }
    try {
      const snap = await getDoc(doc(db, 'postsAutores', post.id));
      const uid = snap.exists() ? ((snap.data() as any)['uid'] as string) : '';
      return { uid: uid || null, nome: 'Autora anônima', anonima: true };
    } catch (e) {
      console.warn('Não foi possível identificar a autora do post anônimo:', e);
      return { uid: null, nome: 'Autora anônima', anonima: true };
    }
  }

  private async resolverAutoraDoPost(post: PostForum): Promise<void> {
    this.autoraDoPost = { uid: null, nome: '', anonima: false, carregando: true };
    const autora = await this.identificarAutoraDoPost(post);
    // só aplica se o modal ainda é do mesmo post
    if (this.postParaAdvertir?.id === post.id || this.postParaRemover?.id === post.id) {
      this.autoraDoPost = { ...autora, carregando: false };
    }
  }

  private trechoDoPost(post: PostForum): string {
    const base = (post.titulo || post.conteudo || 'seu post').trim();
    return base.length > 70 ? base.slice(0, 70) + '…' : base;
  }

  // --- Modal "Aplicar advertência" (post do fórum) ---
  postParaAdvertir: PostForum | null = null;
  motivoAdvertenciaPost: string = '';
  observacoesAdvertenciaPost: string = '';
  advertindoPost: boolean = false;
  erroAdvertenciaPost: string = '';

  abrirModalAdvertirPost(post: PostForum): void {
    this.postParaAdvertir = post;
    this.motivoAdvertenciaPost = '';
    this.observacoesAdvertenciaPost = '';
    this.erroAdvertenciaPost = '';
    void this.resolverAutoraDoPost(post);
  }

  fecharModalAdvertirPost(): void {
    if (this.advertindoPost) {
      return;
    }
    this.postParaAdvertir = null;
    this.autoraDoPost = null;
    this.motivoAdvertenciaPost = '';
    this.observacoesAdvertenciaPost = '';
    this.erroAdvertenciaPost = '';
  }

  /**
   * Aplica a advertência e AVISA a mãe, tudo numa única gravação atômica
   * (writeBatch): ou o post é advertido E a notificação chega, ou nada é
   * gravado. A notificação exige "ciência" — a mãe vê um aviso que só fecha
   * quando ela confirma que leu (ver header.ts / header.html).
   */
  async confirmarAdvertenciaPost(): Promise<void> {
    const post = this.postParaAdvertir;
    if (!post) {
      return;
    }

    if (!this.motivoAdvertenciaPost) {
      this.erroAdvertenciaPost = 'Selecione um motivo para a advertência.';
      return;
    }

    const autora = this.autoraDoPost;
    if (!autora || autora.carregando) {
      this.erroAdvertenciaPost = 'Aguarde um instante: ainda estou identificando a autora do post.';
      return;
    }
    if (!autora.uid) {
      this.erroAdvertenciaPost =
        'Não consigo identificar a autora deste post (post anônimo antigo), então não há como avisá-la. ' +
        'A advertência exige aviso obrigatório. Se o conteúdo for grave, use "Remover Post".';
      return;
    }

    this.advertindoPost = true;
    this.erroAdvertenciaPost = '';

    const motivo = this.motivoAdvertenciaPost;
    const observacoes = this.observacoesAdvertenciaPost.trim();

    try {
      const lote = writeBatch(db);

      lote.update(doc(db, 'posts', post.id), {
        'moderacao.advertido': true,
        'moderacao.motivoAdvertencia': motivo,
        'moderacao.observacoesAdvertencia': observacoes,
        'moderacao.dataAdvertencia': serverTimestamp()
      });

      lote.set(doc(collection(db, 'notificacoes')), {
        destinatarioId: autora.uid,
        tipo: 'advertencia_post',
        titulo: 'Você recebeu uma advertência no fórum',
        mensagem: (`Seu post "${this.trechoDoPost(post)}" recebeu uma advertência da moderação. Motivo: ${motivo}.`
          + (observacoes ? ` Observação da equipe: ${observacoes}` : '')).slice(0, 950),
        motivo,
        observacoes,
        postId: post.id,
        postTitulo: this.trechoDoPost(post),
        exigeCiencia: true,
        cienteEm: null,
        link: '/forum',
        lida: false,
        criadoEm: serverTimestamp()
      });

      lote.update(doc(db, 'usuarios', autora.uid), {
        advertenciasForum: increment(1),
        ultimaAdvertenciaForum: serverTimestamp()
      });

      await lote.commit();

      this.postParaAdvertir = null;
      this.autoraDoPost = null;
      this.motivoAdvertenciaPost = '';
      this.observacoesAdvertenciaPost = '';
      void this.resolverDenunciasDoAlvo('post', post.id);
      this.mostrarToastAdm('Advertência aplicada. A mãe foi avisada e precisará confirmar que leu.', 'ok');
    } catch (error) {
      console.error('Erro ao aplicar advertência no post:', error);
      this.erroAdvertenciaPost = 'Não foi possível aplicar a advertência agora (nada foi gravado). Tente novamente.';
    } finally {
      this.advertindoPost = false;
    }
  }

  // --- Modal "Remover post" (fórum) ---
  postParaRemover: PostForum | null = null;
  motivoRemocaoPost: string = '';
  removendoPost: boolean = false;
  erroRemocaoPost: string = '';

  abrirModalRemoverPost(post: PostForum): void {
    this.postParaRemover = post;
    this.motivoRemocaoPost = '';
    this.erroRemocaoPost = '';
    void this.resolverAutoraDoPost(post);
  }

  fecharModalRemoverPost(): void {
    if (this.removendoPost) {
      return;
    }
    this.postParaRemover = null;
    this.autoraDoPost = null;
    this.motivoRemocaoPost = '';
    this.erroRemocaoPost = '';
  }

  /**
   * Remoção lógica (soft delete): o post some do fórum público — ver o
   * filtro em forum.ts — mas continua salvo com o motivo, pra ficar no
   * histórico de moderação. A autora recebe o aviso na mesma gravação.
   * Exceção: posts anônimos ANTIGOS (feitos antes de existir `postsAutores`)
   * não têm como identificar a autora; nesses a remoção continua permitida
   * (conteúdo nocivo precisa poder sair do ar) e o admin é avisado disso.
   */
  async confirmarRemocaoPost(): Promise<void> {
    const post = this.postParaRemover;
    if (!post) {
      return;
    }

    if (!this.motivoRemocaoPost.trim()) {
      this.erroRemocaoPost = 'Descreva o motivo da remoção.';
      return;
    }

    const autora = this.autoraDoPost;
    if (!autora || autora.carregando) {
      this.erroRemocaoPost = 'Aguarde um instante: ainda estou identificando a autora do post.';
      return;
    }

    this.removendoPost = true;
    this.erroRemocaoPost = '';

    const motivo = this.motivoRemocaoPost.trim();

    try {
      const lote = writeBatch(db);

      lote.update(doc(db, 'posts', post.id), {
        'moderacao.removido': true,
        'moderacao.motivoRemocao': motivo,
        'moderacao.dataRemocao': serverTimestamp()
      });

      if (autora.uid) {
        lote.set(doc(collection(db, 'notificacoes')), {
          destinatarioId: autora.uid,
          tipo: 'post_removido',
          titulo: 'Um post seu foi removido do fórum',
          mensagem: `Seu post "${this.trechoDoPost(post)}" foi removido pela moderação. Motivo: ${motivo}.`.slice(0, 950),
          motivo,
          postId: post.id,
          postTitulo: this.trechoDoPost(post),
          exigeCiencia: false,
          link: '/forum',
          lida: false,
          criadoEm: serverTimestamp()
        });
      }

      await lote.commit();

      this.postParaRemover = null;
      this.autoraDoPost = null;
      this.motivoRemocaoPost = '';
      void this.resolverDenunciasDoAlvo('post', post.id);
      this.mostrarToastAdm(
        autora.uid ? 'Post removido. A mãe foi avisada.' : 'Post removido. A autora não pôde ser avisada (post anônimo antigo).',
        autora.uid ? 'ok' : 'aviso'
      );
    } catch (error) {
      console.error('Erro ao remover post:', error);
      this.erroRemocaoPost = 'Não foi possível remover o post agora (nada foi gravado). Tente novamente.';
    } finally {
      this.removendoPost = false;
    }
  }


  // =========================================================
  // ABA "MODERAÇÃO" — moderação de conteúdo (artigos e eventos)
  // =========================================================

  carregandoConteudoModeracao: boolean = true;
  private artigosModeracao: ConteudoAdm[] = [];
  private eventosModeracao: ConteudoAdm[] = [];
  conteudoModeracao: ConteudoAdm[] = [];

  buscaConteudoModeracao: string = '';
  filtroConteudoModeracao: FiltroConteudoModeracao = 'todos';

  /** id do item cujo menu "Opções" está aberto no momento (só um por vez). */
  opcoesConteudoAbertasId: string | null = null;

  /** Log local das últimas ações de moderação nesta sessão, pra alimentar o painel "Últimos conteúdos moderados". */
  ultimosConteudosModerados: { titulo: string; acao: string; dataFormatada: string }[] = [];

  private conteudoDonutChart: any = null;

  /** Carrega e escuta em tempo real as coleções `artigos` e `eventos` (as mesmas usadas por parceiros/profissionais/mães), unindo as duas nesta tela. */
  carregarConteudoModeracao(): void {
    this.carregandoConteudoModeracao = true;

    const unsubArtigos = onSnapshot(
      collection(db, 'artigos'),
      (snapshot) => {
        this.artigosModeracao = snapshot.docs.map((docSnap) => {
          const a = docSnap.data() as any;
          const dataPost = a['datahorapost'];
          const dataJs = dataPost?.toDate ? dataPost.toDate() : null;

          return {
            id: docSnap.id,
            origem: 'artigos',
            tipo: 'Artigo',
            titulo: a['titulo'] || 'Sem título',
            assunto: a['descricao'] || a['resumo'] || '',
            usuarioNome: a['postadoPor'] || 'Profissional',
            dataFormatada: dataJs ? dataJs.toLocaleDateString('pt-BR') : '—',
            dataOrdenacao: dataJs ? dataJs.getTime() : 0,
            moderacao: a['moderacao'] || {}
          } as ConteudoAdm;
        });

        this.mesclarConteudoModeracao();
      },
      (erro) => {
        console.error('Erro ao carregar artigos:', erro);
        this.carregandoConteudoModeracao = false;
        this.atualizarTela();
      }
    );

    const unsubEventos = onSnapshot(
      collection(db, 'eventos'),
      (snapshot) => {
        this.eventosModeracao = snapshot.docs.map((docSnap) => {
          const e = docSnap.data() as any;
          const dataEvento = e['data'];
          const dataJs = dataEvento?.toDate ? dataEvento.toDate() : null;

          return {
            id: docSnap.id,
            origem: 'eventos',
            tipo: 'Evento',
            titulo: e['titulo'] || 'Sem título',
            assunto: e['descricao'] || e['local'] || '',
            usuarioNome: e['enviadoPor'] || 'Parceiro',
            dataFormatada: dataJs ? dataJs.toLocaleDateString('pt-BR') : '—',
            dataOrdenacao: dataJs ? dataJs.getTime() : 0,
            moderacao: e['moderacao'] || {}
          } as ConteudoAdm;
        });

        this.mesclarConteudoModeracao();
      },
      (erro) => {
        console.error('Erro ao carregar eventos:', erro);
        this.carregandoConteudoModeracao = false;
        this.atualizarTela();
      }
    );

    this.unsubscribes.push(unsubArtigos, unsubEventos);
  }

  private mesclarConteudoModeracao(): void {
    setTimeout(() => this.reconstruirNotificacoes(), 0);
    this.conteudoModeracao = [...this.artigosModeracao, ...this.eventosModeracao]
      .sort((a, b) => b.dataOrdenacao - a.dataOrdenacao);

    this.carregandoConteudoModeracao = false;
    this.atualizarGraficoConteudoModeracao();
    this.atualizarTela();
  }

  get contagemConteudoModeracao() {
    const itens = this.conteudoModeracao;

    return {
      total: itens.length,
      eventos: itens.filter(i => i.origem === 'eventos').length,
      artigos: itens.filter(i => i.origem === 'artigos').length,
      denunciados: itens.filter(i => (i.moderacao?.denuncias || 0) > 0 && !i.moderacao?.removido).length
    };
  }

  get conteudoFiltrado(): ConteudoAdm[] {
    return this.conteudoFiltradoBase.filter((i) =>
      (!this.modParceiro || i.usuarioNome === this.modParceiro)
      && this.noPeriodo(i.dataOrdenacao, this.modDe, this.modAte));
  }

  /** Quem publicou conteúdo (parceiros/profissionais), para o filtro da Moderação. */
  get donosConteudo(): string[] {
    return [...new Set(this.conteudoModeracao.map((i) => i.usuarioNome).filter((n) => !!n))].sort((a, b) => a.localeCompare(b));
  }

  private get conteudoFiltradoBase(): ConteudoAdm[] {
    const termo = this.buscaConteudoModeracao.toLowerCase().trim();

    return this.conteudoModeracao.filter((item) => {
      const bateBusca =
        !termo ||
        item.titulo?.toLowerCase().includes(termo) ||
        item.assunto?.toLowerCase().includes(termo) ||
        item.usuarioNome?.toLowerCase().includes(termo);

      if (!bateBusca) {
        return false;
      }

      switch (this.filtroConteudoModeracao) {
        case 'eventos':
          return item.origem === 'eventos';
        case 'artigos':
          return item.origem === 'artigos';
        case 'denuncias':
          return (item.moderacao?.denuncias || 0) > 0 && !item.moderacao?.removido;
        default:
          return true;
      }
    });
  }

  filtrarConteudoModeracao(filtro: FiltroConteudoModeracao): void {
    this.filtroConteudoModeracao = filtro;
  }

  get percentualEventosConteudo(): number {
    const { total, eventos } = this.contagemConteudoModeracao;
    return total ? Math.round((eventos / total) * 100) : 0;
  }

  get percentualArtigosConteudo(): number {
    const { total, artigos } = this.contagemConteudoModeracao;
    return total ? Math.round((artigos / total) * 100) : 0;
  }

  get percentualDenunciasConteudo(): number {
    const { total, denunciados } = this.contagemConteudoModeracao;
    return total ? Math.round((denunciados / total) * 100) : 0;
  }

  statusConteudo(item: ConteudoAdm): 'removido' | 'denunciado' | 'ok' {
    if (item.moderacao?.removido) {
      return 'removido';
    }
    if ((item.moderacao?.denuncias || 0) > 0) {
      return 'denunciado';
    }
    return 'ok';
  }

  toggleOpcoesConteudo(item: ConteudoAdm): void {
    this.opcoesConteudoAbertasId = this.opcoesConteudoAbertasId === item.id ? null : item.id;
  }

  fecharOpcoesConteudo(): void {
    this.opcoesConteudoAbertasId = null;
  }

  /** Desenha (ou atualiza) o donut "Dados Gerais": proporção de Eventos x Artigos publicados. */
  private atualizarGraficoConteudoModeracao(): void {
    const ctx = document.getElementById('conteudoDonutChart') as HTMLCanvasElement;

    if (!ctx) {
      return;
    }

    const { total, eventos, artigos } = this.contagemConteudoModeracao;
    const pctEventos = total ? Math.round((eventos / total) * 100) : 0;
    const pctArtigos = total ? 100 - pctEventos : 0;

    const valores = [pctEventos, pctArtigos];
    const cores = ['#6C4BBF', '#c9b8f0'];

    if (this.conteudoDonutChart) {
      this.conteudoDonutChart.data.datasets[0].data = valores;
      this.conteudoDonutChart.update();
      return;
    }

    this.conteudoDonutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Eventos', 'Artigos'],
        datasets: [{
          data: valores,
          backgroundColor: cores,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item: any) => ` ${item.label}: ${item.raw}%`,
            },
          },
        },
      },
    });
  }

  // --- Modal "Analisar Denúncia" ---
  conteudoParaAnalisar: ConteudoAdm | null = null;
  acaoDenunciaEscolhida: 'remover' | 'deletar' | null = null;
  observacoesAcaoDenuncia: string = '';
  analisandoDenuncia: boolean = false;
  erroAnaliseDenuncia: string = '';

  abrirModalAnalisarDenuncia(item: ConteudoAdm): void {
    this.conteudoParaAnalisar = item;
    this.acaoDenunciaEscolhida = null;
    this.observacoesAcaoDenuncia = '';
    this.erroAnaliseDenuncia = '';
    this.fecharOpcoesConteudo();
  }

  fecharModalAnalisarDenuncia(): void {
    if (this.analisandoDenuncia) {
      return;
    }
    this.conteudoParaAnalisar = null;
    this.acaoDenunciaEscolhida = null;
    this.observacoesAcaoDenuncia = '';
    this.erroAnaliseDenuncia = '';
  }

  escolherAcaoDenuncia(acao: 'remover' | 'deletar'): void {
    this.acaoDenunciaEscolhida = acao;
    this.erroAnaliseDenuncia = '';
  }

  async confirmarAnaliseDenuncia(): Promise<void> {
    const item = this.conteudoParaAnalisar;
    if (!item) {
      return;
    }

    if (!this.acaoDenunciaEscolhida) {
      this.erroAnaliseDenuncia = 'Escolha uma ação: remover a denúncia ou deletar o post.';
      return;
    }

    this.analisandoDenuncia = true;
    this.erroAnaliseDenuncia = '';

    try {
      if (this.acaoDenunciaEscolhida === 'remover') {
        await updateDoc(doc(db, item.origem, item.id), {
          'moderacao.denuncias': 0,
          'moderacao.motivoDenuncia': ''
        });
        this.registrarUltimoConteudoModerado(item, 'Denúncia removida');
        void this.resolverDenunciasDoAlvo(item.origem === 'artigos' ? 'artigo' : 'evento', item.id);
      } else {
        await updateDoc(doc(db, item.origem, item.id), {
          'moderacao.removido': true,
          'moderacao.motivoRemocao': this.observacoesAcaoDenuncia.trim() || 'Denúncia procedente',
          'moderacao.dataRemocao': serverTimestamp()
        });
        this.registrarUltimoConteudoModerado(item, 'Post Deletado');
        void this.resolverDenunciasDoAlvo(item.origem === 'artigos' ? 'artigo' : 'evento', item.id);
      }

      this.conteudoParaAnalisar = null;
      this.acaoDenunciaEscolhida = null;
      this.observacoesAcaoDenuncia = '';
    } catch (error) {
      console.error('Erro ao analisar denúncia:', error);
      this.erroAnaliseDenuncia = 'Não foi possível concluir a análise agora. Tente novamente.';
    } finally {
      this.analisandoDenuncia = false;
    }
  }

  // --- Modal "Deletar post" (artigo/evento) ---
  conteudoParaDeletar: ConteudoAdm | null = null;
  motivoDelecaoConteudo: string = '';
  deletandoConteudo: boolean = false;
  erroDelecaoConteudo: string = '';

  abrirModalDeletarConteudo(item: ConteudoAdm): void {
    this.conteudoParaDeletar = item;
    this.motivoDelecaoConteudo = '';
    this.erroDelecaoConteudo = '';
    this.fecharOpcoesConteudo();
  }

  fecharModalDeletarConteudo(): void {
    if (this.deletandoConteudo) {
      return;
    }
    this.conteudoParaDeletar = null;
    this.motivoDelecaoConteudo = '';
    this.erroDelecaoConteudo = '';
  }

  /** Remoção lógica (soft delete): o card fica marcado como "Deletado" e pode ser restaurado, igual ao padrão já usado nos posts do fórum. */
  async confirmarDelecaoConteudo(): Promise<void> {
    const item = this.conteudoParaDeletar;
    if (!item) {
      return;
    }

    if (!this.motivoDelecaoConteudo.trim()) {
      this.erroDelecaoConteudo = 'Descreva o motivo de deletar o post.';
      return;
    }

    this.deletandoConteudo = true;
    this.erroDelecaoConteudo = '';

    try {
      await updateDoc(doc(db, item.origem, item.id), {
        'moderacao.removido': true,
        'moderacao.motivoRemocao': this.motivoDelecaoConteudo.trim(),
        'moderacao.dataRemocao': serverTimestamp()
      });

      this.registrarUltimoConteudoModerado(item, 'Post Deletado');
      void this.resolverDenunciasDoAlvo(item.origem === 'artigos' ? 'artigo' : 'evento', item.id);
      this.conteudoParaDeletar = null;
      this.motivoDelecaoConteudo = '';
    } catch (error) {
      console.error('Erro ao deletar conteúdo:', error);
      this.erroDelecaoConteudo = 'Não foi possível deletar agora. Tente novamente.';
    } finally {
      this.deletandoConteudo = false;
    }
  }

  /** Restaura um artigo/evento deletado (desfaz o soft delete). */
  async restaurarConteudo(item: ConteudoAdm): Promise<void> {
    try {
      await updateDoc(doc(db, item.origem, item.id), {
        'moderacao.removido': false,
        'moderacao.motivoRemocao': ''
      });
      this.registrarUltimoConteudoModerado(item, 'Post Restaurado');
    } catch (error) {
      console.error('Erro ao restaurar conteúdo:', error);
    }
  }

  private registrarUltimoConteudoModerado(item: ConteudoAdm, acao: string): void {
    this.ultimosConteudosModerados.unshift({
      titulo: item.titulo,
      acao,
      dataFormatada: new Date().toLocaleDateString('pt-BR')
    });
    this.ultimosConteudosModerados = this.ultimosConteudosModerados.slice(0, 5);
  }
}
