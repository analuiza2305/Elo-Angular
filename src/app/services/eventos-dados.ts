/**
 * Eventos: um lugar só para buscar, ordenar e cuidar das inscrições.
 * Usado pela página de Eventos e pela home da mãe, para as duas mostrarem os mesmos dados
 * e o mesmo modal (components/evento-detalhes).
 */
import { Injectable, signal } from '@angular/core';
import { db } from '../core/firebase';
import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { prioridadeVisibilidade, visibilidadeEfetiva } from './divulgacao';
import { categoriaDoEvento, infoCategoriaEvento } from './eventos-categorias';

/** Converte o documento do Firestore no formato que o card e o modal usam. */
export function mapearEvento(id: string, data: any): any {
  let dataFormatada = '';
  let dataObj: Date | null = null;
  let dia = '23';
  let mes = 'JUN';

  const rawDate = data['data'] ?? data['date'] ?? null;
  if (rawDate && rawDate.toDate) {
    dataObj = rawDate.toDate();
  } else if (typeof rawDate === 'string') {
    dataObj = new Date(rawDate);
  }

  if (dataObj && !isNaN(dataObj.getTime())) {
    dataFormatada = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) +
                    ' às ' +
                    dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    dia = String(dataObj.getDate()).padStart(2, '0');
    mes = dataObj.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
  }

  const encerrado = !!dataObj && dataObj.getTime() < Date.now();

  return {
    id,
    ...data,
    // mesma lista de categorias do painel do parceiro (eventos antigos são convertidos)
    categoria: categoriaDoEvento(data),
    categoriaNome: infoCategoriaEvento(categoriaDoEvento(data)).nome,
    // evento que já passou perde o destaque pago e vai para o fim da lista
    visibilidade: encerrado ? 'basico' : visibilidadeEfetiva(data),
    encerrado,
    dataObj,
    dataFormatada,
    dia,
    mes,
  };
}

/** Próximos primeiro (destaque pago na frente, depois o mais próximo); encerrados no fim, do mais recente ao mais antigo. */
export function ordemPadraoEventos(a: any, b: any): number {
  if (a.encerrado !== b.encerrado) return a.encerrado ? 1 : -1;
  const ta = a.dataObj?.getTime() || 0;
  const tb = b.dataObj?.getTime() || 0;
  if (a.encerrado) return tb - ta;
  return prioridadeVisibilidade(b.visibilidade) - prioridadeVisibilidade(a.visibilidade) || ta - tb;
}

/** Todos os eventos (sem os removidos pela moderação), já na ordem padrão. */
export async function carregarEventos(): Promise<any[]> {
  const snap = await getDocs(collection(db, 'eventos'));
  const lista: any[] = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (data?.['moderacao']?.removido) return; // removido pela moderação
    lista.push(mapearEvento(docSnap.id, data));
  });
  return lista.sort(ordemPadraoEventos);
}

/**
 * Inscrições da mãe nos eventos (usuarios/{uid}.eventosInscritos).
 * Um serviço só, assim a página de Eventos e a home ficam sempre em sincronia.
 */
@Injectable({ providedIn: 'root' })
export class InscricoesEventosService {
  readonly inscritos = signal<any[]>([]);
  private uidCarregado = '';

  async carregar(uid: string | null | undefined) {
    if (!uid) { this.inscritos.set([]); this.uidCarregado = ''; return; }
    try {
      const snap = await getDoc(doc(db, 'usuarios', uid));
      this.inscritos.set(snap.exists() ? (snap.data()['eventosInscritos'] || []) : []);
      this.uidCarregado = uid;
    } catch (err) {
      console.error('Erro ao carregar inscrições:', err);
      this.inscritos.set([]);
    }
  }

  isInscrito(eventoId: string | undefined): boolean {
    return !!eventoId && this.inscritos().some(e => e.id === eventoId);
  }

  async inscrever(uid: string, evento: any) {
    const novo = {
      id: evento.id,
      titulo: evento.titulo ?? '',
      descricao: evento.descricao ?? '',
      // a Agenda da mãe lê essa data para pôr o evento no calendário
      date: evento.dataObj ? evento.dataObj.toISOString() : '',
      capa: evento.capa ?? '',
      local: evento.local ?? ''
    };
    const lista = [...this.inscritos(), novo];
    await updateDoc(doc(db, 'usuarios', uid), { eventosInscritos: lista });
    this.inscritos.set(lista);
  }

  async cancelar(uid: string, evento: any) {
    const lista = this.inscritos().filter((e: any) => e.id !== evento.id);
    await updateDoc(doc(db, 'usuarios', uid), { eventosInscritos: lista });
    this.inscritos.set(lista);
  }
}
