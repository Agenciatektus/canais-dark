require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const { getCredentials } = require('./auth/get-credentials');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

/**
 * Retorna cliente OAuth2 autenticado para um canal específico
 * Usa o refresh token do .env correspondente ao canal
 * @param {object} channel - objeto de canal de channels.js
 * @returns {google.auth.OAuth2}
 */
function getClientForChannel(channel) {
  const creds = getCredentials();
  const redirectUri = `http://localhost:${channel.oauthPort}/callback`;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    redirectUri
  );

  // Tenta refresh token do .env primeiro
  const refreshToken = process.env[channel.refreshTokenEnv];
  if (refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  // Fallback: arquivo de token salvo
  const tokenPath = path.join(__dirname, '..', channel.tokenFile.replace('./', ''));
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);
    return oauth2Client;
  }

  throw new Error(
    `Token não encontrado para o canal "${channel.name}".\n` +
    `Adicione ${channel.refreshTokenEnv} ao .env ou execute o script de autorização.`
  );
}

/**
 * Faz upload de um Short no YouTube para o canal especificado
 * @param {object} channel - objeto de canal de channels.js
 * @param {string} videoPath - caminho local do arquivo MP4
 * @param {object} metadata - { titulo, descricao, tags }
 * @returns {Promise<string>} URL do Short publicado
 */
async function uploadShort(channel, videoPath, metadata) {
  const auth = getClientForChannel(channel);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.titulo.slice(0, 100),
        description: metadata.descricao.slice(0, 5000),
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        categoryId: channel.youtubeCategory || '22',
        defaultLanguage: 'pt',
        defaultAudioLanguage: 'pt',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;
  return `https://www.youtube.com/shorts/${videoId}`;
}

/**
 * Fluxo OAuth interativo para autorizar um canal.
 * Abre servidor local na porta do canal, aguarda callback e salva token.
 * @param {object} channel - objeto de canal de channels.js
 * @returns {Promise<string>} refresh_token obtido
 */
async function autorizarCanal(channel) {
  const creds = loadCredentials();
  const redirectUri = `http://localhost:${channel.oauthPort}/callback`;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    redirectUri
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    login_hint: channel.youtubeEmail,
  });

  console.log(`\n[OAuth] Canal: ${channel.name}`);
  console.log(`[OAuth] Conta: ${channel.youtubeEmail}`);
  console.log(`\nAbra este URL no navegador (use a conta ${channel.youtubeEmail}):\n`);
  console.log(authUrl);
  console.log(`\nAguardando autorização na porta ${channel.oauthPort}...\n`);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsed = url.parse(req.url, true);
        if (!parsed.pathname.includes('/callback') || !parsed.query.code) {
          res.end('Aguardando...');
          return;
        }

        const code = parsed.query.code;
        res.end('<h2>Autorização concluída! Pode fechar esta aba.</h2>');
        server.close();

        const tokenRes = await oauth2Client.getToken(code);
        const credentials = tokenRes.tokens;
        oauth2Client.setCredentials(credentials);

        // Salva token no arquivo
        const tokenPath = path.join(__dirname, '..', channel.tokenFile.replace('./', ''));
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.writeFileSync(tokenPath, JSON.stringify(credentials, null, 2));

        console.log(`\n[OAuth] Token salvo em ${channel.tokenFile}`);
        console.log(`\nAdicione ao .env:`);
        console.log(`${channel.refreshTokenEnv}=${credentials.refresh_token}\n`);

        resolve(credentials.refresh_token);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(channel.oauthPort, () =>
      console.log(`[OAuth] Servidor rodando em http://localhost:${channel.oauthPort}`)
    );
    server.on('error', reject);
  });
}

/**
 * Atualiza título, descrição e tags de um vídeo já publicado
 * @param {object} channel - objeto de canal de channels.js
 * @param {string} videoId - ID do vídeo (ex: "dQw4w9WgXcQ")
 * @param {object} metadata - { titulo, descricao, tags }
 */
async function atualizarMetadados(channel, videoId, metadata) {
  const auth = getClientForChannel(channel);
  const youtube = google.youtube({ version: 'v3', auth });

  // Busca snippet atual para preservar categoryId e outros campos obrigatórios
  const current = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
  const snippet = current.data.items?.[0]?.snippet;
  if (!snippet) throw new Error(`Vídeo não encontrado: ${videoId}`);

  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: videoId,
      snippet: {
        ...snippet,
        title: metadata.titulo.slice(0, 100),
        description: metadata.descricao.slice(0, 5000),
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      },
    },
  });
}

module.exports = { uploadShort, autorizarCanal, getClientForChannel, atualizarMetadados };
