/**
 * Questionário de bem-estar respondido pela mãe antes da consulta com o psicólogo.
 *
 * É um acolhimento inicial, NÃO é um teste diagnóstico: as perguntas só ajudam
 * o(a) psicólogo(a) a chegar na primeira conversa sabendo como a mãe está.
 * As mesmas definições são usadas na tela da mãe e na visualização do psicólogo.
 */

export interface Opcao { valor: string; rotulo: string; }

export interface PerguntaBemEstar {
  id: keyof RespostasBemEstar;
  titulo: string;
  curta: string;            // nome curto (lista de faltando / resumo do psicólogo)
  tipo: 'escala' | 'unica' | 'multipla' | 'texto';
  opcoes?: Opcao[];
  obrigatoria: boolean;
  ajuda?: string;
}

export interface RespostasBemEstar {
  fase: string;
  humor: string;
  sono: string;
  sobrecarga: string;
  apoio: string;
  preocupacoes: string[];
  pensamentos: string;
  expectativa: string;
}

export const RESPOSTAS_VAZIAS: RespostasBemEstar = {
  fase: '', humor: '', sono: '', sobrecarga: '', apoio: '', preocupacoes: [], pensamentos: '', expectativa: '',
};

export const PERGUNTAS_BEM_ESTAR: PerguntaBemEstar[] = [
  {
    id: 'fase', titulo: 'Em que fase da maternidade você está?', curta: 'Fase', tipo: 'unica', obrigatoria: true,
    opcoes: [
      { valor: 'gestante', rotulo: 'Gestante' },
      { valor: 'bebe', rotulo: 'Bebê de até 1 ano' },
      { valor: 'pequena', rotulo: 'Criança de 1 a 5 anos' },
      { valor: 'maior', rotulo: 'Criança maior' },
    ],
  },
  {
    id: 'humor', titulo: 'Como você tem se sentido nas últimas duas semanas?', curta: 'Como tem se sentido', tipo: 'escala', obrigatoria: true,
    opcoes: [
      { valor: '1', rotulo: 'Muito mal' },
      { valor: '2', rotulo: 'Mal' },
      { valor: '3', rotulo: 'Mais ou menos' },
      { valor: '4', rotulo: 'Bem' },
      { valor: '5', rotulo: 'Muito bem' },
    ],
  },
  {
    id: 'sono', titulo: 'E o seu sono, como está?', curta: 'Sono', tipo: 'escala', obrigatoria: true,
    opcoes: [
      { valor: '1', rotulo: 'Muito ruim' },
      { valor: '2', rotulo: 'Ruim' },
      { valor: '3', rotulo: 'Regular' },
      { valor: '4', rotulo: 'Bom' },
      { valor: '5', rotulo: 'Muito bom' },
    ],
  },
  {
    id: 'sobrecarga', titulo: 'Você se sente sobrecarregada com as tarefas do dia a dia?', curta: 'Sobrecarga', tipo: 'unica', obrigatoria: true,
    opcoes: [
      { valor: 'nunca', rotulo: 'Quase nunca' },
      { valor: 'as-vezes', rotulo: 'Às vezes' },
      { valor: 'frequente', rotulo: 'Com frequência' },
      { valor: 'sempre', rotulo: 'Quase sempre' },
    ],
  },
  {
    id: 'apoio', titulo: 'Você tem com quem contar no dia a dia?', curta: 'Rede de apoio', tipo: 'unica', obrigatoria: true,
    opcoes: [
      { valor: 'bastante', rotulo: 'Sim, tenho bastante apoio' },
      { valor: 'pouco', rotulo: 'Tenho pouco apoio' },
      { valor: 'nenhum', rotulo: 'Não tenho apoio' },
    ],
  },
  {
    id: 'preocupacoes', titulo: 'O que mais tem te preocupado?', curta: 'Preocupações', tipo: 'multipla', obrigatoria: true,
    ajuda: 'Pode marcar mais de uma.',
    opcoes: [
      { valor: 'cansaco', rotulo: 'Cansaço' },
      { valor: 'ansiedade', rotulo: 'Ansiedade' },
      { valor: 'tristeza', rotulo: 'Tristeza' },
      { valor: 'solidao', rotulo: 'Solidão' },
      { valor: 'relacionamento', rotulo: 'Relacionamento' },
      { valor: 'trabalho', rotulo: 'Trabalho ou dinheiro' },
      { valor: 'bebe', rotulo: 'Cuidados com o bebê' },
      { valor: 'amamentacao', rotulo: 'Amamentação' },
      { valor: 'autoestima', rotulo: 'Autoestima' },
      { valor: 'outro', rotulo: 'Outro assunto' },
    ],
  },
  {
    id: 'pensamentos', titulo: 'Nas últimas duas semanas, você teve pensamentos de se machucar ou de que seria melhor não estar aqui?',
    curta: 'Pensamentos de se machucar', tipo: 'unica', obrigatoria: true,
    ajuda: 'Essa pergunta ajuda o(a) psicólogo(a) a cuidar melhor de você. Não existe resposta certa.',
    opcoes: [
      { valor: 'nao', rotulo: 'Não' },
      { valor: 'as-vezes', rotulo: 'Sim, às vezes' },
      { valor: 'frequente', rotulo: 'Sim, com frequência' },
      { valor: 'prefiro-nao', rotulo: 'Prefiro não responder' },
    ],
  },
  {
    id: 'expectativa', titulo: 'Sobre o que você gostaria de conversar na consulta?', curta: 'O que quer conversar', tipo: 'texto', obrigatoria: false,
    ajuda: 'Opcional. Escreva do seu jeito.',
  },
];

/** "Sim" na pergunta sobre pensamentos de se machucar. */
export function respostaDeRisco(r: Partial<RespostasBemEstar>): boolean {
  return r.pensamentos === 'as-vezes' || r.pensamentos === 'frequente';
}

/** Destaque para o psicólogo: risco, humor muito baixo ou nenhum apoio. */
export function precisaAtencao(r: Partial<RespostasBemEstar>): boolean {
  return respostaDeRisco(r) || r.humor === '1' || r.apoio === 'nenhum';
}

/** Texto da opção escolhida (para o resumo do psicólogo). */
export function rotuloDaResposta(p: PerguntaBemEstar, valor: string | string[] | undefined): string {
  if (p.tipo === 'texto') return (valor as string)?.trim() || '—';
  if (Array.isArray(valor)) {
    return valor.map((v) => p.opcoes?.find((o) => o.valor === v)?.rotulo || v).join(', ') || '—';
  }
  return p.opcoes?.find((o) => o.valor === valor)?.rotulo || '—';
}
