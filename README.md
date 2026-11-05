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

### Front-end

| Tecnologia | Para que é usada |
|---|---|
| [Angular 21](https://angular.dev/) + SSR | Framework do front-end, com renderização no servidor |
| [Express 5](https://expressjs.com/) | Servidor Node que roda o SSR |
| [TypeScript 5.9](https://www.typescriptlang.org/) | Linguagem do projeto |
| [RxJS 7.8](https://rxjs.dev/) | Programação reativa (observables) |
| [Firebase](https://firebase.google.com/) (Auth + Firestore) + [@angular/fire](https://github.com/angular/angularfire) | Login de usuárias e banco de dados |
| [Chart.js](https://www.chartjs.org/) | Gráficos (ex.: questionários de bem-estar) |
| [jsPDF](https://github.com/parallax/jsPDF) | Geração de documentos em PDF |
| [EmailJS](https://www.emailjs.com/) | Envio do código de verificação de e-mail |
| [Jitsi / JaaS (8x8)](https://jaas.8x8.vc/) | Videochamadas |
| [BrasilAPI](https://brasilapi.com.br/) | Consulta de CNPJ no cadastro de parceiros |
| [VLibras](https://www.gov.br/governodigital/pt-br/vlibras) | Tradução do conteúdo para Libras |
| [Google Fonts](https://fonts.google.com/), [Font Awesome](https://fontawesome.com/), [Phosphor Icons](https://phosphoricons.com/), [FlagCDN](https://flagcdn.com/) | Fontes, ícones e bandeiras do seletor de idioma |
| [Vitest](https://vitest.dev/) + jsdom | Testes unitários |
| [Prettier](https://prettier.io/) | Formatação de código |
| [Netlify](https://www.netlify.com/) | Hospedagem do site (com SSR) |

### Backend (`video-token/`)

| Tecnologia | Para que é usada |
|---|---|
| [Cloudflare Workers](https://workers.cloudflare.com/) + Wrangler | Backend leve que gera o token das chamadas e envia e-mails agendados |
| Cron Triggers (a cada 10 min) | Dispara os lembretes automáticos |
| [jose](https://github.com/panva/jose) | Criação e validação de tokens JWT (JaaS e login do Firebase) |
| [Mailjet](https://www.mailjet.com/) **ou** [Brevo](https://www.brevo.com/) | Envio dos e-mails de lembrete (o código aceita os dois) |
| Firestore REST API + Google OAuth2 | O Worker lê e grava no banco usando uma conta de serviço |

### APIs nativas do navegador

Web Speech (`speechSynthesis`, leitura em voz alta), Notifications (aviso de consulta), Service Worker + Web Manifest (PWA), IntersectionObserver (animações), Web Share e Clipboard (compartilhar eventos) e localStorage (preferências).

---

## 💰 Custos do projeto

Esta seção lista **tudo o que o projeto usa e quanto cada item custa**, inclusive o que hoje está no plano gratuito. O objetivo é que qualquer pessoa que for manter ou expandir o Elo Materno saiba quanto vai gastar conforme o número de usuárias cresce.

> 📅 Valores pesquisados em **novembro de 2026** nas páginas oficiais de cada serviço. Preços mudam com frequência; confira os links antes de contratar.
>
> 💱 **Conversão usada:** US$ 1 = R$ 5,50 (arredondado) **+ 3,5% de IOF** de compra internacional no cartão, ou seja, **US$ 1 ≈ R$ 5,69**. Os valores em reais são aproximados.

### Resumo rápido

| Situação | Custo mensal (US$) | Custo mensal (R$ aprox.) | Custo anual (R$ aprox.) |
|---|---|---|---|
| **Hoje** (TCC / testes, tudo no plano grátis) | US$ 0 | R$ 0 | R$ 0 |
| **Lançamento pequeno** (~100 a 150 mães com consulta por mês) | US$ 108 | R$ 615 | R$ 7.380 |
| **Crescimento** (~1.000 usuários por mês) | US$ 533 + uso do Firebase | R$ 3.034 + Firebase | R$ 36.400 + Firebase |

O **lançamento pequeno** considera JaaS Basic (US$ 99) + Netlify Personal (US$ 9). O **crescimento** considera JaaS Standard (US$ 499) + Netlify Pro (US$ 20) + EmailJS Personal (US$ 9) + Cloudflare Workers Paid (US$ 5) + Firebase Blaze pago por uso. Some R$ 40/ano se registrarem um domínio próprio.

> ⚠️ **A videochamada é cerca de 90% do custo.** É também o primeiro limite que o projeto atinge: o plano grátis do JaaS acaba com pouco mais de 12 consultas no mês.

---

### 1. Firebase (Auth + Firestore)

Usado para login e banco de dados. Não tem mensalidade: no plano **Spark** é grátis com limites; no plano **Blaze** paga-se só o que passar desses limites.

**Plano grátis (Spark)**

| Recurso | Limite grátis |
|---|---|
| Login (e-mail e redes sociais) | 50.000 usuários ativos por mês |
| Armazenamento no Firestore | 1 GiB no total |
| Leituras de documentos | 50.000 por dia |
| Gravações de documentos | 20.000 por dia |
| Exclusões de documentos | 20.000 por dia |

**Plano pago (Blaze)**: valores cobrados acima da cota grátis, Firestore Standard edition

| Recurso | Região Iowa (us-central1) | Região São Paulo (southamerica-east1) |
|---|---|---|
| Leituras | US$ 0,03 a cada 100 mil | US$ 0,045 a cada 100 mil |
| Gravações | US$ 0,09 a cada 100 mil | US$ 0,135 a cada 100 mil |
| Exclusões | US$ 0,01 a cada 100 mil | US$ 0,015 a cada 100 mil |
| Armazenamento | ~US$ 0,15 por GiB/mês | US$ 0,135 por GiB/mês |
| Login acima de 50 mil usuários | ~US$ 0,0055 por usuário ativo | ~US$ 0,0055 por usuário ativo |

O preço depende da região escolhida quando o banco foi criado. Confira em *Console do Firebase → Firestore → Configurações*.

**Cuidados**
- No plano grátis, se passar do limite, o Firebase **desliga aquele recurso até o dia seguinte ou o fim do mês** em vez de cobrar. O site pode parar de funcionar.
- As regras de segurança também contam leituras, e o Worker de lembretes consulta o Firestore a cada 10 minutos (144 vezes por dia). Isso também consome a cota.
- No plano Blaze, configure **alertas de orçamento** no Google Cloud. Eles só avisam, **não bloqueiam** os gastos.

🔗 [firebase.google.com/pricing](https://firebase.google.com/pricing) · [cloud.google.com/firestore/pricing](https://cloud.google.com/firestore/pricing)

---

### 2. Netlify (hospedagem)

Cobra por **créditos**. Cada plano inclui uma quantidade de créditos por mês, que são gastos com deploys, tráfego e o SSR.

| Plano | Preço | Créditos por mês | R$ aprox./mês |
|---|---|---|---|
| Free | US$ 0 | 300 (limite rígido) | R$ 0 |
| Personal | US$ 9 | 1.000 | R$ 51 |
| Pro | US$ 20 | 3.000 (membros ilimitados) | R$ 114 |
| Enterprise | Sob consulta | Personalizado | — |

**Quanto cada coisa gasta**

| Ação | Créditos |
|---|---|
| Cada deploy em produção | 15 |
| Cada GB de tráfego (bandwidth) | 20 |
| Processamento do SSR / funções | 10 por GB-hora |
| Requisições | 2 a cada 10 mil |
| Deploy de preview (branch / pull request) | Grátis |

**Créditos extras** (só nos planos pagos): Personal US$ 5 por 500 créditos; Pro US$ 10 por 1.500 créditos.

**Cuidados**
- Os 300 créditos grátis equivalem a **no máximo 20 deploys em produção por mês**, se nada mais for usado. Cada push na branch `main` gera um deploy.
- No plano Free não dá para comprar créditos extras. Se acabarem, **o site sai do ar até o mês virar**.
- Dica: juntem várias alterações antes de subir para a `main` e usem os deploys de preview, que são grátis, para testar.

🔗 [netlify.com/pricing](https://www.netlify.com/pricing/)

---

### 3. Cloudflare Workers (backend `video-token/`)

| Plano | Preço | O que inclui | R$ aprox./mês |
|---|---|---|---|
| Free | US$ 0 | 100.000 requisições por dia, 10 ms de CPU por chamada | R$ 0 |
| Paid | US$ 5/mês (mínimo) | 10 milhões de requisições/mês e 30 milhões de ms de CPU | R$ 28 |
| Excedente (Paid) | — | US$ 0,30 por milhão de requisições extras; US$ 0,02 por milhão de ms de CPU extras | — |

Para o uso atual do Elo Materno (tokens de vídeo + lembretes a cada 10 minutos), dificilmente o plano grátis vai acabar.

🔗 [developers.cloudflare.com/workers/platform/pricing](https://developers.cloudflare.com/workers/platform/pricing/)

---

### 4. JaaS / 8x8 (videochamadas) ⚠️ maior custo

Cobra por **usuário ativo mensal (MAU)**. Cada dispositivo diferente (navegador, celular, tablet) que entra em uma chamada no mês conta como 1 usuário.

| Plano | Usuários por mês | Preço | R$ aprox./mês |
|---|---|---|---|
| Developer | 25 | Grátis | R$ 0 |
| Basic | 300 | US$ 99 | R$ 564 |
| Standard | 1.500 | US$ 499 | R$ 2.841 |
| Business | 3.000 | US$ 999 | R$ 5.687 |
| Enterprise | 5.000 ou mais | Sob consulta | — |

**Custos adicionais**

| Item | Preço |
|---|---|
| Usuário acima do plano | US$ 0,99 por usuário |
| Gravação de chamada | US$ 0,01 por minuto |
| Transcrição | US$ 0,06 por minuto |
| Ligação telefônica (saída) | 1 usuário + US$ 0,03 por minuto |

**Cuidados**
- Uma consulta tem pelo menos 2 usuários (mãe + profissional). O plano grátis cobre **cerca de 12 pares por mês**.
- Se a mesma pessoa entrar pelo celular e depois pelo computador, conta como 2.
- Alternativa: o Jitsi é open source e pode ser hospedado em um servidor próprio (VPS). O custo vira só o do servidor, mas exige conhecimento técnico para instalar e manter.

🔗 [jaas.8x8.vc](https://jaas.8x8.vc/) · [8x8.com/products/apis/video](https://www.8x8.com/products/apis/video)

---

### 5. EmailJS (código de verificação de e-mail)

| Plano | Envios por mês | Preço | R$ aprox./mês |
|---|---|---|---|
| Free | 200 (2 modelos, até 50 KB) | US$ 0 | R$ 0 |
| Personal | 2.000 | US$ 9 | R$ 51 |
| Professional | Mais envios e anexos maiores | US$ 15 | R$ 85 |
| Business | Até 25.000 | US$ 40 | R$ 228 |

O pagamento anual tem cerca de 20% de desconto. Cada cadastro gasta 1 envio, e reenviar o código gasta outro.

**Dica:** o Worker já usa Mailjet ou Brevo, que têm cotas grátis muito maiores. Dá para mandar o código de verificação por eles e dispensar o EmailJS.

🔗 [emailjs.com/pricing](https://www.emailjs.com/pricing/)

---

### 6. Mailjet **ou** Brevo (e-mails de lembrete)

O Worker funciona com qualquer um dos dois, então só é preciso pagar **um**.

| Serviço | Plano grátis | Primeiro plano pago | Próximo plano | R$ aprox. (1º pago) |
|---|---|---|---|---|
| Mailjet | 6.000 e-mails/mês (máx. 200 por dia), 1.000 contatos | Starter: US$ 9 (8.000 e-mails) | Essential: ~US$ 17–19 (15.000 e-mails) | R$ 51 |
| Brevo | 300 e-mails por dia (~9.000/mês) | Starter: US$ 9 (5.000 e-mails) | Standard: US$ 18 | R$ 51 |

Os planos grátis colocam a marca do serviço no rodapé dos e-mails.

🔗 [mailjet.com/pricing](https://www.mailjet.com/pricing/) · [brevo.com/pricing](https://www.brevo.com/pricing/)

---

### 7. Itens opcionais (não usados hoje, mas são custos possíveis)

| Item | Preço | Quando seria necessário |
|---|---|---|
| Domínio `.com.br` ([Registro.br](https://registro.br/)) | R$ 40 por ano | Para ter um endereço próprio (ex.: `elomaterno.com.br`) em vez de `elomaterno.netlify.app` |
| E-mail profissional no domínio (ex.: Google Workspace, Zoho) | Varia por plano, consulte | Para enviar e-mails de `contato@elomaterno.com.br` em vez de um Gmail pessoal, o que melhora a entrega |
| Servidor próprio (VPS) para Jitsi | Varia por provedor | Se trocarem o JaaS por um Jitsi próprio |
| Google Play (publicar app Android) | US$ 25 (pagamento único) | Só se virarem app de loja; hoje o projeto é um PWA e não precisa |
| Apple Developer (publicar app iOS) | US$ 99 por ano | Só se virarem app de loja; hoje não precisa |
| Font Awesome Pro | Pago, consulte | Só se precisarem de ícones que não estão na versão grátis |

---

### 8. Itens 100% gratuitos

Estes itens **não têm custo** e não têm plano pago necessário para o projeto:

| Item | Por que é grátis |
|---|---|
| Angular, TypeScript, RxJS, Express, Chart.js, jsPDF, jose, Vitest, jsdom, Prettier, Wrangler, buffer | Bibliotecas open source (licenças MIT, Apache ou similares) |
| Node.js, npm, Git, VS Code | Ferramentas de desenvolvimento gratuitas |
| GitHub (repositório) | Repositórios públicos e privados são grátis no plano Free |
| BrasilAPI | API pública e gratuita |
| VLibras | Ferramenta pública do Governo Federal |
| Google Fonts, Phosphor Icons, Font Awesome Free, FlagCDN | Recursos gratuitos via CDN |
| Google OAuth2 e Secure Token (usados pelo Worker) | Fazem parte do Firebase/Google Cloud, sem cobrança separada |
| APIs do navegador (voz, notificações, PWA, compartilhar) | Já vêm no navegador da usuária |

---

### Como reduzir os custos

1. **Videochamada:** é o maior gasto. Avaliar um Jitsi próprio em VPS quando o número de consultas crescer.
2. **E-mails:** usar só o Brevo ou o Mailjet para tudo (verificação + lembretes) e remover o EmailJS.
3. **Netlify:** juntar alterações antes de cada deploy em produção e otimizar imagens (tráfego é o que mais gasta crédito).
4. **Firestore:** evitar leituras repetidas (cache, paginação) e criar o banco em uma região mais barata em projetos novos.
5. **Pagamento:** planos anuais costumam ter desconto (EmailJS, Netlify, Mailjet, Brevo). Alguns cartões não cobram IOF em compras internacionais.

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
|------------------|
| Ana Luiza        |
| Emily Rorigues   |
| João Victor      |
| Michelly Moreira |
| Samyra Alves     |

---

<p align="center">Feito com 💜 para todas as mães que fazem tudo sozinhas.</p>
