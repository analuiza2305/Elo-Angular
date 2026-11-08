import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../core/firebase';

/**
 * Avisos para o PROFISSIONAL (psicóloga ou advogada) na coleção `notificacoes`,
 * no mesmo formato que a mãe já recebe. Aparecem no sino do painel dele(a).
 * Falhar aqui nunca atrapalha o agendamento ou o cancelamento.
 */
export interface AvisoProfissional {
  evento: 'nova' | 'cancelada';
  profissionalId: string;
  tipoProf: 'psicologo' | 'advogado' | string;
  maeId: string;
  consultaId: string;
  quando: Date | null;
  motivo?: string;
}

async function nomeDaMae(maeId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'usuarios', maeId));
    const nome = snap.exists() ? String(snap.data()['nome'] || '').trim() : '';
    return nome ? nome.split(' ')[0] : 'Uma mãe';
  } catch {
    return 'Uma mãe';
  }
}

export async function avisarProfissional(a: AvisoProfissional): Promise<void> {
  if (!a.profissionalId) return;
  try {
    const nome = await nomeDaMae(a.maeId);
    const quando = a.quando
      ? a.quando.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) + ' às '
        + a.quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : 'a data combinada';
    const motivo = (a.motivo || '').trim().slice(0, 300);

    await addDoc(collection(db, 'notificacoes'), {
      destinatarioId: a.profissionalId,
      tipo: a.evento === 'nova' ? 'consulta_nova' : 'consulta_cancelada_mae',
      titulo: a.evento === 'nova' ? 'Novo pedido de consulta' : 'Uma consulta foi cancelada',
      mensagem: a.evento === 'nova'
        ? `${nome} pediu uma consulta para ${quando}. Confira em Consultas para aceitar ou recusar.`
        : `${nome} cancelou a consulta de ${quando}.${motivo ? ' Motivo: ' + motivo : ''}`,
      consultaId: a.consultaId,
      link: a.tipoProf === 'advogado' ? '/home-adv' : '/home-psi',
      lida: false,
      criadoEm: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Aviso para o profissional não gravado:', e);
  }
}

/**
 * Aviso de mensagem nova no chat (para a mãe ou para o profissional).
 * Para não lotar o sino, só avisa na PRIMEIRA mensagem de uma sequência:
 * se quem está mandando já mandou a última mensagem há menos de 10 minutos, não avisa de novo.
 * Chame ANTES de gravar a mensagem, passando o resumo que o chat tinha até então.
 */
export interface AvisoChat {
  chatId: string;
  remetenteId: string;
  remetenteNome?: string;          // se vazio, busca o primeiro nome em usuarios/{uid}
  destinatarioId: string;
  texto: string;
  link: string | null;             // para onde o sino leva (ex.: '/chat?uid=...')
  ultimoEnviadoPor?: string;       // do documento do chat, antes desta mensagem
  ultimaAtualizacao?: Date | null;
}

export async function avisarMensagemChat(a: AvisoChat): Promise<void> {
  if (!a.destinatarioId || a.destinatarioId === a.remetenteId) return;
  const sequencia = a.ultimoEnviadoPor === a.remetenteId
    && !!a.ultimaAtualizacao && Date.now() - a.ultimaAtualizacao.getTime() < 10 * 60000;
  if (sequencia) return;
  try {
    const nome = (a.remetenteNome || '').trim() || await nomeDaMae(a.remetenteId);
    const previa = a.texto.trim() ? a.texto.trim().slice(0, 120) + (a.texto.trim().length > 120 ? '…' : '') : 'Mensagem de áudio';
    await addDoc(collection(db, 'notificacoes'), {
      destinatarioId: a.destinatarioId,
      remetenteId: a.remetenteId,
      tipo: 'chat_mensagem',
      titulo: `Nova mensagem de ${nome}`,
      mensagem: previa,
      chatId: a.chatId,
      link: a.link,
      lida: false,
      criadoEm: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Aviso de mensagem não gravado:', e);
  }
}
