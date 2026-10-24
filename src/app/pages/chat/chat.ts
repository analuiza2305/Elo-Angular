import { Component, OnInit, OnDestroy, signal, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HeaderComponent],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css']
})
export class Chat implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  @ViewChild('caixaMensagens') caixaMensagens?: ElementRef<HTMLDivElement>;
  private readonly LIMITE_AUDIO_SEG = 60;   // áudio vai em base64 no documento (limite de 1 MB do Firestore)
  private timerAudio: any = null;

  currentUser = signal<any>(null);
  usuariosLista = signal<any[]>([]);
  mensagens = signal<any[]>([]);
  
  // Estados do Chat Ativo
  currentChatId = signal<string | null>(null);
  chatAtivoInfo = signal<{ nome: string; avatar: string } | null>(null);
  textoMensagem = signal<string>('');
  isMobileChatActive = signal<boolean>(false);
  
  // Gravação de Áudio
  isRecording = signal<boolean>(false);
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  private unsubscribeMessages: (() => void) | null = null;
  private unsubUserChats: (() => void) | null = null;
  private chatListState = new Map<string, any>();
  private notifyAudio: HTMLAudioElement | null = null;

  ngOnInit() {
    try {
      this.notifyAudio = new Audio('./sounds/not.mp3');
      this.notifyAudio.preload = 'auto';
    } catch (_) {}

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }
      this.currentUser.set(user);
      await this.loadUsers();
      this.listenUserChats();

      // "Chat" em Minhas consultas abre direto a conversa (?uid=...); ?psi= mantido por compatibilidade
      this.route.queryParams.subscribe(params => {
        const alvo = params['uid'] || params['psi'];
        const state = alvo ? this.chatListState.get(alvo) : null;
        if (state) this.openChatWith(alvo, { nome: state.nome, avatar: state.avatar });
      });
    });
  }

  ngOnDestroy() {
    if (this.unsubscribeMessages) this.unsubscribeMessages();
    if (this.unsubUserChats) this.unsubUserChats();
    clearTimeout(this.timerAudio);
  }

  /** Profissionais com quem a mãe tem (ou teve) consulta, no formato novo e no antigo. */
  async loadUsers() {
    try {
      const user = this.currentUser();
      if (!user) return;

      const consultasRef = collection(db, "Consultas");
      const [snapNovo, snapAntigo] = await Promise.all([
        getDocs(query(consultasRef, where("maeId", "==", user.uid))),
        getDocs(query(consultasRef, where("Mae", "==", user.uid))).catch(() => null)
      ]);

      // uid do profissional -> coleção
      const profissionais = new Map<string, 'psicologos' | 'advogados'>();
      const registrar = (data: any) => {
        if (String(data['status'] || '').toLowerCase() === 'negado') return;   // canceladas não abrem chat
        const id = data['profissionalId'] || data['Psicologo'] || data['Advogado'];
        if (!id) return;
        const tipo = data['tipoProfissional'] || (data['Advogado'] ? 'advogado' : 'psicologo');
        profissionais.set(id, tipo === 'advogado' ? 'advogados' : 'psicologos');
      };
      snapNovo.forEach(d => registrar(d.data()));
      snapAntigo?.forEach(d => registrar(d.data()));

      const todos = await Promise.all([...profissionais.entries()].map(async ([uid, colecao]) => {
        const p = await this.buscarProfissional(uid, colecao);
        const dadosUser = {
          uid,
          nome: p?.['nome'] || 'Profissional',
          avatar: p?.['avatar'] || p?.['fotoURL'] || './img/avatar_usuario.png',
          lastMessage: this.chatListState.get(uid)?.lastMessage || '',
          unreadCount: 0
        };
        this.chatListState.set(uid, dadosUser);
        return dadosUser;
      }));

      this.usuariosLista.set(todos);
    } catch (error) {
      console.error("Erro ao carregar profissionais:", error);
    }
  }

  /** Procura pelo id do documento e, se não achar, pelo campo uid (cadastros antigos). */
  private async buscarProfissional(uid: string, colecao: string): Promise<any | null> {
    try {
      const porId = await getDoc(doc(db, colecao, uid));
      if (porId.exists()) return porId.data();
      const legado = await getDocs(query(collection(db, colecao), where("uid", "==", uid)));
      return legado.empty ? null : legado.docs[0].data();
    } catch {
      return null;
    }
  }

  listenUserChats() {
    const user = this.currentUser();
    if (!user) return;

    if (this.unsubUserChats) this.unsubUserChats();
    const chatsRef = collection(db, "chats");
    const qChats = query(chatsRef, where("participantes", "array-contains", user.uid), orderBy("ultimaAtualizacao", "desc"));

    this.unsubUserChats = onSnapshot(qChats, async (snap) => {
      snap.forEach(async (chatDoc) => {
        const data = chatDoc.data();
        const otherId = data['participantes'].find((p: string) => p !== user.uid);
        if (!otherId) return;

        const state = this.chatListState.get(otherId);
        if (state) {
          state.lastMessage = data['ultimoMensagem'] || '';
          this.usuariosLista.set([...this.usuariosLista()]);
        }
      });
    });
  }

  async openChatWith(otherUid: string, userData: { nome: string; avatar: string }) {
    const user = this.currentUser();
    if (!user) return;

    const chatsRef = collection(db, "chats");
    const snapshot = await getDocs(query(chatsRef, where("participantes", "array-contains", user.uid)));

    let chatDoc: any = null;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data['participantes'].includes(otherUid)) {
        chatDoc = { id: docSnap.id, ...data };
      }
    });

    if (!chatDoc) {
      const newChatRef = await addDoc(chatsRef, {
        participantes: [user.uid, otherUid],
        criadoEm: serverTimestamp(),
        ultimoMensagem: "",
        ultimoEnviadoPor: ""
      });
      chatDoc = { id: newChatRef.id, participantes: [user.uid, otherUid] };
    }

    if (this.unsubscribeMessages) this.unsubscribeMessages();

    this.currentChatId.set(chatDoc.id);
    this.chatAtivoInfo.set(userData);
    this.isMobileChatActive.set(true);

    const msgsRef = collection(db, "chats", chatDoc.id, "mensagens");
    const qMsgs = query(msgsRef, orderBy("enviadoEm", "asc"));

    this.unsubscribeMessages = onSnapshot(qMsgs, (snap) => {
      const msgs: any[] = [];
      snap.forEach((d) => {
        const m = d.data();
        const hora = m['enviadoEm']?.toDate ? m['enviadoEm'].toDate().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : 'Agora';
        msgs.push({
          id: d.id,
          mine: m['enviadoPor'] === user.uid,
          texto: m['texto'],
          audio: m['audio'],
          hora
        });
      });
      this.mensagens.set(msgs);
      this.rolarParaFim();

      // Marca como lidas as que chegarem enquanto a conversa está aberta
      const naoLidas = snap.docs.filter(d => d.data()['enviadoPor'] === otherUid && d.data()['lido'] === false);
      if (naoLidas.length) {
        const batch = writeBatch(db);
        naoLidas.forEach(d => batch.update(d.ref, { lido: true }));
        batch.commit().catch(() => {});
      }
    });
  }

  private rolarParaFim() {
    setTimeout(() => {
      const el = this.caixaMensagens?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  }

  async markMessagesAsRead(chatId: string, otherUid: string) {
    try {
      const msgsRef = collection(db, "chats", chatId, "mensagens");
      const unreadSnap = await getDocs(query(msgsRef, where("enviadoPor", "==", otherUid)));
      const batch = writeBatch(db);
      let toUpdate = 0;

      unreadSnap.forEach((d) => {
        if (d.data()['lido'] === false) {
          toUpdate++;
          batch.update(d.ref, { lido: true });
        }
      });
      if (toUpdate > 0) await batch.commit();
    } catch (err) {
      console.error("Erro ao marcar como lidas:", err);
    }
  }

  async enviarMensagem(event: Event) {
    event.preventDefault();
    const chatId = this.currentChatId();
    const user = this.currentUser();
    const texto = this.textoMensagem().trim();

    if (!chatId || !user || !texto) return;

    this.textoMensagem.set('');

    try {
      const msgRef = collection(db, "chats", chatId, "mensagens");
      await addDoc(msgRef, {
        texto,
        enviadoPor: user.uid,
        enviadoEm: serverTimestamp(),
        lido: false
      });

      await setDoc(doc(db, "chats", chatId), {
        ultimoMensagem: texto,
        ultimoEnviadoPor: user.uid,
        ultimaAtualizacao: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      this.textoMensagem.set(texto);   // devolve o texto para tentar de novo
    }
  }

  async toggleGravacaoAudio() {
    const chatId = this.currentChatId();
    const user = this.currentUser();
    if (!chatId || !user) return;

    if (!this.isRecording()) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
        this.mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = async () => {
            const base64Audio = reader.result as string;
            const msgRef = collection(db, "chats", chatId, "mensagens");
            await addDoc(msgRef, {
              audio: base64Audio,
              texto: "",
              enviadoPor: user.uid,
              enviadoEm: serverTimestamp(),
              lido: false
            });
            await setDoc(doc(db, "chats", chatId), {
              ultimoMensagem: "[Áudio]",
              ultimoEnviadoPor: user.uid,
              ultimaAtualizacao: serverTimestamp()
            }, { merge: true });
          };
          reader.readAsDataURL(audioBlob);
        };

        this.mediaRecorder.start();
        this.isRecording.set(true);
        // Para sozinho no limite para não passar do tamanho máximo do documento
        this.timerAudio = setTimeout(() => {
          if (this.isRecording()) this.toggleGravacaoAudio();
        }, this.LIMITE_AUDIO_SEG * 1000);
      } catch (err) {
        alert("Não foi possível acessar o microfone.");
      }
    } else {
      clearTimeout(this.timerAudio);
      if (this.mediaRecorder) {
        this.mediaRecorder.stop();
        this.mediaRecorder.stream.getTracks().forEach(t => t.stop());   // solta o microfone
      }
      this.isRecording.set(false);
    }
  }

  voltarParaLista() {
    this.isMobileChatActive.set(false);
    if (this.unsubscribeMessages) this.unsubscribeMessages();
    this.currentChatId.set(null);
  }
}