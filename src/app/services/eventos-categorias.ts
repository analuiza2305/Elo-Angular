/**
 * Categorias de evento: UMA lista só, usada pela empresa ao publicar
 * (painel do parceiro) e pelas mães ao filtrar (página Eventos).
 *
 * O evento grava a chave em `categoria` (e também em `tipo`, que é o campo
 * que o painel do parceiro usava antes).
 */
export interface CategoriaEvento {
  chave: string;
  nome: string;
  icone: string;
  cor: string;
}

export const CATEGORIAS_EVENTO: CategoriaEvento[] = [
  { chave: 'palestras', nome: 'Palestras', icone: 'fa-solid fa-microphone', cor: '#2d2d7a' },
  { chave: 'oficinas', nome: 'Oficinas', icone: 'fa-solid fa-cookie', cor: '#4caf6b' },
  { chave: 'encontros', nome: 'Encontros', icone: 'fa-solid fa-users', cor: '#e0524f' },
  { chave: 'atividades', nome: 'Atividades', icone: 'fa-solid fa-heart', cor: '#37c1d1' },
];

/** Eventos antigos foram gravados com as categorias velhas do painel do parceiro. */
const CATEGORIAS_ANTIGAS: Record<string, string> = {
  psicologo: 'palestras',
  juridico: 'palestras',
  apoio: 'encontros',
  oficinas: 'oficinas',
};

/** Chave da categoria de um evento do Firestore (novo ou antigo). */
export function categoriaDoEvento(data: any): string {
  const bruta = String(data?.categoria || data?.tipo || '').toLowerCase().trim();
  if (CATEGORIAS_EVENTO.some((c) => c.chave === bruta)) return bruta;
  return CATEGORIAS_ANTIGAS[bruta] || 'atividades';
}

export function infoCategoriaEvento(chave: string): CategoriaEvento {
  return CATEGORIAS_EVENTO.find((c) => c.chave === chave) || CATEGORIAS_EVENTO[CATEGORIAS_EVENTO.length - 1];
}
