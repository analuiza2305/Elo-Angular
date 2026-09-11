import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  DocumentData,
  QueryConstraint,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { db } from '../firebase';

/**
 * Serviço genérico de acesso ao Firestore.
 *
 * Concentra as operações que antes ficavam espalhadas pelos arquivos
 * js/adminDashboard.js, js/home-parc.js etc. (getDocs, addDoc,
 * updateDoc, deleteDoc, onSnapshot...) em um único lugar tipado, para
 * os componentes (Adm, HomeParc, ...) apenas consumirem via injeção
 * de dependência.
 */
@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Leitura única de uma coleção (equivalente a getDocs). */
  async getCollection<T = DocumentData>(path: string, ...constraints: QueryConstraint[]): Promise<T[]> {
    const ref = collection(db, path);
    const q = constraints.length ? query(ref, ...constraints) : ref;
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
  }

  /** Leitura única de um documento (equivalente a getDoc). */
  async getById<T = DocumentData>(path: string, id: string): Promise<T | null> {
    const snap = await getDoc(doc(db, path, id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
  }

  /**
   * Observable em tempo real de uma coleção (equivalente ao onSnapshot
   * antigo). Só escuta de fato no browser; no SSR emite uma vez com
   * array vazio para não travar a renderização do servidor.
   */
  collection$<T = DocumentData>(path: string, ...constraints: QueryConstraint[]): Observable<T[]> {
    return new Observable((subscriber) => {
      if (!this.isBrowser) {
        subscriber.next([]);
        return;
      }
      const ref = collection(db, path);
      const q = constraints.length ? query(ref, ...constraints) : ref;
      return onSnapshot(
        q,
        (snap) => subscriber.next(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
        (err) => subscriber.error(err),
      );
    });
  }

  add(path: string, data: DocumentData) {
    return addDoc(collection(db, path), data);
  }

  set(path: string, id: string, data: DocumentData, merge = true) {
    return setDoc(doc(db, path, id), data, { merge });
  }

  update(path: string, id: string, data: Partial<DocumentData>) {
    return updateDoc(doc(db, path, id), data);
  }

  remove(path: string, id: string) {
    return deleteDoc(doc(db, path, id));
  }
}
