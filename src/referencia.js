require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const YTDLP    = process.env.YTDLP_PATH  || 'yt-dlp';
const TEMP_DIR = process.env.TEMP_DIR    || path.join(os.tmpdir(), 'canais-dark');

const { CHANNELS }             = require('./channels');
const { downloadFromYouTube }  = require('./clips/downloader');
const { uploadFileToDrive }    = require('./drive');
const { getCanaisReferencia, getNomesRegistrados, registrarVideosEmLote } = require('./sheets');

function log(msg) {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[${ts}] ${msg}`);
}

/**
 * Lista os N vídeos mais recentes de um canal do YouTube (sem fazer download).
 * Usa yt-dlp --flat-playlist para obter apenas metadados.
 * @param {string} channelUrl - URL do canal (ex: https://www.youtube.com/@kimkataguiri)
 * @param {number} maxVideos  - quantos vídeos listar (padrão: 10)
 * @returns {Promise<Array<{id, title, duration, url}>>}
 */
async function listarVideosDoCanal(channelUrl, maxVideos = 10) {
  const url = channelUrl.replace(/\/$/, '');
  const { stdout } = await execFileAsync(YTDLP, [
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    '--playlist-end', String(maxVideos),
    url,
  ], { maxBuffer: 10 * 1024 * 1024 });

  return stdout
    .split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .map(v => ({
      id:       v.id,
      title:    v.title || v.id,
      duration: v.duration || 0,
      url:      `https://www.youtube.com/watch?v=${v.id}`,
    }));
}

/**
 * Ciclo principal: verifica todos os canais de referência configurados na planilha,
 * baixa os vídeos novos e os enfileira na pasta "aguardando" do canal de corte.
 */
async function cicloReferencia() {
  log('🔗 Iniciando ciclo de canais de referência...');

  const referencias = await getCanaisReferencia();
  if (referencias.length === 0) {
    log('🔗 Nenhum canal de referência configurado.');
    return;
  }

  const nomesRegistrados = await getNomesRegistrados();
  let totalNovos = 0;

  for (const ref of referencias) {
    const channel = CHANNELS[ref.channelKey];
    if (!channel) {
      log(`⚠️  Canal destino não encontrado: ${ref.channelKey}`);
      continue;
    }

    log(`🔗 [${channel.name}] ← ${ref.urlReferencia}`);

    let videos;
    try {
      videos = await listarVideosDoCanal(ref.urlReferencia, 10);
      log(`   ${videos.length} vídeo(s) listados`);
    } catch (err) {
      log(`   ❌ Erro ao listar: ${err.message}`);
      continue;
    }

    const novos = videos.filter(v => !nomesRegistrados.has(`${v.id}.mp4`));
    log(`   ${novos.length} vídeo(s) novo(s)`);

    for (const video of novos) {
      const nomeArquivo = `${video.id}.mp4`;
      log(`   ⬇️  Baixando: ${video.title}`);
      try {
        const { localPath } = await downloadFromYouTube(video.url, TEMP_DIR);
        const { webViewLink } = await uploadFileToDrive(localPath, nomeArquivo, channel.driveAguardando);
        await registrarVideosEmLote([{
          canal: channel.name,
          nicho: channel.nicho,
          nomeArquivo,
          linkDriveAguardando: webViewLink,
        }]);
        nomesRegistrados.add(nomeArquivo);
        totalNovos++;
        log(`   ✅ Enfileirado: ${video.title}`);
        fs.unlink(localPath, () => {});
      } catch (err) {
        log(`   ❌ Erro ao processar ${video.id}: ${err.message}`);
      }
    }
  }

  log(`🔗 Ciclo de referências concluído — ${totalNovos} vídeo(s) novo(s) enfileirado(s).`);
}

module.exports = { cicloReferencia, listarVideosDoCanal };
