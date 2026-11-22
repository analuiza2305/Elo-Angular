import { Component, OnInit, signal, inject, ViewChild } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { GuiaPassosComponent, PassoGuia } from '../../components/guia-passos/guia-passos';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, query, where, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { AlertaService } from '../../core/services/alerta.service';
import { avisarProfissional } from '../../services/avisos-profissional';
import {
  encerrarAutomaticamente, limiteParaEntrar, motivoEncerramentoAutomatico, prazoConfirmacao, textoEncerramento,
  MINUTOS_DE_TOLERANCIA,
} from '../../services/prazos-consulta';

@Component({
  selector: 'app-consultas',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, GuiaPassosComponent],
  templateUrl: './consultas.html',
  styleUrls: ['./consultas.css']
})
export class ConsultasComponent implements OnInit {
  private router = inject(Router);
  private location = inject(Location);
  private readonly alerta = inject(AlertaService);
  readonly minutosTolerancia = MINUTOS_DE_TOLERANCIA;

  /** Tutorial do chat: abre sozinho quando a mãe tem uma consulta confirmada. */
  @ViewChild('guiaChat') guiaChat?: GuiaPassosComponent;
  private guiaChatVerificado = false;
  readonly passosGuiaChat: PassoGuia[] = [
    { icone: 'ph-light ph-chat-circle-text', titulo: 'Sua consulta foi confirmada!', texto: 'Agora você pode conversar com a profissional pelo chat, antes e depois da consulta. Toque em "Mandar mensagem" no cartão da consulta.' },
    { icone: 'ph-light ph-user-list', titulo: 'Escolha com quem falar', texto: 'Na tela do chat, a lista da esquerda mostra as profissionais das suas consultas. Toque no nome para abrir a conversa.' },
    { icone: 'ph-light ph-paper-plane-tilt', titulo: 'Escreva ou mande áudio', texto: 'Digite embaixo e toque em enviar. Se preferir, toque no microfone para gravar um áudio (até 1 minuto) e toque de novo para enviar.' },
    { icone: 'ph-light ph-bell', titulo: 'Aviso de resposta', texto: 'Quando ela responder, aparece um número na conversa e um aviso no sino lá em cima. O chat não substitui a consulta por vídeo.' },
  ];

  currentUser = signal<any>(null);

  // Controle de Abas
  abaAtiva = signal<string>('agendadas');

  // Listas de consultas
  consultasAgendadas = signal<any[]>([]);
  consultasRealizadas = signal<any[]>([]);
  consultasCanceladas = signal<any[]>([]);
  isLoading = signal<boolean>(true);

  // Modal do Profissional
  showModalProf = signal<boolean>(false);
  profissionalSelecionado = signal<any>(null);

