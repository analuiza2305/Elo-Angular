/**
 * Geração de PDFs no navegador — BASE TEMPORÁRIA (Samy + Emily).
 * O João vai substituir pela base oficial de relatórios; as telas só chamam
 * gerarCertificadoHoras() e gerarDocumentoPsicologico(), então basta trocar aqui.
 *
 * Usa jsPDF (npm i jspdf), carregado só quando a pessoa clica em baixar.
 */
import type { jsPDF } from 'jspdf';
import { ModeloDocumento } from './modelos-psicologia';
import { ModeloJuridico } from './modelos-juridicos';

// Paleta da plataforma (mesmos tons do site)
const ROXO: [number, number, number] = [91, 61, 153];          // #5B3D99
const ROXO_ESCURO: [number, number, number] = [62, 42, 114];   // #3E2A72
const LILAS: [number, number, number] = [124, 105, 169];       // #7C69A9
const LILAS_CLARO: [number, number, number] = [244, 239, 252]; // #F4EFFC
const BORDA: [number, number, number] = [228, 220, 246];
const CINZA: [number, number, number] = [107, 98, 144];
const TEXTO: [number, number, number] = [42, 27, 92];          // #2A1B5C
// Tons pastel (soft UI)
const FUNDO_SOFT: [number, number, number] = [246, 242, 254];
const LAVANDA: [number, number, number] = [234, 226, 252];
const LAVANDA_FORTE: [number, number, number] = [181, 160, 236];
const ROSA: [number, number, number] = [251, 228, 241];
const ROSA_FORTE: [number, number, number] = [238, 170, 205];
const MENTA: [number, number, number] = [222, 243, 236];
const ROSA_CLARO: [number, number, number] = [253, 240, 247];
const MENTA_CLARO: [number, number, number] = [237, 249, 245];
const PESSEGO_CLARO: [number, number, number] = [254, 244, 236];
const ZEBRA: [number, number, number] = [251, 249, 255];
const MARGEM = 20;          // mm
const LARGURA_A4 = 210;
const ALTURA_A4 = 297;
const RODAPE = 18;          // espaço reservado no fim da página

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ======================================================================
//  Tipos de entrada
// ======================================================================

export interface SessaoCertificado {
  data: Date;
  duracaoMin: number;
  duracaoEstimada: boolean; // true = usou a duração padrão (sem horário de encerramento)
}

export interface DadosCertificado {
  uid: string;
  nome: string;
  profissao: 'Psicólogo(a)' | 'Advogado(a)';
  registro: string;          // "CRP 06/123456" ou "OAB/SP 123456"
  ano: number;
  mes: number;               // 0–11
  duracaoPadraoMin: number;
  sessoes: SessaoCertificado[];
}

export interface DadosDocumento {
  modelo: ModeloDocumento;
  profissional: { nome: string; crp: string };
  interessado: string;       // nome ou nome social da pessoa atendida
  solicitante: string;
  finalidade: string;
  secoes: Record<string, string>;
  atendimentos?: Date[];     // usado na declaração
  duracaoMin?: number;
  validade?: string;
  cidade: string;
  data: Date;
}

export interface DadosDocumentoJuridico {
  modelo: ModeloJuridico;
  profissional: { nome: string; oab: string };
  interessado: string;       // nome da pessoa atendida (outorgante, contratante, notificante...)
  solicitante: string;       // 2ª pessoa do documento (ex.: notificado) ou quem pediu a declaração
  finalidade: string;
  secoes: Record<string, string>;
  atendimentos?: Date[];     // usado na declaração de comparecimento
  duracaoMin?: number;
  cidade: string;
  data: Date;
}

// ======================================================================
//  Certificado de horas
// ======================================================================

