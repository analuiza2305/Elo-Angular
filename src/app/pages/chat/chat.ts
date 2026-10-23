import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../../components/header/header';
import { auth, db } from '../../core/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  addDoc,
  setDoc,
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
        alert("Você precisa estar logado.");
        window.location.href = "/login";
        return;
      }
      this.currentUser.set(user);
      await this.loadUsers();
      this.listenUserChats();

      this.route.queryParams.subscribe(params => {
        const psiUid = params['psi'];
        if (psiUid) {
          const checkExist = setInterval(() => {
            const state = this.chatListState.get(psiUid);
            if (state) {
              clearInterval(checkExist);
              this.openChatWith(psiUid, { nome: state.nome, avatar: state.avatar });
            }
          }, 100);
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.unsubscribeMessages) this.unsubscribeMessages();
    if (this.unsubUserChats) this.unsubUserChats();
  }

  async loadUsers() {
    try {
      const user = this.currentUser();
      if (!user) return;

      const consultasRef = collection(db, "Consultas");
      const q = query(consultasRef, where("Mae", "==", user.uid));
      const snapConsultas = await getDocs(q);

      if (snapConsultas.empty) {
        this.usuariosLista.set([]);
        return;
      }

      const psicSet = new Set<string>();
      const advSet = new Set<string>();

      snapConsultas.forEach(docSnap => {
        const data = docSnap.data();
        if (data['Psicologo']) psicSet.add(data['Psicologo']);
        if (data['Advogado']) advSet.add(data['Advogado']);
      });

      const psicUids = Array.from(psicSet).filter(Boolean);
      const advUids = Array.from(advSet).filter(Boolean);

      let psicDocs: any[] = [];
      if (psicUids.length > 0) {
        const qPsi = query(collection(db, "psicologos"), where("uid", "in", psicUids.slice(0, 10)));
        const snapPsi = await getDocs(qPsi);
        snapPsi.forEach(s => psicDocs.push({ id: s.id, ...s.data() }));
      }

      let advDocs: any[] = [];
      if (advUids.length > 0) {
        const qAdv = query(collection(db, "advogados"), where("uid", "in", advUids.slice(0, 10)));
        const snapAdv = await getDocs(qAdv);
        snapAdv.forEach(s => advDocs.push({ id: s.id, ...s.data() }));
      }

      const todos = [...psicDocs, ...advDocs].map(p => {
        const uid = p['uid'] || p.id;
        const dadosUser = {
          uid,
          nome: p['nome'] || 'Profissional',
          avatar: p['avatar'] || p['fotoURL'] || './img/avatar_usuario.png',
          lastMessage: '',
          unreadCount: 0
        };
        this.chatListState.set(uid, dadosUser);
        return dadosUser;
      });

      this.usuariosLista.set(todos);
    } catch (error) {
      console.error("Erro ao carregar profissionais:", error);
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
    });

    this.markMessagesAsRead(chatDoc.id, otherUid);
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
      alert("Erro ao enviar mensagem.");
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
      } catch (err) {
        alert("Não foi possível acessar o microfone.");
      }
    } else {
      if (this.mediaRecorder) {
        this.mediaRecorder.stop();
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