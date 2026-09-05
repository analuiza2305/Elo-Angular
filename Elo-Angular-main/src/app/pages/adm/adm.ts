import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';

import { CommonModule } from '@angular/common';
import {
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';

import { Chart, registerables } from 'chart.js';


import { HeaderComponent } from '../../components/header/header';

// COLOQUE AQUI O CAMINHO REAL DO FIREBASE DO SEU PROJETO
import { db } from '../../core/firebase';

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

@Component({
  selector: 'app-adm',
  standalone: true,
  imports: [CommonModule, HeaderComponent],
  templateUrl: './adm.html',
  styleUrl: './adm.css',
})
export class Adm implements OnInit, OnDestroy, AfterViewInit {

  abaAtiva: string = 'dashboard';

  

  sidebarAberta: boolean = false;

  psicologosAtivos: number = 0;
  advogadosAtivos: number = 0;

  solicitacoes: ProfissionalData[] = [];
  usuarios: UsuarioData[] = [];

  private usageChart: any = null;
  private pieChartObj: any = null;
  private unsubscribes: Unsubscribe[] = [];

  ngOnInit(): void {
    this.escutarMudancas();
  }

  ngAfterViewInit(): void {
    this.atualizarDashboard();
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(unsub => unsub());

    if (this.usageChart) {
      this.usageChart.destroy();
    }

    if (this.pieChartObj) {
      this.pieChartObj.destroy();
    }
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

      this.criarOuAtualizarGrafico(
        this.psicologosAtivos,
        this.advogadosAtivos
      );

    } catch (e) {
      console.error('Erro dashboard:', e);
    }
  }

  criarOuAtualizarGrafico(
    psicologosAtivos: number,
    advogadosAtivos: number
  ): void {

    const labels = ['Psicólogos', 'Advogados'];

    const values = [
      psicologosAtivos,
      advogadosAtivos
    ];

    const purpleColors = [
      'rgba(124,105,169,0.9)',
      'rgba(108,75,191,0.85)',
      'rgba(88,62,142,0.9)',
      'rgba(99,80,165,0.9)'
    ];

    const ctx = document.getElementById(
      'usageChart'
    ) as HTMLCanvasElement;

    if (ctx) {

      if (this.usageChart) {

        this.usageChart.data.datasets[0].data = values;
        this.usageChart.update();

      } else {

        this.usageChart = new Chart(ctx, {
          type: 'bar',

          data: {
            labels,

            datasets: [{
              label: 'Quantidade',
              data: values,
              backgroundColor: purpleColors,
              borderColor: purpleColors.map(
                c => c.replace('0.9', '1')
              ),
              borderWidth: 1
            }]
          },

          options: {
            responsive: true,

            plugins: {
              legend: {
                display: false
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
    }

    const pie = document.getElementById(
      'pieChart'
    ) as HTMLCanvasElement;

    if (pie) {

      if (this.pieChartObj) {

        this.pieChartObj.data.datasets[0].data = values;
        this.pieChartObj.update();

      } else {

        this.pieChartObj = new Chart(pie, {
          type: 'doughnut',

          data: {
            labels: [
              'Psicólogos',
              'Advogados'
            ],

            datasets: [{
              data: values,

              backgroundColor: [
                'rgba(124,105,169,0.9)',
                'rgba(108,75,191,0.85)'
              ]
            }]
          },

          options: {
            cutout: '55%',

            plugins: {
              legend: {
                position: 'bottom'
              }
            }
          }
        });
      }
    }
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
      'maes'
    ];

    colNames.forEach(
      colName => {

        const unsub =
          onSnapshot(
            collection(db, colName),
            () => {

              this.atualizarDashboard();

              this.carregarUsuarios();

              if (colName !== 'maes') {
                this.carregarSolicitacoes();
              }
            }
          );

        this.unsubscribes.push(unsub);
      }
    );
  }
}