export async function gerarCertificadoHoras(d: DadosCertificado): Promise<void> {
  const pdf = await novoPdf();
  const e = new Escritor(pdf);
  const totalMin = d.sessoes.reduce((s, x) => s + x.duracaoMin, 0);
  const mesTexto = `${MESES[d.mes]} de ${d.ano}`;
  const codigo = await codigoVerificacao(`${d.uid}|${d.ano}-${d.mes + 1}|${d.sessoes.length}|${totalMin}`);

  e.cabecalho();
  e.titulo('Certificado de horas de atendimento');
  e.subtitulo(`Referente a ${mesTexto}`);
  e.espaco(6);

  e.paragrafo(
    `Certificamos que ${d.nome}, ${d.profissao.toLowerCase()}, ${d.registro}, realizou ${d.sessoes.length} ` +
    `${d.sessoes.length === 1 ? 'atendimento' : 'atendimentos'} de forma voluntária por meio da plataforma EloMaterno ` +
    `no mês de ${mesTexto}, totalizando ${formatarHoras(totalMin)} de atendimento on-line a mães da comunidade.`,
    { tamanho: 12, entrelinha: 1.6 }
  );
  e.espaco(4);

  // Destaque com os totais
  e.caixaTotais([
    ['Atendimentos', String(d.sessoes.length)],
    ['Total de horas', formatarHoras(totalMin)],
    ['Período', capitalizar(mesTexto)],
  ]);
  e.espaco(6);

  // Lista sem identificar as pessoas atendidas (sigilo)
  e.subtituloSecao('Atendimentos realizados');
  e.tabela(
    ['Nº', 'Data', 'Início', 'Duração', 'Modalidade'],
    [12, 42, 30, 36, 50],
    d.sessoes.map((s, i) => [
      String(i + 1),
      s.data.toLocaleDateString('pt-BR'),
      s.data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      `${s.duracaoMin} min${s.duracaoEstimada ? '*' : ''}`,
      'On-line (vídeo)',
    ])
  );

  if (d.sessoes.some((s) => s.duracaoEstimada)) {
    e.nota(`* Duração padrão de ${d.duracaoPadraoMin} min por sessão, usada quando a chamada não registrou o horário de encerramento.`);
  }
  e.nota('As pessoas atendidas não são identificadas neste certificado, em respeito ao sigilo profissional.');
  e.espaco(6);

  // Emissão + assinatura sempre juntas na mesma página
  e.manterJunto(42);
  e.paragrafo(`Emitido em ${new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.`, { tamanho: 10, cor: CINZA });
  e.paragrafo(`Código de verificação: ${codigo}`, { tamanho: 10, cor: CINZA, negrito: true });
  e.espaco(12);
  e.assinatura('EloMaterno', 'Plataforma de apoio à maternidade');

  e.rodapes({ rubrica: false, texto: 'Certificado emitido automaticamente pela plataforma EloMaterno.' });
  pdf.save(`certificado-horas-${d.ano}-${String(d.mes + 1).padStart(2, '0')}.pdf`);
}

// ======================================================================
//  Relatório de atendimentos (Premium)
// ======================================================================

export interface ConsultaRelatorio {
  data: Date;
  situacao: 'Realizada' | 'Agendada' | 'Pendente' | 'Recusada';
  duracaoMin: number | null;   // só nas realizadas
  duracaoEstimada: boolean;
  iniciais: string;            // "M. S." (sem nome completo, por sigilo)
}

export interface DadosRelatorio {
  nome: string;
  profissao: 'Psicólogo(a)' | 'Advogado(a)';
  registro: string;
  periodoTexto: string;        // "agosto a outubro de 2026"
  inicio: Date;
  fim: Date;
  consultas: ConsultaRelatorio[];
  duracaoPadraoMin: number;
  reputacao?: { media: string; total: number; recomendamPct: number | null; bemAvaliado: boolean };
}

