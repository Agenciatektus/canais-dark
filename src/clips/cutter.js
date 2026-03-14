const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { gerarSRTParaCorte } = require('./transcriber');

const execFileAsync = promisify(execFile);

// Estilo de legenda otimizado para Shorts verticais (branco + contorno preto)
const SUBTITLE_STYLE = [
  'FontName=Arial', 'FontSize=22', 'Bold=1',
  'PrimaryColour=&H00FFFFFF',
  'OutlineColour=&H00000000',
  'BackColour=&H80000000',
  'Outline=2', 'Shadow=1',
  'Alignment=2', 'MarginV=60',
].join(',');

/** Detecta dimensões do vídeo */
async function getVideoDimensions(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-select_streams', 'v:0', videoPath,
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  const w = stream?.width  || 1920;
  const h = stream?.height || 1080;
  return { width: w, height: h, isVertical: h > w };
}

/**
 * Corta um trecho, converte para 9:16 vertical e queima as legendas.
 *
 * @param {object} p
 * @param {string} p.videoPath
 * @param {number} p.inicio
 * @param {number} p.fim
 * @param {Array}  p.segments   - segmentos da transcrição completa
 * @param {string} p.outputPath
 * @param {number} [p.index=0]
 */
async function cortarVideo({ videoPath, inicio, fim, segments, outputPath, index = 0 }) {
  const duracao = fim - inicio;
  const tmpDir  = path.dirname(outputPath);
  const srtPath = path.join(tmpDir, `sub_${index}_${Date.now()}.srt`);

  if (segments && segments.length > 0) {
    gerarSRTParaCorte(segments, inicio, fim, srtPath);
  }

  const { isVertical } = await getVideoDimensions(videoPath);
  const vfParts = [];

  if (!isVertical) {
    // 16:9 → crop central para 9:16
    vfParts.push('crop=ih*9/16:ih');
  }
  vfParts.push('scale=1080:1920:force_original_aspect_ratio=decrease');
  vfParts.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black');

  const srtExists = fs.existsSync(srtPath);
  if (srtExists) {
    // Escapa path para filtro do ffmpeg (Windows usa barras invertidas)
    const srtEsc = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    vfParts.push(`subtitles='${srtEsc}':force_style='${SUBTITLE_STYLE}'`);
  }

  await execFileAsync('ffmpeg', [
    '-ss', String(inicio),
    '-i',  videoPath,
    '-t',  String(duracao),
    '-vf', vfParts.join(','),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ]);

  if (srtExists) try { fs.unlinkSync(srtPath); } catch {}
  return outputPath;
}

/**
 * Processa uma lista de cortes de um único vídeo fonte.
 * @returns {Promise<string[]>} paths dos MP4s gerados
 */
async function processarCortes({ videoPath, cortes, segments, outputDir, prefixo = 'corte' }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const arquivos = [];

  for (let i = 0; i < cortes.length; i++) {
    const c    = cortes[i];
    const nome = `${prefixo}_${String(i+1).padStart(2,'0')}_score${c.score.toFixed(0)}.mp4`;
    const out  = path.join(outputDir, nome);

    console.log(`  ✂️  Corte ${i+1}/${cortes.length}: ${c.inicio.toFixed(1)}s→${c.fim.toFixed(1)}s (score ${c.score})`);
    console.log(`      📝 ${c.motivo}`);

    await cortarVideo({ videoPath, inicio: c.inicio, fim: c.fim, segments, outputPath: out, index: i });
    arquivos.push(out);
  }
  return arquivos;
}

module.exports = { cortarVideo, processarCortes };
