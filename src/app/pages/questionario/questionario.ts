import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { HeaderComponent } from '../../components/header/header';
import { AlertaService } from '../../core/services/alerta.service';
import {
  PERGUNTAS_BEM_ESTAR,
  RespostasBemEstar,
  RESPOSTAS_VAZIAS,
  precisaAtencao,
  respostaDeRisco,
  rotuloDaResposta,
} from '../../services/questionario-bem-estar';

/**
 * Questionário de bem-estar da mãe. É UM por mãe (questionarios/{uid da mãe}):
 * ela responde uma vez e pode atualizar quando mudar de fase (ex.: o bebê nasceu).
 * Só as psicólogas com quem ela tem consulta conseguem ler (campo "psicologos").
 * Rota: /questionario
 */
@Component({
  selector: 'app-questionario',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent],
  templateUrl: './questionario.html',
  styleUrl: './questionario.css',
})
export class QuestionarioComponent implements OnInit {
  private router = inject(Router);
  private alerta = inject(AlertaService);

  readonly perguntas = PERGUNTAS_BEM_ESTAR;

  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly erroCarregar = signal('');
  readonly enviado = signal(false);
  readonly jaRespondido = signal(false);
  /** 'resumo' = mostra o que ela já respondeu; 'responder' = perguntas uma por vez. */
  readonly modo = signal<'resumo' | 'responder'>('responder');
  readonly atualizadoEm = signal('');

  readonly respostas = signal<RespostasBemEstar>({ ...RESPOSTAS_VAZIAS, preocupacoes: [] });
  private respostasSalvas: RespostasBemEstar = { ...RESPOSTAS_VAZIAS, preocupacoes: [] };
  readonly consentimento = signal(false);

  private uid = '';

  /** Mostra o quadro de apoio assim que a mãe marca a resposta de risco. */
  readonly mostrarApoio = computed(() => respostaDeRisco(this.respostas()));

