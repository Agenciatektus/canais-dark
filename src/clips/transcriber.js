require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);
const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const GROQ_LIMIT_MB  = 23;           // margem abaixo dos 25MB do Groq
const CHUNK_SECONDS  = 30 * 60;      // 30 minutos por chunk

/** Retorna duração em segundos usando ffprobe */
async function getAudioDuration(audioPath) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', audioPath,
  ]);
  return parseFloat(JSON.parse(stdout).format?.duration || 0);
}

/** Extrai faixa de áudio do vídeo para MP3 mono 16kHz */
async function extrairAudio(videoPath) {
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');
  await execFileAsync(FFMPEG, [
    '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-q:a', '4', '-y', audioPath,
  ]);
  return audioPath;
}

/** Corta um trecho do áudio (ss=início, t=duração) */
async function extrairChunk(audioPath, startSec, durationSec, outPath) {
  await execFileAsync(FFMPEG, [
    '-i', audioPath,
    '-ss', String(startSec),
    '-t',  String(durationSec),
    '-c',  'copy',
    '-y',  outPath,
  ]);
  return outPath;
}

/** Chama a API Groq Whisper para um único arquivo de áudio (com retry em rate limit) */
async function transcribeChunk(audioPath, attempt = 1) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  try {
    const transcription = await client.audio.transcriptions.create({
      file:                    fs.createReadStream(audioPath),
      model:                   'whisper-large-v3',
      language:                'pt',
      response_format:         'verbose_json',
      timestamp_granularities: ['segment'],
    });

    return (transcription.segments || []).map(seg => ({
      start: parseFloat(seg.start.toFixed(2)),
      end:   parseFloat(seg.end.toFixed(2)),
      text:  seg.text.trim(),
    }));
  } catch (err) {
    if (err.status === 429 && attempt <= 3) {
      // Lê retry-after do header ou extrai da mensagem
      const rawRetry = err.headers?.get?.('retry-after') ?? err.headers?.['retry-after'] ?? '120';
      const waitSec = parseInt(rawRetry, 10) + 10;
      console.log(`  ⏳ Rate limit — aguardando ${waitSec}s antes de tentar novamente (tentativa ${attempt}/3)...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return transcribeChunk(audioPath, attempt + 1);
    }
    throw err;
  }
}

/**
 * Transcreve um arquivo de áudio com chunking automático.
 * Se o arquivo > GROQ_LIMIT_MB, divide em partes de CHUNK_SECONDS e combina.
 */
async function transcribeWithWhisper(audioPath) {
  const fileSizeMB = fs.statSync(audioPath).size / (1024 * 1024);
  const duration   = await getAudioDuration(audioPath);

  let allSegments = [];

  if (fileSizeMB <= GROQ_LIMIT_MB) {
    allSegments = await transcribeChunk(audioPath);
  } else {
    // Divide em chunks e transcreve cada um, ajustando timestamps
    const numChunks = Math.ceil(duration / CHUNK_SECONDS);
    const chunkDir  = path.dirname(audioPath);
    console.log(`  ℹ️  Áudio grande (${fileSizeMB.toFixed(1)}MB / ${(duration/60).toFixed(0)}min) → ${numChunks} chunk(s) de 60min`);

    for (let i = 0; i < numChunks; i++) {
      const startSec   = i * CHUNK_SECONDS;
      const durSec     = Math.min(CHUNK_SECONDS, duration - startSec);
      const chunkPath  = path.join(chunkDir, `chunk_${i}.mp3`);

      try {
        await extrairChunk(audioPath, startSec, durSec, chunkPath);
        const chunkSegs = await transcribeChunk(chunkPath);

        // Ajusta timestamps para posição real no vídeo
        chunkSegs.forEach(s => {
          allSegments.push({
            start: parseFloat((s.start + startSec).toFixed(2)),
            end:   parseFloat((s.end   + startSec).toFixed(2)),
            text:  s.text,
          });
        });
        console.log(`     chunk ${i+1}/${numChunks} ✅ (${chunkSegs.length} segmentos)`);
      } finally {
        if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      }
    }
  }

  return {
    fullText: allSegments.map(s => s.text).join(' '),
    segments: allSegments,
    duration,
    language: 'pt',
  };
}

/** Gera arquivo SRT a partir de segmentos */
function gerarSRT(segments, outputPath) {
  const fmt = (s) => {
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  };
  const content = segments
    .map((seg, i) => `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`)
    .join('\n');
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

/** Gera SRT com timestamps relativos ao início do corte */
function gerarSRTParaCorte(allSegments, clipStart, clipEnd, outputPath) {
  const segs = allSegments
    .filter(s => s.start < clipEnd && s.end > clipStart)
    .map(s => ({
      start: Math.max(0, s.start - clipStart),
      end:   Math.min(clipEnd - clipStart, s.end - clipStart),
      text:  s.text,
    }))
    .filter(s => s.end > s.start && s.text.trim());
  return gerarSRT(segs, outputPath);
}

/** Extrai áudio + transcreve (limpa o MP3 temporário ao final) */
async function transcreverVideo(videoPath) {
  const audioPath = await extrairAudio(videoPath);
  try {
    return await transcribeWithWhisper(audioPath);
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

module.exports = { transcreverVideo, gerarSRT, gerarSRTParaCorte };
