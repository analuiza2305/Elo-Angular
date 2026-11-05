<h1 align="center">💜 Elo Materno</h1>

<p align="center">
  Plataforma de apoio a mães solo: rede de acolhimento, profissionais, eventos e cuidado em um só lugar.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Angular-21-DD0031?logo=angular&logoColor=white" alt="Angular 21">
  <img src="https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore-FFCA28?logo=firebase&logoColor=black" alt="Firebase">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Deploy-Netlify-00C7B7?logo=netlify&logoColor=white" alt="Netlify">
</p>

<p align="center">
  🌐 <a href="https://elomaterno.netlify.app">elomaterno.netlify.app</a>
</p>

---

## 📖 Sobre o projeto

O **Elo Materno** é uma plataforma web pensada para mães solo, que reúne em um só lugar apoio emocional, jurídico e prático. Entre as funcionalidades estão:

- Cadastro e login com verificação de e-mail
- Agenda da mãe com lembretes
- Busca de profissionais (psicologia, jurídico) e agendamento de consultas
- Videochamadas entre mãe e profissional
- Eventos, artigos e favoritos
- Questionários de bem-estar
- Geração de documentos em PDF a partir de modelos

---

## 🛠️ Tecnologias

| Tecnologia | Para que é usada |
|---|---|
| [Angular 21](https://angular.dev/) + SSR | Framework do front-end, com renderização no servidor |
| [Firebase](https://firebase.google.com/) (Auth + Firestore) | Login de usuárias e banco de dados |
| [Chart.js](https://www.chartjs.org/) | Gráficos (ex.: questionários de bem-estar) |
| [jsPDF](https://github.com/parallax/jsPDF) | Geração de documentos em PDF |
| [EmailJS](https://www.emailjs.com/) | Envio do código de verificação de e-mail |
| [Jitsi / JaaS (8x8)](https://jaas.8x8.vc/) | Videochamadas |
| [Cloudflare Workers](https://workers.cloudflare.com/) | Backend leve (`video-token/`) que gera o token das chamadas e envia e-mails agendados |
| [Vitest](https://vitest.dev/) | Testes unitários |
| [Netlify](https://www.netlify.com/) | Hospedagem do site |

---

## ✅ Pré-requisitos

Antes de começar, instale na sua máquina:

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) **versão 20.19 ou superior** (recomendado: a versão LTS mais recente)
- npm (já vem junto com o Node.js)

Para conferir se está tudo certo:

```bash
git --version
node -v
npm -v
```

> 💡 Não é obrigatório instalar o Angular CLI globalmente: os comandos `npm start`, `npm run build` e `npm test` já usam a versão do projeto.

---

## 🚀 Como rodar o projeto

**1. Clone o repositório**

```bash
git clone https://github.com/analuiza2305/Elo-Angular.git
```

**2. Entre na pasta do projeto**

```bash
cd Elo-Angular
```

**3. Instale as dependências**

```bash
npm install
```

**4. Inicie o servidor de desenvolvimento**

```bash
npm start
```

**5. Abra no navegador**

Acesse [http://localhost:4200](http://localhost:4200). A página recarrega sozinha sempre que você salvar algum arquivo.

---

## 🔐 Configuração (Firebase e EmailJS)

As configurações do front-end ficam em:

```
src/environments/environment.ts              → usado no build de produção
src/environments/environment.development.ts  → usado no npm start
```

Cada arquivo tem este formato:

```ts
export const environment = {
  production: false,
  firebase: {
    apiKey: 'SUA_API_KEY',
    authDomain: 'seu-projeto.firebaseapp.com',
    projectId: 'seu-projeto',
    storageBucket: 'seu-projeto.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:xxxxxxxxxxxx',
    measurementId: 'G-XXXXXXXXXX',
  },
  emailjs: {
    serviceId: 'service_xxxxxxx',
    templateId: 'template_xxxxxxx',
    publicKey: 'xxxxxxxxxxxxxxxxx',
  },
};
```

**Onde encontrar cada valor:**

- **Firebase:** [Console do Firebase](https://console.firebase.google.com/) → seu projeto → ⚙️ Configurações do projeto → Seus apps → app Web.
- **EmailJS:** [emailjs.com](https://www.emailjs.com/) → *Email Services* (serviceId), *Email Templates* (templateId) e *Account → General* (publicKey).

> ⚠️ **Sobre segurança:** essas chaves do Firebase e do EmailJS são *públicas por natureza* — elas vão para o navegador de qualquer pessoa que abrir o site. Quem protege os dados são as **regras de segurança do Firestore** e as **restrições de domínio** configuradas em cada serviço, não o sigilo da chave. **Nunca** coloque aqui chaves privadas, contas de serviço (`*adminsdk*.json`) ou chaves de API de servidor.

---

## 🎥 Worker de videochamada (`video-token/`)

A pasta `video-token/` é um **Cloudflare Worker** separado do Angular. Ele gera os tokens das videochamadas (JaaS) e dispara e-mails de lembrete. **Só é necessário mexer nele se você for trabalhar nessas funcionalidades**; o site roda normalmente sem ele, apenas sem as chamadas de vídeo.

**Rodar localmente:**

```bash
cd video-token
npm install
cp .dev.vars.example .dev.vars   # depois preencha com os valores reais
npm run dev
```

**Publicar:**

```bash
npm run deploy
```

As variáveis **públicas** ficam em `video-token/wrangler.toml`. Os **segredos** nunca vão para o repositório: localmente ficam em `video-token/.dev.vars` (já ignorado pelo Git) e, em produção, são cadastrados com:

```bash
npx wrangler secret put NOME_DO_SEGREDO
```

Segredos usados pelo Worker: `JAAS_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `BREVO_API_KEY` e `CHAVE_TESTE`.

---

## 📜 Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm start` | Roda o projeto em modo de desenvolvimento em `localhost:4200` |
| `npm run build` | Gera a versão de produção na pasta `dist/` |
| `npm run watch` | Gera o build de desenvolvimento e refaz a cada alteração |
| `npm test` | Executa os testes unitários com Vitest |
| `npm run serve:ssr:elomaterno` | Roda a versão de produção com SSR (depois do `build`) |

---

## 📁 Estrutura de pastas

```
Elo-Angular/
├── public/                 # Imagens, fontes e favicon
├── src/
│   ├── app/
│   │   ├── components/     # Componentes reutilizáveis (header, footer, alertas...)
│   │   ├── core/           # Firebase, serviços centrais e guards de rota
│   │   ├── pages/          # Páginas da aplicação
│   │   └── services/       # Regras de negócio (lembretes, PDFs, questionários...)
│   └── environments/       # Configurações do Firebase e EmailJS
├── video-token/            # Cloudflare Worker (videochamada e e-mails)
├── angular.json
└── package.json
```

---

## 🧯 Problemas comuns

**`npm install` dá erro de versão do Node**
Confira com `node -v`. O Angular 21 precisa do Node 20.19 ou superior.

**A porta 4200 já está em uso**
Rode em outra porta: `npm start -- --port 4300`.

**Erros de Firebase como `window is not defined`**
O projeto usa SSR, então parte do código roda no servidor (Node), onde não existe `window`. Envolva chamadas que só funcionam no navegador com `isPlatformBrowser` (veja o comentário em `src/app/core/firebase.ts`).

**Videochamada não conecta**
Verifique se o Worker está publicado e se o endereço em `src/app/pages/videochamada/videochamada.ts` (`URL_TOKEN_VIDEO`) aponta para ele.

---

## 👩‍💻 Equipe

| Nome             |
| Ana Luiza        |
| Emily Rorigues   |
| João Victor      |
| Michelly Moreira |
| Samyra Alves     |

---

<p align="center">Feito com 💜 para todas as mães que fazem tudo sozinhas.</p>
