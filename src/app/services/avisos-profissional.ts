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
