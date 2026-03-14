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
    // Pasta "aguardando-publicacao-canal-cristao"
    driveAguardando: '1ygkXfU3FqzcFYh7EYQqaDRidOSeWykqV',
    // Pasta "publicados-canal-cristao"
    drivePublicados: '1Y1CZfRvcjUAKQe7PX-_zS6KwVhlv_y_X',
    nicho: 'cristão',
    // Categoria YouTube: 22 = People & Blogs (adequada para conteúdo cristão)
    youtubeCategory: '22',
  },

  'frutas-sinceronas': {
    name: 'Frutas Sinceronas',
    youtubeEmail: 'contato.vitmartins@gmail.com',
    youtubeUrl: 'https://www.youtube.com/@frutas.sinceronas',
    refreshTokenEnv: 'YOUTUBE_REFRESH_TOKEN_FRUTAS_SINCERONAS',
    tokenFile: './credenciais/token_frutas_sinceronas.json',
    oauthPort: 8082,
    // Pasta "aguardando-publicacao-frutas-sinceronas"
    driveAguardando: '1uttD7j14MxMW2obpJMS8_I6mzUCXdrv6',
    // Pasta "publicados-frutas-sinceronas"
    drivePublicados: '1s6LaVPSdxBwmj50c5ndsD8PMOF5KxO2x',
    nicho: 'frutas',
    // Categoria YouTube: 22 = People & Blogs
    youtubeCategory: '22',
  },
};

/**
 * Retorna a lista de chaves de canais configurados
 * @returns {string[]}
 */
function getChannelKeys() {
  return Object.keys(CHANNELS);
}

/**
 * Retorna a configuração de um canal pelo nome (chave)
 * @param {string} key
 * @returns {object}
 */
function getChannel(key) {
  const ch = CHANNELS[key];
  if (!ch) throw new Error(`Canal não encontrado: "${key}". Canais disponíveis: ${getChannelKeys().join(', ')}`);
  return ch;
}

module.exports = { CHANNELS, getChannelKeys, getChannel };
