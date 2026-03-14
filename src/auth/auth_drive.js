/**
 * Autorização OAuth Google Drive — conta agenciatektus@gmail.com
 * Execute UMA VEZ: npm run auth:drive
 *
 * Esta conta é a dona das pastas no Drive e precisa de permissão
 * para listar, mover e renomear os arquivos de vídeo.
 *
 * Após executar, copie o DRIVE_REFRESH_TOKEN gerado para o .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const CREDENTIALS_PATH = path.join(__dirname, '../../credenciais/google_credentials.json');
const TOKEN_PATH = path.join(__dirname, '../../credenciais/drive_token.json');
const OAUTH_PORT = 8080;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

(async () => {
  console.log('=== Autorização OAuth Google Drive ===');
  console.log('Conta: agenciatektus@gmail.com\n');

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const creds = raw.web || raw.installed;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    login_hint: 'agenciatektus@gmail.com',
  });

  console.log('Abra este URL no navegador (use a conta agenciatektus@gmail.com):\n');
  console.log(authUrl);
  console.log(`\nAguardando autorização na porta ${OAUTH_PORT}...\n`);

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

      fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));

      console.log('✅ Autorização concluída!');
      console.log(`\nToken salvo em ${TOKEN_PATH}`);
      console.log(`\nAdicione ao .env:`);
      console.log(`DRIVE_REFRESH_TOKEN=${credentials.refresh_token}\n`);
      process.exit(0);
    } catch (err) {
      server.close();
      console.error('❌ Erro:', err.message);
      process.exit(1);
    }
  });

  server.listen(OAUTH_PORT, () =>
    console.log(`[OAuth] Servidor rodando em http://localhost:${OAUTH_PORT}`)
  );
})();
