/**
 * Reseta linhas da aba CORTES para novo teste:
 * - STATUS volta para "Aguardando"
 * - Limpa: TOTAL_CORTES, LINKS_CORTES_DRIVE, DATA_ADICIONADO, DATA_PROCESSADO, OBSERVACAO
 * - Mantém: CANAL, NICHO, LINK_FONTE, TIPO_FONTE, TITULO_ORIGINAL, CONTEXTO_CONTEUDO
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');

(async () => {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const creds = raw.web || raw.installed;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    'http://localhost:8080/callback'
  );
  oauth2.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'CORTES!A2:L5000',
  });
  const rows = res.data.values || [];

  const toReset = rows
    .map((row, i) => ({ row: i + 2, status: (row[6] || '').trim(), link: row[2] || '' }))
    .filter(r => r.link && r.status !== 'Aguardando');

  if (toReset.length === 0) {
    console.log('ℹ️  Nenhuma linha para resetar.');
    return;
  }

  for (const u of toReset) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `CORTES!G${u.row}:L${u.row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Aguardando', '', '', '', '', '']] },
    });
    console.log(`🔄 Linha ${u.row} resetada → Aguardando`);
  }
  console.log(`✅ ${toReset.length} linha(s) resetada(s)`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
