
import { Injectable } from '@angular/core';

import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';

import { db } from '../core/firebase';

export interface AmostraErro {
  navegador: string;
  pagina: string;
  stack: string;
}

export interface ErroMonitorado {
  id?: string;
  tipo: string;
  mensagem: string;
  pagina: string;
  navegador: string;
  stack?: string;

  ocorrencias: number;
  primeiraOcorrencia?: unknown;
  ultimaOcorrencia?: unknown;
  data?: unknown;

  amostras?: AmostraErro[];
}

@Injectable({
  providedIn: 'root'
})
export class ErrorMonitorService {

  private readonly colecao = 'erros';

  /**
   * Registra ou atualiza um erro.
   * Erros iguais são agrupados no mesmo documento.
   */
  async registrarErro(
    erro: Omit<
      ErroMonitorado,
      | 'id'
      | 'ocorrencias'
      | 'primeiraOcorrencia'
      | 'ultimaOcorrencia'
      | 'data'
      | 'amostras'
    >
  ): Promise<void> {

    const idErro = this.gerarIdErro(erro);

    const referencia = doc(db, this.colecao, idErro);

    const novaAmostra: AmostraErro = {
      navegador: erro.navegador,
      pagina: erro.pagina,
      stack: erro.stack || ''
    };

    await runTransaction(db, async (transacao) => {

      const documento = await transacao.get(referencia);

      if (!documento.exists()) {

        transacao.set(referencia, {
          tipo: erro.tipo,
          mensagem: erro.mensagem,
          pagina: erro.pagina,
          navegador: erro.navegador,
          stack: erro.stack || '',

          ocorrencias: 1,

          primeiraOcorrencia: serverTimestamp(),
          ultimaOcorrencia: serverTimestamp(),
          data: serverTimestamp(),

          amostras: [novaAmostra]
        });

      } else {

        const dados = documento.data();

        const amostrasAtuais: AmostraErro[] =
          Array.isArray(dados['amostras'])
            ? dados['amostras']
            : [];

        const novasAmostras =
          amostrasAtuais.length < 3
            ? [...amostrasAtuais, novaAmostra]
            : amostrasAtuais;

        transacao.update(referencia, {

          ocorrencias: increment(1),

          ultimaOcorrencia: serverTimestamp(),
          data: serverTimestamp(),

          amostras: novasAmostras

        });

      }

    });

  }

  /**
   * Lista os últimos 200 registros agrupados.
   */
  async listarErros(): Promise<ErroMonitorado[]> {

    const referencia = collection(db, this.colecao);

    const consulta = query(
      referencia,
      orderBy('data', 'desc'),
      limit(200)
    );

    const resultado = await getDocs(consulta);

    return resultado.docs.map((documento) => {

      const dados = documento.data();

      return {
        id: documento.id,
        ...dados,

        ocorrencias: Number(dados['ocorrencias'] ?? 1),

        amostras: Array.isArray(dados['amostras'])
          ? dados['amostras']
          : []

      } as ErroMonitorado;

    });

  }

  /**
   * Gera um identificador estável para agrupar erros iguais.
   */
  private gerarIdErro(
    erro: Pick<ErroMonitorado, 'tipo' | 'mensagem' | 'pagina'>
  ): string {

    const assinatura = [
      erro.tipo.trim().toLowerCase(),
      erro.mensagem.trim().replace(/\s+/g, ' ').toLowerCase(),
      erro.pagina.trim().toLowerCase()
    ].join('|');

    let hash1 = 2166136261;
    let hash2 = 5381;

    for (let i = 0; i < assinatura.length; i++) {

      const codigo = assinatura.charCodeAt(i);

      hash1 = Math.imul(hash1 ^ codigo, 16777619);
      hash2 = Math.imul(hash2, 33) ^ codigo;

    }

    return `erro_${(hash1 >>> 0).toString(36)}_${(hash2 >>> 0).toString(36)}`;

  }

}
