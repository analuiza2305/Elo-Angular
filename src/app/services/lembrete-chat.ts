/**
 * Dados do cartão "Lembrete" que o Worker posta no chat
 * (mensagens com tipo = 'lembrete' e enviadoPor = 'sistema').
 * Usado no chat da mãe e nos chats dos painéis do psicólogo e do advogado.
 */
export interface CartaoLembrete {
  horario: string;  // "16:00"
  sub: string;      // "Hoje · em 1 hora" / "Amanhã · seg, 02 nov"
  texto: string;
  consultaId: string | null;
}

export function cartaoDoLembrete(m: any): CartaoLembrete | null {
  if (m?.['tipo'] !== 'lembrete') return null;
  const inicio: Date | null = m['inicio']?.toDate ? m['inicio'].toDate() : m['inicio'] ? new Date(m['inicio']) : null;
  const umaHora = m['lembrete'] === '1h';
  let sub = umaHora ? 'Hoje · em 1 hora' : 'Amanhã';
  if (inicio && !umaHora) {
    sub += ' · ' + inicio.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
  }
  return {
    horario: inicio ? inicio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    sub,
    texto: String(m['texto'] || ''),
    consultaId: m['consultaId'] || null,
  };
}
