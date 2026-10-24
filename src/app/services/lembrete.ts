import { Injectable } from '@angular/core';
import { db } from '../core/firebase';
import { collection, query, where, onSnapshot, Unsubscribe } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class LembreteService {
  private jaNotificou = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsub: Unsubscribe | null = null;
  private uidAtual: string | null = null;

  /**
   * Fica escutando as consultas confirmadas do usuário e avisa 15 min antes.
   * Pode ser chamado várias vezes (home, header...): se já estiver ouvindo o mesmo usuário, não duplica.
   * A consulta filtra por maeId/profissionalId == uid, que é o que as regras do Firestore exigem.
   */
  iniciarListenerDeConsultas(uid: string, tipoPerfil: 'psicologo' | 'advogado' | 'mae') {
    if (this.unsub && this.uidAtual === uid) return;
    this.parar();
    this.uidAtual = uid;

    const campoBusca = tipoPerfil === 'mae' ? 'maeId' : 'profissionalId';
    const q = query(
      collection(db, 'Consultas'),
      where(campoBusca, '==', uid),
      where('status', '==', 'aceito') // 'aceito' = Agendada
    );

    this.unsub = onSnapshot(
      q,
      (snap) => {
        const idsAtivos = new Set(snap.docs.map((d) => d.id));

        // Consulta cancelada/encerrada: desmarca o lembrete pendente
        for (const [id, timer] of this.timers) {
          if (!idsAtivos.has(id)) {
            clearTimeout(timer);
            this.timers.delete(id);
          }
        }

        snap.docs.forEach((d) => {
          const data = d.data();
          if (!data['Datahora']) return;
          const dataConsulta = data['Datahora']?.toDate ? data['Datahora'].toDate() : new Date(data['Datahora']);
          const nomePessoa = tipoPerfil === 'mae' ? 'seu profissional' : (data['nome'] || 'sua paciente');
          this.agendarNotificacao(d.id, dataConsulta, nomePessoa);
        });
      },
      (erro) => console.warn('Lembretes de consulta indisponíveis:', erro)
    );
  }

  /** Chamar no logout / troca de conta. */
  parar() {
    this.unsub?.();
    this.unsub = null;
    this.uidAtual = null;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  private agendarNotificacao(idConsulta: string, dataConsulta: Date, nomePessoa: string) {
    if (this.jaNotificou.has(idConsulta) || this.timers.has(idConsulta)) return;

    const minutosFaltando = Math.floor((dataConsulta.getTime() - Date.now()) / 60000);

    if (minutosFaltando > 0 && minutosFaltando <= 15) {
      this.dispararNotificacaoNativa(idConsulta, nomePessoa, minutosFaltando);
    } else if (minutosFaltando > 15) {
      const tempoParaAviso = (minutosFaltando - 15) * 60000;
      // Só agenda o que acontece nas próximas 24h (setTimeout muito longo não é confiável)
      if (tempoParaAviso <= 86400000) {
        const timer = setTimeout(() => {
          this.timers.delete(idConsulta);
          this.dispararNotificacaoNativa(idConsulta, nomePessoa, 15);
        }, tempoParaAviso);
        this.timers.set(idConsulta, timer);
      }
    }
  }

  private dispararNotificacaoNativa(idConsulta: string, nomePessoa: string, minutos: number) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    this.jaNotificou.add(idConsulta);

    const mostrar = () =>
      new Notification('Elo Materno: consulta se aproximando', {
        body: `A sua sessão com ${nomePessoa} começa em ${minutos} minutos. Prepare-se e conecte-se!`,
        icon: './img/account_icon.png'
      });

    if (Notification.permission === 'granted') {
      mostrar();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((p) => { if (p === 'granted') mostrar(); });
    }
  }
}
