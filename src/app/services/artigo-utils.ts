import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../core/firebase';

// =============================================================
// DATA
// Os artigos são salvos com `datahorapost` (home-parc, home-psi, home-adv).
// Alguns antigos usam `data` ou `date`. Aceita Timestamp, Date, string ou {seconds}.
// =============================================================
export function dataDoArtigo(artigo: any): Date | null {
  const raw = artigo?.['datahorapost'] ?? artigo?.['data'] ?? artigo?.['date'] ?? null;
  if (!raw) return null;

  let d: Date | null = null;
  if (typeof raw.toDate === 'function') d = raw.toDate();
  else if (raw instanceof Date) d = raw;
  else if (typeof raw === 'string' || typeof raw === 'number') d = new Date(raw);
  else if (typeof raw.seconds === 'number') d = new Date(raw.seconds * 1000);

  return d && !isNaN(d.getTime()) ? d : null;
}

/** "06 nov" — ou "06 nov 2025" quando não é do ano atual. Vazio se não houver data. */
export function formatarDataArtigo(artigo: any): string {
  const d = dataDoArtigo(artigo);
  if (!d) return '';
  const mesmoAno = d.getFullYear() === new Date().getFullYear();
  return d
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', ...(mesmoAno ? {} : { year: 'numeric' }) })
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}

// =============================================================
// AUTOR E FONTE
// "Publicado por" = quem postou na plataforma.
// "Fonte" = de onde vem o conteúdo: o campo `fonte` (psi/adv) ou o site do link.
// =============================================================
export function autorDoArtigo(artigo: any): string {
  return artigo?.['postadoPor'] || artigo?.['autorNome'] || 'Equipe EloMaterno';
}

export function fonteDoArtigo(artigo: any): string {
  const fonte = (artigo?.['fonte'] || '').trim();
  if (fonte && fonte.toUpperCase() !== 'ELOMATERNO') return fonte;

  const link = (artigo?.['link'] || '').trim();
  if (link) {
    try {
      return new URL(link).hostname.replace(/^www\./, '');
    } catch { /* link inválido, segue */ }
  }
  return autorDoArtigo(artigo);
}

// =============================================================
// FAVORITOS
// Fonte da verdade: `usuarios/{uid}.favoritos` (lido pela página de favoritos).
// Também mantém `artigos/{id}.salvosPor` para o parceiro poder contar/ser notificado.
// =============================================================
export async function carregarIdsFavoritos(uid: string): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? ((snap.data()['favoritos'] as string[]) || []) : [];
  } catch (e) {
    console.error('Erro ao carregar favoritos:', e);
    return [];
  }
}

/** Salva/remove o favorito. Lança erro só se falhar no perfil da usuária. */
export async function definirFavorito(uid: string, artigoId: string, salvar: boolean): Promise<void> {
  const op = salvar ? arrayUnion : arrayRemove;
  // setDoc com merge: funciona mesmo se o documento ainda não tiver o campo
  await setDoc(doc(db, 'usuarios', uid), { favoritos: op(artigoId) }, { merge: true });

  // contador no artigo: não bloqueia se as regras não permitirem
  try {
    await updateDoc(doc(db, 'artigos', artigoId), { salvosPor: op(uid) });
  } catch (e) {
    console.warn('Não foi possível atualizar salvosPor do artigo:', e);
  }
}