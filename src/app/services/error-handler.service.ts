
import {
  ErrorHandler,
  Injectable,
  Injector,
  inject,
  PLATFORM_ID
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class GlobalErrorHandler implements ErrorHandler {

  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);

  handleError(error: unknown): void {

    console.error('[ERRO NA APLICAÇÃO]', error);

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    void this.registrarErro(error);

  }

  private async registrarErro(error: unknown): Promise<void> {

    try {

      // Carrega o serviço Firebase somente no navegador.
      const { ErrorMonitorService } =
        await import('./error-monitor.service');

      const monitor = this.injector.get(ErrorMonitorService);

      const detalhes = error instanceof Error ? error : null;

      const objeto = (
        typeof error === 'object' && error !== null
      ) ? error as {
        name?: unknown;
        message?: unknown;
        stack?: unknown;
      } : {};

      const tipo =
        detalhes?.name ||
        (typeof objeto.name === 'string'
          ? objeto.name
          : 'Erro não identificado');

      const mensagem =
        detalhes?.message ||
        (typeof objeto.message === 'string'
          ? objeto.message
          : this.converterErroEmTexto(error));

      const stack =
        detalhes?.stack ||
        (typeof objeto.stack === 'string'
          ? objeto.stack
          : '');

      await monitor.registrarErro({
        tipo,
        mensagem,
        pagina: window.location.pathname,
        navegador: navigator.userAgent,
        stack
      });

    } catch (falha) {

      console.error(
        '[MONITORAMENTO] Não foi possível registrar o erro:',
        falha
      );

    }

  }

  private converterErroEmTexto(error: unknown): string {

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error) || 'Erro sem mensagem disponível';
    } catch {
      return 'Erro sem mensagem disponível';
    }

  }

}
