require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const { getCredentials } = require('./auth/get-credentials');

/**
 * Retorna cliente OAuth2 autenticado como agenciatektus@gmail.com (dona dos arquivos no Drive)
 */
function getDriveClient() {
  const creds = getCredentials();
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'http://localhost:8080/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Lista vídeos MP4 na pasta "aguardando publicação" de um canal específico
 * @param {object} channel - objeto de canal de channels.js
 * @returns {Promise<Array<{id, name, size, createdTime, webViewLink}>>}
 */
async function listVideosForChannel(channel) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${channel.driveAguardando}' in parents and mimeType='video/mp4' and trashed=false`,
    fields: 'files(id, name, size, createdTime, webViewLink)',
    orderBy: 'createdTime asc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

/**
 * Faz download de um vídeo do Drive para disco local
 * @param {string} fileId
 * @param {string} localPath - caminho absoluto onde salvar
 */
async function downloadVideo(fileId, localPath) {
  const drive = getDriveClient();
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const dest = fs.createWriteStream(localPath);
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return new Promise((resolve, reject) => {
    res.data
      .on('end', () => resolve(localPath))
      .on('error', reject)
      .pipe(dest);
  });
}

/**
 * Renomeia um arquivo no Drive
 * @param {string} fileId
 * @param {string} novoNome
 */
async function renameFile(fileId, novoNome) {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: { name: novoNome },
    fields: 'id, name',
  });
}

/**
 * Move um arquivo da pasta aguardando para a pasta publicados do canal
 * @param {string} fileId
 * @param {object} channel - objeto de canal de channels.js
 */
async function moveToPublished(fileId, channel) {
  const drive = getDriveClient();
  const file = await drive.files.get({
    fileId,
    fields: 'parents',
    supportsAllDrives: true,
  });
  const parents = file.data.parents;
  const previousParents = (parents && parents.length > 0 ? parents : [channel.driveAguardando]).join(',');
  await drive.files.update({
    fileId,
    addParents: channel.drivePublicados,
    removeParents: previousParents,
    supportsAllDrives: true,
    fields: 'id, parents',
  });
}

/**
 * Retorna o link webView de um arquivo pelo fileId
 * @param {string} fileId
 * @returns {Promise<string>}
 */
async function getFileLink(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });
  return res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Extrai fileId de um link do Google Drive
 * Suporta: /file/d/{ID}/view  e  ?id={ID}  e  /folders/{ID}
 * @param {string} link
 * @returns {string|null}
 */
function extrairFileId(link) {
  const m1 = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

module.exports = { listVideosForChannel, downloadVideo, renameFile, moveToPublished, getFileLink, extrairFileId };
