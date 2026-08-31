import { Component, OnInit, signal, inject, ViewEncapsulation, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './perfil.html',
  styleUrls: ['./perfil.css'],
  encapsulation: ViewEncapsulation.None
})
export class Perfil implements OnInit {
  private router = inject(Router);

  currentUser = signal<any>(null);
  userData = signal<any>({});
  interacaoRecente = signal<any>(null);
  isLoading = signal<boolean>(true);

  showModalEditar = signal<boolean>(false);
  showModalAvatar = signal<boolean>(false);
  showModalCriador = signal<boolean>(false);

  editForm = signal({ nome: '', cidade: '', emprego: '', filhos: '' });

  avatarSelecionado = signal<string | null>(null);
  avataresDisponiveis = Array.from({length: 33}, (_, i) => `./img/mamaesemfundo/${i + 1}.png`);

  // Limites específicos baseados na quantidade real de arquivos nas pastas do projeto
  indiceBase = signal<number>(1);
  maxBases = 5; // Ajuste se houver mais bases

  indiceCamisa = signal<number>(1);
  maxCamisas = 15; // Quantidade total de camisas disponíveis na pasta

  indiceSobrancelha = signal<number>(1);
  maxSobrancelhas = 10; // Quantidade total de sobrancelhas disponíveis na pasta

  indiceCabelo = signal<number>(1);
  maxCabelos = 15; // Quantidade total de cabelos disponíveis na pasta

  avatarCamadas = computed(() => {
    const b = this.indiceBase();
    const c = this.indiceCamisa();
    const s = this.indiceSobrancelha();
    const cab = this.indiceCabelo();

    return {
      base: `./img/mamaesemfundo/bases/${b}.png`,
      orelha: `./img/mamaesemfundo/bases/${b}_orelha.png`,
      camisa: `./img/mamaesemfundo/camisas/${c}.png`,
      sobrancelha: `./img/mamaesemfundo/sobrancelhas/${s}.png`,
      cabelo: `./img/mamaesemfundo/cabelos/${cab}.png`,
      cabeloTras: `./img/mamaesemfundo/cabelos/${cab}_tras.png`,
      boca: `./img/mamaesemfundo/bocas/1.png`,
      olhos: `./img/mamaesemfundo/olhos/1.png`
    };
  });

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        this.isLoading.set(true);
        this.currentUser.set(user);
        await this.carregarPerfil(user.uid);
        await this.carregarInteracoes(user.uid);
        this.isLoading.set(false);
      } else {
        this.router.navigate(['/login']);
      }
    });
  }

  async carregarPerfil(uid: string) {
    try {
      const docSnap = await getDoc(doc(db, 'usuarios', uid));
      if (docSnap.exists()) {
        this.userData.set(docSnap.data());
      }
    } catch (err) {
      console.error(err);
    }
  }

  async carregarInteracoes(uid: string) {
    try {
      const q = query(collection(db, "posts"), where("autorId", "==", uid), orderBy("data", "desc"), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        this.interacaoRecente.set(snap.docs[0].data());
      }
    } catch (err) {
      console.error(err);
    }
  }

  abrirModalEditar() {
    const data = this.userData();
    this.editForm.set({
      nome: data.nome || '', cidade: data.cidade || '',
      emprego: data.emprego || '', filhos: data.filhos || ''
    });
    this.showModalEditar.set(true);
  }

  async salvarPerfil() {
    try {
      const userRef = doc(db, 'usuarios', this.currentUser().uid);
      await updateDoc(userRef, { ...this.editForm() });
      this.userData.set({ ...this.userData(), ...this.editForm() });
      this.showModalEditar.set(false);
      alert("Perfil updated!");
    } catch (err) {
      alert("Erro ao salvar.");
    }
  }

  abrirModalAvatar() {
    this.avatarSelecionado.set(null);
    this.showModalAvatar.set(true);
  }

  selecionarAvatar(url: string) {
    this.avatarSelecionado.set(url);
  }

  async confirmarAvatar() {
    if (!this.avatarSelecionado()) return;
    try {
      const userRef = doc(db, 'usuarios', this.currentUser().uid);
      await updateDoc(userRef, { avatar: this.avatarSelecionado() });
      this.userData.set({ ...this.userData(), avatar: this.avatarSelecionado(), fotoURL: this.avatarSelecionado() });
      this.showModalAvatar.set(false);
    } catch (err) {
      alert("Erro ao salvar avatar.");
    }
  }

  abrirCriador() {
    this.showModalAvatar.set(false);
    this.showModalCriador.set(true);
  }

  mudarParte(parte: string, direcao: number) {
    if (parte === 'base') {
      this.indiceBase.update(v => ((v + direcao - 1 + this.maxBases) % this.maxBases) + 1);
    } else if (parte === 'camisa') {
      this.indiceCamisa.update(v => ((v + direcao - 1 + this.maxCamisas) % this.maxCamisas) + 1);
    } else if (parte === 'sobrancelha') {
      this.indiceSobrancelha.update(v => ((v + direcao - 1 + this.maxSobrancelhas) % this.maxSobrancelhas) + 1);
    } else if (parte === 'cabelo') {
      this.indiceCabelo.update(v => ((v + direcao - 1 + this.maxCabelos) % this.maxCabelos) + 1);
    }
  }

  async salvarAvatarCriado() {
    try {
      const avatarEscolhido = this.avatarCamadas().base;
      const userRef = doc(db, 'usuarios', this.currentUser().uid);
      await updateDoc(userRef, { avatar: avatarEscolhido });
      
      this.userData.set({ ...this.userData(), avatar: avatarEscolhido, fotoURL: avatarEscolhido });
      this.showModalCriador.set(false);
      alert("Avatar criado e salvo com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar avatar criado:", err);
      alert("Erro ao salvar avatar.");
    }
  }
}