export async function gerarRelatorioAtendimentos(d: DadosRelatorio): Promise<void> {
  const pdf = await novoPdf();
  const e = new Escritor(pdf);
  const lista = [...d.consultas].sort((a, b) => a.data.getTime() - b.data.getTime());
  const realizadas = lista.filter((c) => c.situacao === 'Realizada');
  const recusadas = lista.filter((c) => c.situacao === 'Recusada').length;
  const decididas = lista.filter((c) => c.situacao !== 'Pendente').length;
  const totalMin = realizadas.reduce((s, c) => s + (c.duracaoMin || 0), 0);
  const taxaAceite = decididas ? Math.round(((decididas - recusadas) / decididas) * 100) : null;
  const mediaMin = realizadas.length ? Math.round(totalMin / realizadas.length) : 0;

  e.cabecalho();
  e.titulo('Relatório de atendimentos');
  e.subtitulo(`${capitalizar(d.periodoTexto)}`);
  e.espaco(6);

  e.campo('Profissional', d.nome);
  e.campo('Registro', `${d.profissao} · ${d.registro}`);
  e.campo('Período', `${d.inicio.toLocaleDateString('pt-BR')} a ${d.fim.toLocaleDateString('pt-BR')}`);
  e.espaco(4);

  e.caixaTotais([
    ['Pedidos recebidos', String(lista.length)],
    ['Realizados', String(realizadas.length)],
    ['Horas atendidas', formatarHoras(totalMin)],
    ['Taxa de aceite', taxaAceite === null ? '–' : `${taxaAceite}%`],
  ]);
  e.espaco(7);

  // ----- Por mês -----
  e.subtituloSecao('Resumo por mês');
  const porMes = new Map<string, { rotulo: string; pedidos: number; realizados: number; minutos: number; recusados: number }>();
  for (const c of lista) {
    const chave = `${c.data.getFullYear()}-${String(c.data.getMonth()).padStart(2, '0')}`;
    if (!porMes.has(chave)) porMes.set(chave, { rotulo: capitalizar(`${MESES[c.data.getMonth()]} de ${c.data.getFullYear()}`), pedidos: 0, realizados: 0, minutos: 0, recusados: 0 });
    const m = porMes.get(chave)!;
    m.pedidos++;
    if (c.situacao === 'Realizada') { m.realizados++; m.minutos += c.duracaoMin || 0; }
    if (c.situacao === 'Recusada') m.recusados++;
  }
  e.tabela(
    ['Mês', 'Pedidos', 'Realizados', 'Recusados', 'Horas'],
    [52, 28, 32, 30, 28],
    [...porMes.keys()].sort().map((k) => {
      const m = porMes.get(k)!;
      return [m.rotulo, String(m.pedidos), String(m.realizados), String(m.recusados), formatarHoras(m.minutos)];
    }),
    'Nenhum pedido de consulta no período.'
  );
  e.espaco(6);

  // ----- Dias e horários mais procurados -----
  if (lista.length) {
    const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const contDia = new Array(7).fill(0);
    const contTurno: Record<string, number> = { Manhã: 0, Tarde: 0, Noite: 0 };
    for (const c of lista) {
      contDia[c.data.getDay()]++;
      const h = c.data.getHours();
      contTurno[h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite']++;
    }
    const diaTop = contDia.indexOf(Math.max(...contDia));
    const turnoTop = Object.entries(contTurno).sort((a, b) => b[1] - a[1])[0][0];
    e.subtituloSecao('Indicadores');
    e.campo('Duração média', realizadas.length ? `${mediaMin} min por atendimento` : '–');
    e.campo('Dia de pico', `${dias[diaTop]} (${contDia[diaTop]} ${contDia[diaTop] === 1 ? 'pedido' : 'pedidos'})`);
    e.campo('Turno de pico', `${turnoTop} (${contTurno[turnoTop]} ${contTurno[turnoTop] === 1 ? 'pedido' : 'pedidos'})`);
    if (d.reputacao && d.reputacao.total > 0) {
      const rec = d.reputacao.recomendamPct !== null ? `, ${d.reputacao.recomendamPct}% recomendam` : '';
      e.campo('Avaliação', `${d.reputacao.media} de 5 (${d.reputacao.total} avaliações${rec})${d.reputacao.bemAvaliado ? ' · selo Bem avaliado' : ''}`);
    }
    e.espaco(6);
  }

  // ----- Lista -----
  e.subtituloSecao('Atendimentos do período');
  e.tabela(
    ['Nº', 'Data', 'Início', 'Situação', 'Duração', 'Atendida'],
    [12, 30, 22, 34, 30, 42],
    lista.map((c, i) => [
      String(i + 1),
      c.data.toLocaleDateString('pt-BR'),
      hm(c.data),
      c.situacao,
      c.duracaoMin ? `${c.duracaoMin} min${c.duracaoEstimada ? '*' : ''}` : '–',
      c.iniciais || '–',
    ]),
    'Nenhum atendimento no período.'
  );
  if (lista.some((c) => c.duracaoEstimada)) {
    e.nota(`* Duração padrão de ${d.duracaoPadraoMin} min, usada quando a chamada não registrou o horário de encerramento.`);
  }
  e.nota('As pessoas atendidas aparecem só pelas iniciais, em respeito ao sigilo profissional. Guarde este relatório em local seguro.');
  e.espaco(4);
  e.paragrafo(`Emitido em ${new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}.`, { tamanho: 9.5, cor: CINZA });

  e.rodapes({ rubrica: false, texto: 'Relatório gerado pela plataforma EloMaterno para uso do(a) profissional.' });
  const ini = d.inicio;
  pdf.save(`relatorio-atendimentos-${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}.pdf`);
}

// ======================================================================
//  Documentos psicológicos (Resolução CFP 06/2019)
// ======================================================================

export async function gerarDocumentoPsicologico(d: DadosDocumento): Promise<void> {
  const pdf = await novoPdf();
  const e = new Escritor(pdf);
  const m = d.modelo;

  e.cabecalho();
  e.titulo(m.nome.toUpperCase());
  e.espaco(6);

  // 1. Identificação
  let n = 1;
  e.subtituloSecao(`${n}. Identificação`);
  e.campo('Autor(a)', `${d.profissional.nome} — ${d.profissional.crp}`);
  e.campo('Interessado(a)', d.interessado || '—');
  if (d.solicitante) e.campo('Solicitante', d.solicitante);
  e.campo('Finalidade', d.finalidade || '—');
  e.espaco(3);

  if (m.id === 'declaracao' || m.id === 'atestado') {
    // Documentos curtos: texto corrido, sem seções numeradas
    e.espaco(2);
    e.paragrafo(d.secoes['texto'] || '', { tamanho: 11.5, entrelinha: 1.6, justificar: true });
    if (m.id === 'declaracao' && d.atendimentos?.length) {
      e.espaco(2);
      const dur = d.duracaoMin || 50;
      e.paragrafo('Atendimentos (modalidade on-line):', { negrito: true });
      d.atendimentos.forEach((a) => {
        const fim = new Date(a.getTime() + dur * 60000);
        e.paragrafo(
          `•  ${a.toLocaleDateString('pt-BR')}, das ${hm(a)} às ${hm(fim)}`,
          { recuo: 4 }
        );
      });
    }
  } else {
    for (const s of m.secoes) {
      n++;
      e.espaco(3);
      e.subtituloSecao(`${n}. ${s.titulo}`);
      e.paragrafo(d.secoes[s.id] || '', { justificar: true, entrelinha: 1.55 });
    }
  }

  if (m.pedeValidade && d.validade) {
    e.espaco(4);
    e.paragrafo(`Este documento tem validade de ${d.validade}, a contar da data de emissão.`, { justificar: true });
  }

  e.espaco(10);
  e.manterJunto(40);
  e.paragrafo(`${d.cidade || '__________'}, ${dataPorExtenso(d.data)}.`);
  e.espaco(16);
  e.assinatura(d.profissional.nome, `Psicólogo(a) — ${d.profissional.crp}`);

  e.rodapes({ rubrica: true, texto: `${m.nome} elaborado conforme a Resolução CFP nº 06/2019 (${m.artigo}). Documento sigiloso.` });
  const nomeArquivo = `${m.id}-${(d.interessado || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
  pdf.save(nomeArquivo);
}

// ======================================================================
//  Documentos jurídicos (área do advogado)
// ======================================================================

export async function gerarDocumentoJuridico(d: DadosDocumentoJuridico): Promise<void> {
  const pdf = await novoPdf();
  const e = new Escritor(pdf);
  const m = d.modelo;

  e.cabecalho();
  e.titulo(m.nome.toUpperCase());
  e.nota(`Base: ${m.baseLegal}`);
  e.espaco(5);

  // 1. Identificação
  let n = 1;
  e.subtituloSecao(`${n}. Identificação`);
  e.campo('Advogado(a)', `${d.profissional.nome} — ${d.profissional.oab}`);
  e.campo(m.papelCliente, d.interessado || '—');
  if (d.solicitante) e.campo(m.rotuloSolicitante || 'Solicitante', d.solicitante);
  if (m.rotuloFinalidade) e.campo(m.rotuloFinalidade, d.finalidade || '—');
  e.espaco(3);

  if (m.id === 'declaracao') {
    // Documento curto: texto corrido, sem seções numeradas
    e.espaco(2);
    e.paragrafo(d.secoes['texto'] || '', { tamanho: 11.5, entrelinha: 1.6, justificar: true });
    if (d.atendimentos?.length) {
      e.espaco(2);
      const dur = d.duracaoMin || 30;
      e.paragrafo('Atendimentos (modalidade on-line):', { negrito: true });
      d.atendimentos.forEach((a) => {
        const fim = new Date(a.getTime() + dur * 60000);
        e.paragrafo(`•  ${a.toLocaleDateString('pt-BR')}, das ${hm(a)} às ${hm(fim)}`, { recuo: 4 });
      });
    }
  } else {
    for (const s of m.secoes) {
      n++;
      e.espaco(3);
      e.subtituloSecao(`${n}. ${s.titulo}`);
      e.paragrafo(d.secoes[s.id] || '', { justificar: true, entrelinha: 1.55 });
    }
  }

  e.espaco(10);
  e.manterJunto(m.assinaturaCliente ? 90 : 45);
  e.paragrafo(`${d.cidade || '__________'}, ${dataPorExtenso(d.data)}.`);
  e.espaco(16);
  if (m.assinaturaCliente) {
    e.assinatura(d.interessado || '____________________', m.papelCliente);
    e.espaco(14);
  }
  e.assinatura(d.profissional.nome, `Advogado(a) — ${d.profissional.oab}`);

  e.rodapes({ rubrica: true, texto: `${m.nome} · modelo de apoio EloMaterno · Documento sigiloso.` });
  const nomeArquivo = `${m.id}-${(d.interessado || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
  pdf.save(nomeArquivo);
}

// ======================================================================
//  Prontuário: anotações das sessões (Resolução CFP nº 001/2009)
// ======================================================================

export interface SessaoProntuario {
  data: Date | null;
  texto: string;
}

export interface PacienteProntuario {
  nome: string;
  sessoes: SessaoProntuario[];
}

export interface DadosProntuario {
  /** crp = registro profissional ("CRP 06/123456" ou "OAB/SP 123456") */
  profissional: { nome: string; crp: string };
  /** muda título e rodapé; padrão: psicólogo */
  tipo?: 'psicologo' | 'advogado';
  pacientes: PacienteProntuario[];
  /** usado no nome do arquivo: 'prontuario-<nome>' ou 'prontuarios' */
  nomeArquivo: string;
}

export async function gerarProntuario(d: DadosProntuario): Promise<void> {
  const pdf = await novoPdf();
  const e = new Escritor(pdf);

  e.cabecalho();
  const adv = d.tipo === 'advogado';
  e.titulo(adv ? 'REGISTRO DE ATENDIMENTOS JURÍDICOS' : 'REGISTRO DOCUMENTAL DE ATENDIMENTOS');
  e.subtitulo(`${d.profissional.nome} — ${d.profissional.crp || (adv ? 'OAB não informada' : 'CRP não informado')}`);
  e.subtitulo(`Gerado em ${dataPorExtenso(new Date())}`);
  e.espaco(6);

  if (!d.pacientes.length) {
    e.paragrafo('Nenhuma anotação registrada.');
  }

  d.pacientes.forEach((pac, i) => {
    if (i > 0) e.espaco(8);
    e.manterJunto(30);
    e.subtituloSecao(pac.nome || 'Paciente');
    const ordenadas = [...pac.sessoes].sort((a, b) => (a.data?.getTime() ?? 0) - (b.data?.getTime() ?? 0));
    ordenadas.forEach((s, j) => {
      e.espaco(j === 0 ? 1 : 4);
      e.manterJunto(18);
      const quando = s.data ? `${s.data.toLocaleDateString('pt-BR')} às ${hm(s.data)}` : 'Data não registrada';
      e.paragrafo(`${adv ? 'Atendimento' : 'Sessão'} ${j + 1} — ${quando}`, { negrito: true });
      e.paragrafo(s.texto?.trim() || '(sem anotações)', { justificar: true, entrelinha: 1.5, recuo: 4 });
    });
  });

  e.rodapes({
    rubrica: false,
    texto: adv
      ? 'Documento sigiloso, protegido pelo sigilo profissional do(a) advogado(a).'
      : 'Documento sigiloso. Registro documental conforme a Resolução CFP nº 001/2009 (guarda mínima de 5 anos).',
  });
  const slug = d.nomeArquivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  pdf.save(`${slug || 'prontuario'}.pdf`);
}

// ======================================================================
//  Utilidades
// ======================================================================

/** Logo do Elo (public/img/logo_icon.png) em base64, carregada uma vez só. */
let logoElo: string | null | undefined;

async function carregarLogo(): Promise<string | null> {
  if (logoElo !== undefined) return logoElo;
  try {
    const resp = await fetch('img/logo_icon.png');
    if (!resp.ok) throw new Error(String(resp.status));
    const blob = await resp.blob();
    logoElo = await new Promise<string>((ok, erro) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(String(leitor.result));
      leitor.onerror = erro;
      leitor.readAsDataURL(blob);
    });
  } catch {
    logoElo = null; // sem logo, o PDF sai só com o nome
  }
  return logoElo;
}

async function novoPdf(): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setProperties({ creator: 'EloMaterno' });
  await carregarLogo();
  return pdf;
}

export function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function hm(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function dataPorExtenso(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

async function codigoVerificacao(base: string): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base));
    const hex = Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `EM-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`.toUpperCase();
  } catch {
    return `EM-${Date.now().toString(36).toUpperCase()}`;
  }
}

