const { execFile } = require('child_process');
const { promisify } = require('util');
const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const { gerarASSParaCorte } = require('./subtitle-generator');

const execFileAsync = promisify(execFile);
const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Detecta dimensões do vídeo */
async function getVideoDimensions(videoPath) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_streams', '-select_streams', 'v:0', videoPath,
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  const w = stream?.width  || 1920;
  const h = stream?.height || 1080;
  return { width: w, height: h, isVertical: h > w };
}

/**
 * Extrai um frame do vídeo em um timestamp e retorna como base64.
 */
async function extrairFrame(videoPath, timestampSec, outputPath) {
  await execFileAsync(FFMPEG, [
    '-ss', String(timestampSec),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '3',
    '-y', outputPath,
  ]);
  return fs.readFileSync(outputPath);
}

/**
 * Usa Claude Vision para detectar posição horizontal do falante principal.
 * Retorna um número 0–100 representando o centro do rosto em % da largura do frame.
 * 0 = extremo esquerdo, 50 = centro, 100 = extremo direito.
 */
async function detectarPosicaoFalante(videoPath, midpointSec, tmpDir, index) {
  const framePath = path.join(tmpDir, `frame_${index}_${Date.now()}.jpg`);
  try {
    const frameBuffer = await extrairFrame(videoPath, midpointSec, framePath);
    const base64 = frameBuffer.toString('base64');

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: 'Esta é uma imagem horizontal de vídeo. Encontre o rosto ou busto do PRINCIPAL falante (pessoa que está com a boca aberta, gesticulando ou claramente sendo entrevistada). Qual é a posição horizontal do centro do rosto/busto dessa pessoa, em porcentagem da largura total da imagem? 0% = borda esquerda, 50% = centro, 100% = borda direita. Responda APENAS com o número inteiro (ex: 25, 50, 70).',
          },
        ],
      }],
    });

    const raw  = msg.content[0].text.trim().replace(/[^0-9]/g, '');
    const pct  = parseInt(raw, 10);
    const result = (!isNaN(pct) && pct >= 0 && pct <= 100) ? pct : 50;
    console.log(`     👁️  Falante detectado em ${result}% (corte ${index})`);
    return result;
  } catch (err) {
    console.log(`     ⚠️  Falha na detecção do falante (${err.message}) — usando centro`);
    return 50;
  } finally {
    try { fs.unlinkSync(framePath); } catch {}
  }
}

/**
 * Corta um trecho, converte para 9:16 vertical com crop inteligente e queima legendas ASS.
 *
 * @param {object} p
 * @param {string} p.videoPath
 * @param {number} p.inicio
 * @param {number} p.fim
 * @param {Array}  p.segments     - segmentos da transcrição completa
 * @param {string} p.outputPath
 * @param {number} [p.index=0]
 * @param {string} [p.tipoDeCorte]
 * @param {string} [p.nicho]
 */
async function cortarVideo({ videoPath, inicio, fim, segments, outputPath, index = 0, tipoDeCorte, nicho }) {
  const duracao = fim - inicio;
  const tmpDir  = path.dirname(outputPath);
  const assPath = path.join(tmpDir, `sub_${index}_${Date.now()}.ass`);

  if (segments && segments.length > 0) {
    gerarASSParaCorte(segments, inicio, fim, assPath, { tipoDeCorte, nicho });
  }

  const { width, height, isVertical } = await getVideoDimensions(videoPath);
  const vfParts = [];

  if (!isVertical) {
    // Detecta posição percentual do falante para crop inteligente
    const midpoint   = inicio + duracao / 2;
    const posicaoPct = await detectarPosicaoFalante(videoPath, midpoint, tmpDir, index);

    // Calcula largura do crop para 9:16 e centraliza no falante
    const cropW    = Math.floor(height * 9 / 16);
    const faceCenterX = Math.floor(width * posicaoPct / 100);
    const cropXIdeal  = faceCenterX - Math.floor(cropW / 2);
    const cropX       = Math.max(0, Math.min(width - cropW, cropXIdeal));
    console.log(`     ✂️  Crop: x=${cropX} (face@${faceCenterX}px, janela=${cropW}px de ${width}px)`);
    vfParts.push(`crop=${cropW}:${height}:${cropX}:0`);
  }

  vfParts.push('scale=1080:1920:force_original_aspect_ratio=decrease');
  vfParts.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black');

  const assExists = fs.existsSync(assPath);
  if (assExists) {
    // ASS: sem force_style — os estilos estão definidos no próprio arquivo
    const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    vfParts.push(`subtitles='${assEsc}'`);
  }

  await execFileAsync(FFMPEG, [
    '-ss', String(inicio),
    '-i',  videoPath,
    '-t',  String(duracao),
    '-vf', vfParts.join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ]);

  if (assExists) try { fs.unlinkSync(assPath); } catch {}
  return outputPath;
}

/**
 * Processa uma lista de cortes de um único vídeo fonte.
 * @returns {Promise<string[]>} paths dos MP4s gerados
 */
async function processarCortes({ videoPath, cortes, segments, outputDir, prefixo = 'corte', nicho }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const arquivos = [];

  for (let i = 0; i < cortes.length; i++) {
    const c    = cortes[i];
    const nome = `${prefixo}_${String(i+1).padStart(2,'0')}_score${c.score.toFixed(0)}.mp4`;
    const out  = path.join(outputDir, nome);

    console.log(`  ✂️  Corte ${i+1}/${cortes.length}: ${c.inicio.toFixed(1)}s→${c.fim.toFixed(1)}s (score ${c.score})`);
    console.log(`      📝 ${c.motivo}`);

    await cortarVideo({
      videoPath,
      inicio:      c.inicio,
      fim:         c.fim,
      segments,
      outputPath:  out,
      index:       i,
      tipoDeCorte: c.tipoDeCorte,
      nicho,
    });
    arquivos.push(out);
  }
  return arquivos;
}

module.exports = { cortarVideo, processarCortes };