  // Modal de Cancelamento
  showModalCancelar = signal<boolean>(false);
  consultaParaCancelar = signal<any>(null);
  motivoCancelamento = signal<string>('');
  isCancelando = signal<boolean>(false);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        this.ouvirConsultasDaMae(user.uid);
      } else {
        this.router.navigate(['/login']);
      }
    });
  }

  mudarAba(aba: string) {
    this.abaAtiva.set(aba);
  }

  /** Volta para a tela anterior (ou para o início, se ela abriu o link direto). */
  voltar() {
    if (window.history.length > 1) this.location.back();
    else this.router.navigate(['/home-mae']);
  }

  /** Consulta que não aconteceu: leva para marcar de novo, já filtrando pelo mesmo profissional. */
  reagendar(c: any) {
    const queryParams: any = { tipo: c.tipoProf || 'psicologo' };
    if (c.profissionalNome) queryParams.busca = c.profissionalNome;
    this.router.navigate(['/consultas-lista-psi'], { queryParams });
  }

  ouvirConsultasDaMae(uidMae: string) {
    const q = query(collection(db, "Consultas"), where("maeId", "==", uidMae));

    onSnapshot(q, async (snapshot) => {
      this.isLoading.set(false);
      const agendadas: any[] = [];
      const realizadas: any[] = [];
      const canceladas: any[] = [];

      for (const snapDoc of snapshot.docs) {
        const raw = { id: snapDoc.id, ...snapDoc.data() } as any;

        // Passou do prazo? Fecha sozinha (2 dias sem confirmação ou 15 min depois do horário sem ninguém entrar).
        const motivoAuto = motivoEncerramentoAutomatico(raw);
        if (motivoAuto) {
          encerrarAutomaticamente(raw.id, motivoAuto);
          raw.status = 'negado';
          raw.canceladoPor = 'sistema';
          raw.encerradaAutomaticamente = true;
          raw.motivoCancelamento = textoEncerramento(motivoAuto);
        }

        // NOVO CONTRATO DE DADOS DA SPRINT 2
        let profissionalId = raw.profissionalId || raw.Psicologo || raw.Advogado;
        let tipoProf = raw.tipoProfissional;

        // Fallback caso a consulta seja antiga
        if (!tipoProf) {
            if (raw.Psicologo) tipoProf = 'psicologo';
            else if (raw.Advogado) tipoProf = 'advogado';
        }

        let collectionName = tipoProf === 'psicologo' ? 'psicologos' : 'advogados';

        // Busca dados do profissional
        let profissionalNome = '';
        let profissionalFoto = './img/account_icon.png';

        if (profissionalId && collectionName) {
          const pData = await this.buscarProfissional(profissionalId, collectionName);
          if (pData) {
            profissionalNome = pData['nome'] || '';
            profissionalFoto = pData['avatar'] || './img/account_icon.png';
          }
        }

        const dataFormatada = this.formatDataHora(raw.Datahora);

        const prazo = raw.status === 'pendente' ? prazoConfirmacao(raw) : null;
        const limite = limiteParaEntrar(raw);
        const consultaObj = {
          ...raw,
          profissionalId,
          tipoProf,
          profissionalNome,
          profissionalFoto,
          dataFormatada,
          prazoConfirmacaoTexto: prazo ? this.formatDataHora(prazo) : '',
          limiteEntradaTexto: limite ? limite.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
          profissionalNaSala: !!raw.profissionalNaSala,
        };

        if (["pendente", "aceito"].includes(raw.status)) {
          agendadas.push(consultaObj);
        } else if (raw.status === "realizado") {
          realizadas.push(consultaObj);
        } else if (raw.status === "negado") {
          canceladas.push(consultaObj);
        }
      }

      this.consultasAgendadas.set(agendadas);
      if (!this.guiaChatVerificado && agendadas.some((c) => c.status === 'aceito')) {
        this.guiaChatVerificado = true;
        setTimeout(() => this.guiaChat?.abrirSeDeve(), 700);
      }
      this.consultasRealizadas.set(realizadas);
      this.consultasCanceladas.set(canceladas);
    });
  }

  private cacheProfissionais = new Map<string, any>();

  /** Procura o profissional pelo id do documento e, se não achar, pelo campo uid (cadastros antigos). */
  private async buscarProfissional(id: string, colecao: string): Promise<any | null> {
    const chave = `${colecao}/${id}`;
    if (this.cacheProfissionais.has(chave)) return this.cacheProfissionais.get(chave);
    let dados: any = null;
    try {
      const porId = await getDoc(doc(db, colecao, id));
      if (porId.exists()) {
        dados = porId.data();
      } else {
        const legado = await getDocs(query(collection(db, colecao), where('uid', '==', id)));
        if (!legado.empty) dados = legado.docs[0].data();
      }
    } catch (e) {
      console.error('Erro ao buscar profissional', e);
    }
    this.cacheProfissionais.set(chave, dados);
    return dados;
  }

  formatDataHora(timestamp: any): string {
    if (!timestamp) return "";
    try {
      const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) +
        " às " +
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  gerarBadge(status: string): string {
    if (status === "pendente") return '<span class="badge badge-pendente">Esperando confirmação</span>';
    if (status === "aceito") return '<span class="badge badge-aceito">Confirmada</span>';
    if (status === "realizado") return '<span class="badge badge-realizado">Realizada</span>';
    if (status === "negado") return '<span class="badge badge-negado">Cancelada</span>';
    return "";
  }

  async abrirDetalhesProfissional(uid: string, tipo: string) {
    try {
      const collectionName = tipo === "psicologo" ? "psicologos" : "advogados";
      const data = await this.buscarProfissional(uid, collectionName);
      if (!data) {
        this.alerta.erro('Informações do profissional não encontradas.', 'Profissional não encontrado');
        return;
      }

      this.profissionalSelecionado.set({
        nome: data['nome'] || "—",
        email: data['email'] ? `Email: ${data['email']}` : "",
        registro: tipo === "psicologo" ? (data['crp'] ? `CRP: ${data['crp']}` : "") : (data['oab'] ? `OAB: ${data['oab']}` : ""),
        atuacao: data['area'] ? `Área: ${data['area']}` : (data['atuacao'] ? `Atuação: ${data['atuacao']}` : ""),
        foto: data['avatar'] || "./img/avatar_usuario.png",
        especializacoes: Array.isArray(data['especializacoes']) && data['especializacoes'].length
          ? "Especializações: " + data['especializacoes'].join(", ")
          : ""
      });

      this.showModalProf.set(true);
    } catch (err) {
      console.error("Erro ao abrir modal:", err);
    }
  }

  fecharModalProf() {
    this.showModalProf.set(false);
  }

  abrirChat(uid: string, tipo: string) {
    this.router.navigate(['/chat'], { queryParams: { uid, tipo } });
  }

  abrirModalCancelar(consulta: any) {
    this.consultaParaCancelar.set(consulta);
    this.motivoCancelamento.set('');
    this.showModalCancelar.set(true);
  }

  fecharModalCancelar() {
    if (this.isCancelando()) return;
    this.showModalCancelar.set(false);
    this.consultaParaCancelar.set(null);
    this.motivoCancelamento.set('');
  }

  async confirmarCancelamento() {
    const consulta = this.consultaParaCancelar();
    if (!consulta || this.isCancelando()) return;

    this.isCancelando.set(true);
    try {
      const consultaRef = doc(db, "Consultas", consulta.id);
      await updateDoc(consultaRef, {
        status: "negado",
        motivoCancelamento: this.motivoCancelamento().trim() || null,
        canceladoEm: serverTimestamp(),
        canceladoPor: "mae"
      });

      const user = auth.currentUser;
      if (user) {
        avisarProfissional({
          evento: 'cancelada', profissionalId: consulta.profissionalId, tipoProf: consulta.tipoProf,
          maeId: user.uid, consultaId: consulta.id,
          quando: consulta.Datahora?.toDate ? consulta.Datahora.toDate() : null,
          motivo: this.motivoCancelamento(),
        });
      }

      this.showModalCancelar.set(false);
      this.consultaParaCancelar.set(null);
      this.motivoCancelamento.set('');
    } catch (err) {
      console.error("Erro ao cancelar consulta:", err);
      this.alerta.erro('Não foi possível cancelar a consulta. Tente novamente.');
    } finally {
      this.isCancelando.set(false);
    }
  }
}
