/**
 * Modelos de documentos jurídicos — área do advogado.
 *
 * Cada modelo traz a estrutura do documento e uma orientação curta em cada
 * campo. O CONTEÚDO é escrito pelo(a) advogado(a): a plataforma só organiza,
 * numera as páginas e monta o PDF no navegador. Nada é salvo na plataforma.
 *
 * A Declaração de comparecimento é liberada para todos; os demais modelos
 * fazem parte do Premium.
 *
 * ATENÇÃO: são modelos de apoio. A base legal citada em cada um deve ser
 * conferida por um(a) advogado(a) antes de entrar em produção.
 */

export type IdModeloJuridico =
  | 'declaracao'
  | 'procuracao'
  | 'honorarios'
  | 'notificacao'
  | 'parecer'
  | 'consentimento';

export interface SecaoModeloJuridico {
  id: string;
  titulo: string;
  /** Orientação que aparece como placeholder do campo. */
  ajuda: string;
  /** Altura da caixa de texto. */
  linhas: number;
  obrigatoria: boolean;
}

export interface ModeloJuridico {
  id: IdModeloJuridico;
  nome: string;
  /** Base legal ou normativa que fundamenta o documento (mostrada no card e no PDF). */
  baseLegal: string;
  resumo: string;
  premium: boolean;
  /** Ícone do Font Awesome mostrado no card do modelo. */
  icone: string;
  /** Papel da pessoa atendida neste documento (Outorgante, Contratante...). */
  papelCliente: string;
  /** Se definido, aparece um segundo campo de pessoa (ex.: Notificado(a)). */
  rotuloSolicitante?: string;
  solicitanteObrigatorio?: boolean;
  /** Se definido, aparece o campo "finalidade" com este rótulo (obrigatório). */
  rotuloFinalidade?: string;
  /** O PDF sai com a linha de assinatura da pessoa atendida, além da do(a) advogado(a). */
  assinaturaCliente: boolean;
  secoes: SecaoModeloJuridico[];
}

