import { Component, ElementRef, NgZone, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { onAuthStateChanged, signOut, Unsubscribe } from 'firebase/auth';
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';

/**
 * Pede o CPF da mãe UMA vez, depois do cadastro/login (o CPF não pode ser pedido
 * no cadastro). Enquanto não for informado, o modal fica por cima de qualquer
 * página e não pode ser fechado — a única saída é "Sair da conta".
 *
 * Unicidade sem Cloud Functions (plano Spark): cada CPF vira um documento
 * cpfs/{hash}. As regras do Firestore só deixam CRIAR esse documento, nunca
 * sobrescrever, então o mesmo CPF não entra em duas contas.
 * O número em si não é salvo: guardamos só o hash (SHA-256).
 */

// Telas em que o modal não aparece (login, cadastro e verificação de e-mail)
const ROTAS_LIVRES = new Set(['', 'login', 'login-profissional', 'cadastro', 'cadastro-profissional', 'verificar-email']);
const PIMENTA = 'elo-materno::cpf::v1';

@Component({
  selector: 'app-cpf-obrigatorio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cpf-obrigatorio.html',
  styleUrls: ['./cpf-obrigatorio.css'],
})
export class CpfObrigatorioComponent implements OnDestroy {
  private router = inject(Router);
  private zone = inject(NgZone);
  private host = inject(ElementRef<HTMLElement>);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));

  aberto = signal(false);
  salvando = signal(false);
  erro = signal('');
  concluido = signal(false);
  cpf = '';
  nome = '';

  private precisaCpf = false;
  private uid = '';
  private rotaLivre = true;
  private pararAuth?: Unsubscribe;
  private pararDoc?: Unsubscribe;
  private subRotas?: Subscription;

  constructor() {
    if (!this.browser) return;

    this.rotaLivre = this.ehRotaLivre(this.router.url);
    this.subRotas = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => { this.rotaLivre = this.ehRotaLivre(e.urlAfterRedirects); this.atualizar(); });

    this.pararAuth = onAuthStateChanged(auth, user => {
      this.pararDoc?.();
      this.pararDoc = undefined;
      this.precisaCpf = false;
      this.uid = user?.uid || '';
      if (!user) { this.zone.run(() => this.atualizar()); return; }

      this.pararDoc = onSnapshot(doc(db, 'usuarios', user.uid), snap => {
        this.zone.run(() => {
          const d: any = snap.exists() ? snap.data() : null;
          const tipo = String(d?.tipo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          this.nome = String(d?.nome || '').split(' ')[0];
          this.precisaCpf = !!d && tipo.includes('mae') && !d.cpfHash;
          this.atualizar();
        });
      }, () => {});
    });
  }

  ngOnDestroy(): void {
    this.pararAuth?.();
    this.pararDoc?.();
    this.subRotas?.unsubscribe();
    this.travarFundo(false);
  }

  private ehRotaLivre(url: string): boolean {
    return ROTAS_LIVRES.has(url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, ''));
  }

  private atualizar(): void {
    const mostrar = this.precisaCpf && !this.rotaLivre && !this.concluido();
    if (mostrar === this.aberto()) return;
    this.aberto.set(mostrar);
    this.travarFundo(mostrar);
    if (mostrar) setTimeout(() => this.host.nativeElement.querySelector('input')?.focus(), 350);
  }

  // Deixa o resto do site sem clique, sem Tab e sem rolagem enquanto o modal está aberto
  private travarFundo(travar: boolean): void {
    if (!this.browser) return;
    const el = this.host.nativeElement as HTMLElement;
    const irmaos = Array.from(el.parentElement?.children || []).filter(c => c !== el);
    irmaos.forEach(c => travar ? c.setAttribute('inert', '') : c.removeAttribute('inert'));
    document.documentElement.style.overflow = travar ? 'hidden' : '';
    document.body.style.overflow = travar ? 'hidden' : '';
  }

  get digitos(): string { return this.cpf.replace(/\D/g, ''); }

  formatar(valor: string): void {
    const d = valor.replace(/\D/g, '').slice(0, 11);
    let f = d;
    if (d.length > 9) f = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    else if (d.length > 6) f = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    else if (d.length > 3) f = `${d.slice(0, 3)}.${d.slice(3)}`;
    this.cpf = f;
    this.erro.set('');
  }

  static cpfValido(d: string): boolean {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (n: number) => {
      let soma = 0;
      for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }

  private async gerarHash(d: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${PIMENTA}:${d}`));
    return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async salvar(): Promise<void> {
    if (this.salvando()) return;
    const d = this.digitos;
    if (d.length < 11) { this.erro.set('Digite os 11 números do CPF.'); return; }
    if (!CpfObrigatorioComponent.cpfValido(d)) { this.erro.set('Esse CPF não é válido. Confira os números e tente de novo.'); return; }
    if (!this.uid) return;

    this.salvando.set(true);
    this.erro.set('');
    try {
      const hash = await this.gerarHash(d);
      const uid = this.uid;
      await runTransaction(db, async tx => {
        const refCpf = doc(db, 'cpfs', hash);
        const snap = await tx.get(refCpf);
        if (snap.exists() && snap.data()['uid'] !== uid) throw new Error('CPF_EM_USO');
        if (!snap.exists()) tx.set(refCpf, { uid, criadoEm: serverTimestamp() });
        tx.update(doc(db, 'usuarios', uid), { cpfHash: hash, cpfFinal: d.slice(-2), cpfInformadoEm: serverTimestamp() });
      });
      this.concluido.set(true);
      setTimeout(() => { this.concluido.set(false); this.atualizar(); }, 1800);
    } catch (e: any) {
      // permission-denied ao ler cpfs/{hash} = o documento é de outra conta
      if (e?.message === 'CPF_EM_USO' || e?.code === 'permission-denied') {
        this.erro.set('Esse CPF já está ligado a outra conta da Elo Materno. Se você já tem conta, entre com ela. Se acha que é um engano, fale com o suporte.');
      } else {
        console.error('Erro ao salvar CPF:', e);
        this.erro.set('Não foi possível salvar agora. Verifique sua internet e tente de novo.');
      }
    } finally {
      this.salvando.set(false);
    }
  }

  async sair(): Promise<void> {
    await signOut(auth);
    this.router.navigate(['/login']);
  }
}
