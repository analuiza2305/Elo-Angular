import { Component, ElementRef, Input, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { AlertaService } from '../../core/services/alerta.service';

type TipoAlvo = 'post' | 'artigo' | 'evento';

/**
 * Botão + janelinha "Denunciar".
 * Serve para post do fórum, artigo e evento. A denúncia é gravada em `denunciasConteudo`
 * (o admin escuta essa coleção em tempo real e recebe aviso na hora) e, se as regras
 * do Firestore permitirem, também soma 1 no contador `moderacao.denuncias` do conteúdo.
 *
 * Uso: <app-denunciar tipo="post" [alvoId]="post.id" [alvoTitulo]="post.titulo" [alvoDono]="post.autorNomeFinal" />
 */
@Component({
  selector: 'app-denunciar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './denunciar.html',
  styleUrls: ['./denunciar.css']
})
export class DenunciarComponent implements OnDestroy {
  /** <dialog> nativo: fica na "camada superior" do navegador, por cima de tudo, mesmo dentro de cards com hover/transform. */
  @ViewChild('caixa') private caixa?: ElementRef<HTMLDialogElement>;
  private readonly alerta = inject(AlertaService);

  @Input({ required: true }) tipo!: TipoAlvo;
  @Input({ required: true }) alvoId!: string;
  @Input() alvoTitulo = '';
  @Input() alvoDono = '';
  @Input() rotulo = 'Denunciar';

  aberto = signal(false);
  enviando = signal(false);
  enviada = signal(false);
  erro = signal('');

  motivo = '';
  detalhes = '';

  readonly motivos = [
    'Conteúdo ofensivo ou discurso de ódio',
    'Spam ou divulgação indevida',
    'Informação falsa ou perigosa',
    'Assédio ou ameaça',
    'Golpe ou fraude',
    'Outro motivo'
  ];

  get nomeTipo(): string {
    return this.tipo === 'post' ? 'post' : this.tipo === 'artigo' ? 'artigo' : 'evento';
  }

  abrir(evento: Event): void {
    evento.stopPropagation();
    evento.preventDefault();
    this.motivo = '';
    this.detalhes = '';
    this.erro.set('');
    this.enviada.set(false);
    this.aberto.set(true);
    const dialogo = this.caixa?.nativeElement;
    if (dialogo && !dialogo.open) dialogo.showModal();
  }

  fechar(): void {
    if (this.enviando()) return;
    this.caixa?.nativeElement.close();
    this.aberto.set(false);
  }

  /** Clique fora da caixa (no fundo escuro) fecha; clique dentro não vaza para o card do post. */
  aoClicarNoDialogo(evento: MouseEvent): void {
    evento.stopPropagation();
    if (evento.target === this.caixa?.nativeElement) this.fechar();
  }

  /** Tecla Esc */
  aoCancelar(evento: Event): void {
    evento.preventDefault();
    this.fechar();
  }

  ngOnDestroy(): void {
    const dialogo = this.caixa?.nativeElement;
    if (dialogo?.open) dialogo.close();
  }

  async enviar(): Promise<void> {
    const usuario = auth.currentUser;
    if (!usuario) {
      this.erro.set('Entre na sua conta para fazer uma denúncia.');
      return;
    }
    if (!this.motivo) {
      this.erro.set('Escolha o motivo da denúncia.');
      return;
    }

    this.enviando.set(true);
    this.erro.set('');
    try {
      // 1 denúncia por pessoa para cada conteúdo (id fixo evita repetição).
      const ref = doc(db, 'denunciasConteudo', `${this.tipo}_${this.alvoId}_${usuario.uid}`);
      if ((await getDoc(ref)).exists()) {
        // Mesmo aviso padrão do resto da plataforma (AlertaService)
        this.enviando.set(false);
        this.fechar();
        this.alerta.info('Você já denunciou este conteúdo. Nossa equipe de moderação já foi avisada e vai analisar.', 'Denúncia já registrada');
        return;
      }

      let nome = usuario.displayName || 'Usuária';
      try {
        const perfil = await getDoc(doc(db, 'usuarios', usuario.uid));
        if (perfil.exists()) nome = (perfil.data() as any)['nome'] || nome;
      } catch { /* segue com o nome do login */ }

      await setDoc(ref, {
        tipo: this.tipo,
        alvoId: this.alvoId,
        alvoTitulo: (this.alvoTitulo || '').slice(0, 140),
        alvoDono: this.alvoDono || '',
        motivo: this.motivo,
        detalhes: this.detalhes.trim(),
        denuncianteId: usuario.uid,
        denuncianteNome: nome,
        status: 'aberta',
        criadoEm: serverTimestamp()
      });

      // Contador usado pelas telas de moderação (melhor esforço: não impede a denúncia se falhar).
      const colecao = this.tipo === 'post' ? 'posts' : this.tipo === 'artigo' ? 'artigos' : 'eventos';
      try {
        await updateDoc(doc(db, colecao, this.alvoId), {
          'moderacao.denuncias': increment(1),
          'moderacao.motivoDenuncia': this.motivo
        });
      } catch (e) {
        console.warn('Contador de denúncias não atualizado (regras do Firestore?):', e);
      }

      this.enviando.set(false);
      this.fechar();
      this.alerta.sucesso(
        'Obrigada por cuidar da nossa comunidade. A equipe de moderação já foi avisada e vai analisar. Quem denuncia não aparece para quem foi denunciado.',
        'Denúncia enviada'
      );
    } catch (e) {
      console.error('Erro ao enviar denúncia:', e);
      this.erro.set('Não foi possível enviar agora. Tente novamente em instantes.');
    } finally {
      this.enviando.set(false);
    }
  }
}
