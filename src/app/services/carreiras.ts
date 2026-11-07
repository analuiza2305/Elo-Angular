/**
 * Carreiras: vitrine de vagas de emprego e cursos divulgados pelos parceiros
 * (ONGs, empresas). Nada acontece dentro da plataforma: a mãe vê a divulgação
 * e segue pelo link do parceiro (site da vaga, inscrição do curso, e-mail...).
 *
 * Coleções no Firestore:
 *  - vagas/{id}   → publicada pelo parceiro (parceiroId = uid do parceiro)
 *  - cursos/{id}  → publicado pelo parceiro
 */

export type Modalidade = 'Presencial' | 'Remoto' | 'Híbrido';

export interface Vaga {
  id: string;
  titulo: string;
  empresa: string;
  empresaFoto: string;
  parceiroId: string;
  area: string;
  modalidade: Modalidade;
  regime: string;
  local: string;
  salario: string;
  descricao: string;
  requisitos: string;
  beneficios: string[];
  link: string;
  status: 'aberta' | 'encerrada';
  criadoEm: Date | null;
}

export interface Curso {
  id: string;
  titulo: string;
  instituicao: string;
  empresaFoto: string;
  parceiroId: string;
  area: string;
  nivel: string;
  formato: string;
  cargaHoraria: string;
  inicio: string;
  gratuito: boolean;
  certificado: boolean;
  descricao: string;
  link: string;
  status: 'ativo' | 'encerrado';
  criadoEm: Date | null;
}

export const AREAS_CARREIRA: { nome: string; icone: string; cor: string }[] = [
  { nome: 'Administração', icone: 'fa-briefcase', cor: 'lilas' },
  { nome: 'Atendimento', icone: 'fa-headset', cor: 'rosa' },
  { nome: 'Beleza e estética', icone: 'fa-spa', cor: 'rosa' },
  { nome: 'Educação', icone: 'fa-graduation-cap', cor: 'azul' },
  { nome: 'Empreendedorismo', icone: 'fa-lightbulb', cor: 'amarelo' },
  { nome: 'Gastronomia', icone: 'fa-utensils', cor: 'amarelo' },
  { nome: 'Saúde e cuidado', icone: 'fa-hand-holding-heart', cor: 'verde' },
  { nome: 'Tecnologia', icone: 'fa-laptop-code', cor: 'azul' },
  { nome: 'Vendas', icone: 'fa-store', cor: 'verde' },
  { nome: 'Outros', icone: 'fa-shapes', cor: 'lilas' },
];

export const MODALIDADES: Modalidade[] = ['Presencial', 'Remoto', 'Híbrido'];
export const REGIMES = ['CLT', 'PJ', 'Meio período', 'Estágio', 'Jovem aprendiz', 'Temporário', 'Freelance'];
export const NIVEIS_CURSO = ['Iniciante', 'Intermediário', 'Avançado'];
export const FORMATOS_CURSO = ['Online', 'Presencial', 'Híbrido'];

/** Benefícios que fazem diferença para mães (a mãe filtra por eles). */
export const BENEFICIOS_MAE = [
  'Horário flexível',
  'Home office',
  'Auxílio-creche',
  'Meio período',
  'Licença estendida',
  'Sala de amamentação',
  'Plano de saúde',
  'Vale-alimentação',
];

export function infoArea(area: string): { nome: string; icone: string; cor: string } {
  return AREAS_CARREIRA.find((a) => a.nome === area) || AREAS_CARREIRA[AREAS_CARREIRA.length - 1];
}

export function paraData(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function tempoDesde(d: Date | null): string {
  if (!d) return '';
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}

/** Link externo seguro: só http(s) ou mailto. */
export function linkSeguro(v: string): string {
  const t = (v || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t) || /^mailto:/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  return `https://${t}`;
}

export function vagaDeDoc(id: string, d: any): Vaga {
  return {
    id,
    titulo: d.titulo || 'Vaga',
    empresa: d.empresa || 'Parceiro',
    empresaFoto: d.empresaFoto || '',
    parceiroId: d.parceiroId || '',
    area: d.area || 'Outros',
    modalidade: d.modalidade || 'Presencial',
    regime: d.regime || '',
    local: d.local || '',
    salario: d.salario || '',
    descricao: d.descricao || '',
    requisitos: d.requisitos || '',
    beneficios: Array.isArray(d.beneficios) ? d.beneficios : [],
    link: d.link || '',
    status: d.status === 'encerrada' ? 'encerrada' : 'aberta',
    criadoEm: paraData(d.criadoEm),
  };
}

export function cursoDeDoc(id: string, d: any): Curso {
  return {
    id,
    titulo: d.titulo || 'Curso',
    instituicao: d.instituicao || 'Parceiro',
    empresaFoto: d.empresaFoto || '',
    parceiroId: d.parceiroId || '',
    area: d.area || 'Outros',
    nivel: d.nivel || 'Iniciante',
    formato: d.formato || 'Online',
    cargaHoraria: d.cargaHoraria || '',
    inicio: d.inicio || '',
    gratuito: d.gratuito !== false,
    certificado: !!d.certificado,
    descricao: d.descricao || '',
    link: d.link || '',
    status: d.status === 'encerrado' ? 'encerrado' : 'ativo',
    criadoEm: paraData(d.criadoEm),
  };
}

/** Conteúdo removido pela moderação do ADM não aparece. */
export function removidoPelaModeracao(d: any): boolean {
  return !!d?.moderacao?.removido;
}
