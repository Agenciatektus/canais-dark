/**
 * Autorização OAuth YouTube — Frutas Sinceronas (contato.vitmartins@gmail.com)
 * Execute UMA VEZ: npm run auth:frutas-sinceronas
 *
 * Pré-requisito: a conta contato.vitmartins@gmail.com deve estar
 * adicionada como "Usuário de teste" no Google Cloud Console.
 *
 * Após executar, copie o YOUTUBE_REFRESH_TOKEN_FRUTAS_SINCERONAS gerado para o .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { autorizarCanal } = require('../youtube');
const { getChannel } = require('../channels');

(async () => {
  const channel = getChannel('frutas-sinceronas');
  console.log('=== Autorização OAuth YouTube ===');
  console.log(`Canal: ${channel.name}`);
  console.log(`Conta: ${channel.youtubeEmail}\n`);

  try {
    const refreshToken = await autorizarCanal(channel);
    if (refreshToken) {
      console.log('✅ Autorização concluída!');
      console.log(`\nAdicione ao .env:`);
      console.log(`YOUTUBE_REFRESH_TOKEN_FRUTAS_SINCERONAS=${refreshToken}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
})();
