# Assistente virtual "Elo" (Cloudflare Worker + Gemini, sem custo)

Este Worker é o "meio de campo" entre o site e a IA do Google (Gemini).
A chave do Gemini fica guardada só aqui, nunca no Angular.

```
Mãe digita no site ──► Worker (confere login e limite) ──► Gemini ──► resposta volta para o site
                                  │
                                  └── se falhar: o site responde pelas perguntas frequentes
```

## Publicar (uma vez só)

1. **Criar a chave grátis do Gemini**
   - Entre em https://aistudio.google.com com uma conta Google do grupo.
   - Clique em **Get API key** → **Create API key**. Copie a chave (começa com `AIza...`).
   - Não precisa cadastrar cartão. Não cole essa chave em nenhum arquivo do projeto.

2. **Instalar as dependências** (no terminal do VS Code):
   ```powershell
   cd assistente-ia
   npm install
   ```

3. **Entrar na Cloudflare** (a mesma conta do Worker da videochamada):
   ```powershell
   npx wrangler login
   ```

4. **Guardar a chave como segredo** (ele pede para colar a chave):
   ```powershell
   npx wrangler secret put GEMINI_API_KEY
   ```

5. **Publicar**:
   ```powershell
   npm run deploy
   ```
   No fim aparece o endereço, algo como `https://elo-materno-assistente.elomaterno.workers.dev`.
   Ele precisa ser igual ao `URL_ASSISTENTE` em `src/app/services/assistente-ia.ts`.
   Se for diferente, troque lá.

## Testar

- Rode o site (`ng serve`), entre como mãe, vá em **Meu perfil → Ajuda para usar o site →
  Assistente virtual (IA)**. O botão "Dúvidas? Fale com a Elo" aparece no canto de baixo.
- Se a resposta vier com "Resposta das perguntas frequentes", o Worker não respondeu.
  Veja o motivo com:
  ```powershell
  npx wrangler tail
  ```
  (mostra os erros ao vivo enquanto você testa)

## Mudar o que a Elo sabe

Tudo o que ela sabe sobre o site está em `src/conhecimento.ts`.
Mudou uma tela? Atualize o texto e rode `npm run deploy` de novo.

## Configurações (wrangler.toml)

| Nome | Para que serve |
|---|---|
| `ALLOWED_ORIGINS` | Sites que podem usar o assistente. Se o endereço do site mudar, adicione aqui. |
| `GEMINI_MODELO` | Modelo do Gemini. Se der erro de modelo, troque pelo nome que aparece no AI Studio. |
| `LIMITE_DIARIO` | Perguntas por mãe por dia (protege a cota grátis). |

## Cuidados

- No plano grátis, o Google pode usar os textos para melhorar os produtos dele. Por isso:
  o Worker apaga CPF, e-mail e telefone antes de enviar, o site avisa a mãe para não escrever
  dados pessoais e mensagens de crise nem chegam a sair do celular (o site responde na hora com CVV 188).
- A Elo só explica como usar o site. Não dá orientação psicológica, jurídica nem médica.
