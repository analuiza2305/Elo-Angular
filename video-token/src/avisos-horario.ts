/**
 * "Avise-me quando houver horário".
 *
 * A mãe clica no botão da lista de profissionais e o app grava
 * avisosHorario/{profissionalUid}_{maeUid}. A cada 10 minutos (mesmo cron dos lembretes)
 * este código confere se o profissional abriu algum horário futuro. Se abriu:
 *   1. manda um e-mail para a mãe (Mailjet);
 *   2. cria a notificação no sino dela (coleção notificacoes);
 *   3. apaga o pedido, para não avisar duas vezes.
 * Pedidos com mais de 60 dias são apagados sem aviso.
 */
import { Firestore } from './google';
import { EnvLembretes, enviarMailjet, escapar, perfil, primeiroNome } from './lembretes';

const DIA = 24 * 60 * 60 * 1000;
const VALIDADE = 60 * DIA;
const CHAMADAS_POR_AVISO = 5; // ler mãe + ler profissional + notificação + apagar + parte do e-mail

export interface ResumoAvisos {
  pedidos: number;
  avisadas: number;
  expirados: number;
  erros: string[];
  detalhes: string[];
}

/**
 * chamadasLivres: quantas chamadas externas ainda cabem nesta execução
 * (o plano gratuito da Cloudflare permite 50 por execução, e os lembretes usam parte delas).
 */
export async function verificarAvisosDeHorario(
  env: EnvLembretes,
  db: Firestore,
  chamadasLivres: number,
  agora = Date.now(),
  simular = false
): Promise<ResumoAvisos> {
  const r: ResumoAvisos = { pedidos: 0, avisadas: 0, expirados: 0, erros: [], detalhes: [] };
  const maximo = Math.max(0, Math.min(8, Math.floor((chamadasLivres - 2) / CHAMADAS_POR_AVISO)));
  if (maximo === 0) {
    r.detalhes.push('Avisos de horário: sem espaço nesta rodada (muitos lembretes); ficam para a próxima.');
    return r;
  }

  const pedidos = await db.consultar({ from: [{ collectionId: 'avisosHorario' }], limit: 40 });
  r.pedidos = pedidos.length;
  if (!pedidos.length) {
    r.detalhes.push('Avisos de horário: nenhum pedido esperando.');
    return r;
  }

  const cache = new Map<string, Record<string, any> | null>();
  const app = (env.APP_URL || 'http://localhost:4200').replace(/\/$/, '');
  const mensagens: any[] = [];
  const concluir: { id: string; notificacao: Record<string, any> | null }[] = [];

  for (const p of pedidos) {
    if (concluir.length >= maximo) break;
    const d = p.dados;
    try {
      const criadoEm = d['criadoEm'] ? new Date(d['criadoEm']).getTime() : agora;
      if (agora - criadoEm > VALIDADE) {
        r.expirados++;
        r.detalhes.push(`Pedido ${p.id}: tem mais de 60 dias, será apagado.`);
        concluir.push({ id: p.id, notificacao: null });
        continue;
      }

      const ehAdv = d['tipoProfissional'] === 'advogado';
      const colecao = ehAdv ? 'advogados' : 'psicologos';
      const prof = d['profDocId']
        ? await perfil(db, cache, colecao, String(d['profDocId']))
        : await perfil(db, cache, colecao, String(d['profissionalId']));
      if (!prof) {
        r.detalhes.push(`Pedido ${p.id}: profissional não encontrado em ${colecao}.`);
        continue;
      }

      const horarios: Date[] = (Array.isArray(prof['disponibilidade']) ? prof['disponibilidade'] : [])
        .map((t: any) => new Date(t))
        .filter((t: Date) => !isNaN(t.getTime()) && t.getTime() > agora)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime());

      if (!horarios.length) {
        r.detalhes.push(`Pedido ${p.id}: ${prof['nome'] || 'profissional'} ainda sem horário.`);
        continue;
      }

      const mae = await perfil(db, cache, 'usuarios', String(d['maeId']));
      const nomeProf = String(prof['nome'] || (ehAdv ? 'A advogada' : 'A psicóloga'));
      const primeiro = horarios[0];
      const quando =
        primeiro.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' }) +
        ' às ' + primeiro.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      const total = horarios.length;

      if (mae?.['email']) {
        mensagens.push(montarEmailHorario(env, {
          para: String(mae['email']),
          nomePara: String(mae['nome'] || ''),
          saudacao: primeiroNome(mae['nome']) || 'mamãe',
          nomeProf,
          quando,
          total,
          link: `${app}/consultas-lista-psi`,
        }));
      } else {
        r.detalhes.push(`Pedido ${p.id}: a mãe não tem e-mail no cadastro, vai só a notificação do sino.`);
      }

      concluir.push({
        id: p.id,
        notificacao: {
          destinatarioId: String(d['maeId']),
          tipo: 'horario_disponivel',
          titulo: 'Abriu horário!',
          mensagem: `${nomeProf} abriu ${total === 1 ? '1 horário' : total + ' horários'}. O primeiro é ${quando}.`,
          link: '/consultas-lista-psi',
          lida: false,
          criadoEm: new Date(agora),
        },
      });
      r.detalhes.push(`Pedido ${p.id}: ${nomeProf} tem ${total} horário(s); avisando a mãe ${d['maeId']}.`);
    } catch (e: any) {
      r.erros.push(`${p.id}: ${e?.message || e}`);
    }
  }

  if (simular) return r;

  // E-mails primeiro, numa chamada só; se o Mailjet falhar, os pedidos ficam para a próxima rodada
  if (mensagens.length) {
    try {
      await enviarMailjet(env, mensagens);
    } catch (e: any) {
      r.erros.push(`E-mail dos avisos de horário: ${e?.message || e}`);
      return r;
    }
  }

  for (const c of concluir) {
    try {
      if (c.notificacao) {
        await db.criar('notificacoes', c.notificacao);
        r.avisadas++;
      }
      await db.apagar(`avisosHorario/${c.id}`);
    } catch (e: any) {
      r.erros.push(`${c.id}: ${e?.message || e}`);
    }
  }
  return r;
}

