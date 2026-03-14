/**
 * Autorização OAuth YouTube — Canal Missão
 * Execute UMA VEZ: npm run auth:missao
 *
 * Pré-requisito: a conta do canal Missão deve estar
 * adicionada como "Usuário de teste" no Google Cloud Console.
 *
 * Após executar, copie o YOUTUBE_REFRESH_TOKEN_MISSAO gerado para o .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { autorizarCanal } = require('../youtube');
const { getChannel } = require('../channels');

(async () => {
  const channel = getChannel('missao');
  console.log('=== Autorização OAuth YouTube ===');
  console.log(`Canal: ${channel.name}`);
  console.log(`Conta: ${channel.youtubeEmail}\n`);

  try {
    const refreshToken = await autorizarCanal(channel);
    if (refreshToken) {
      console.log('✅ Autorização concluída!');
      console.log(`\nAdicione ao .env:`);
      console.log(`YOUTUBE_REFRESH_TOKEN_MISSAO=${refreshToken}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
})();
