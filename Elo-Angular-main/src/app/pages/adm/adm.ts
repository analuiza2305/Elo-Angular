import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
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
  abasEmConstrucao: AbaEmConstrucao[] = [
    { chave: 'forum', titulo: 'Fórum', subtitulo: 'Modere as discussões e publicações da comunidade.' },
    { chave: 'profissionais', titulo: 'Profissionais', subtitulo: 'Gerencie o cadastro completo de psicólogos e advogados.' },
    { chave: 'parceiros', titulo: 'Parceiros', subtitulo: 'Acompanhe as empresas e instituições parceiras da rede.' },
    { chave: 'creditos', titulo: 'Créditos', subtitulo: 'Controle a movimentação de créditos Elo na plataforma.' },
    { chave: 'relatorios', titulo: 'Relatórios', subtitulo: 'Extraia relatórios detalhados sobre o uso da plataforma.' },
    { chave: 'eventos', titulo: 'Eventos', subtitulo: 'Organize e divulgue eventos para a rede EloMaterno.' },
    { chave: 'configuracoes', titulo: 'Configurações', subtitulo: 'Ajuste as preferências gerais do painel administrativo.' },
  ];

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

  /** Média (0 a 5) das avaliações carregadas para a mãe selecionada. */
  get maeAvaliacaoMedia(): number {
    if (!this.maeAvaliacoes.length) {
      return 0;
    }
    const soma = this.maeAvaliacoes.reduce((acc, a) => acc + (Number(a.nota) || 0), 0);
    return Math.round((soma / this.maeAvaliacoes.length) * 10) / 10;
  }

  private atividadeChart: any = null;
  private unsubscribes: Unsubscribe[] = [];

  ngOnInit(): void {
    this.escutarMudancas();
    this.escutarAdminLogado();
  }

  ngAfterViewInit(): void {
    this.atualizarDashboard();
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(unsub => unsub());

    if (this.atividadeChart) {
      this.atividadeChart.destroy();
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
          avatar: data['avatar'] || data['fotoURL'] || './img/account_icon.png',
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

  /** Suspende ou reativa a mãe (persistido em usuarios/{id}.status). */
  async alternarStatusMae(mae: MaeData): Promise<void> {
    const novoStatus = mae.status === 'ativo' ? 'inativo' : 'ativo';
    const acao = novoStatus === 'inativo' ? 'suspender' : 'reativar';

    const confirmar = window.confirm(`Tem certeza que deseja ${acao} ${mae.nome}?`);
    if (!confirmar) {
      return;
    }

    try {
      await updateDoc(doc(db, 'usuarios', mae.id), { status: novoStatus });

      mae.status = novoStatus;

      if (this.maeSelecionada?.id === mae.id) {
        this.maeSelecionada = { ...this.maeSelecionada, status: novoStatus };
      }
    } catch (error) {
      console.error('Erro ao atualizar status da mãe:', error);
      alert('Não foi possível atualizar o status agora. Tente novamente.');
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
}