import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../core/firebase';

/**
 * Depois que a mãe marca consulta com uma psicóloga, libera para ela o questionário
 * de bem-estar (questionarios/{maeId}.psicologos). Se a mãe ainda não respondeu,
 * não faz nada: quando responder, a lista é montada a partir das consultas.
 */
export async function liberarQuestionarioPara(maeId: string, psicologaId: string, tipo: string): Promise<void> {
  if (!maeId || !psicologaId || (tipo && tipo !== 'psicologo')) return;
  try {
    await updateDoc(doc(db, 'questionarios', maeId), { psicologos: arrayUnion(psicologaId) });
  } catch {
    /* ainda não respondeu (documento não existe): nada a fazer */
  }
}
