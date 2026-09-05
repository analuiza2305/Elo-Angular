import { Injectable } from '@angular/core';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { environment } from '../../../environments/environment';

/**
 * Serviço de verificação de e-mail por código de 6 dígitos.
 *
 * Não usa o link nativo do Firebase (sendEmailVerification) porque o
 * fluxo pedido é: mãe se cadastra → recebe um CÓDIGO por e-mail →
 * digita o código numa tela própria → volta pro login e entra.
 *
 * Como o projeto não tem back-end (Cloud Functions/Blaze), o e-mail é
 * enviado direto do navegador via EmailJS (https://www.emailjs.com/),
 * que tem plano gratuito (200 e-mails/mês) e não exige cartão.
 *
 * O código fica salvo no próprio documento `usuarios/{uid}` (campos
 * `codigoVerificacao` e `codigoExpiraEm`), então as regras de segurança
 * do Firestore de "usuarios" (o próprio usuário lê/escreve o seu doc)
 * já protegem esses campos — não é preciso criar coleção nova nem
 * abrir leitura pública.
 */
@Injectable({ providedIn: 'root' })
export class EmailVerificationService {
  private readonly VALIDADE_MINUTOS = 15;

  private gerarCodigo(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /**
   * Gera um novo código, salva no Firestore (usuarios/{uid}) e envia
   * por e-mail via EmailJS. Use tanto no cadastro quanto no "reenviar
   * código".
   */
  async gerarEEnviarCodigo(uid: string, email: string, nome: string): Promise<void> {
    const codigo = this.gerarCodigo();
    const expiraEm = Date.now() + this.VALIDADE_MINUTOS * 60 * 1000;

    await updateDoc(doc(db, 'usuarios', uid), {
      emailVerificado: false,
      codigoVerificacao: codigo,
      codigoExpiraEm: expiraEm,
    });

    await this.enviarEmail(email, nome, codigo);
  }

  private async enviarEmail(email: string, nome: string, codigo: string): Promise<void> {
    const { serviceId, templateId, publicKey } = environment.emailjs;

    if (!serviceId || !publicKey) {
      // Configuração ainda não preenchida em environment.ts — evita
      // travar o cadastro com um erro confuso do EmailJS.
      console.warn(
        'EmailJS não configurado (environment.emailjs). Código gerado mas e-mail não enviado:',
        codigo,
      );
      return;
    }

    const resposta = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: email,
          to_name: nome || 'mãe',
          codigo,
        },
      }),
    });

    if (!resposta.ok) {
      throw new Error('Não foi possível enviar o e-mail de verificação.');
    }
  }

  /**
   * Confere o código digitado contra o que está salvo em
   * usuarios/{uid}. Em caso de sucesso, marca emailVerificado: true e
   * limpa o código (não pode ser reutilizado).
   */
  async verificarCodigo(uid: string, codigoDigitado: string): Promise<{ ok: boolean; motivo?: 'expirado' | 'incorreto' | 'nao_encontrado' }> {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    if (!snap.exists()) return { ok: false, motivo: 'nao_encontrado' };

    const dados = snap.data();
    const codigoSalvo = dados['codigoVerificacao'];
    const expiraEm = dados['codigoExpiraEm'];

    if (!codigoSalvo || !expiraEm) return { ok: false, motivo: 'nao_encontrado' };
    if (Date.now() > expiraEm) return { ok: false, motivo: 'expirado' };
    if (codigoDigitado.trim() !== codigoSalvo) return { ok: false, motivo: 'incorreto' };

    await updateDoc(doc(db, 'usuarios', uid), {
      emailVerificado: true,
      codigoVerificacao: null,
      codigoExpiraEm: null,
    });

    return { ok: true };
  }
}
