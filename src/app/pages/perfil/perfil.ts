import { Component, OnInit, signal, inject, ViewEncapsulation, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { FooterComponent } from '../../components/footer/footer';
import { auth, db } from '../../core/firebase';
import {
  onAuthStateChanged,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

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
  showModalApagarConta = signal<boolean>(false);

  mensagemSucessoAvatar = signal<string>('');

  senhaConfirmacao = '';
  apagandoConta = signal<boolean>(false);
  erroApagarConta = signal('');

  ehContaGoogle = computed(() => {
    const user = this.currentUser();
    return !!user?.providerData?.some((p: any) => p.providerId === 'google.com');
  });

  editForm = signal({ nome: '', cidade: '', emprego: '', filhos: '' });

  avatarSelecionado = signal<string | null>(null);
  avataresDisponiveis = Array.from({length: 33}, (_, i) => `./img/mamaesemfundo/${i + 1}.png`);

// Limites específicos baseados na quantidade real de arquivos nas pastas do projeto
  indiceBase = signal<number>(1);
  maxBases = 8; // Você tem 8 bases

  indiceCamisa = signal<number>(1);
  maxCamisas = 15; // Troque de 1 para 15 (ou o total exato de camisas na pasta)

  indiceSobrancelha = signal<number>(1);
  maxSobrancelhas = 10; // Troque de 1 para 10 (ou o total exato de sobrancelhas)

  indiceCabelo = signal<number>(1);
  maxCabelos = 11; // Ajustado para 11 cabelos

  // Sinais de Cor para Camisa e Sobrancelha
  corCamisa = signal<string>('#ff8888'); 
  corSobrancelha = signal<string>('#4a2b18');

  // Filtros dinâmicos que aplicam a cor na imagem
  filtroCamisa = computed(() => this.gerarFiltroCss(this.corCamisa()));
  filtroSobrancelha = computed(() => this.gerarFiltroCss(this.corSobrancelha()));

  // Função matemática para converter cor HEX em filtro CSS (hue-rotate)
  gerarFiltroCss(hex: string): string {
    if (!hex) return 'none';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return `hue-rotate(${h * 360}deg) saturate(${1 + s}) brightness(${0.9 + l / 2})`;
  }

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
      window.location.reload(); // Atualiza a página imediatamente
      
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
      const canvas = document.createElement('canvas');
      canvas.width = 250;
      canvas.height = 250;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      // Adicionamos os filtros diretamente nas camadas correspondentes
      const layers = [
        { id: 'cabelotras', filter: 'none' },
        { id: 'base', filter: 'none' },
        { id: 'camisa', filter: this.filtroCamisa() },
        { id: 'sobrancelha', filter: this.filtroSobrancelha() },
        { id: 'cabelo', filter: 'none' },
        { id: 'boca', filter: 'none' },
        { id: 'olhos', filter: 'none' },
        { id: 'orelha', filter: 'none' }
      ];

      for (const layer of layers) {
        const img = document.getElementById(layer.id) as HTMLImageElement;
        if (img) {
          await new Promise<void>((resolve) => {
            if (img.complete) resolve();
            else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          });
          
          if (img.naturalWidth > 0) {
            ctx.filter = layer.filter; // Aplica a cor escolhida
            ctx.drawImage(img, 0, 0, 250, 250);
            ctx.filter = 'none'; // Reseta para a próxima camada
          }
        }
      }

      // ... (mantenha a parte de cima do código do canvas igual)

      const avatarFinalBase64 = canvas.toDataURL('image/png');
      const userRef = doc(db, 'usuarios', this.currentUser().uid);
      await updateDoc(userRef, { avatar: avatarFinalBase64 });
      
      this.userData.set({ ...this.userData(), avatar: avatarFinalBase64, fotoURL: avatarFinalBase64 });
      
     // Exibe a mensagem de sucesso
      this.mensagemSucessoAvatar.set('Avatar atualizado com sucesso!');
      
      // Aguarda 2 segundos, limpa a mensagem, fecha o modal e atualiza o Header
      setTimeout(() => {
        this.mensagemSucessoAvatar.set('');
        this.showModalCriador.set(false);
        window.location.reload(); // Atualiza a página para o Header puxar a foto nova
      }, 2000);
      
    } catch (err) {
      console.error("Erro ao salvar avatar:", err);
      alert("Erro ao salvar avatar.");
    }
  }
  abrirModalApagarConta() {
    this.senhaConfirmacao = '';
    this.erroApagarConta.set('');
    this.showModalApagarConta.set(true);
  }

  /**
   * Apaga a conta da mãe (Firebase Auth + doc em usuarios/{uid}).
   * O Firebase exige "login recente" pra deletar uma conta, então
   * reautenticamos primeiro (com senha, ou com o Google se foi assim
   * que ela entrou) antes de confirmar a exclusão.
   */
  async confirmarApagarConta() {
    const user = this.currentUser();
    if (!user) return;

    this.erroApagarConta.set('');
    this.apagandoConta.set(true);
    try {
      if (this.ehContaGoogle()) {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else {
        if (!this.senhaConfirmacao.trim()) {
          this.erroApagarConta.set('Digite sua senha para confirmar.');
          this.apagandoConta.set(false);
          return;
        }
        const credential = EmailAuthProvider.credential(user.email, this.senhaConfirmacao);
        await reauthenticateWithCredential(user, credential);
      }

      await deleteDoc(doc(db, 'usuarios', user.uid));
      await deleteUser(user);

      this.showModalApagarConta.set(false);
      this.router.navigate(['/']);
    } catch (err: any) {
      if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        this.erroApagarConta.set('Senha incorreta.');
      } else if (err?.code === 'auth/too-many-requests') {
        this.erroApagarConta.set('Muitas tentativas. Aguarde um pouco e tente de novo.');
      } else {
        this.erroApagarConta.set('Não foi possível apagar a conta agora. Tente novamente.');
      }
    } finally {
      this.apagandoConta.set(false);
    }
  }
}