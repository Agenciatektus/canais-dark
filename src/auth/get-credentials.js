const fs   = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');

/**
 * Retorna { client_id, client_secret } para OAuth2.
 * Prioriza variáveis de ambiente (produção/Coolify).
 * Fallback: lê google_credentials.json (dev local).
 */
function getCredentials() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    return { client_id: clientId, client_secret: clientSecret };
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  return raw.web || raw.installed;
}

module.exports = { getCredentials };