interface OpcoesTexto {
  tamanho?: number;
  negrito?: boolean;
  cor?: [number, number, number];
  entrelinha?: number;
  justificar?: boolean;
  recuo?: number;
}

/** Escreve de cima para baixo e cria páginas novas quando precisa. */
class Escritor {
  private y = MARGEM;
  private largura = LARGURA_A4 - 2 * MARGEM;

  constructor(private pdf: jsPDF) {}

  private garantir(altura: number) {
    if (this.y + altura > ALTURA_A4 - RODAPE) {
      this.pdf.addPage();
      this.y = MARGEM + 4;
    }
  }

  espaco(mm: number) { this.y += mm; }

  /** Pula de página se o próximo bloco (ex.: local, data e assinatura) não couber inteiro. */
  manterJunto(mm: number) { this.garantir(mm); }

  /** Cartão lilás clarinho no topo da 1ª página, com a logo do Elo. */
  cabecalho() {
    const p = this.pdf;
    const x = 10, y = 8, larg = LARGURA_A4 - 20, alt = 30;
    p.setFillColor(...FUNDO_SOFT).roundedRect(x, y, larg, alt, 8, 8, 'F');
    // bolinhas decorativas (dentro do cartão)
    p.setFillColor(...LAVANDA).circle(x + larg - 16, y + 9, 9, 'F');
    p.setFillColor(...ROSA).circle(x + larg - 28, y + alt - 7, 5, 'F');
    p.setFillColor(...MENTA).circle(x + larg - 6, y + alt - 5, 3, 'F');

    // selo redondo branco com a logo
    const cx = MARGEM + 5, cy = y + alt / 2;
    p.setFillColor(255, 255, 255).circle(cx, cy, 9.5, 'F');
    if (logoElo) {
      try { p.addImage(logoElo, 'PNG', cx - 6.5, cy - 6.5, 13, 13, 'logo-elo', 'FAST'); } catch { /* segue sem logo */ }
    }
    p.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...ROXO_ESCURO);
    p.text('elomaterno', cx + 14, cy + 0.5);
    p.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...LILAS);
    p.text('Rede de apoio à maternidade', cx + 14, cy + 6);
    p.setFontSize(8.5).text('elomaterno.netlify.app', x + larg - 40, cy + 6, { align: 'right' });

    this.y = y + alt + 17;
  }

  /** Título grande, com um tracinho lavanda e uma bolinha rosa embaixo. */
  titulo(t: string) {
    const p = this.pdf;
    p.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...ROXO_ESCURO);
    const linhas = p.splitTextToSize(t, this.largura) as string[];
    linhas.forEach((l) => { p.text(l, LARGURA_A4 / 2, this.y, { align: 'center' }); this.y += 8; });
    p.setFillColor(...LAVANDA_FORTE).roundedRect(LARGURA_A4 / 2 - 11, this.y - 4, 18, 1.8, 0.9, 0.9, 'F');
    p.setFillColor(...ROSA_FORTE).circle(LARGURA_A4 / 2 + 10.5, this.y - 3.1, 0.95, 'F');
    this.y += 5;
  }

  subtitulo(t: string) {
    this.pdf.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...CINZA);
    this.pdf.text(t, LARGURA_A4 / 2, this.y, { align: 'center' });
    this.y += 6;
  }

  /** Título de seção: pílula lilás clarinha com uma bolinha na frente. */
  subtituloSecao(t: string) {
    const p = this.pdf;
    this.garantir(16);
    const altura = 9.5;
    const topo = this.y - 6.3;
    p.setFillColor(...FUNDO_SOFT).roundedRect(MARGEM, topo, this.largura, altura, 4.75, 4.75, 'F');
    p.setFillColor(...LAVANDA_FORTE).circle(MARGEM + 5.5, topo + altura / 2, 1.5, 'F');
    p.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...ROXO_ESCURO);
    p.text(t, MARGEM + 10, this.y);
    this.y += 9.5;
  }

  campo(rotulo: string, valor: string) {
    const p = this.pdf;
    p.setFontSize(10.5);
    const linhas = p.splitTextToSize(valor, this.largura - 34) as string[];
    this.garantir(linhas.length * 5 + 1);
    p.setFont('helvetica', 'bold').setTextColor(...LILAS).text(`${rotulo}:`, MARGEM, this.y);
    p.setFont('helvetica', 'normal').setTextColor(...TEXTO).text(linhas, MARGEM + 34, this.y);
    this.y += linhas.length * 5 + 1;
  }

  paragrafo(texto: string, o: OpcoesTexto = {}) {
    const p = this.pdf;
    const tamanho = o.tamanho ?? 11;
    const alturaLinha = (tamanho * 0.3528) * (o.entrelinha ?? 1.45);
    const x = MARGEM + (o.recuo ?? 0);
    const larg = this.largura - (o.recuo ?? 0);
    p.setFont('helvetica', o.negrito ? 'bold' : 'normal').setFontSize(tamanho).setTextColor(...(o.cor ?? TEXTO));

    const blocos = String(texto || '').replace(/\r/g, '').split('\n');
    for (const bloco of blocos) {
      const linhas = (bloco.trim() ? p.splitTextToSize(bloco, larg) : ['']) as string[];
      linhas.forEach((linha, i) => {
        this.garantir(alturaLinha);
        const ultima = i === linhas.length - 1;
        if (o.justificar && !ultima && linha.trim()) {
          p.text(linha, x, this.y, { align: 'justify', maxWidth: larg });
        } else {
          p.text(linha, x, this.y);
        }
        this.y += alturaLinha;
      });
    }
  }

  nota(t: string) {
    this.espaco(1);
    this.paragrafo(t, { tamanho: 8.5, cor: CINZA, entrelinha: 1.35 });
  }

  /** Números em destaque: um cartãozinho pastel para cada item. */
  caixaTotais(itens: [string, string][]) {
    const p = this.pdf;
    const altura = 24;
    const gap = 4;
    const tons = [FUNDO_SOFT, ROSA_CLARO, MENTA_CLARO, PESSEGO_CLARO];
    this.garantir(altura + 2);
    const col = (this.largura - gap * (itens.length - 1)) / itens.length;
    itens.forEach(([rotulo, valor], i) => {
      const x = MARGEM + i * (col + gap);
      p.setFillColor(...tons[i % tons.length]).roundedRect(x, this.y, col, altura, 5, 5, 'F');
      p.setFont('helvetica', 'bold').setFontSize(valor.length > 12 ? 12 : 16).setTextColor(...ROXO_ESCURO)
        .text(valor, x + col / 2, this.y + 11.5, { align: 'center', maxWidth: col - 4 });
      p.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...CINZA)
        .text(rotulo, x + col / 2, this.y + 18, { align: 'center', maxWidth: col - 4 });
    });
    this.y += altura + 3;
  }

  tabela(cabecalho: string[], larguras: number[], linhas: string[][], vazio = 'Nenhum atendimento realizado neste mês.') {
    const p = this.pdf;
    const alt = 6.4;
    const desenharCabecalho = () => {
      p.setFillColor(...LAVANDA).roundedRect(MARGEM, this.y - 4.8, this.largura, alt + 1.2, 3.2, 3.2, 'F');
      p.setFont('helvetica', 'bold').setFontSize(8.8).setTextColor(...ROXO_ESCURO);
      let x = MARGEM + 3;
      cabecalho.forEach((c, i) => { p.text(c, x, this.y); x += larguras[i]; });
      this.y += alt + 0.8;
    };
    this.garantir(alt * 2);
    desenharCabecalho();
    p.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...TEXTO);
    if (!linhas.length) {
      p.setTextColor(...CINZA).text(vazio, MARGEM + 3, this.y);
      this.y += alt;
      return;
    }
    let zebra = false;
    for (const linha of linhas) {
      if (this.y + alt > ALTURA_A4 - RODAPE) {
        p.addPage();
        this.y = MARGEM + 9;
        desenharCabecalho();
      }
      if (zebra) p.setFillColor(...ZEBRA).roundedRect(MARGEM, this.y - 4.3, this.largura, alt, 2, 2, 'F');
      zebra = !zebra;
      p.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...TEXTO);
      let x = MARGEM + 3;
      linha.forEach((c, i) => { p.text(c, x, this.y); x += larguras[i]; });
      this.y += alt;
    }
  }

  assinatura(nome: string, linha2: string) {
    const p = this.pdf;
    this.garantir(22);
    const meio = LARGURA_A4 / 2;
    p.setDrawColor(...LAVANDA_FORTE).setLineWidth(0.4).line(meio - 40, this.y, meio + 40, this.y);
    p.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TEXTO).text(nome, meio, this.y + 5, { align: 'center' });
    p.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...CINZA).text(linha2, meio, this.y + 10, { align: 'center' });
    this.y += 14;
  }

  /** Numeração "Página x de y" e, nos documentos do CFP, espaço de rubrica até a penúltima página. */
  rodapes(o: { rubrica: boolean; texto: string }) {
    const p = this.pdf;
    const total = p.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      p.setPage(i);
      // da 2ª página em diante: cartãozinho com a marca no topo
      if (i > 1) {
        p.setFillColor(...FUNDO_SOFT).roundedRect(10, 6, LARGURA_A4 - 20, 10, 5, 5, 'F');
        if (logoElo) { try { p.addImage(logoElo, 'PNG', MARGEM - 3, 7.6, 6.8, 6.8, 'logo-elo', 'FAST'); } catch { /* sem logo */ } }
        p.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...ROXO_ESCURO).text('elomaterno', MARGEM + 5.5, 12.4);
        p.setFillColor(...ROSA).circle(LARGURA_A4 - 18, 11, 2, 'F');
        p.setFillColor(...LAVANDA).circle(LARGURA_A4 - 24, 11, 1.3, 'F');
      }
      const yR = ALTURA_A4 - 10;
      p.setDrawColor(...BORDA).setLineWidth(0.3).line(MARGEM, yR - 5.5, LARGURA_A4 - MARGEM, yR - 5.5);
      p.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...CINZA);
      p.text(o.texto, MARGEM, yR, { maxWidth: 115 });
      // número da página numa pílula
      const pag = `Página ${i} de ${total}`;
      p.setFont('helvetica', 'bold').setFontSize(7.5);
      const lp = p.getTextWidth(pag) + 7;
      const xp = LARGURA_A4 - MARGEM - lp;
      p.setFillColor(...FUNDO_SOFT).roundedRect(xp, yR - 3.6, lp, 5.4, 2.7, 2.7, 'F');
      p.setTextColor(...ROXO).text(pag, xp + lp / 2, yR, { align: 'center' });
      if (o.rubrica && i < total) {
        p.setFont('helvetica', 'normal').setTextColor(...CINZA).text('Rubrica: ____________', xp - 3, yR, { align: 'right' });
      }
    }
  }
}
