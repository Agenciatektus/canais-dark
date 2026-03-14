require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { google } = require('googleapis');

const { downloadVideo, getVideoDuration }               = require('./downloader');
const { transcreverVideo }                              = require('./transcriber');
const { identificarMomentosVirais, detectarContexto }   = require('./viral-detector');
const { processarCortes }                               = require('./cutter');
const {
  getPendingClipJobs, markAsProcessing,
  markAsCompleted, markAsError, updateMetadata,
} = require('./clips-sheets');
const { CHANNELS } = require('../channels');

const TEMP_BASE       = path.join(os.tmpdir(), 'canais-dark-clips');
const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');

function getDriveClient() {
  const raw  = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const creds = raw.web || raw.installed;
  const auth  = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID  || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    'http://localhost:8080/callback'
  );
  auth.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

/** Faz upload de um MP4 local para a pasta "aguardando" do canal no Drive */
async function uploadCorteParaDrive(localPath, channel) {
  const drive = getDriveClient();
  const res   = await drive.files.create({
    requestBody: { name: path.basename(localPath), parents: [channel.driveAguardando] },
    media: { mimeType: 'video/mp4', body: fs.createReadStream(localPath) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return {
    id:          res.data.id,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

/** Busca configuração do canal pelo nome (exato, case-insensitive) */
function resolverCanal(nomeCanal) {
  const key = Object.keys(CHANNELS).find(
    k => CHANNELS[k].name.toLowerCase() === nomeCanal.toLowerCase()
  );
  return key ? CHANNELS[key] : null;
}

/** Processa um único job de corte end-to-end */
async function processarJobDeCorte(job, log) {
  log(`🎬 Iniciando: "${job.linkFonte}" → ${job.canal} (linha ${job.rowIndex})`);
  await markAsProcessing(job.rowIndex);

  const channel = resolverCanal(job.canal);
  if (!channel) throw new Error(`Canal não encontrado: "${job.canal}". Verifique channels.js`);

  const tmpDir = path.join(TEMP_BASE, `job_${job.rowIndex}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ── 1. Download ─────────────────────────────────────────────
    log(`  ⬇️  Baixando (${job.tipoFonte})...`);
    const videoInfo = await downloadVideo(job.linkFonte, job.tipoFonte, tmpDir);
    log(`  ✅ ${path.basename(videoInfo.localPath)}`);

    const duracao        = videoInfo.duration || await getVideoDuration(videoInfo.localPath);
    const tituloOriginal = job.tituloOriginal || videoInfo.title || 'Sem título';

    // ── 2. Transcrição ───────────────────────────────────────────
    log(`  🎙️  Transcrevendo com Whisper...`);
    const transcricao = await transcreverVideo(videoInfo.localPath);
    log(`  ✅ ${transcricao.segments.length} segmentos transcritos`);

    // ── 3. Contexto ──────────────────────────────────────────────
    const contexto = job.contextoConteudo ||
      await detectarContexto(transcricao.fullText, tituloOriginal);
    log(`  🏷️  Contexto: ${contexto}`);
    await updateMetadata(job.rowIndex, { tituloOriginal, contexto });

    // ── 4. Detecção de momentos virais ───────────────────────────
    log(`  🔍 Identificando momentos virais (Claude AI)...`);
    const cortes = await identificarMomentosVirais({
      fullText:        transcricao.fullText,
      segments:        transcricao.segments,
      nicho:           channel.nicho,
      nomeCanal:       channel.name,
      tituloOriginal,
      duracaoTotal:    duracao,
      maxCortes:       parseInt(process.env.MAX_CORTES_POR_VIDEO || '5'),
      maxDuracaoCorte: 59,
    });

    log(`  ✅ ${cortes.length} momento(s) identificado(s):`);
    cortes.forEach((c, i) =>
      log(`     ${i+1}. [${c.inicio.toFixed(0)}s-${c.fim.toFixed(0)}s] score=${c.score} — ${c.motivo}`)
    );

    if (cortes.length === 0) throw new Error('Nenhum momento viral identificado.');

    // ── 5. Corte + legendas (ffmpeg) ─────────────────────────────
    const prefixo = tituloOriginal
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, '').trim()
      .replace(/\s+/g, '_').substring(0, 30);

    log(`  ✂️  Cortando e legendando...`);
    const arquivos = await processarCortes({
      videoPath:  videoInfo.localPath,
      cortes,
      segments:   transcricao.segments,
      outputDir:  path.join(tmpDir, 'cortes'),
      prefixo,
    });
    log(`  ✅ ${arquivos.length} cortes gerados`);

    // ── 6. Upload → Drive aguardando do canal ────────────────────
    log(`  ☁️  Enviando para Drive de "${channel.name}"...`);
    const linksDrive = [];
    for (const arq of arquivos) {
      const r = await uploadCorteParaDrive(arq, channel);
      linksDrive.push(r.webViewLink);
      log(`     📁 ${path.basename(arq)}`);
    }

    // ── 7. Atualiza planilha CORTES ──────────────────────────────
    await markAsCompleted(job.rowIndex, {
      totalCortes: arquivos.length,
      linksDrive,
      tituloOriginal,
      contexto,
    });
    log(`  🎉 Concluído! ${arquivos.length} corte(s) na fila de "${channel.name}"`);

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** Ciclo principal: busca jobs pendentes e processa */
async function cicloDeCortess(log) {
  log('✂️  Verificando jobs de cortes pendentes...');
  let jobs;
  try {
    jobs = await getPendingClipJobs();
  } catch (err) {
    log(`❌ Erro ao buscar jobs: ${err.message}`);
    return;
  }

  if (jobs.length === 0) { log('📭 Nenhum job aguardando.'); return; }

  log(`📂 ${jobs.length} job(s) encontrado(s). Processando...`);
  for (const job of jobs) {
    try {
      await processarJobDeCorte(job, log);
    } catch (err) {
      log(`❌ Erro linha ${job.rowIndex}: ${err.message}`);
      console.error(err);
      try { await markAsError(job.rowIndex, err.message); } catch {}
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

module.exports = { cicloDeCortess };
