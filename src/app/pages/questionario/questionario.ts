import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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
 * Questionário de bem-estar que a mãe responde antes da consulta com o psicólogo.
 * Fica em questionarios/{consultaId} e só a mãe e o psicólogo da consulta conseguem ler.
 * Rota: /questionario?id=ID_DA_CONSULTA
 */
@Component({
  selector: 'app-questionario',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HeaderComponent],
  templateUrl: './questionario.html',
  styleUrl: './questionario.css',
})
export class QuestionarioComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private alerta = inject(AlertaService);

  readonly perguntas = PERGUNTAS_BEM_ESTAR;

  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly bloqueio = signal('');
  readonly enviado = signal(false);
  readonly jaRespondido = signal(false);

  readonly nomeProfissional = signal('seu psicólogo(a)');
  readonly dataConsulta = signal('');
  readonly respostas = signal<RespostasBemEstar>({ ...RESPOSTAS_VAZIAS, preocupacoes: [] });
  readonly consentimento = signal(false);

  private consultaId = '';
  private uid = '';
  private profissionalId = '';

  /** Mostra o quadro de apoio assim que a mãe marca a resposta de risco. */
  readonly mostrarApoio = computed(() => respostaDeRisco(this.respostas()));

  /** Quantas perguntas obrigatórias já têm resposta (barra de progresso). */
  readonly progresso = computed(() => {
    const r = this.respostas() as any;
    const obrigatorias = this.perguntas.filter((p) => p.obrigatoria);
    const feitas = obrigatorias.filter((p) => (Array.isArray(r[p.id]) ? r[p.id].length > 0 : !!r[p.id])).length;
    return Math.round((feitas / obrigatorias.length) * 100);
  });

  ngOnInit(): void {
    this.consultaId = this.route.snapshot.queryParamMap.get('id') || '';
    onAuthStateChanged(auth, async (user) => {
      if (!user) { this.router.navigate(['/login']); return; }
      this.uid = user.uid;
      await this.carregar();
    });
  }

  private async carregar() {
    this.carregando.set(true);
    try {
      if (!this.consultaId) { this.bloqueio.set('Link do questionário inválido.'); return; }

      const snap = await getDoc(doc(db, 'Consultas', this.consultaId));
      if (!snap.exists()) { this.bloqueio.set('Consulta não encontrada.'); return; }
      const c: any = snap.data();

      if ((c.maeId || c.Mae) !== this.uid) { this.bloqueio.set('Este questionário é de outra conta.'); return; }
      if (c.tipoProfissional && c.tipoProfissional !== 'psicologo') {
        this.bloqueio.set('O questionário de bem-estar é só para consultas com psicólogo(a).');
        return;
      }
      const status = String(c.status || '').toLowerCase();
      if (!['pendente', 'aceito', 'aceita', 'agendada'].includes(status)) {
        this.bloqueio.set('Esta consulta já aconteceu ou foi cancelada, então o questionário não pode mais ser enviado.');
        return;
      }

      this.profissionalId = c.profissionalId;
      const data: Date | null = c.Datahora?.toDate ? c.Datahora.toDate() : c.Datahora ? new Date(c.Datahora) : null;
      if (data) {
        this.dataConsulta.set(
          data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) +
          ' às ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        );
      }
      this.buscarNomeProfissional(c.profissionalId);

      // Já respondeu antes? Carrega para ela poder revisar.
      const existente = await getDoc(doc(db, 'questionarios', this.consultaId));
      if (existente.exists()) {
        const q: any = existente.data();
        this.respostas.set({ ...RESPOSTAS_VAZIAS, ...(q.respostas || {}), preocupacoes: q.respostas?.preocupacoes || [] });
        this.consentimento.set(true);
        this.jaRespondido.set(true);
        this.passo.set(this.perguntas.length); // já respondeu: abre direto na revisão
      }
    } catch (e) {
      console.error('Erro ao carregar o questionário:', e);
      this.bloqueio.set('Não foi possível abrir o questionário agora. Tente de novo em instantes.');
    } finally {
      this.carregando.set(false);
    }
  }

  private async buscarNomeProfissional(id: string) {
    try {
      const s = await getDoc(doc(db, 'psicologos', id));
      if (s.exists() && s.data()['nome']) this.nomeProfissional.set(String(s.data()['nome']));
    } catch { /* fica o texto padrão */ }
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

  async enviar() {
    if (this.salvando()) return;
    const r = this.respostas() as any;
    const faltando = this.perguntas.filter((p) => p.obrigatoria && (Array.isArray(r[p.id]) ? !r[p.id].length : !r[p.id]));
    if (faltando.length) {
      this.alerta.aviso(`Falta responder: ${faltando.map((p) => p.curta).join(', ')}.`);
      return;
    }
    if (!this.consentimento()) {
      this.alerta.aviso('Para enviar, marque que autoriza o(a) psicólogo(a) desta consulta a ver suas respostas.');
      return;
    }

    this.salvando.set(true);
    try {
      const respostas: RespostasBemEstar = {
        ...this.respostas(),
        expectativa: String(this.respostas().expectativa || '').trim().slice(0, 500),
      };
      await setDoc(doc(db, 'questionarios', this.consultaId), {
        consultaId: this.consultaId,
        maeId: this.uid,
        profissionalId: this.profissionalId,
        respostas,
        atencao: precisaAtencao(respostas),
        consentimento: true,
        versao: 1,
        atualizadoEm: serverTimestamp(),
      });
      this.enviado.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      console.error('Erro ao enviar o questionário:', e);
      this.alerta.erro(e?.code === 'permission-denied'
        ? 'Não foi possível salvar: esta consulta não aceita mais o questionário.'
        : 'Não foi possível enviar agora. Verifique sua conexão e tente de novo.');
    } finally {
      this.salvando.set(false);
    }
  }

  voltar() {
    this.router.navigate(['/consultas']);
  }
}
