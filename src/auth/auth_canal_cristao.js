/**
 * Autorização OAuth YouTube — Canal Cristão (contato.jadecreate@gmail.com)
 * Execute UMA VEZ: npm run auth:canal-cristao
 *
 * Pré-requisito: a conta contato.jadecreate@gmail.com deve estar
 * adicionada como "Usuário de teste" no Google Cloud Console.
 *
 * Após executar, copie o YOUTUBE_REFRESH_TOKEN_CANAL_CRISTAO gerado para o .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { autorizarCanal } = require('../youtube');
const { getChannel } = require('../channels');

(async () => {
  const channel = getChannel('canal-cristao');
  console.log('=== Autorização OAuth YouTube ===');
  console.log(`Canal: ${channel.name}`);
  console.log(`Conta: ${channel.youtubeEmail}\n`);

  try {
    const refreshToken = await autorizarCanal(channel);
    if (refreshToken) {
      console.log('✅ Autorização concluída!');
      console.log(`\nAdicione ao .env:`);
      console.log(`YOUTUBE_REFRESH_TOKEN_CANAL_CRISTAO=${refreshToken}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
})();
