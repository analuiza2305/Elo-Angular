/**
 * Polyfill do Buffer para o ambiente de SSR do Netlify (Edge Functions).
 *
 * O runtime Edge do Netlify não é Node.js "de verdade" — é mais parecido
 * com um navegador/Deno. Ele não tem a API global `Buffer`, que é do Node.
 *
 * O Firebase (mais especificamente o Firestore, via @grpc/grpc-js) espera
 * que `Buffer` exista globalmente. Sem isso, qualquer requisição que passe
 * pelo servidor (incluindo pedidos de imagens, manifest.json, etc, que
 * caem no mesmo handler) quebra com:
 *   ReferenceError: Buffer is not defined
 *
 * Este arquivo precisa ser importado ANTES de qualquer outra coisa em
 * src/server.ts, pra garantir que `Buffer` já exista no momento em que
 * o Firebase for carregado.
 */
import { Buffer } from 'buffer';

if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}
