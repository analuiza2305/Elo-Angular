/**
 * Posts do fórum: um lugar só para buscar e curtir.
 * Usado pela página do fórum e pela home da mãe, para os dois mostrarem
 * exatamente os mesmos dados (nome/foto da autora, anônimo, curtidas, comentários).
 */
import { db } from '../core/firebase';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc, deleteDoc, setDoc, updateDoc, increment, getCountFromServer
} from 'firebase/firestore';

export interface OpcoesPostsForum {
  /** quantos posts buscar (o fórum busca 20) */
  limite: number;
  /** quem está logada (para saber se já curtiu) */
  user: { uid: string } | null;
  /** autorId de quem está logada (mãe: uid; parceiro: 'parc_' + uid) */
  meuAutorId: string;
  /** dentro do painel do parceiro */
  embutido?: boolean;
}

/** Busca os posts mais recentes, já prontos para o card (sem os removidos pela moderação). */
export async function carregarPostsForum(opcoes: OpcoesPostsForum): Promise<any[]> {
  const q = query(collection(db, 'posts'), orderBy('data', 'desc'), limit(opcoes.limite));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return [];
  const user = opcoes.user;

  const postsList = await Promise.all(snapshot.docs.map(async (docSnap) => {
    const p = docSnap.data();
    const postId = docSnap.id;

    let autorNome = p['autorNome'] || 'Usuária';
    let autorFoto = p['autorFoto'] || './img/account_icon.png';

    if (p['autorId'] && String(p['autorId']).startsWith('parc_')) {
      // empresa parceira: o nome e a foto ficam gravados no próprio post
    } else if (p['autorId'] && p['autorId'] !== 'anonimo') {
      try {
        const userSnap = await getDoc(doc(db, 'usuarios', p['autorId']));
        if (userSnap.exists()) {
          const uData = userSnap.data();
          autorNome = uData['nome'] || autorNome;
          autorFoto = uData['avatar'] || uData['fotoURL'] || autorFoto;
        }
      } catch (e) { console.error(e); }
    }
    if (p['autorId'] === 'anonimo') {
      autorNome = 'Anônimo';
      autorFoto = './img/account_icon.png';
    }

    let jaCurtiu = false;
    let totalComentarios = 0;
    // "ehMeu": o post é de quem está logada? Nos anônimos o autorId é só 'anonimo',
    // então a dona é descoberta pelo vínculo privado em `postsAutores/{postId}`.
    let ehMeu = !!user && p['autorId'] === opcoes.meuAutorId;
    const promisesExtras = [];
    if (user && p['autorId'] === 'anonimo' && !opcoes.embutido) {
      promisesExtras.push(
        getDoc(doc(db, 'postsAutores', postId)).then(vinculo => {
          ehMeu = vinculo.exists() && vinculo.data()['uid'] === user.uid;
        }).catch(() => {}) // sem permissão de leitura = não é dela
      );
    }
    if (user) {
      promisesExtras.push(
        getDoc(doc(db, 'posts', postId, 'likes', user.uid)).then(likeSnap => {
          jaCurtiu = likeSnap.exists();
        }).catch(() => {})
      );
    }
    promisesExtras.push(
      getCountFromServer(collection(db, 'posts', postId, 'comentarios')).then(comSnap => {
        totalComentarios = comSnap.data().count;
      }).catch(() => {})
    );
    await Promise.all(promisesExtras);

    return {
      id: postId,
      ...p,
      autorNomeFinal: autorNome,
      autorFotoFinal: autorFoto,
      dataFormatada: p['data']?.toDate
        ? p['data'].toDate().toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Agora',
      jaCurtiu,
      totalComentarios,
      ehMeu
    };
  }));

  // Esconde do fórum público os posts removidos pela moderação do admin
  return postsList.filter((p: any) => !p.moderacao?.removido);
}

/** Curtir / descurtir (subcoleção posts/{id}/likes + contador "likes"). Atualiza o objeto na hora. */
export async function curtirPost(post: any, uid: string): Promise<void> {
  const likeRef = doc(db, 'posts', post.id, 'likes', uid);
  const postRef = doc(db, 'posts', post.id);
  const tinha = !!post.jaCurtiu;
  try {
    if (tinha) {
      post.jaCurtiu = false;
      post.likes = Math.max(0, (post.likes || 1) - 1);
      await deleteDoc(likeRef);
      await updateDoc(postRef, { likes: increment(-1) });
    } else {
      post.jaCurtiu = true;
      post.likes = (post.likes || 0) + 1;
      await setDoc(likeRef, { curtido: true });
      await updateDoc(postRef, { likes: increment(1) });
    }
  } catch (err) {
    post.jaCurtiu = tinha;
    post.likes = Math.max(0, (post.likes || 0) + (tinha ? 1 : -1));
    console.error('Erro ao curtir:', err);
  }
}
