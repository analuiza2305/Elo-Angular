import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { 
  doc, getDoc, getDocs, collection, query, where, onSnapshot 
} from 'firebase/firestore';

@Component({
  selector: 'app-consultas',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './consultas.html',
  styleUrls: ['./consultas.css']
})
export class ConsultasComponent implements OnInit {
  private router = inject(Router);

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

  ouvirConsultasDaMae(uidMae: string) {
    const q = query(collection(db, "Consultas"), where("Mae", "==", uidMae));

    onSnapshot(q, async (snapshot) => {
      this.isLoading.set(false);
      const agendadas: any[] = [];
      const realizadas: any[] = [];
      const canceladas: any[] = [];

      for (const snapDoc of snapshot.docs) {
        const raw = { id: snapDoc.id, ...snapDoc.data() } as any;
        let profissionalId = null;
        let collectionName = null;

        if (raw.Psicologo) {
          profissionalId = raw.Psicologo;
          collectionName = 'psicologos';
        } else if (raw.Advogado) {
          profissionalId = raw.Advogado;
          collectionName = 'advogados';
        }

        // Busca dados do profissional
        let profissionalNome = '';
        let profissionalFoto = './img/account_icon.png';

        if (profissionalId && collectionName) {
          try {
            const pQuery = query(collection(db, collectionName), where("uid", "==", profissionalId));
            const pSnap = await getDocs(pQuery);
            if (!pSnap.empty) {
              const pData = pSnap.docs[0].data();
              profissionalNome = pData['nome'] || '';
              profissionalFoto = pData['avatar'] || './img/account_icon.png';
            }
          } catch (e) {
            console.error(e);
          }
        }

        const dataFormatada = this.formatDataHora(raw.Datahora);
        const tipoProf = collectionName === 'psicologos' ? 'psicologo' : 'advogado';

        const consultaObj = {
          ...raw,
          profissionalId,
          tipoProf,
          profissionalNome,
          profissionalFoto,
          dataFormatada
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
      this.consultasRealizadas.set(realizadas);
      this.consultasCanceladas.set(canceladas);
    });
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
    if (status === "pendente") return '<span class="badge badge-pendente">Pendente</span>';
    if (status === "aceito") return '<span class="badge badge-aceito">Agendada</span>';
    if (status === "realizado") return '<span class="badge badge-realizado">Realizada</span>';
    if (status === "negado") return '<span class="badge badge-negado">Negada</span>';
    return "";
  }

  async abrirDetalhesProfissional(uid: string, tipo: string) {
    try {
      const collectionName = tipo === "psicologo" ? "psicologos" : "advogados";
      const q = query(collection(db, collectionName), where("uid", "==", uid));
      const snap = await getDocs(q);
      if (snap.empty) {
        alert("Informações do profissional não encontradas.");
        return;
      }

      const data = snap.docs[0].data();
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
}