import { Injectable, signal } from '@angular/core';

export type AlertaTipo = 'sucesso' | 'erro' | 'aviso' | 'info' | 'confirmar' | 'entrada';

export interface AlertaOpcoes {
  titulo?: string;
  mensagem: string;
  /** Texto do botão principal. */
  textoOk?: string;
  /** Texto do botão secundário (confirmar / entrada). */
  textoCancelar?: string;
  /** Pinta o botão principal de vermelho (ações destrutivas). */
  perigo?: boolean;
  /** Placeholder do campo de texto (entrada). */
  placeholder?: string;
  valorInicial?: string;
}

export interface AlertaAtivo extends AlertaOpcoes {
  tipo: AlertaTipo;
  resolver: (valor: boolean | string | null) => void;
}

const TITULOS: Record<AlertaTipo, string> = {
  sucesso: 'Tudo certo!',
  erro: 'Algo deu errado',
  aviso: 'Atenção',
  info: 'Aviso',
  confirmar: 'Tem certeza?',
  entrada: 'Informe o valor',
};

/**
 * Substitui os `alert()`, `confirm()` e `prompt()` nativos do navegador
 * por um modal com a identidade visual do Elo Materno.
 *
 * O modal em si é o `<app-alerta>` montado uma única vez no `app.html`;
 * aqui fica só a fila de avisos. Todos os métodos retornam Promise, então
 * a página pode usar `await` quando precisar esperar a resposta:
 *
 *   this.alerta.sucesso('Consulta agendada!');
 *   if (!(await this.alerta.confirmar('Deseja sair?'))) return;
 *   const url = await this.alerta.solicitar('Cole a URL da foto:');
 */
@Injectable({ providedIn: 'root' })
export class AlertaService {
  private readonly fila: AlertaAtivo[] = [];
  readonly atual = signal<AlertaAtivo | null>(null);

  sucesso(mensagem: string, titulo?: string): Promise<void> {
    return this.abrir('sucesso', { mensagem, titulo }).then(() => undefined);
  }

  erro(mensagem: string, titulo?: string): Promise<void> {
    return this.abrir('erro', { mensagem, titulo }).then(() => undefined);
  }

  aviso(mensagem: string, titulo?: string): Promise<void> {
    return this.abrir('aviso', { mensagem, titulo }).then(() => undefined);
  }

  info(mensagem: string, titulo?: string): Promise<void> {
    return this.abrir('info', { mensagem, titulo }).then(() => undefined);
  }

  confirmar(mensagem: string, opcoes: Omit<AlertaOpcoes, 'mensagem'> = {}): Promise<boolean> {
    return this.abrir('confirmar', { mensagem, ...opcoes }).then((v) => v === true);
  }

  solicitar(mensagem: string, opcoes: Omit<AlertaOpcoes, 'mensagem'> = {}): Promise<string | null> {
    return this.abrir('entrada', { mensagem, ...opcoes }).then((v) =>
      typeof v === 'string' ? v : null,
    );
  }

  /** Chamado pelo componente quando o usuário responde. */
  responder(valor: boolean | string | null): void {
    const ativo = this.atual();
    if (!ativo) return;
    ativo.resolver(valor);
    this.atual.set(this.fila.shift() ?? null);
  }

  private abrir(tipo: AlertaTipo, opcoes: AlertaOpcoes): Promise<boolean | string | null> {
    return new Promise((resolver) => {
      const alerta: AlertaAtivo = {
        ...opcoes,
        titulo: opcoes.titulo ?? TITULOS[tipo],
        tipo,
        resolver,
      };
      if (this.atual()) this.fila.push(alerta);
      else this.atual.set(alerta);
    });
  }
}