  ngOnInit(): void {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { this.router.navigate(['/login']); return; }
      this.uid = user.uid;
      await this.carregar();
    });
  }

  private async carregar() {
    this.carregando.set(true);
    try {
      const existente = await getDoc(doc(db, 'questionarios', this.uid));
      if (existente.exists()) {
        const q: any = existente.data();
        const r = { ...RESPOSTAS_VAZIAS, ...(q.respostas || {}), preocupacoes: q.respostas?.preocupacoes || [] };
        this.respostas.set(r);
        this.respostasSalvas = r;
        this.consentimento.set(true);
        this.jaRespondido.set(true);
        const quando = q.atualizadoEm?.toDate ? q.atualizadoEm.toDate() : null;
        this.atualizadoEm.set(quando ? quando.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
        this.modo.set('resumo');
      } else {
        this.modo.set('responder');
      }
    } catch (e) {
      console.error('Erro ao carregar o questionário:', e);
      this.erroCarregar.set('Não foi possível abrir o questionário agora. Tente de novo em instantes.');
    } finally {
      this.carregando.set(false);
    }
  }

  /** Começa a atualização a partir das respostas atuais. */
  atualizar() {
    this.passo.set(0);
    this.modo.set('responder');
    this.subir();
  }

  /** Desiste de atualizar e volta ao resumo sem mudar nada. */
  cancelarAtualizacao() {
    this.respostas.set({ ...this.respostasSalvas, preocupacoes: [...this.respostasSalvas.preocupacoes] });
    this.modo.set('resumo');
    this.subir();
  }

  // ---------- Uma pergunta por vez ----------
  readonly passo = signal(0);
  readonly naRevisao = computed(() => this.passo() >= this.perguntas.length);
  readonly perguntaAtual = computed(() => this.perguntas[Math.min(this.passo(), this.perguntas.length - 1)]);
  private avancoTimer: any = null;

  respondida(id: string): boolean {
    const v = this.valor(id);
    return Array.isArray(v) ? v.length > 0 : !!String(v || '').trim();
  }

  /** Escolha única e escala: marca e passa sozinho para a próxima (menos na pergunta sensível). */
  escolherEAvancar(id: string, valor: string) {
    this.escolher(id, valor);
    clearTimeout(this.avancoTimer);
    if (id === 'pensamentos' && respostaDeRisco(this.respostas())) return; // deixa ela ler o quadro de apoio
    this.avancoTimer = setTimeout(() => this.proxima(), 380);
  }

  proxima() {
    clearTimeout(this.avancoTimer);
    if (this.passo() < this.perguntas.length) this.passo.update((n) => n + 1);
    this.subir();
  }

  anterior() {
    clearTimeout(this.avancoTimer);
    if (this.passo() > 0) this.passo.update((n) => n - 1);
    this.subir();
  }

  irPara(i: number) {
    this.passo.set(i);
    this.modo.set('responder');
    this.subir();
  }

  resumo(p: (typeof PERGUNTAS_BEM_ESTAR)[number]): string {
    return rotuloDaResposta(p, this.valor(p.id));
  }

  private subir() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  escolher(id: string, valor: string) {
    this.respostas.update((r) => ({ ...r, [id]: valor }));
  }

  alternarMultipla(id: string, valor: string) {
    this.respostas.update((r: any) => {
      const atual: string[] = r[id] || [];
      return { ...r, [id]: atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor] };
    });
  }

  valor(id: string): any {
    return (this.respostas() as any)[id];
  }

  marcado(id: string, valor: string): boolean {
    const v = this.valor(id);
    return Array.isArray(v) ? v.includes(valor) : v === valor;
  }

  /** Psicólogas com quem a mãe tem ou teve consulta: só elas podem ler o questionário. */
  private async psicologasDaMae(): Promise<string[]> {
    const snap = await getDocs(query(collection(db, 'Consultas'), where('maeId', '==', this.uid)));
    const ids = new Set<string>();
    snap.forEach((d) => {
      const c: any = d.data();
      if (c.profissionalId && (c.tipoProfissional || 'psicologo') === 'psicologo') ids.add(String(c.profissionalId));
    });
    return [...ids];
  }

  async enviar() {
    if (this.salvando()) return;
    const r = this.respostas() as any;
    const faltando = this.perguntas.filter((p) => p.obrigatoria && (Array.isArray(r[p.id]) ? !r[p.id].length : !r[p.id]));
    if (faltando.length) {
      this.alerta.aviso(`Falta responder: ${faltando.map((p) => p.curta).join(', ')}.`);
      return;
    }
    if (!this.consentimento()) {
      this.alerta.aviso('Para enviar, marque que autoriza as psicólogas das suas consultas a ver suas respostas.');
      return;
    }

    this.salvando.set(true);
    try {
      const respostas: RespostasBemEstar = {
        ...this.respostas(),
        expectativa: String(this.respostas().expectativa || '').trim().slice(0, 500),
      };
      const dados: Record<string, any> = {
        maeId: this.uid,
        respostas,
        atencao: precisaAtencao(respostas),
        consentimento: true,
        psicologos: await this.psicologasDaMae(),
        versao: 2,
        atualizadoEm: serverTimestamp(),
      };
      if (!this.jaRespondido()) dados['respondidoEm'] = serverTimestamp();
      await setDoc(doc(db, 'questionarios', this.uid), dados, { merge: true });
      this.respostasSalvas = respostas;
      this.enviado.set(true);
      this.subir();
    } catch (e: any) {
      console.error('Erro ao enviar o questionário:', e);
      this.alerta.erro(e?.code === 'permission-denied'
        ? 'Não foi possível salvar: confira se as regras novas do Firestore foram publicadas.'
        : 'Não foi possível enviar agora. Verifique sua conexão e tente de novo.');
    } finally {
      this.salvando.set(false);
    }
  }

  voltar() {
    this.router.navigate(['/perfil']);
  }
}
