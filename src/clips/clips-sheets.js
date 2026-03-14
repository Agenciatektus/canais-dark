require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');

// =========================================================
// Aba: CORTES
// A=CANAL, B=NICHO, C=LINK_FONTE, D=TIPO_FONTE,
// E=TITULO_ORIGINAL, F=CONTEXTO_CONTEUDO,
// G=STATUS, H=TOTAL_CORTES, I=LINKS_CORTES_DRIVE,
// J=DATA_ADICIONADO, K=DATA_PROCESSADO, L=OBSERVACAO
// =========================================================
const COL = {
  CANAL:               0,
  NICHO:               1,
  LINK_FONTE:          2,
  TIPO_FONTE:          3,
  TITULO_ORIGINAL:     4,
  CONTEXTO_CONTEUDO:   5,
  STATUS:              6,
  TOTAL_CORTES:        7,
  LINKS_CORTES_DRIVE:  8,
  DATA_ADICIONADO:     9,
  DATA_PROCESSADO:     10,
  OBSERVACAO:          11,
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
 * Retorna todos os vídeos fonte com STATUS = "Aguardando"
 */
async function getPendingClipJobs() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'CORTES!A2:L5000',
  });
  const rows = res.data.values || [];
  return rows
    .map((row, i) => ({
      rowIndex:         i + 2,
      canal:            row[COL.CANAL]             || '',
      nicho:            row[COL.NICHO]             || '',
      linkFonte:        row[COL.LINK_FONTE]         || '',
      tipoFonte:        (row[COL.TIPO_FONTE]        || 'youtube').toLowerCase(),
      tituloOriginal:   row[COL.TITULO_ORIGINAL]    || '',
      contextoConteudo: row[COL.CONTEXTO_CONTEUDO]  || '',
      status:           row[COL.STATUS]             || '',
    }))
    .filter(r => r.status.toLowerCase() === 'aguardando' && r.linkFonte);
}

/** Marca o job como "Processando" */
async function markAsProcessing(rowIndex) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CORTES!G${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['Processando']] },
  });
}

/** Marca job como Concluído e registra resultados */
async function markAsCompleted(rowIndex, { totalCortes, linksDrive, tituloOriginal, contexto }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CORTES!E${rowIndex}:L${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        tituloOriginal,
        contexto,
        'Concluído',
        totalCortes,
        linksDrive.join('\n'),
        '',
        agora(),
        `${totalCortes} corte(s) enviados para fila de publicação`,
      ]],
    },
  });
}

/** Marca job como Erro */
async function markAsError(rowIndex, errorMsg) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CORTES!G${rowIndex}:L${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['Erro', '', '', '', agora(), errorMsg.slice(0, 500)]],
    },
  });
}

/** Atualiza título e contexto descobertos durante processamento */
async function updateMetadata(rowIndex, { tituloOriginal, contexto }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `CORTES!E${rowIndex}:F${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[tituloOriginal, contexto]] },
  });
}

module.exports = {
  getPendingClipJobs,
  markAsProcessing,
  markAsCompleted,
  markAsError,
  updateMetadata,
};