export const MODELOS_JURIDICOS: ModeloJuridico[] = [
  {
    id: 'declaracao',
    icone: 'fa-regular fa-file-lines',
    nome: 'Declaração de comparecimento',
    baseLegal: 'Documento informativo · sigilo profissional (Lei 8.906/1994)',
    resumo: 'Informa o comparecimento a atendimento jurídico: dias, horários e duração. Não descreve o assunto tratado, que é sigiloso.',
    premium: false,
    papelCliente: 'Declarado(a)',
    rotuloSolicitante: 'Solicitante',
    rotuloFinalidade: 'Finalidade',
    assinaturaCliente: false,
    secoes: [
      {
        id: 'texto',
        titulo: 'Declaração',
        ajuda: 'Ex.: Declaro, para os devidos fins, que [nome] compareceu a atendimento jurídico on-line nos dias e horários abaixo. Não informe o assunto tratado.',
        linhas: 5,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'procuracao',
    icone: 'fa-solid fa-stamp',
    nome: 'Procuração',
    baseLegal: 'Lei 8.906/1994, art. 5º · CPC, art. 105',
    resumo: 'Instrumento de mandato para representar o(a) cliente em juízo ou fora dele. Poderes especiais precisam constar de forma expressa.',
    premium: true,
    papelCliente: 'Outorgante',
    assinaturaCliente: true,
    secoes: [
      {
        id: 'qualificacao',
        titulo: 'Qualificação do(a) outorgante',
        ajuda: 'Nome completo, nacionalidade, estado civil, profissão, CPF, RG e endereço completo.',
        linhas: 4,
        obrigatoria: true,
      },
      {
        id: 'objeto',
        titulo: 'Finalidade da procuração',
        ajuda: 'Para que o mandato é concedido. Ex.: representar o(a) outorgante em ação de [tipo], perante o juízo de [local].',
        linhas: 3,
        obrigatoria: true,
      },
      {
        id: 'poderes',
        titulo: 'Poderes concedidos',
        ajuda: 'Poderes da cláusula ad judicia para o foro em geral. Poderes especiais (receber citação, transigir, desistir, dar quitação...) só valem se escritos aqui.',
        linhas: 5,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'honorarios',
    icone: 'fa-solid fa-file-contract',
    nome: 'Contrato de honorários',
    baseLegal: 'Lei 8.906/1994, arts. 22 e 24 · Código de Ética da OAB, art. 48',
    resumo: 'Contrato escrito de prestação de serviços advocatícios, com objeto, valor, forma de pagamento e obrigações das partes.',
    premium: true,
    papelCliente: 'Contratante',
    assinaturaCliente: true,
    secoes: [
      {
        id: 'qualificacao',
        titulo: 'Qualificação do(a) contratante',
        ajuda: 'Nome completo, nacionalidade, estado civil, profissão, CPF, RG e endereço completo.',
        linhas: 4,
        obrigatoria: true,
      },
      {
        id: 'objeto',
        titulo: 'Objeto e escopo dos serviços',
        ajuda: 'O que será feito e o que NÃO está incluído (ex.: recursos, execução, audiências fora da comarca).',
        linhas: 5,
        obrigatoria: true,
      },
      {
        id: 'honorarios',
        titulo: 'Honorários e forma de pagamento',
        ajuda: 'Valor, parcelas, vencimentos, honorários de êxito (se houver) e como ficam despesas e custas.',
        linhas: 5,
        obrigatoria: true,
      },
      {
        id: 'obrigacoes',
        titulo: 'Obrigações das partes e sigilo',
        ajuda: 'Deveres do(a) advogado(a) e do(a) cliente, entrega de documentos, comunicação e sigilo profissional.',
        linhas: 5,
        obrigatoria: true,
      },
      {
        id: 'rescisao',
        titulo: 'Rescisão e foro',
        ajuda: 'Como o contrato termina, o que acontece com os honorários nesse caso e o foro eleito.',
        linhas: 4,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'notificacao',
    icone: 'fa-solid fa-envelope-open-text',
    nome: 'Notificação extrajudicial',
    baseLegal: 'Código Civil, art. 397, parágrafo único',
    resumo: 'Comunica formalmente uma pessoa ou empresa sobre fatos e exige providência dentro de um prazo, sem precisar ir ao Judiciário.',
    premium: true,
    papelCliente: 'Notificante',
    rotuloSolicitante: 'Notificado(a)',
    solicitanteObrigatorio: true,
    assinaturaCliente: true,
    secoes: [
      {
        id: 'fatos',
        titulo: 'Dos fatos',
        ajuda: 'Relato objetivo e cronológico, com datas e documentos que comprovem.',
        linhas: 6,
        obrigatoria: true,
      },
      {
        id: 'fundamentos',
        titulo: 'Dos fundamentos',
        ajuda: 'Normas e contratos que sustentam o pedido.',
        linhas: 4,
        obrigatoria: true,
      },
      {
        id: 'pedido',
        titulo: 'Do pedido e do prazo',
        ajuda: 'O que o(a) notificado(a) deve fazer, em quanto tempo e o que pode acontecer se não cumprir.',
        linhas: 4,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'parecer',
    icone: 'fa-solid fa-scale-balanced',
    nome: 'Parecer jurídico',
    baseLegal: 'Lei 8.906/1994, art. 1º, II (consultoria e assessoria jurídicas)',
    resumo: 'Opinião jurídica fundamentada sobre uma questão específica, com análise e conclusão.',
    premium: true,
    papelCliente: 'Consulente',
    rotuloFinalidade: 'Assunto da consulta',
    assinaturaCliente: false,
    secoes: [
      {
        id: 'consulta',
        titulo: 'Consulta',
        ajuda: 'A pergunta apresentada e quem a formulou.',
        linhas: 3,
        obrigatoria: true,
      },
      {
        id: 'fatos',
        titulo: 'Fatos e documentos analisados',
        ajuda: 'Resumo dos fatos e lista dos documentos examinados.',
        linhas: 5,
        obrigatoria: true,
      },
      {
        id: 'analise',
        titulo: 'Análise jurídica',
        ajuda: 'Fundamentação com legislação, doutrina e jurisprudência.',
        linhas: 8,
        obrigatoria: true,
      },
      {
        id: 'conclusao',
        titulo: 'Conclusão',
        ajuda: 'Resposta objetiva à consulta e recomendações.',
        linhas: 4,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'consentimento',
    icone: 'fa-solid fa-user-shield',
    nome: 'Termo de consentimento (LGPD)',
    baseLegal: 'Lei 13.709/2018 (LGPD), arts. 7º, I, e 8º',
    resumo: 'Registra o consentimento do(a) cliente para o tratamento dos dados pessoais necessários ao atendimento.',
    premium: true,
    papelCliente: 'Titular dos dados',
    assinaturaCliente: true,
    secoes: [
      {
        id: 'dados',
        titulo: 'Dados tratados e finalidade',
        ajuda: 'Quais dados serão usados (identificação, contato, documentos do caso) e para que.',
        linhas: 5,
        obrigatoria: true,
      },
      {
        id: 'compartilhamento',
        titulo: 'Compartilhamento e prazo de guarda',
        ajuda: 'Com quem os dados podem ser compartilhados (ex.: órgãos judiciais) e por quanto tempo serão guardados.',
        linhas: 4,
        obrigatoria: true,
      },
      {
        id: 'direitos',
        titulo: 'Direitos do titular e revogação',
        ajuda: 'Como o(a) titular pode acessar, corrigir, pedir a exclusão dos dados ou revogar o consentimento.',
        linhas: 4,
        obrigatoria: true,
      },
    ],
  },
];

export function modeloJuridicoPorId(id: IdModeloJuridico): ModeloJuridico {
  return MODELOS_JURIDICOS.find((m) => m.id === id)!;
}
