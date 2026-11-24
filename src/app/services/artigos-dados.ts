/**
 * Postagens da Comunidade (artigos): um lugar só para buscar, ordenar e salvar.
 * Usado pela página de Comunidade e pela home da mãe, para as duas mostrarem os mesmos dados.
 */
import { db } from '../core/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { formatarDataArtigo, dataDoArtigo, autorDoArtigo, fonteDoArtigo, carregarIdsFavoritos, definirFavorito } from './artigo-utils';
import { prioridadeVisibilidade, visibilidadeEfetiva } from './divulgacao';

/** Todas as postagens (sem as removidas pela moderação), prontas para o card. */
export async function carregarArtigos(user: { uid: string } | null): Promise<any[]> {
  const [snap, favoritos] = await Promise.all([
    getDocs(collection(db, 'artigos')),
    user ? carregarIdsFavoritos(user.uid) : Promise.resolve([] as string[]),
  ]);

  return snap.docs.filter(d => !d.data()?.['moderacao']?.removido).map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      // nível de visibilidade (pacote de divulgação do parceiro); volta ao básico quando o pacote acaba
      visibilidade: visibilidadeEfetiva(data),
      dataString: formatarDataArtigo(data),
      autorExibido: autorDoArtigo(data),
      fonteExibida: fonteDoArtigo(data),
      // favoritos ficam no perfil da usuária (usuarios/{uid}.favoritos)
      salvo: user ? (favoritos.includes(d.id) || data['salvosPor']?.includes(user.uid) || false) : false
    };
  });
}

/** Ordem padrão ("Mais recentes"): quem tem pacote de divulgação primeiro, depois as mais novas. */
export function ordemPadraoArtigos(a: any, b: any): number {
  const porNivel = prioridadeVisibilidade(b.visibilidade) - prioridadeVisibilidade(a.visibilidade);
  if (porNivel) return porNivel;
  return (dataDoArtigo(b)?.getTime() || 0) - (dataDoArtigo(a)?.getTime() || 0);
}

/** Salvar / tirar dos salvos. Atualiza o objeto na hora e desfaz se o banco falhar. */
export async function alternarFavorito(artigo: any, uid: string): Promise<void> {
  const tinha = !!artigo.salvo;
  artigo.salvo = !tinha;
  try {
    await definirFavorito(uid, artigo.id, !tinha);
  } catch (err) {
    artigo.salvo = tinha;
    console.error('Erro ao salvar artigo', err);
  }
}
