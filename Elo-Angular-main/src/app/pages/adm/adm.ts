import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  Unsubscribe
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

import { Chart, registerables } from 'chart.js';


import { HeaderComponent } from '../../components/header/header';

// COLOQUE AQUI O CAMINHO REAL DO FIREBASE DO SEU PROJETO
import { auth, db } from '../../core/firebase';

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
 * TODO: os campos `criadoEm`, `creditos`, `cidade`, `uf`, `dataNascimento`,
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
  creditos: number;
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
  variacao: number;
  icone: string;
  cor: 'purple' | 'pink' | 'green' | 'blue';
}

/** Fatia de um dos donuts "Receita por origem" / "Custos da plataforma". */
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
  titulo: string;
  conteudo: string;
  autorNome: string;
  autorFoto: string;
  categoria: string;
  dataFormatada: string;
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

/** Configuração de custo em créditos de uma ação da plataforma (sub-página "Créditos"). */
interface AcaoCredito {
  id: string;
  icone: string;
  nome: string;
  descricao: string;
  valor: number;
  valorPadrao: number;
  ativo: boolean;
}

/** Fatia do gráfico de distribuição de uso de créditos (sub-página "Créditos"). */
interface DistribuicaoCredito {
  nome: string;
  percentual: number;
  cor: string;
}

/** Item da lista "Configurações gerais" (sub-página "Créditos"). */
interface ConfiguracaoGeralCredito {
  id: string;
  icone: string;
  label: string;
  tipo: 'valor' | 'toggle';
  valor?: string;
  ativo?: boolean;
}

/** Item da lista "Últimas transações" (sub-página "Créditos"). */
interface TransacaoCredito {
  id: string;
  icone: string;
  nome: string;
  data: string;
  hora: string;
  tipo: 'debito' | 'credito';
}

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

@Component({
  selector: 'app-adm',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './adm.html',
  styleUrl: './adm.css',
})
export class Adm implements OnInit, OnDestroy, AfterViewInit {

  abaAtiva: string = 'home';

  sidebarAberta: boolean = false;

  psicologosAtivos: number = 0;
  advogadosAtivos: number = 0;

  // --- Cartões da Home ---
  maesNaRede: number = 0;
  maesNaRedeVariacao: number = 8.4; // TODO: calcular variação real (mês atual vs anterior)

  // TODO: ainda não existe uma coleção de "atendimentos"/"consultas" concluídas
  // nem de "créditos" no Firestore deste projeto. Deixei valores de exemplo
  // para o layout não ficar vazio; assim que o backend expuser esses dados,
  // é só substituir aqui dentro de atualizarDashboard().
  atendimentosRealizados: number = 327;
  atendimentosVariacao: number = 8.4;
  creditosMovimentados: number = 2640;

  atividadesRecentes: AtividadeItem[] = [];

  // Nome/avatar exibidos no cartão de perfil da sidebar
  adminNome: string = 'Admin EloMaterno';
  adminAvatar: string = './img/avatar_usuario.png';

  // Abas do novo menu que ainda não têm tela própria implementada
  abasEmConstrucao: AbaEmConstrucao[] = [];


  // --- Aba "Parceiros" (sub-abas: Aprovação / Profissionais / Parceiros) ---
  parceirosSubAba: 'aprovacao' | 'profissionais' | 'parceiros' = 'aprovacao';

  // --- Sub-página "Créditos" (dados de exemplo, sem coleção no Firestore ainda) ---
  saldoPlataformaCreditos: number = 1248500;
  creditosEmCirculacao: number = 1248500;
  usuariosAtivosCreditos: number = 8642;
  transacoesNoMesCreditos: number = 12384;
  avaliacaoMediaCreditos: number = 4.6;

  /** TODO: abrirá o modal de adicionar créditos (próxima etapa da tela). */
  abrirModalAdicionarCreditos(): void {
  }

  creditosTabAtiva: 'valores' = 'valores';

  mudarCreditosTab(tab: 'valores'): void {
    this.creditosTabAtiva = tab;
  }

