require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execFileAsync = promisify(execFile);
const FFMPEG     = process.env.FFMPEG_PATH || 'ffmpeg';
const FONT_PATH  = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// Mapeamento de posições para expressões ffmpeg drawtext
const POSICOES = {
  'bottom-right': 'x=w-tw-24:y=h-th-40',
  'bottom-left':  'x=24:y=h-th-40',
  'top-right':    'x=w-tw-24:y=24',
  'top-left':     'x=24:y=24',
};

/**
 * Aplica transformações visuais em um vídeo usando ffmpeg.
 * Opera in-place: cria arquivo temporário e substitui o original ao fim.
 *
 * Config de transformações (channel.transformacoes):
 * {
 *   colorGrade: { saturacao: 1.3, contraste: 1.15, brilho: 0.0 },
 *   vignette: true,
 *   watermark: {
 *     texto:     '@seucanal',
 *     posicao:   'bottom-right',   // bottom-right | bottom-left | top-right | top-left
 *     tamanho:   32,               // tamanho da fonte em px
 *     opacidade: 0.8,              // 0.0 a 1.0
 *   },
 * }
 *
 * @param {string} videoPath    - caminho absoluto do arquivo MP4
 * @param {object} transformacoes - objeto de config do canal (pode ser undefined)
 * @returns {Promise<string>}   - mesmo videoPath após transformação
 */
async function aplicarTransformacoes(videoPath, transformacoes) {
  if (!transformacoes || Object.keys(transformacoes).length === 0) return videoPath;

  const filters = [];

  // ── Color grade ───────────────────────────────────────────────────────────
  if (transformacoes.colorGrade) {
    const { saturacao = 1.0, contraste = 1.0, brilho = 0.0 } = transformacoes.colorGrade;
    filters.push(`eq=saturation=${saturacao}:contrast=${contraste}:brightness=${brilho}`);
  }

  // ── Vignette ──────────────────────────────────────────────────────────────
  if (transformacoes.vignette) {
    filters.push('vignette=PI/4');
  }

  // ── Granulação de cinema ──────────────────────────────────────────────────
  // Adiciona noise sutil que imita película — modifica o arquivo sem ser perceptível
  if (transformacoes.grain) {
    const intensidade = transformacoes.grain === true ? 8 : transformacoes.grain; // px de noise
    filters.push(`noise=alls=${intensidade}:allf=t+u`);
  }

  // ── Watermark de texto ────────────────────────────────────────────────────
  if (transformacoes.watermark) {
    const {
      texto,
      posicao   = 'bottom-right',
      tamanho   = 32,
      opacidade = 0.8,
    } = transformacoes.watermark;

    const pos          = POSICOES[posicao] || POSICOES['bottom-right'];
    const textoEsc     = texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
    const fontArg      = fs.existsSync(FONT_PATH) ? `fontfile=${FONT_PATH}:` : '';

    filters.push(
      `drawtext=${fontArg}text='${textoEsc}':fontcolor=white@${opacidade}:fontsize=${tamanho}:${pos}:shadowcolor=black@0.7:shadowx=2:shadowy=2`
    );
  }

  if (filters.length === 0) return videoPath;

  const tempPath = videoPath.replace(/\.mp4$/i, '_t.mp4');

  try {
    await execFileAsync(FFMPEG, [
      '-i',      videoPath,
      '-vf',     filters.join(','),
      '-c:a',    'copy',       // áudio sem re-encode
      '-crf',    '20',
      '-preset', 'fast',
      '-y',
      tempPath,
    ], { maxBuffer: 200 * 1024 * 1024 });

    fs.renameSync(tempPath, videoPath);
    return videoPath;
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error(`Erro ao aplicar transformações: ${err.message}`);
  }
}

module.exports = { aplicarTransformacoes };
