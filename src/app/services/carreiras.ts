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

// =====================================================================
// VERIFICAÇÃO DOS LINKS DE VAGAS E CURSOS
// Golpes de "vaga falsa" costumam usar link encurtado, endereço de IP,
// WhatsApp ou sites que não têm nada a ver com a empresa. Aqui o link só é
// aceito se for:
//   - um e-mail (o RH recebe o currículo);
//   - do site da própria empresa (cadastrado em Configurações) ou do domínio
//     do e-mail corporativo dela;
//   - de uma plataforma conhecida de vagas, cursos ou formulários.
// =====================================================================

/** Plataformas conhecidas de vagas, cursos, eventos e formulários. Subdomínios também valem. */
export const DOMINIOS_CONFIAVEIS = [
  // vagas
  'gupy.io', 'linkedin.com', 'indeed.com', 'vagas.com.br', 'catho.com.br', 'infojobs.com.br', 'solides.com.br',
  'kenoby.com', '99jobs.com', 'trabalhabrasil.com.br', 'bne.com.br', 'glassdoor.com', 'glassdoor.com.br',
  'empregos.com.br', 'ciee.org.br', 'nube.com.br', 'abler.com.br', 'quickin.io', 'pandape.com.br', 'recrutei.com.br',
  'jobs.lever.co', 'greenhouse.io', 'workable.com', 'breezy.hr', 'recruitee.com', 'gov.br',
  // cursos e eventos
  'sebrae.com.br', 'senai.br', 'senac.br', 'sesc.com.br', 'ev.org.br', 'fgv.br', 'coursera.org', 'udemy.com',
  'alura.com.br', 'edx.org', 'khanacademy.org', 'sympla.com.br', 'eventbrite.com.br', 'eventbrite.com', 'even3.com.br',
  // formulários de inscrição
  'docs.google.com', 'forms.gle', 'forms.office.com', 'typeform.com',
];

/** Encurtadores escondem o destino real do link. */
const ENCURTADORES = [
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 't.co', 'goo.gl', 'rebrand.ly', 'shorturl.at', 'encurtador.com.br',
  'ow.ly', 'buff.ly', 'tiny.cc', 'rb.gy', 'v.gd', 'linktr.ee', 's.id', 'bitly.com',
];

/** WhatsApp/Telegram: comum em golpe de vaga, e a mãe sai sem saber com quem está falando. */
const MENSAGEIROS = ['wa.me', 'whatsapp.com', 'api.whatsapp.com', 't.me', 'telegram.me'];

/** E-mails gratuitos não comprovam o domínio da empresa. */
const EMAILS_GRATUITOS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'bol.com.br',
  'uol.com.br', 'terra.com.br', 'ig.com.br', 'protonmail.com', 'msn.com',
];

function dominioDe(valor: string): string {
  return (valor || '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^mailto:/, '')
    .split(/[\/?#]/)[0].split('@').pop()!.replace(/:\d+$/, '').replace(/^www\./, '');
}

function pertence(host: string, dominio: string): boolean {
  return !!dominio && (host === dominio || host.endsWith('.' + dominio));
}

export interface ResultadoLink { ok: boolean; mensagem: string; }

/**
 * Confere se o link de candidatura/inscrição pode ser divulgado.
 * @param empresa site e e-mail da empresa (coleção 'parceiros')
 */
export function verificarLinkCarreira(link: string, empresa: { site?: string; email?: string }): ResultadoLink {
  const t = (link || '').trim();
  if (!t) return { ok: false, mensagem: 'Informe o link ou o e-mail onde a mãe se candidata.' };

  // e-mail do RH: sempre aceito
  if (/^(mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(t)) return { ok: true, mensagem: 'E-mail para receber as candidaturas.' };

  if (/^http:\/\//i.test(t)) return { ok: false, mensagem: 'Use um link seguro, que começa com https://.' };

  let url: URL;
  try { url = new URL(linkSeguro(t)); } catch { return { ok: false, mensagem: 'Esse link não parece válido.' }; }
  if (url.protocol !== 'https:') return { ok: false, mensagem: 'Use um link seguro, que começa com https://.' };

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return { ok: false, mensagem: 'Links com endereço de IP não são aceitos. Use o endereço do site.' };
  }
  if (host.split('.').some((p) => p.startsWith('xn--'))) {
    return { ok: false, mensagem: 'Esse endereço usa caracteres especiais que imitam outros sites. Use o endereço normal do site.' };
  }
  if (ENCURTADORES.some((d) => pertence(host, d))) {
    return { ok: false, mensagem: 'Links encurtados não são aceitos, porque escondem o site de destino. Cole o link completo.' };
  }
  if (MENSAGEIROS.some((d) => pertence(host, d))) {
    return { ok: false, mensagem: 'Links de WhatsApp ou Telegram não são aceitos. Use um site, formulário ou e-mail do RH.' };
  }

  const siteEmpresa = dominioDe(empresa.site || '');
  const dominioEmail = dominioDe(empresa.email || '');
  if (pertence(host, siteEmpresa) || (!EMAILS_GRATUITOS.includes(dominioEmail) && pertence(host, dominioEmail))) {
    return { ok: true, mensagem: 'Link do site da sua empresa.' };
  }
  if (DOMINIOS_CONFIAVEIS.some((d) => pertence(host, d))) {
    return { ok: true, mensagem: 'Link de uma plataforma conhecida.' };
  }

  return {
    ok: false,
    mensagem: siteEmpresa
      ? `Esse link não é do site da sua empresa (${siteEmpresa}) nem de uma plataforma de vagas ou cursos conhecida. Use um deles ou um e-mail do RH.`
      : 'Esse link não é de uma plataforma de vagas ou cursos conhecida. Cadastre o site da sua empresa em Configurações para poder usar links dele, ou informe um e-mail do RH.',
  };
}