  // TODO: ainda não existe uma coleção `configuracoesCreditos` no Firestore.
  // Dados de exemplo aqui só pra montar a tela; assim que o backend tiver
  // essa configuração, troca por um onSnapshot/updateDoc de verdade.
  acoesCreditos: AcaoCredito[] = [
    { id: '1', icone: 'fa-book-open', nome: 'Ler artigo', descricao: 'Créditos necessários para realizar a leitura do artigo', valor: 50, valorPadrao: 50, ativo: true },
    { id: '2', icone: 'fa-calendar-check', nome: 'Agendar consulta', descricao: 'Créditos necessários para agendar uma consulta com profissional', valor: 200, valorPadrao: 200, ativo: true },
    { id: '3', icone: 'fa-comments', nome: 'Publicar no fórum', descricao: 'Créditos necessários para criar uma nova publicação no fórum', valor: 30, valorPadrao: 30, ativo: true },
    { id: '4', icone: 'fa-comment-dots', nome: 'Comentar no fórum', descricao: 'Créditos necessários para comentar em uma publicação', valor: 10, valorPadrao: 10, ativo: true },
    { id: '5', icone: 'fa-star', nome: 'Avaliar profissional', descricao: 'Créditos necessários para avaliar um profissional após consulta', valor: 5, valorPadrao: 5, ativo: true },
    { id: '6', icone: 'fa-graduation-cap', nome: 'Concluir curso', descricao: 'Créditos necessários para se inscrever em um curso da plataforma', valor: 150, valorPadrao: 150, ativo: true },
    { id: '7', icone: 'fa-share-nodes', nome: 'Compartilhar artigo', descricao: 'Créditos necessários para compartilhar um artigo com outra mãe', valor: 15, valorPadrao: 15, ativo: false },
    { id: '8', icone: 'fa-message', nome: 'Enviar mensagem no chat', descricao: 'Créditos necessários para iniciar uma conversa no chat', valor: 20, valorPadrao: 20, ativo: true },
    { id: '9', icone: 'fa-id-card', nome: 'Completar perfil', descricao: 'Créditos de bônus liberados ao completar 100% do perfil', valor: 50, valorPadrao: 50, ativo: true },
  ];

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  restaurarPadraoCreditos(): void {
    this.acoesCreditos.forEach(acao => {
      acao.valor = acao.valorPadrao;
    });
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  alternarAtivoCredito(acao: AcaoCredito): void {
    acao.ativo = !acao.ativo;
  }

  // TODO: ainda não existe uma coleção com o histórico real de uso de
  // créditos por categoria no Firestore. Distribuição de exemplo só pra
  // montar o gráfico; assim que o backend expuser essas métricas (ex.: uma
  // agregação por tipo de ação), troca os valores por dados reais.
  distribuicaoCreditos: DistribuicaoCredito[] = [
    { nome: 'Leitura de artigos', percentual: 34, cor: '#5b3f91' },
    { nome: 'Consultas agendadas', percentual: 26, cor: '#8e65bf' },
    { nome: 'Fórum', percentual: 18, cor: '#b79ce0' },
    { nome: 'Cursos', percentual: 14, cor: '#d8c8f0' },
    { nome: 'Outras ações', percentual: 8, cor: '#efe7fa' },
  ];

  private creditosDonutChart: any = null;

  /** Desenha (ou atualiza) o donut de distribuição de uso de créditos. */
  private atualizarGraficoDistribuicaoCreditos(): void {
    const ctx = document.getElementById('creditosDonutChart') as HTMLCanvasElement;

    if (!ctx) {
      return;
    }

    const labels = this.distribuicaoCreditos.map(d => d.nome);
    const valores = this.distribuicaoCreditos.map(d => d.percentual);
    const cores = this.distribuicaoCreditos.map(d => d.cor);

    if (this.creditosDonutChart) {
      this.creditosDonutChart.data.labels = labels;
      this.creditosDonutChart.data.datasets[0].data = valores;
      this.creditosDonutChart.data.datasets[0].backgroundColor = cores;
      this.creditosDonutChart.update();
      return;
    }

    this.creditosDonutChart = new Chart(ctx, {
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

  // TODO: ainda não existe uma coleção `configuracoesCreditos` no Firestore
  // pra essas configurações gerais. Dados de exemplo aqui só pra montar a
  // tela; assim que o backend tiver essa configuração, troca por leitura e
  // updateDoc de verdade.
  configuracoesGeraisCreditos: ConfiguracaoGeralCredito[] = [
    { id: 'moeda', icone: 'fa-sack-dollar', label: 'Créditos da plataforma', tipo: 'valor', valor: 'Real (R$)' },
    { id: 'validade', icone: 'fa-calendar-days', label: 'Validade dos créditos', tipo: 'valor', valor: '15 dias' },
    { id: 'compras', icone: 'fa-cart-shopping', label: 'Permitir compras de créditos', tipo: 'toggle', ativo: true },
    { id: 'transferencia', icone: 'fa-people-arrows', label: 'Permitir transferência entre usuários', tipo: 'toggle', ativo: true },
    { id: 'boasVindas', icone: 'fa-gift', label: 'Créditos de boas-vindas', tipo: 'valor', valor: '50 créditos' },
  ];

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  alternarConfiguracaoGeralCredito(item: ConfiguracaoGeralCredito): void {
    if (item.tipo === 'toggle') {
      item.ativo = !item.ativo;
    }
  }

  /**
   * TODO: abrirá um modal de edição pro item (troca de moeda, validade em
   * dias, valor de boas-vindas). Por enquanto só um placeholder — ainda não
   * existe coleção no Firestore pra persistir essas configurações.
   */
  editarConfiguracaoGeralCredito(item: ConfiguracaoGeralCredito): void {
    if (item.tipo !== 'valor') {
      return;
    }
  }

  // TODO: ainda não existe uma coleção `transacoesCreditos` no Firestore.
  // Dados de exemplo aqui só pra montar a tela; assim que o backend tiver
  // o histórico real de transações, troca por um onSnapshot ordenado por
  // data, igual ao que já existe pra `maes`.
  ultimasTransacoesCreditos: TransacaoCredito[] = [
    { id: 't1', icone: 'fa-book-open', nome: 'Ler artigo', data: '02/09/2026', hora: '14:35', tipo: 'debito' },
    { id: 't2', icone: 'fa-book-open', nome: 'Ler artigo', data: '02/09/2026', hora: '14:35', tipo: 'debito' },
    { id: 't3', icone: 'fa-book-open', nome: 'Ler artigo', data: '02/09/2026', hora: '14:35', tipo: 'debito' },
    { id: 't4', icone: 'fa-book-open', nome: 'Ler artigo', data: '02/09/2026', hora: '14:35', tipo: 'debito' },
    { id: 't5', icone: 'fa-book-open', nome: 'Ler artigo', data: '02/09/2026', hora: '14:35', tipo: 'debito' },
  ];

  // TODO: ainda não existe uma coleção `solicitacoesProfissionais` no Firestore.
  // Dados de exemplo aqui só pra montar a tela; assim que o backend tiver
  // o fluxo de cadastro/aprovação de profissionais, troca isso por um
  // onSnapshot igual ao que já existe pra `maes`.
  solicitacoesProfissionais: SolicitacaoProfissional[] = [
    {
      id: '1',
      nome: 'Dra. Michelly',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      cadastro: '05/09/2026',
      documentacaoCompleta: true,
      status: 'em_analise',
      ultimaAnalise: null,
      observacoes: '',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        especialidade: 'Psicologia perinatal',
        perfilPublico: [
          { label: 'Foto de perfil', ok: true },
          { label: 'Documento de identidade', ok: false },
          { label: 'Registro profissional (CRP)', ok: true },
          { label: 'Comprovante de residência', ok: false },
          { label: 'Certificado de especialização', ok: true },
          { label: 'Currículo', ok: false },
          { label: 'Termo de responsabilidade', ok: true },
        ],
      },
    },
    {
      id: '2',
      nome: 'Dra. Michelly',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      cadastro: '05/09/2026',
      documentacaoCompleta: true,
      status: 'pendencia',
      ultimaAnalise: { data: '05/09/2026', admin: 'Ana Admin' },
      observacoes: '',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        especialidade: 'Psicologia perinatal',
        perfilPublico: [
          { label: 'Foto de perfil', ok: true },
          { label: 'Documento de identidade', ok: false },
          { label: 'Registro profissional (CRP)', ok: true },
          { label: 'Comprovante de residência', ok: false },
          { label: 'Certificado de especialização', ok: true },
          { label: 'Currículo', ok: false },
          { label: 'Termo de responsabilidade', ok: true },
        ],
      },
    },
    {
      id: '3',
      nome: 'Dra. Michelly',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      cadastro: '05/09/2026',
      documentacaoCompleta: true,
      status: 'aprovado',
      ultimaAnalise: { data: '05/09/2026', admin: 'Ana Admin' },
      observacoes: '',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        especialidade: 'Psicologia perinatal',
        perfilPublico: [
          { label: 'Foto de perfil', ok: true },
          { label: 'Documento de identidade', ok: true },
          { label: 'Registro profissional (CRP)', ok: true },
          { label: 'Comprovante de residência', ok: true },
          { label: 'Certificado de especialização', ok: true },
          { label: 'Currículo', ok: true },
          { label: 'Termo de responsabilidade', ok: true },
        ],
      },
    },
  ];

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
      novos: this.solicitacoesProfissionais.filter(s => s.cadastro === '05/09/2026').length,
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
    this.profissionalSelecionado = null;
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

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  aprovarProfissional(sol: SolicitacaoProfissional): void {
    sol.status = 'aprovado';
    sol.ultimaAnalise = { data: this.formatarDataHoje(), admin: this.adminNome };
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  recusarProfissional(sol: SolicitacaoProfissional): void {
    sol.status = 'pendencia';
    sol.ultimaAnalise = { data: this.formatarDataHoje(), admin: this.adminNome };
  }

  /** TODO: só atualiza em memória — plugar no Firestore quando a coleção existir. */
  salvarObservacaoProfissional(sol: SolicitacaoProfissional): void {
    // Observação já está bindada via ngModel; aqui é só onde entraria o updateDoc futuramente.
  }

  private formatarDataHoje(): string {
    const hoje = new Date();
    return hoje.toLocaleDateString('pt-BR');
  }

  // TODO: ainda não existe uma coleção com essas métricas no Firestore.
  // Dados de exemplo aqui só pra montar a tela (sub-aba "Profissionais");
  // assim que o backend tiver esse dado, troca por um onSnapshot de verdade.
  profissionaisLista: ProfissionalLista[] = [
    {
      id: '1',
      nome: 'Dra. Michelly',
      nomeCompleto: 'Michelly Souza Andrade',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      status: 'ativo',
      novo: true,
      consultas: 38,
      conteudos: 38,
      engajamento: 38,
      satisfacao: 4.6,
      ultimoAcesso: 'Hoje',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        profissao: 'Psicóloga',
      },
      totalConsultas: 38,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
        { id: '2', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
      ],
      advertencias: 0,
      ultimaAdvertencia: null,
    },
    {
      id: '2',
      nome: 'Dra. Michelly',
      nomeCompleto: 'Michelly Souza Andrade',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      status: 'ativo',
      novo: true,
      consultas: 38,
      conteudos: 38,
      engajamento: 38,
      satisfacao: 4.6,
      ultimoAcesso: 'Hoje',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        profissao: 'Psicóloga',
      },
      totalConsultas: 38,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
        { id: '2', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
      ],
      advertencias: 1,
      ultimaAdvertencia: { motivo: 'uso_inadequado', dias: 3, observacoes: '', data: '01/09/2026' },
    },
    {
      id: '3',
      nome: 'Emily Rodrigues',
      nomeCompleto: 'Emily Zica Rodrigues',
      categoria: 'Advogada',
      registro: 'OAB/SP 412.908',
      avatar: '',
      status: 'ativo',
      novo: false,
      consultas: 12,
      conteudos: 9,
      engajamento: 41,
      satisfacao: 4.5,
      ultimoAcesso: 'Hoje',
      detalhes: {
        dataNascimento: '16/05/2008',
        idade: 18,
        email: 'rodriguesemily1605@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        profissao: 'Advogada',
      },
      totalConsultas: 12,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
        { id: '2', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
      ],
      advertencias: 0,
      ultimaAdvertencia: null,
    },
    {
      id: '4',
      nome: 'Dra. Michelly',
      nomeCompleto: 'Michelly Souza Andrade',
      categoria: 'Psicóloga',
      registro: 'CRP 0614523',
      avatar: '',
      status: 'inativo',
      novo: false,
      consultas: 38,
      conteudos: 38,
      engajamento: 38,
      satisfacao: 4.6,
      ultimoAcesso: '2 dias atrás',
      detalhes: {
        dataNascimento: '16/05/1990',
        idade: 36,
        email: 'michelly.psi@gmail.com',
        telefone: '(11) 98159-0183',
        endereco: 'São Paulo - SP',
        profissao: 'Psicóloga',
      },
      totalConsultas: 38,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Meio biruta mas deu para aguentar' },
      ],
      advertencias: 3,
      ultimaAdvertencia: { motivo: 'inatividade', dias: 7, observacoes: '', data: '03/09/2026' },
      motivoSuspensao: 'inatividade',
      observacoesSuspensao: '',
      suspensoEm: '03/09/2026',
    },
  ];

  termoBuscaProfissionaisLista: string = '';
  filtroStatusProfissionaisLista: 'todos' | 'ativos' | 'inativos' | 'novos' = 'todos';
  profissionalListaSelecionado: ProfissionalLista | null = null;

  /** Lista de profissionais (sub-aba "Profissionais") já filtrada pela busca e pelo status/segmento selecionado. */
  get profissionaisListaFiltrados(): ProfissionalLista[] {
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
  parceirosLista: ParceiroEmpresaLista[] = [
    {
      id: '1',
      nome: 'Enxoval da Nina',
      nomeCompleto: 'Enxoval da Nina Comércio de Bebês Ltda',
      categoria: 'Loja de enxoval',
      cnpj: '12.345.678/0001-90',
      avatar: '',
      status: 'ativo',
      novo: true,
      eventos: 6,
      artigos: 14,
      engajamento: 52,
      satisfacao: 4.7,
      ultimoAcesso: 'Hoje',
      detalhes: {
        email: 'contato@enxovaldanina.com.br',
        telefone: '(11) 97654-3210',
        endereco: 'São Paulo - SP',
        cnpj: '12.345.678/0001-90',
        segmento: 'Loja de enxoval',
      },
      totalInteracoes: 14,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Ótimo atendimento e preços justos' },
        { id: '2', autorNome: 'Carla Menezes - Mãe solo', autorTipo: 'Mãe solo', nota: 4, comentario: 'Entrega demorou um pouco' },
      ],
      advertencias: 0,
      ultimaAdvertencia: null,
    },
    {
      id: '2',
      nome: 'Clínica Pequeno Passo',
      nomeCompleto: 'Clínica Pediátrica Pequeno Passo Ltda',
      categoria: 'Clínica pediátrica',
      cnpj: '23.456.789/0001-01',
      avatar: '',
      status: 'ativo',
      novo: true,
      eventos: 3,
      artigos: 9,
      engajamento: 38,
      satisfacao: 4.6,
      ultimoAcesso: 'Hoje',
      detalhes: {
        email: 'contato@pequenopasso.com.br',
        telefone: '(11) 98765-4321',
        endereco: 'São Paulo - SP',
        cnpj: '23.456.789/0001-01',
        segmento: 'Clínica pediátrica',
      },
      totalInteracoes: 9,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Equipe muito atenciosa com as crianças' },
      ],
      advertencias: 1,
      ultimaAdvertencia: { motivo: 'conteudo_improprio', dias: 3, observacoes: '', data: '01/09/2026' },
    },
    {
      id: '3',
      nome: 'Cursos Mamãe Ativa',
      nomeCompleto: 'Mamãe Ativa Cursos e Treinamentos EIRELI',
      categoria: 'Curso online',
      cnpj: '34.567.890/0001-12',
      avatar: '',
      status: 'ativo',
      novo: false,
      eventos: 10,
      artigos: 22,
      engajamento: 61,
      satisfacao: 4.8,
      ultimoAcesso: 'Ontem',
      detalhes: {
        email: 'contato@mamaeativa.com.br',
        telefone: '(11) 91234-5678',
        endereco: 'São Paulo - SP',
        cnpj: '34.567.890/0001-12',
        segmento: 'Curso online',
      },
      totalInteracoes: 22,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Cursos excelentes e bem didáticos' },
        { id: '2', autorNome: 'Carla Menezes - Mãe solo', autorTipo: 'Mãe solo', nota: 5, comentario: 'Recomendo demais' },
      ],
      advertencias: 0,
      ultimaAdvertencia: null,
    },
    {
      id: '4',
      nome: 'Enxoval da Nina',
      nomeCompleto: 'Enxoval da Nina Comércio de Bebês Ltda',
      categoria: 'Loja de enxoval',
      cnpj: '12.345.678/0001-90',
      avatar: '',
      status: 'inativo',
      novo: false,
      eventos: 6,
      artigos: 14,
      engajamento: 52,
      satisfacao: 4.7,
      ultimoAcesso: '5 dias atrás',
      detalhes: {
        email: 'contato@enxovaldanina.com.br',
        telefone: '(11) 97654-3210',
        endereco: 'São Paulo - SP',
        cnpj: '12.345.678/0001-90',
        segmento: 'Loja de enxoval',
      },
      totalInteracoes: 14,
      avaliacoes: [
        { id: '1', autorNome: 'Ana Luiza - Mãe solo', autorTipo: 'Mãe solo', nota: 3, comentario: 'Demorou pra responder no fórum' },
      ],
      advertencias: 3,
      ultimaAdvertencia: { motivo: 'inatividade', dias: 7, observacoes: '', data: '03/09/2026' },
      motivoSuspensao: 'inatividade',
      observacoesSuspensao: '',
      suspensoEm: '03/09/2026',
    },
  ];

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

      return bateTermo && bateStatus;
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
  // RELATÓRIOS
  // TODO: ainda não existe nenhuma coleção/agregação financeira real no
  // Firestore deste projeto (receita, custos, lucro por período). Os dados
  // abaixo são de exemplo só para a tela não ficar vazia; assim que o
  // backend expuser esses números, é só trocar os valores fixos por uma
  // leitura real dentro de atualizarGraficosRelatorios().
  // =========================================================

  relatoriosMesSelecionado: string = 'Setembro 2026';
  relatoriosMesesDisponiveis: string[] = [
    'Setembro 2026', 'Agosto 2026', 'Julho 2026', 'Junho 2026', 'Maio 2026', 'Abril 2026',
  ];

  relatoriosStats: RelatorioStatCard[] = [
    { label: 'Receita', valor: 'R$ 84.520', variacao: 18.4, icone: 'fa-database', cor: 'purple' },
    { label: 'Custos', valor: 'R$ 84.520', variacao: 18.4, icone: 'fa-sack-dollar', cor: 'pink' },
    { label: 'Receita', valor: 'R$ 84.520', variacao: 18.4, icone: 'fa-arrow-trend-up', cor: 'green' },
    { label: 'Receita', valor: 'R$ 84.520', variacao: 18.4, icone: 'fa-arrows-rotate', cor: 'blue' },
  ];

  relatoriosLabelsMeses: string[] = ['0', '1', '2', '3', '4', '5', '6'];
  relatoriosReceitaSerie: number[] = [20, 62, 45, 30, 58, 40, 12];
  relatoriosCustosSerie: number[] = [18, 22, 34, 40, 46, 38, 44];
  relatoriosLucroSerie: number[] = [10, 16, 24, 20, 30, 34, 38];

  relatoriosReceitaOrigem: RelatorioDistribuicao[] = [
    { nome: 'Receita', percentual: 50, valor: 'R$ 42.300', cor: '#6C4BBF' },
    { nome: 'Custos', percentual: 50, valor: 'R$ 42.300', cor: '#8ee0c4' },
    { nome: 'Lucro', percentual: 50, valor: 'R$ 42.300', cor: '#e685a6' },
  ];

  relatoriosCustosPlataforma: RelatorioDistribuicao[] = [
    { nome: 'Receita', percentual: 50, valor: 'R$ 42.300', cor: '#6C4BBF' },
    { nome: 'Custos', percentual: 50, valor: 'R$ 42.300', cor: '#8ee0c4' },
    { nome: 'Lucro', percentual: 50, valor: 'R$ 42.300', cor: '#e685a6' },
  ];

  relatoriosInsights: RelatorioInsight[] = [
    { tipo: 'alerta', icone: 'fa-triangle-exclamation', titulo: 'Atenção', texto: 'Alguns pontos de atenção no período' },
    { tipo: 'perigo', icone: 'fa-arrow-up', titulo: 'Custo operacional aumentou 23%', texto: 'Alguns pontos de atenção no período' },
    { tipo: 'sucesso', icone: 'fa-arrow-up', titulo: 'Receita de consultorias aumentou 18%', texto: '284 consultas a mais que o mês anterior' },
  ];

  private relatoriosFinanceiroChart: any = null;
  private relatoriosOrigemChart: any = null;
  private relatoriosCustosChart: any = null;

  /** TODO: gera um PDF/CSV real do período selecionado assim que o backend expuser os dados. */
  exportarRelatorio(): void {
  }

  /** Desenha (ou atualiza) o gráfico de linha "Resultado financeiro". */
  private atualizarGraficoFinanceiroRelatorios(): void {
    const ctx = document.getElementById('relatoriosFinanceiroChart') as HTMLCanvasElement;
    if (!ctx) {
      return;
    }

    if (this.relatoriosFinanceiroChart) {
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
          {
            label: 'Receita',
            data: this.relatoriosReceitaSerie,
            borderColor: '#6C4BBF',
            backgroundColor: 'rgba(108,75,191,0.12)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
          },
          {
            label: 'Custos',
            data: this.relatoriosCustosSerie,
            borderColor: '#3fb28f',
            backgroundColor: 'rgba(63,178,143,0.12)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
          },
          {
            label: 'Lucro',
            data: this.relatoriosLucroSerie,
            borderColor: '#e685a6',
            backgroundColor: 'rgba(230,133,166,0.12)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  /** Desenha (ou atualiza) um dos donuts "Receita por origem" / "Custos da plataforma". */
  private atualizarDonutRelatorios(
    canvasId: string,
    dados: RelatorioDistribuicao[],
    instancia: 'origem' | 'custos'
  ): void {
    const ctx = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!ctx) {
      return;
    }

    const labels = dados.map(d => d.nome);
    const valores = dados.map(d => d.percentual);
    const cores = dados.map(d => d.cor);

    const chartAtual = instancia === 'origem' ? this.relatoriosOrigemChart : this.relatoriosCustosChart;

    if (chartAtual) {
      chartAtual.data.labels = labels;
      chartAtual.data.datasets[0].data = valores;
      chartAtual.data.datasets[0].backgroundColor = cores;
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
      this.relatoriosCustosChart = novoChart;
    }
  }

  /** Desenha/atualiza todos os gráficos da aba "Relatórios". */
  atualizarGraficosRelatorios(): void {
    this.atualizarGraficoFinanceiroRelatorios();
    this.atualizarDonutRelatorios('relatoriosOrigemChart', this.relatoriosReceitaOrigem, 'origem');
    this.atualizarDonutRelatorios('relatoriosCustosChart', this.relatoriosCustosPlataforma, 'custos');
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

  /** TODO: plugar no fluxo real de troca de senha do Firebase Auth. */
  alterarSenha(): void {
  }

  /** TODO: só atualiza em memória — plugar na revogação real da sessão do dispositivo. */
  desconectarDispositivo(dispositivo: DispositivoConectado): void {
    dispositivo.status = 'desconectado';
  }

  /** TODO: plugar no signOut real do Firebase Auth (já importado neste arquivo). */
  sairDaConta(): void {
  }

  /** TODO: plugar no fluxo real de exclusão de conta (com confirmação extra). */
  deletarConta(): void {
  }

  private atividadeChart: any = null;
  private unsubscribes: Unsubscribe[] = [];

  ngOnInit(): void {
    this.escutarMudancas();
    this.escutarAdminLogado();
    this.carregarPostsForum();
    this.carregarConteudoModeracao();
  }

  ngAfterViewInit(): void {
    this.atualizarDashboard();
    this.atualizarGraficoDistribuicaoCreditos();
    this.atualizarGraficosRelatorios();
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(unsub => unsub());

    if (this.atividadeChart) {
      this.atividadeChart.destroy();
    }

    if (this.creditosDonutChart) {
      this.creditosDonutChart.destroy();
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

    if (this.relatoriosCustosChart) {
      this.relatoriosCustosChart.destroy();
    }
  }

  /** Preenche o cartão de perfil da sidebar com os dados de quem está logado. */
  escutarAdminLogado(): void {
    const unsub = onAuthStateChanged(auth, (firebaseUser: any) => {
      if (firebaseUser?.displayName) {
        this.adminNome = firebaseUser.displayName;
      }
      if (firebaseUser?.photoURL) {
        this.adminAvatar = firebaseUser.photoURL;
      }
    });
    this.unsubscribes.push(unsub);
  }

  mudarAba(aba: string): void {
    this.abaAtiva = aba;

    // Os canvases dos gráficos de Relatórios ficam ocultos via CSS ([class.hidden])
    // em vez de destruídos (*ngIf), então ao reabrir a aba só precisamos garantir
    // que o Chart.js recalcule o tamanho depois que a seção volta a ficar visível.
    if (aba === 'relatorios') {
      setTimeout(() => this.atualizarGraficosRelatorios(), 0);
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

  async atualizarDashboard(): Promise<void> {
    try {
      const psicologosSnap = await getDocs(
        collection(db, 'psicologos')
      );

      const advogadosSnap = await getDocs(
        collection(db, 'advogados')
      );

      this.psicologosAtivos =
        psicologosSnap.docs.filter(
          d => d.data()['status'] === 'aprovado'
        ).length;

      this.advogadosAtivos =
        advogadosSnap.docs.filter(
          d => d.data()['status'] === 'aprovado'
        ).length;

      this.atualizarGraficoAtividade();

    } catch (e) {
      console.error('Erro dashboard:', e);
    }
  }

  /**
   * Gráfico "Atividade da rede" (linha, 2 séries: Profissionais e Atendimentos).
   * TODO: hoje não existe uma coleção com histórico diário de atendimentos,
   * então geramos uma série de exemplo que termina no total real atual de
   * profissionais/atendimentos. Trocar por dados reais assim que o backend
   * expuser um endpoint de série histórica.
   */
  atualizarGraficoAtividade(): void {

    const labels = Array.from({ length: 10 }, (_, i) => `${i}`);

    const profissionaisSerie = this.gerarSerieDeExemplo(this.profissionaisAtivos, 10);
    const atendimentosSerie = this.gerarSerieDeExemplo(this.atendimentosRealizados, 10, true);

    const ctx = document.getElementById(
      'atividadeChart'
    ) as HTMLCanvasElement;

    if (!ctx) {
      return;
    }

    if (this.atividadeChart) {
      this.atividadeChart.data.datasets[0].data = profissionaisSerie;
      this.atividadeChart.data.datasets[1].data = atendimentosSerie;
      this.atividadeChart.update();
      return;
    }

    this.atividadeChart = new Chart(ctx, {
      type: 'line',

      data: {
        labels,
        datasets: [
          {
            label: 'Profissionais',
            data: profissionaisSerie,
            borderColor: 'rgba(88,62,142,0.9)',
            backgroundColor: 'rgba(88,62,142,0.15)',
            tension: 0.35,
            fill: false,
            pointRadius: 3
          },
          {
            label: 'Atendimentos',
            data: atendimentosSerie,
            borderColor: '#e685a6',
            backgroundColor: 'rgba(230,133,166,0.15)',
            tension: 0.35,
            fill: false,
            pointRadius: 3
          }
        ]
      },

      options: {
        responsive: true,

        plugins: {
          legend: {
            position: 'top',
            align: 'start'
          },

          tooltip: {
            mode: 'index',
            intersect: false
          }
        },

        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        }
      }
    });
  }

  /** Gera uma série de exemplo (para o gráfico) que termina no valor real atual. */
  private gerarSerieDeExemplo(valorFinal: number, pontos: number, ondulado: boolean = false): number[] {
    const base = Math.max(valorFinal * 0.6, 1);
    const serie: number[] = [];

    for (let i = 0; i < pontos; i++) {
      const progresso = i / (pontos - 1);
      const ruido = ondulado ? Math.sin(i * 1.3) * (valorFinal * 0.15) : Math.sin(i) * (valorFinal * 0.08);
      serie.push(Math.max(0, Math.round(base + (valorFinal - base) * progresso + ruido)));
    }

    serie[serie.length - 1] = valorFinal;
    return serie;
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
   * Monta o feed "Atividade recente" da Home a partir dos dados já carregados.
   * TODO: o Firestore deste projeto ainda não guarda um carimbo de data/hora
   * nem um log de auditoria por evento — por isso o feed é montado com base
   * nos últimos registros conhecidos (usuários e solicitações), em vez de uma
   * ordem cronológica real. Assim que existir um campo tipo "criadoEm" ou uma
   * coleção de eventos, dá pra trocar por uma consulta ordenada por data.
   */
  private atualizarAtividadesRecentes(): void {
    const itens: AtividadeItem[] = [];

    this.solicitacoes.slice(-2).forEach(req => {
      itens.push({
        icone: 'fa-solid fa-user-doctor',
        corIcone: 'icone-azul',
        titulo: 'Nova solicitação de profissional',
        descricao: `${req.nome} enviou um cadastro de ${req.colTipo === 'psicologo' ? 'psicólogo(a)' : 'advogado(a)'} para análise.`
      });
    });

    this.usuarios.slice(-3).forEach(user => {
      if (user.colName === 'usuarios') {
        itens.push({
          icone: 'fa-solid fa-user-plus',
          corIcone: 'icone-roxo',
          titulo: 'Nova mãe cadastrada',
          descricao: `${user.nome} entrou para a rede EloMaterno.`
        });
      } else {
        itens.push({
          icone: 'fa-solid fa-circle-check',
          corIcone: 'icone-verde',
          titulo: 'Profissional aprovado',
          descricao: `${user.nome} (${user.colLabel}) está ativo na plataforma.`
        });
      }
    });

    this.atividadesRecentes = itens.slice(-5).reverse();
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

    alert('Profissional aprovado!');

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

    alert('Profissional recusado.');

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
      window.confirm(
        'Tem certeza que deseja remover este usuário?'
      );

    if (!confirmar) {
      return;
    }

    const docRef =
      doc(db, colName, id);

    await deleteDoc(docRef);

    alert('Usuário removido!');

    await this.carregarUsuarios();
    await this.atualizarDashboard();
  }

  escutarMudancas(): void {

    const colNames = [
      'psicologos',
      'advogados',
      'usuarios' // OBS: corrigido de 'maes' — a coleção real de mães/usuários no Firestore é 'usuarios'
    ];

    colNames.forEach(
      colName => {

        const unsub =
          onSnapshot(
            collection(db, colName),
            () => {

              this.atualizarDashboard();

              this.carregarUsuarios();

              if (colName === 'usuarios') {
                this.carregarMaes();
              }

              if (colName !== 'usuarios') {
                this.carregarSolicitacoes();
              }
            }
          );

        this.unsubscribes.push(unsub);
      }
    );
  }

  // =========================================================
  // ABA "MÃES" — antiga aba "Usuários", agora exclusiva para mães
  // =========================================================

  /** Carrega apenas os usuários com tipo === 'mae' da coleção 'usuarios'. */
  async carregarMaes(): Promise<void> {
    try {
      const q = query(collection(db, 'usuarios'), where('tipo', '==', 'mae'));
      const snap = await getDocs(q);

      this.maes = snap.docs.map((docSnap) => {
        const data = docSnap.data();

        return {
          id: docSnap.id,
          nome: data['nome'] || 'Sem nome',
          email: data['email'] || '-',
          avatar: data['avatar'] || data['fotoURL'] || '',
          status: data['status'] || 'ativo',
          criadoEm: data['criadoEm'] || null,
          creditos: data['creditos'] ?? 0,
          cidade: data['cidade'] || '',
          uf: data['uf'] || data['estado'] || '',
          dataNascimento: data['dataNascimento'] || '',
          endereco: data['endereco'] || '',
          telefone: data['telefone'] || '',
          filhos: data['filhos'] || ''
        } as MaeData;
      });
    } catch (error) {
      console.error('Erro ao carregar mães:', error);
    }
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

    try {
      const postsQuery = query(collection(db, 'posts'), where('autorId', '==', mae.id));
      const contagem = await getCountFromServer(postsQuery);
      this.maeTotalInteracoes = contagem.data().count;
    } catch (error) {
      console.error('Erro ao contar interações da mãe:', error);
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
            titulo: p['titulo'] || '',
            conteudo: p['conteudo'] || '',
            autorNome: p['autorNome'] || 'Usuária',
            autorFoto: p['autorFoto'] || './img/account_icon.png',
            categoria: p['categoria'] || '',
            dataFormatada: p['data']?.toDate
              ? p['data'].toDate().toLocaleString('pt-BR')
              : 'Agora',
            moderacao: p['moderacao'] || {}
          } as PostForum;
        });

        this.carregandoPostsForum = false;
      },
      (erro) => {
        console.error('Erro ao carregar posts do fórum:', erro);
        this.carregandoPostsForum = false;
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
  }

  fecharModalAdvertirPost(): void {
    if (this.advertindoPost) {
      return;
    }
    this.postParaAdvertir = null;
    this.motivoAdvertenciaPost = '';
    this.observacoesAdvertenciaPost = '';
    this.erroAdvertenciaPost = '';
  }

  async confirmarAdvertenciaPost(): Promise<void> {
    const post = this.postParaAdvertir;
    if (!post) {
      return;
    }

    if (!this.motivoAdvertenciaPost) {
      this.erroAdvertenciaPost = 'Selecione um motivo para a advertência.';
      return;
    }

    this.advertindoPost = true;
    this.erroAdvertenciaPost = '';

    try {
      await updateDoc(doc(db, 'posts', post.id), {
        'moderacao.advertido': true,
        'moderacao.motivoAdvertencia': this.motivoAdvertenciaPost,
        'moderacao.observacoesAdvertencia': this.observacoesAdvertenciaPost.trim(),
        'moderacao.dataAdvertencia': serverTimestamp()
      });

      this.postParaAdvertir = null;
      this.motivoAdvertenciaPost = '';
      this.observacoesAdvertenciaPost = '';
    } catch (error) {
      console.error('Erro ao aplicar advertência no post:', error);
      this.erroAdvertenciaPost = 'Não foi possível aplicar a advertência agora. Tente novamente.';
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
  }

  fecharModalRemoverPost(): void {
    if (this.removendoPost) {
      return;
    }
    this.postParaRemover = null;
    this.motivoRemocaoPost = '';
    this.erroRemocaoPost = '';
  }

  /**
   * Remoção lógica (soft delete): o post some do fórum público — ver o
   * filtro em forum.ts — mas continua salvo com o motivo, pra ficar no
   * histórico de moderação (igual ao protótipo do Figma).
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

    this.removendoPost = true;
    this.erroRemocaoPost = '';

    try {
      await updateDoc(doc(db, 'posts', post.id), {
        'moderacao.removido': true,
        'moderacao.motivoRemocao': this.motivoRemocaoPost.trim(),
        'moderacao.dataRemocao': serverTimestamp()
      });

      this.postParaRemover = null;
      this.motivoRemocaoPost = '';
    } catch (error) {
      console.error('Erro ao remover post:', error);
      this.erroRemocaoPost = 'Não foi possível remover o post agora. Tente novamente.';
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
      }
    );

    this.unsubscribes.push(unsubArtigos, unsubEventos);
  }

  private mesclarConteudoModeracao(): void {
    this.conteudoModeracao = [...this.artigosModeracao, ...this.eventosModeracao]
      .sort((a, b) => b.dataOrdenacao - a.dataOrdenacao);

    this.carregandoConteudoModeracao = false;
    this.atualizarGraficoConteudoModeracao();
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
      } else {
        await updateDoc(doc(db, item.origem, item.id), {
          'moderacao.removido': true,
          'moderacao.motivoRemocao': this.observacoesAcaoDenuncia.trim() || 'Denúncia procedente',
          'moderacao.dataRemocao': serverTimestamp()
        });
        this.registrarUltimoConteudoModerado(item, 'Post Deletado');
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
