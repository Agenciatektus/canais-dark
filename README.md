# Canais Dark — Automação Multi-Canal YouTube

Sistema de automação para gerenciar múltiplos canais YouTube ("dark channels"), com upload automático de vídeos, geração de SEO via Claude AI com análise de frames, controle via Google Sheets e organização de arquivos no Google Drive.

---

## Fluxo de Trabalho

```
Fluxo 1 — Detecção (a cada 30 min)
  Google Drive (aguardando) → novo MP4 detectado → registra na planilha (STATUS: Pendente)

Fluxo 2 — Publicação (05h / 12h / 18h — horário de Brasília)
  Planilha (Pendente) → baixa vídeo → extrai frames → Claude Vision analisa conteúdo
  → gera SEO (título, descrição, tags) → salva na planilha → sobe no YouTube como Short
  → STATUS: Postado → renomeia arquivo → move para pasta "publicados" no Drive
```

**Limite:** 1 vídeo por canal por horário = máx. **3 posts/dia por canal**

---

## Estrutura do Projeto

```
canais-dark/
├── src/
│   ├── index.js           # Orquestrador principal + cron jobs
│   ├── server.js          # Servidor Express + dashboard
│   ├── channels.js        # Configuração central dos canais
│   ├── drive.js           # Google Drive API (multi-pasta)
│   ├── sheets.js          # Google Sheets (planilha de controle)
│   ├── youtube.js         # YouTube upload multi-canal + OAuth
│   ├── seo.js             # SEO via Claude AI + análise de frames (ffmpeg)
│   └── auth/
│       ├── auth_drive.js              # OAuth agenciatektus@gmail.com
│       ├── auth_canal_cristao.js      # OAuth contato.jadecreate@gmail.com
│       └── auth_frutas_sinceronas.js  # OAuth contato.vitmartins@gmail.com
├── public/
│   └── index.html         # Dashboard de controle
├── credenciais/           # Tokens OAuth (git-ignored)
├── logs/                  # Logs de execução (git-ignored)
├── .env                   # Variáveis de ambiente (git-ignored)
├── .env.example           # Template do .env
└── package.json
```

---

## Canais Configurados

| Canal | Email | YouTube |
|-------|-------|---------|
| Canal Cristão | contato.jadecreate@gmail.com | [@Corintios19](https://www.youtube.com/@Corintios19) |
| Frutas Sinceronas | contato.vitmartins@gmail.com | [@frutas.sinceronas](https://www.youtube.com/@frutas.sinceronas) |

---

## Estrutura do Google Drive

```
Canais Dark (pasta raiz)
├── canal-cristao/
│   ├── aguardando-publicacao-canal-cristao/   ← subir vídeos aqui
│   └── publicados-canal-cristao/
└── frutas-sinceronas/
    ├── aguardando-publicacao-frutas-sinceronas/
    └── publicados-frutas-sinceronas/
```

**Conta dona do Drive:** agenciatektus@gmail.com

---

## Planilha de Controle

[Controle de post canais dark](https://docs.google.com/spreadsheets/d/1dZJMKZtwr9pwJQMn4v9fpEjyb1Lpr1Sc8yqLomX3FwM)

Aba: **POSTAGENS**

| Coluna | Campo | Descrição |
|--------|-------|-----------|
| A | CANAL | Nome do canal |
| B | NICHO | Nicho do canal |
| C | NOME_ARQUIVO | Nome original do arquivo MP4 |
| D | LINK_DRIVE_AGUARDANDO | Link do arquivo na pasta aguardando |
| E | TITULO_YOUTUBE | Título gerado com SEO |
| F | DESCRICAO_YOUTUBE | Descrição com SEO |
| G | TAGS_YOUTUBE | Tags separadas por vírgula |
| H | LINK_YOUTUBE | URL do vídeo publicado |
| I | STATUS | Pendente / Postado / Erro |
| J | LINK_DRIVE_PUBLICADO | Link do arquivo na pasta publicados |
| K | NOME_ARQUIVO_PUBLICADO | Nome do arquivo após renomeação |
| L | DATA_DETECCAO | Quando o vídeo foi detectado |
| M | DATA_PUBLICACAO | Quando foi publicado no YouTube |
| N | ERRO | Mensagem de erro (se houver) |

---

## Pré-requisitos

- Node.js >= 18
- [ffmpeg](https://ffmpeg.org) instalado (`winget install Gyan.FFmpeg` no Windows)
- Projeto no [Google Cloud Console](https://console.cloud.google.com) com as APIs habilitadas:
  - YouTube Data API v3
  - Google Drive API
  - Google Sheets API
- Chave de API da [Anthropic](https://console.anthropic.com) (Claude AI)

---

## Instalação

```bash
git clone https://github.com/Agenciatektus/canais-dark.git
cd canais-dark
npm install
cp .env.example .env
```

Preencha o `.env` com suas credenciais.

Coloque o arquivo `google_credentials.json` (OAuth 2.0 do Google Cloud Console) em `credenciais/`.

---

## Autorização OAuth

Execute uma vez para cada conta:

```bash
npm run auth:drive              # agenciatektus@gmail.com (Drive + Sheets)
npm run auth:canal-cristao      # contato.jadecreate@gmail.com (YouTube)
npm run auth:frutas-sinceronas  # contato.vitmartins@gmail.com (YouTube)
```

Cada script abre o browser, você faz login na conta correta, e o refresh token é exibido para adicionar no `.env`.

> **Importante:** As contas YouTube precisam estar adicionadas como **Usuários de Teste** no Google Cloud Console enquanto o app estiver em modo de teste.

---

## Variáveis de Ambiente

```env
# Google OAuth (Web App do Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Google Drive (agenciatektus@gmail.com)
DRIVE_REFRESH_TOKEN=

# YouTube por canal
YOUTUBE_REFRESH_TOKEN_CANAL_CRISTAO=
YOUTUBE_REFRESH_TOKEN_FRUTAS_SINCERONAS=

# Planilha de controle
SPREADSHEET_ID=1dZJMKZtwr9pwJQMn4v9fpEjyb1Lpr1Sc8yqLomX3FwM

# Anthropic Claude (SEO)
ANTHROPIC_API_KEY=

# Configurações gerais
CRON_INTERVAL_MINUTES=30
PORT=3000
```

---

## Uso

```bash
npm start
```

Dashboard disponível em `http://localhost:3000`

### Testes

```bash
npm run test:drive    # Lista vídeos aguardando no Drive
npm run test:sheets   # Lista vídeos pendentes na planilha
npm run test:seo      # Testa geração de SEO via Claude AI
```

---

## Adicionar Novo Canal

1. Crie as pastas no Google Drive (aguardando + publicados)
2. Adicione a configuração em [src/channels.js](src/channels.js)
3. Crie o script OAuth em `src/auth/auth_{canal}.js` (copie um existente)
4. Adicione o script em `package.json` → scripts
5. Adicione `YOUTUBE_REFRESH_TOKEN_{CANAL}` no `.env`
6. Execute `npm run auth:{canal}` para autorizar

---

## Stack

- **Runtime:** Node.js 18+
- **Web:** Express.js
- **Google APIs:** googleapis (Drive, YouTube, Sheets)
- **IA / SEO:** @anthropic-ai/sdk (Claude Haiku)
- **Análise de vídeo:** ffmpeg (extração de frames) + Claude Vision
- **Agendamento:** node-cron
