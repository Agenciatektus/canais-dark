require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startServer } = require('./server');

const { CHANNELS, getChannelKeys } = require('./channels');
const { listVideosForChannel, downloadVideo, renameFile, moveToPublished, getFileLink, extrairFileId } = require('./drive');
const { getNomesRegistrados, registrarVideosEmLote, getPendingVideos, salvarSEO, markAsPublished, markAsError } = require('./sheets');
const { gerarSEO } = require('./seo');
const { uploadShort } = require('./youtube');
const { cicloDeCortess } = require('./clips/clipper');

const TEMP_DIR = path.join(os.tmpdir(), 'canais-dark');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');

// Horários de publicação (horário de Brasília)
// Máximo 1 vídeo por canal por horário = 3 posts/dia por canal
const HORARIOS_PUBLICACAO = [
  { hora: 5,  minuto: 0 },
  { hora: 12, minuto: 0 },
  { hora: 18, minuto: 0 },
];

function log(msg) {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function formatarNomePublicado(titulo) {
  const data = new Date().toISOString().slice(0, 10);
  const tituloLimpo = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .substring(0, 50)
    .trim();
  return `${data} - ${tituloLimpo}.mp4`;
}

/**
 * Detecta novos vídeos no Drive e registra na planilha como Pendente.
 * Roda a cada 30 minutos para capturar uploads novos rapidamente.
 */
async function detectarNovosVideos() {
  log('🔍 Verificando Drive por novos vídeos...');
  const nomesRegistrados = await getNomesRegistrados();

  for (const channelKey of getChannelKeys()) {
    const channel = CHANNELS[channelKey];
    try {
      const videos = await listVideosForChannel(channel);
      log(`[${channel.name}] ${videos.length} vídeo(s) na pasta aguardando`);

      // Coleta apenas os novos (não registrados ainda)
      const novos = videos
        .filter(v => !nomesRegistrados.has(v.name))
        .map(v => ({
          canal: channel.name,
          nicho: channel.nicho,
          nomeArquivo: v.name,
          linkDriveAguardando: v.webViewLink || `https://drive.google.com/file/d/${v.id}/view`,
        }));

      if (novos.length > 0) {
        // 1 única chamada à API para registrar todos os novos vídeos do canal
        await registrarVideosEmLote(novos);
        novos.forEach(v => nomesRegistrados.add(v.nomeArquivo));
        log(`[${channel.name}] ${novos.length} vídeo(s) registrado(s) na planilha`);
      }
    } catch (err) {
      log(`❌ Erro ao verificar Drive para ${channel.name}: ${err.message}`);
    }
  }
}

/**
 * Publica um único vídeo.
 */
async function processarVideo(entry) {
  log(`🎬 Processando: ${entry.nomeArquivo} — ${entry.canal} (linha ${entry.rowIndex})`);

  const channelKey = Object.keys(CHANNELS).find(k => CHANNELS[k].name === entry.canal);
  if (!channelKey) throw new Error(`Canal não mapeado: "${entry.canal}"`);
  const channel = CHANNELS[channelKey];

  const fileId = extrairFileId(entry.linkDriveAguardando);
  if (!fileId) throw new Error(`Link Drive inválido na linha ${entry.rowIndex}`);

  const localPath = path.join(TEMP_DIR, entry.nomeArquivo);

  try {
    // 1. Download do vídeo
    await downloadVideo(fileId, localPath);
    log(`⬇️  Baixado: ${path.basename(localPath)}`);

    // 2. Gera SEO analisando os frames do vídeo (ou usa o que já está na planilha)
    let seo;
    if (entry.tituloYoutube) {
      seo = { titulo: entry.tituloYoutube, descricao: entry.descricaoYoutube, tags: entry.tagsYoutube ? entry.tagsYoutube.split(',').map(t => t.trim()) : [] };
      log(`✍️  SEO já existente: ${seo.titulo}`);
    } else {
      log(`✍️  Analisando vídeo e gerando SEO...`);
      seo = await gerarSEO({ videoPath: localPath, nomeArquivo: entry.nomeArquivo, nomeCanal: channel.name, nicho: channel.nicho });
      await salvarSEO(entry.rowIndex, seo);
      log(`✍️  Título: ${seo.titulo}`);
    }

    // 3. Upload YouTube Short
    const youtubeUrl = await uploadShort(channel, localPath, seo);
    log(`📺 YouTube: ${youtubeUrl}`);

    // 4. Renomeia e move no Drive (não-crítico)
    const nomePublicado = formatarNomePublicado(seo.titulo);
    let linkDrivePublicado = '';
    try {
      await renameFile(fileId, nomePublicado);
      await moveToPublished(fileId, channel);
      linkDrivePublicado = await getFileLink(fileId);
      log(`📁 Drive: movido para publicados como "${nomePublicado}"`);
    } catch (driveErr) {
      log(`⚠️  Drive rename/move falhou (não crítico): ${driveErr.message}`);
    }

    // 5. Atualiza planilha
    await markAsPublished(entry.rowIndex, { youtubeUrl, linkDrivePublicado, nomeArquivoPublicado: nomePublicado });
    log(`✅ Concluído: ${entry.nomeArquivo}`);

  } catch (err) {
    log(`❌ Erro: ${err.message}`);
    console.error(err);
    await markAsError(entry.rowIndex, err.message).catch(() => {});
  } finally {
    if (fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch {}
  }
}

/**
 * Ciclo de publicação: publica 1 vídeo por canal (respeita limite de 3/dia).
 * Roda nos horários: 5h, 12h, 18h (horário de Brasília).
 */
async function cicloPublicacao() {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  log(`📅 Ciclo de publicação — ${agora}`);

  try {
    const pending = await getPendingVideos();
    if (pending.length === 0) {
      log('📭 Nenhum vídeo pendente.');
      return;
    }

    // Agrupa pendentes por canal e publica 1 por canal
    const porCanal = {};
    for (const entry of pending) {
      if (!porCanal[entry.canal]) porCanal[entry.canal] = entry;
    }

    const fila = Object.values(porCanal);
    log(`📂 Publicando 1 vídeo de ${fila.length} canal(is) com pendências`);

    for (const entry of fila) {
      await processarVideo(entry);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (err) {
    log(`❌ Erro no ciclo de publicação: ${err.message}`);
    console.error(err);
  }
}

/**
 * Ciclo de detecção: só verifica novos arquivos no Drive.
 * Roda a cada 30 minutos.
 */
async function cicloDeteccao() {
  try {
    await detectarNovosVideos();
  } catch (err) {
    log(`❌ Erro na detecção: ${err.message}`);
  }
}

// Garante diretórios necessários
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// Inicia servidor web
startServer();

log(`🚀 Canais Dark iniciado`);
log(`📡 Canais ativos: ${getChannelKeys().map(k => CHANNELS[k].name).join(', ')}`);
log(`🕐 Horários de publicação: ${HORARIOS_PUBLICACAO.map(h => `${String(h.hora).padStart(2,'0')}:00`).join(' | ')} (Brasília)`);
log(`📊 Limite: 1 vídeo por canal por horário = máx. 3 posts/dia por canal`);

// Detecção de novos vídeos a cada 30 minutos
cron.schedule('*/30 * * * *', cicloDeteccao);

// Publicação nos horários fixos (timezone America/Sao_Paulo)
for (const { hora, minuto } of HORARIOS_PUBLICACAO) {
  cron.schedule(`${minuto} ${hora} * * *`, cicloPublicacao, { timezone: 'America/Sao_Paulo' });
  log(`⏰ Publicação agendada: ${String(hora).padStart(2,'0')}:${String(minuto).padStart(2,'0')} (Brasília)`);
}

// Pipeline de cortes a cada 15 minutos
cron.schedule('*/15 * * * *', cicloDeCortess, { timezone: 'America/Sao_Paulo' });
log('✂️  Pipeline de cortes agendado: a cada 15 minutos');

// Detecção imediata ao iniciar
cicloDeteccao();
