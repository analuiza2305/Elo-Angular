import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

@Component({
  selector: 'app-consultoria',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent, FooterComponent],
  templateUrl: './consultoria.html',
  styleUrls: ['./consultoria.css']
})
export class Consultoria implements OnInit {
  private router = inject(Router);
  
  currentUser = signal<any>(null);
  showModal = signal<boolean>(false);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.currentUser.set(user);
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

      const data = snap.data();
      const consultLoad = data?.['extras']?.['consult_load'];

      if (consultLoad !== true) {
        await updateDoc(userRef, { 'extras.consult_load': true });
      }
    } catch (err) {
      console.error('Erro ao atualizar consult_load:', err);
    }
  }

  // Função programática para ir direto para as consultas
  irParaConsultas() {
    this.router.navigate(['/consultas']);
  }

  abrirModal() {
    this.showModal.set(true);
  }

  fecharModal() {
    this.showModal.set(false);
  }
}