function montarEmailHorario(env: EnvLembretes, o: {
  para: string; nomePara: string; saudacao: string; nomeProf: string; quando: string; total: number; link: string;
}) {
  const assunto = `${o.nomeProf} abriu horário no EloMaterno`;
  const linhaTotal = o.total === 1 ? 'Há 1 horário livre' : `Há ${o.total} horários livres`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#F6F2FF;font-family:Arial,Helvetica,sans-serif;color:#2D1E4E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F2FF;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #EEE8FA">
<tr><td style="padding:22px 28px;border-bottom:1px solid #EEE8FA;font-size:20px;font-weight:bold;color:#4B2C82">elomaterno</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 14px;font-size:17px">Olá, ${escapar(o.saudacao)}!</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55">Você pediu para avisar, e chegou a hora: <strong>${escapar(o.nomeProf)}</strong> abriu horários na agenda.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F4ECFF;border-radius:12px;margin:0 0 18px"><tr><td style="padding:14px 18px;font-size:15px;line-height:1.6">
<span style="color:#7B6AAE;font-size:12px;font-weight:bold;letter-spacing:.04em">PRIMEIRO HORÁRIO</span><br>
<strong>${escapar(o.quando)}</strong><br>
<span style="color:#5C5478;font-size:13px">${linhaTotal} agora.</span>
</td></tr></table>
<p style="margin:0 0 22px;font-size:14px;line-height:1.55;color:#5C5478">Os horários são de quem agenda primeiro, então vale garantir o seu.</p>
<a href="${escapar(o.link)}" style="display:inline-block;background:#5B3D99;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:12px">Agendar agora</a>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #EEE8FA;font-size:12px;color:#8A82A6">Você recebeu este e-mail porque clicou em "Avise-me quando houver horário" no EloMaterno. O aviso é enviado uma vez só.</td></tr>
</table></td></tr></table></body></html>`;
  const texto = `Olá, ${o.saudacao}!\n\n${o.nomeProf} abriu horários na agenda.\nPrimeiro horário: ${o.quando}. ${linhaTotal} agora.\n\nAgendar: ${o.link}`;
  return {
    From: { Email: env.MAILJET_FROM_EMAIL, Name: env.MAILJET_FROM_NAME || 'EloMaterno' },
    To: [{ Email: o.para, Name: o.nomePara }],
    Subject: assunto,
    TextPart: texto,
    HTMLPart: html,
  };
}
