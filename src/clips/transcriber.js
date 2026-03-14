require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

/** Extrai faixa de áudio do vídeo para MP3 mono 16kHz (ideal para Whisper) */
async function extrairAudio(videoPath) {
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');
  await execFileAsync('ffmpeg', [
    '-i', videoPath,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-q:a', '4',
    '-y', audioPath,
  ]);
  return audioPath;
}

/**
 * Transcreve com Groq Whisper API (free tier).
 * Compatível com OpenAI SDK — basta trocar baseURL + apiKey.
 * Retorna: { fullText, segments: [{start, end, text}], duration, language }
 */
async function transcribeWithWhisper(audioPath) {
  let OpenAI;
  try {
    OpenAI = require('openai');
  } catch {
    throw new Error('Pacote "openai" não instalado. Execute: npm install openai');
  }

  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const transcription = await client.audio.transcriptions.create({
    file:                    fs.createReadStream(audioPath),
    model:                   'whisper-large-v3',
    language:                'pt',
    response_format:         'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = (transcription.segments || []).map(seg => ({
    start: parseFloat(seg.start.toFixed(2)),
    end:   parseFloat(seg.end.toFixed(2)),
    text:  seg.text.trim(),
  }));

  return {
    fullText: transcription.text || segments.map(s => s.text).join(' '),
    segments,
    duration: transcription.duration || 0,
    language: transcription.language || 'pt',
  };
}

/**
 * Gera arquivo SRT a partir de segmentos de transcrição
 */
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

/**
 * Gera SRT com timestamps relativos ao início do corte
 */
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
