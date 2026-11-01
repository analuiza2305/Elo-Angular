import { Component, HostListener, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';

@Component({
  selector: 'app-consultoria',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent],
  templateUrl: './consultoria.html',
  styleUrls: ['./consultoria.css']
})
export class Consultoria implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  /** Quantas consultas futuras a mãe já tem (aparece no botão "Minhas consultas"). */
  proximas = signal(0);
  comoFuncionaAberto = signal(false);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
        this.contarProximas(user.uid);
        await this.atualizarConsultLoad(user.uid);
      } else {
        this.router.navigate(['/login']);
      }
    });
  }

  async atualizarConsultLoad(uid: string) {
    try {
      const userRef = doc(db, 'usuarios', uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return;
      const consultLoad = snap.data()?.['extras']?.['consult_load'];
      if (consultLoad !== true) {
        await updateDoc(userRef, { 'extras.consult_load': true });
      }
    } catch (err) {
      console.error('Erro ao atualizar consult_load:', err);
    }
  }

  private async contarProximas(uid: string) {
    try {
      const snap = await getDocs(query(collection(db, 'Consultas'), where('maeId', '==', uid)));
      const agora = Date.now();
      const ativos = ['pendente', 'aceito', 'aceita', 'agendada'];
      let total = 0;
      snap.forEach((d) => {
        const c: any = d.data();
        const quando = c.Datahora?.toDate ? c.Datahora.toDate().getTime() : c.Datahora ? new Date(c.Datahora).getTime() : 0;
        if (ativos.includes(String(c.status || '').toLowerCase()) && quando >= agora - 60 * 60 * 1000) total++;
      });
      this.proximas.set(total);
    } catch {
      /* sem contador, a página continua funcionando */
    }
  }

  abrirComoFunciona() {
    this.comoFuncionaAberto.set(true);
  }

  fecharComoFunciona() {
    this.comoFuncionaAberto.set(false);
  }

  @HostListener('document:keydown.escape')
  aoApertarEsc() {
    this.fecharComoFunciona();
  }

  agendar() {
    this.router.navigate(['/consultas-lista-psi']);
  }

  minhasConsultas() {
    this.router.navigate(['/consultas']);
  }

}
