# 💜 Elomaterno

### Conectando, acolhendo e fortalecendo mães solo.

<p align="center">
  <strong>Uma plataforma digital de apoio, acolhimento e conexão para mães solo.</strong>
</p>

<p align="center">
  🌸 Acolhimento • 🤝 Conexão • 🧠 Saúde emocional • ⚖️ Orientação • 💬 Comunidade
</p>

---

## 🌷 Sobre o Projeto

O **Elomaterno** é uma plataforma desenvolvida com o propósito de criar uma **rede de apoio digital para mães solo**, promovendo acolhimento, informação, orientação e conexão.

A plataforma oferece um ambiente seguro e acessível onde mães solo podem:

- 🧠 Encontrar suporte emocional;
- 📅 Agendar consultas com profissionais especializados;
- 💬 Conversar diretamente com profissionais;
- 📋 Acompanhar seu histórico de atendimentos;
- 🤝 Compartilhar experiências e fortalecer sua rede de apoio.

Mais do que um sistema, o Elomaterno busca utilizar a tecnologia como uma ferramenta de **transformação social, acolhimento e fortalecimento da autonomia feminina**.

---

## 🎯 Objetivos

O projeto foi desenvolvido com os seguintes objetivos:

- 💜 Criar uma rede de apoio para mães solo;
- 🌷 Promover acolhimento e empatia por meio da tecnologia;
- 📚 Facilitar o acesso à informação e orientação;
- 🧠 Conectar mães solo a psicólogos(as);
- ⚖️ Facilitar o acesso a advogados(as);
- 💬 Incentivar a troca de experiências entre usuárias;
- 🌱 Contribuir para o fortalecimento social e emocional das mães solo;
- ✨ Promover o empoderamento feminino.

---

## ✨ Funcionalidades

### 🔐 Autenticação

- Cadastro e login de usuárias;
- Autenticação utilizando **Firebase Authentication**;
- Login com conta Google.

### 📅 Agendamento de Consultas

- Agendamento de consultas com profissionais;
- Seleção de data e horário;
- Registro do motivo da consulta;
- Organização das consultas da usuária.

### 📋 Minhas Consultas

As consultas são organizadas de forma simples e intuitiva em três categorias:

| Aba | Descrição |
|---|---|
| 📅 **Agendadas** | Consultas futuras que ainda serão realizadas |
| ✅ **Realizadas** | Consultas que já aconteceram |
| ❌ **Canceladas** | Consultas que foram canceladas |

### ❌ Cancelamento de Consultas

- Cancelamento de consultas agendadas;
- Registro opcional do motivo do cancelamento;
- Atualização do status da consulta.

### 👩‍⚕️ Detalhes do Profissional

A usuária pode visualizar informações do profissional responsável pela consulta, como:

- Nome;
- Profissão;
- Registro profissional;
- Área de atuação;
- Especializações.

### 💬 Chat

- Comunicação direta entre mãe e profissional;
- Chat relacionado ao atendimento;
- Troca de mensagens de forma simples e acessível.

### ⚡ Atualização em Tempo Real

Os dados das consultas são atualizados em tempo real utilizando o **Firebase Firestore**, proporcionando uma experiência mais dinâmica e consistente.

---

## 🖥️ Interface

A interface do Elomaterno foi pensada para ser:

- 🌷 Acolhedora;
- 💜 Intuitiva;
- ♿ Acessível;
- 📱 Responsiva;
- ✨ Simples de utilizar.

O design utiliza uma identidade visual baseada em tons suaves de roxo e lilás, transmitindo uma sensação de **acolhimento, confiança e tranquilidade**.

---

## 🛠️ Tecnologias Utilizadas

### 🎨 Front-end

<p>
  <img src="https://img.shields.io/badge/Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white"/>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white"/>
</p>

- Angular
- Standalone Components
- TypeScript
- HTML5
- CSS3

### 🔥 Backend / Infraestrutura

<p>
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black"/>
</p>

O projeto utiliza o **Firebase** como infraestrutura principal.

### 🔐 Autenticação

- Firebase Authentication
- Login com Google

### 🗄️ Banco de Dados

- Firebase Firestore
- Atualização de dados em tempo real utilizando `onSnapshot`

---

## 🏗️ Estrutura do Projeto

O projeto utiliza a arquitetura baseada em **Angular Standalone Components**, buscando manter a aplicação organizada e modular.

```text
Elomaterno/
│
├── src/
│   ├── app/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── models/
│   │   └── ...
│   │
│   ├── assets/
│   └── ...
│
├── angular.json
├── package.json
├── tsconfig.json
└── README.md
