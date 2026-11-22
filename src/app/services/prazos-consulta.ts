import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../core/firebase';

/**
 * Regras de prazo das consultas (decididas na reunião de 21/11):
 * - o profissional tem até 2 dias (ou até o horário da consulta, o que vier antes) para confirmar;
 * - a consulta confirmada que ninguém abriu fecha sozinha 15 minutos depois do horário marcado,
 *   e a mãe pode marcar de novo.
 *
 * Quem abrir a tela primeiro (mãe ou profissional) faz o fechamento. Assim não precisa de servidor.
 */
export const DIAS_PARA_CONFIRMAR = 2;
export const MINUTOS_DE_TOLERANCIA = 15;

export type MotivoEncerramento = 'sem-confirmacao' | 'horario-passou';

const STATUS_ABERTOS = ['aceito', 'aceita', 'agendada'];

export function paraData(valor: any): Date | null {
  if (!valor) return null;
  const d = valor?.toDate ? valor.toDate() : new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/** Até quando o profissional pode confirmar uma consulta pendente. */
export function prazoConfirmacao(consulta: any): Date | null {
  const horario = paraData(consulta?.Datahora);
  const criada = paraData(consulta?.criadoEm);
  const limite = criada ? new Date(criada.getTime() + DIAS_PARA_CONFIRMAR * 24 * 60 * 60 * 1000) : null;
  if (horario && limite) return horario < limite ? horario : limite;
  return horario || limite;
}

/** Horário em que a consulta confirmada fecha sozinha se ninguém entrar. */
export function limiteParaEntrar(consulta: any): Date | null {
  const horario = paraData(consulta?.Datahora);
  return horario ? new Date(horario.getTime() + MINUTOS_DE_TOLERANCIA * 60 * 1000) : null;
}

/** Diz se a consulta já passou do prazo e deve ser fechada (ou null se ainda está valendo). */
export function motivoEncerramentoAutomatico(consulta: any, agora = Date.now()): MotivoEncerramento | null {
  const status = String(consulta?.status || '').toLowerCase();

  if (status === 'pendente') {
    const prazo = prazoConfirmacao(consulta);
    return prazo && agora > prazo.getTime() ? 'sem-confirmacao' : null;
  }

  if (STATUS_ABERTOS.includes(status)) {
    // Se alguém entrou na chamada, ela aconteceu (ou está acontecendo): não mexe.
    if (consulta?.profissionalEntrouEm || consulta?.maeEntrouEm) return null;
    const limite = limiteParaEntrar(consulta);
    return limite && agora > limite.getTime() ? 'horario-passou' : null;
  }

  return null;
}

export function textoEncerramento(motivo: MotivoEncerramento): string {
  return motivo === 'sem-confirmacao'
    ? `O profissional não confirmou dentro do prazo de ${DIAS_PARA_CONFIRMAR} dias.`
    : `Ninguém entrou na chamada até ${MINUTOS_DE_TOLERANCIA} minutos depois do horário marcado.`;
}

/** Fecha a consulta como cancelada pelo sistema. Falhar aqui não quebra a tela. */
export async function encerrarAutomaticamente(consultaId: string, motivo: MotivoEncerramento): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'Consultas', consultaId), {
      status: 'negado',
      canceladoPor: 'sistema',
      canceladoEm: serverTimestamp(),
      encerradaAutomaticamente: true,
      motivoEncerramento: motivo,
      motivoCancelamento: textoEncerramento(motivo),
    });
    return true;
  } catch (e) {
    console.warn('Não foi possível fechar a consulta automaticamente:', consultaId, e);
    return false;
  }
}
