/**
 * Como a mãe prefere receber ajuda para usar o site (reunião 21/11):
 *  - 'manual': guias passo a passo que abrem sozinhos nas telas ("Como funciona");
 *  - 'ia':     assistente virtual (botão "Elo" no canto da tela, components/assistente-ia);
 *              os guias continuam no botão "Como funciona", mas não abrem sozinhos.
 * Escolhida no cadastro e alterável no perfil. Fica em usuarios/{uid}.preferenciaSuporte
 * e uma cópia no navegador, para os guias saberem sem ler o banco.
 */
import { signal } from '@angular/core';

export type PreferenciaSuporte = 'ia' | 'manual';

export const OPCOES_SUPORTE: { valor: PreferenciaSuporte; titulo: string; texto: string; icone: string }[] = [
  { valor: 'manual', titulo: 'Guias passo a passo', texto: 'Explicações curtas aparecem nas telas na primeira vez.', icone: 'fa-solid fa-book-open' },
  { valor: 'ia', titulo: 'Assistente virtual (IA)', texto: 'Um assistente responde suas dúvidas sobre o site.', icone: 'fa-solid fa-robot' },
];

const CHAVE = 'elo_preferencia_suporte';

/** Valor atual, para as telas reagirem na hora (ex.: o botão do assistente aparece ao trocar no perfil). */
export const preferenciaSuporteAtual = signal<PreferenciaSuporte | null>(null);

export function lerPreferenciaLocal(): PreferenciaSuporte | null {
  try {
    const v = localStorage.getItem(CHAVE);
    const valor = v === 'ia' || v === 'manual' ? v : null;
    if (valor && preferenciaSuporteAtual() !== valor) preferenciaSuporteAtual.set(valor);
    return valor;
  } catch { return null; }
}

export function salvarPreferenciaLocal(v: PreferenciaSuporte | null | undefined) {
  try {
    if (v === 'ia' || v === 'manual') localStorage.setItem(CHAVE, v);
  } catch { /* sem storage */ }
  if (v === 'ia' || v === 'manual') preferenciaSuporteAtual.set(v);
}
