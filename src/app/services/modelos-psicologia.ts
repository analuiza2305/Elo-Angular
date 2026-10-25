/**
 * Modelos de documentos psicológicos — Resolução CFP nº 06/2019.
 *
 * Cada modelo traz as seções obrigatórias do artigo correspondente, com uma
 * orientação curta para o profissional. O conteúdo é escrito por ele: a
 * plataforma só organiza, numera as páginas e monta o PDF.
 *
 * A Declaração é liberada para todos; os demais fazem parte do Premium.
 */

export type IdModelo = 'declaracao' | 'atestado' | 'relatorio' | 'laudo' | 'parecer';

export interface SecaoModelo {
  id: string;
  titulo: string;
  ajuda: string;          // aparece como placeholder/orientação
  linhas: number;         // altura da caixa de texto
  obrigatoria: boolean;
}

export interface ModeloDocumento {
  id: IdModelo;
  nome: string;
  artigo: string;
  resumo: string;
  premium: boolean;
  /** Ícone do Font Awesome mostrado no card do modelo. */
  icone: string;
  /** Pede o campo "finalidade" na identificação (exigido em todos, destacado na declaração). */
  pedeSolicitante: boolean;
  /** Validade no último parágrafo (art. 17: atestado, relatório e laudo). */
  pedeValidade: boolean;
  secoes: SecaoModelo[];
}

export const MODELOS_PSICOLOGIA: ModeloDocumento[] = [
  {
    id: 'declaracao',
    icone: 'fa-regular fa-file-lines',
    nome: 'Declaração',
    artigo: 'Art. 9º',
    resumo: 'Informa de forma objetiva o comparecimento: local, dias, horários e duração. Não registra sintomas nem estados psicológicos.',
    premium: false,
    pedeSolicitante: true,
    pedeValidade: false,
    secoes: [
      {
        id: 'texto',
        titulo: 'Declaração',
        ajuda: 'Ex.: Declaro, para fins de comprovação junto ao empregador, que [nome] compareceu a atendimento psicológico on-line nos dias e horários abaixo.',
        linhas: 5,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'atestado',
    icone: 'fa-regular fa-clipboard',
    nome: 'Atestado psicológico',
    artigo: 'Art. 10',
    resumo: 'Certifica, com base em avaliação, uma condição que justifique afastamento, aptidão ou impedimento. Texto corrido, sem parágrafos.',
    premium: true,
    pedeSolicitante: true,
    pedeValidade: true,
    secoes: [
      {
        id: 'texto',
        titulo: 'Atestado',
        ajuda: 'Texto corrido e sem parágrafos. Atesto, para fins de..., que [nome] apresenta... (o CID é opcional e só com autorização da pessoa atendida).',
        linhas: 7,
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'relatorio',
    icone: 'fa-solid fa-brain',
    nome: 'Relatório psicológico',
    artigo: 'Art. 11',
    resumo: 'Comunica o trabalho realizado ou em andamento e pode embasar orientações, encaminhamentos ou intervenções.',
    premium: true,
    pedeSolicitante: true,
    pedeValidade: true,
    secoes: [
      { id: 'demanda', titulo: 'Descrição da demanda', ajuda: 'Motivo do pedido, quem solicitou e o que se espera do documento.', linhas: 4, obrigatoria: true },
      { id: 'procedimento', titulo: 'Procedimento', ajuda: 'Número de encontros, período, modalidade (on-line), pessoas ouvidas e recursos técnicos utilizados, com o referencial teórico.', linhas: 4, obrigatoria: true },
      { id: 'analise', titulo: 'Análise', ajuda: 'Exposição descritiva e fundamentada do que foi observado, sem expor além do necessário (sigilo).', linhas: 7, obrigatoria: true },
      { id: 'conclusao', titulo: 'Conclusão', ajuda: 'Síntese do trabalho, orientações e encaminhamentos.', linhas: 4, obrigatoria: true },
    ],
  },
  {
    id: 'laudo',
    icone: 'fa-regular fa-rectangle-list',
    nome: 'Laudo psicológico',
    artigo: 'Art. 13',
    resumo: 'Resultado de um processo de avaliação psicológica. Apresenta análise, conclusão e indicações para subsidiar decisões.',
    premium: true,
    pedeSolicitante: true,
    pedeValidade: true,
    secoes: [
      { id: 'demanda', titulo: 'Descrição da demanda', ajuda: 'Motivo da avaliação, quem solicitou e a pergunta a ser respondida.', linhas: 4, obrigatoria: true },
      { id: 'procedimento', titulo: 'Procedimento', ajuda: 'Recursos e instrumentos utilizados (entrevistas, testes com parecer favorável no SATEPSI etc.), número de encontros e período.', linhas: 5, obrigatoria: true },
      { id: 'analise', titulo: 'Análise', ajuda: 'Integração dos dados colhidos à luz do referencial teórico, de forma fundamentada.', linhas: 8, obrigatoria: true },
      { id: 'conclusao', titulo: 'Conclusão', ajuda: 'Resultado da avaliação, hipóteses diagnósticas quando cabíveis, indicações e encaminhamentos.', linhas: 5, obrigatoria: true },
      { id: 'referencias', titulo: 'Referências', ajuda: 'Obras e instrumentos citados (preferencialmente em notas ou lista ao final).', linhas: 3, obrigatoria: true },
    ],
  },
  {
    id: 'parecer',
    icone: 'fa-solid fa-shield-halved',
    nome: 'Parecer psicológico',
    artigo: 'Art. 14',
    resumo: 'Responde a uma questão técnica específica, de forma indicativa ou conclusiva. Exige competência na área consultada.',
    premium: true,
    pedeSolicitante: true,
    pedeValidade: false,
    secoes: [
      { id: 'demanda', titulo: 'Descrição da demanda', ajuda: 'A questão-problema apresentada e quem a formulou.', linhas: 4, obrigatoria: true },
      { id: 'analise', titulo: 'Análise', ajuda: 'Discussão técnica fundamentada sobre a questão, com base na literatura e nos documentos analisados.', linhas: 8, obrigatoria: true },
      { id: 'conclusao', titulo: 'Conclusão', ajuda: 'Posicionamento indicativo ou conclusivo sobre a questão.', linhas: 4, obrigatoria: true },
      { id: 'referencias', titulo: 'Referências', ajuda: 'Obras e documentos que embasam o parecer.', linhas: 3, obrigatoria: true },
    ],
  },
];

export function modeloPorId(id: IdModelo): ModeloDocumento {
  return MODELOS_PSICOLOGIA.find((m) => m.id === id)!;
}
