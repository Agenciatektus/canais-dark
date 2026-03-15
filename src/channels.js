/**
 * Configuração central de todos os canais dark.
 * Para adicionar um novo canal:
 *   1. Adicione uma entrada aqui com as pastas do Drive e token
 *   2. Crie src/auth/auth_{chave}.js copiando um dos existentes
 *   3. Adicione YOUTUBE_REFRESH_TOKEN_{CHAVE_EM_MAIUSCULO} no .env
 *   4. Crie as pastas no Drive e atualize driveAguardando / drivePublicados
 */

const CHANNELS = {
  'canal-cristao': {
    name: 'Canal Cristão',
    youtubeEmail: 'contato.jadecreate@gmail.com',
    youtubeUrl: 'https://www.youtube.com/@Corintios19',
    refreshTokenEnv: 'YOUTUBE_REFRESH_TOKEN_CANAL_CRISTAO',
    tokenFile: './credenciais/token_canal_cristao.json',
    oauthPort: 8081,
    driveAguardando: '1ygkXfU3FqzcFYh7EYQqaDRidOSeWykqV',
    drivePublicados:  '1Y1CZfRvcjUAKQe7PX-_zS6KwVhlv_y_X',
    nicho: 'cristão',
    youtubeCategory: '22',
  },

  'frutas-sinceronas': {
    name: 'Frutas Sinceronas',
    youtubeEmail: 'contato.vitmartins@gmail.com',
    youtubeUrl: 'https://www.youtube.com/@frutas.sinceronas',
    refreshTokenEnv: 'YOUTUBE_REFRESH_TOKEN_FRUTAS_SINCERONAS',
    tokenFile: './credenciais/token_frutas_sinceronas.json',
    oauthPort: 8082,
    driveAguardando: '1uttD7j14MxMW2obpJMS8_I6mzUCXdrv6',
    drivePublicados:  '1s6LaVPSdxBwmj50c5ndsD8PMOF5KxO2x',
    nicho: 'frutas',
    youtubeCategory: '22',
  },

  // ── CANAL POLÍTICO — PARTIDO MISSÃO ─────────────────────────────
  'missao': {
    name: 'Missão',
    youtubeEmail: 'cortesmissao46@gmail.com',
    youtubeUrl:   'https://www.youtube.com/@cortes14missao',
    refreshTokenEnv: 'YOUTUBE_REFRESH_TOKEN_MISSAO',
    tokenFile: './credenciais/token_missao.json',
    oauthPort: 8083,
    driveAguardando: '1iSHA3bMgGFk0TD7a9aJ0Ai2idoTqHilT',
    drivePublicados:  '1zpW0-uPRt2BImBeOBFeiGGEGTAS6qrKU',
    driveLocalAguardando: 'G:\\Meu Drive\\Tektus Publicidade - Sincronizado\\12 - Automações\\Canais Dark\\Cortes 14 Missão\\aguardando-publicacao-missao',
    nicho: 'político',
    youtubeCategory: '25',  // 25 = News & Politics
  },
};

/** Retorna a lista de chaves de canais configurados */
function getChannelKeys() {
  return Object.keys(CHANNELS);
}

/** Retorna a configuração de um canal pelo nome (chave) */
function getChannel(key) {
  const ch = CHANNELS[key];
  if (!ch) throw new Error(`Canal não encontrado: "${key}". Canais disponíveis: ${getChannelKeys().join(', ')}`);
  return ch;
}

module.exports = { CHANNELS, getChannelKeys, getChannel };
