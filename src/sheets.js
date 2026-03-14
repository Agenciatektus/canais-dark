require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credenciais', 'google_credentials.json');

// Colunas da aba VIDEOS (0-indexed)
// A=CANAL, B=NICHO, C=NOME_ARQUIVO, D=LINK_DRIVE_AGUARDANDO,
// E=TITULO_YOUTUBE, F=DESCRICAO_YOUTUBE, G=TAGS_YOUTUBE,
// H=STATUS, I=LINK_YOUTUBE, J=LINK_DRIVE_PUBLICADO,
// K=NOME_ARQUIVO_PUBLICADO, L=DATA_DETECCAO, M=DATA_PUBLICACAO, N=ERRO
// Colunas conforme a planilha real (A=0, B=1, ...)
// A=CANAL, B=NICHO, C=NOME_ARQUIVO, D=LINK_DRIVE_AGUARDANDO,
// E=TITULO_YOUTUBE, F=DESCRICAO_YOUTUBE, G=TAGS_YOUTUBE,
// H=LINK_YOUTUBE, I=STATUS, J=LINK_DRIVE_PUBLICADO,
// K=NOME_ARQUIVO_PUBLICADO, L=DATA_DETECCAO, M=DATA_PUBLICACAO, N=ERRO
const COL = {
  CANAL:                 0,
  NICHO:                 1,
  NOME_ARQUIVO:          2,
  LINK_DRIVE_AGUARDANDO: 3,
  TITULO_YOUTUBE:        4,
  DESCRICAO_YOUTUBE:     5,
  TAGS_YOUTUBE:          6,
  LINK_YOUTUBE:          7,  // H
  STATUS:                8,  // I
  LINK_DRIVE_PUBLICADO:  9,
  NOME_ARQUIVO_PUBLICADO:10,
  DATA_DETECCAO:         11,
  DATA_PUBLICACAO:       12,
  ERRO:                  13,
};

function getSheetsClient() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const creds = raw.web || raw.installed;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    'http://localhost:8080/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

function agora() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Retorna todos os nomes de arquivo já registrados na planilha (para evitar duplicatas)
 * @returns {Promise<Set<string>>}
 */
async function getNomesRegistrados() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'POSTAGENS!C2:C5000',
  });
  const rows = res.data.values || [];
  return new Set(rows.flat().filter(Boolean));
}

/**
 * Registra múltiplos vídeos de uma vez (lote) — 1 única chamada à API
 * @param {Array<{canal, nicho, nomeArquivo, linkDriveAguardando}>} videos
 */
async function registrarVideosEmLote(videos) {
  if (videos.length === 0) return;
  const sheets = getSheetsClient();
  const dataDeteccao = agora();
  const rows = videos.map(({ canal, nicho, nomeArquivo, linkDriveAguardando }) => [
    canal, nicho, nomeArquivo, linkDriveAguardando,
    '', '', '',         // E: TITULO, F: DESCRICAO, G: TAGS
    '',                 // H: LINK_YOUTUBE
    'Pendente',         // I: STATUS
    '', '', dataDeteccao, '', '',
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'POSTAGENS!A:N',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/**
 * Retorna todas as linhas com STATUS = "Pendente"
 * @returns {Promise<Array>}
 */
async function getPendingVideos() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'POSTAGENS!A2:N5000',
  });
  const rows = res.data.values || [];
  const pending = [];
  rows.forEach((row, i) => {
    const status = (row[COL.STATUS] || '').toLowerCase().trim();
    if (status === 'pendente') {
      pending.push({
        rowIndex: i + 2,
        canal: row[COL.CANAL] || '',
        nicho: row[COL.NICHO] || '',
        nomeArquivo: row[COL.NOME_ARQUIVO] || '',
        linkDriveAguardando: row[COL.LINK_DRIVE_AGUARDANDO] || '',
        tituloYoutube: row[COL.TITULO_YOUTUBE] || '',
        descricaoYoutube: row[COL.DESCRICAO_YOUTUBE] || '',
        tagsYoutube: row[COL.TAGS_YOUTUBE] || '',
      });
    }
  });
  return pending;
}

/**
 * Salva o SEO gerado na linha da planilha
 * @param {number} rowIndex
 * @param {object} seo - { titulo, descricao, tags }
 */
async function salvarSEO(rowIndex, seo) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `POSTAGENS!E${rowIndex}:G${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        seo.titulo.slice(0, 100),
        seo.descricao.slice(0, 5000),
        Array.isArray(seo.tags) ? seo.tags.join(', ') : seo.tags,
      ]],
    },
  });
}

/**
 * Atualiza a linha após publicação bem-sucedida
 * @param {number} rowIndex
 * @param {object} params
 */
async function markAsPublished(rowIndex, { youtubeUrl, linkDrivePublicado, nomeArquivoPublicado }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `POSTAGENS!H${rowIndex}:N${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        youtubeUrl,           // H: LINK_YOUTUBE
        'Postado',            // I: STATUS
        linkDrivePublicado,   // J: LINK_DRIVE_PUBLICADO
        nomeArquivoPublicado, // K: NOME_ARQUIVO_PUBLICADO
        '',                   // L: DATA_DETECCAO (não alterar)
        agora(),              // M: DATA_PUBLICACAO
        '',                   // N: ERRO
      ]],
    },
  });
}

/**
 * Marca a linha com STATUS=Erro e registra a mensagem
 * @param {number} rowIndex
 * @param {string} errorMsg
 */
async function markAsError(rowIndex, errorMsg) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `POSTAGENS!H${rowIndex}:N${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['', 'Erro', '', '', '', agora(), errorMsg.slice(0, 500)]],
    },
  });
}

module.exports = {
  getNomesRegistrados,
  registrarVideosEmLote,
  getPendingVideos,
  salvarSEO,
  markAsPublished,
  markAsError,
};
