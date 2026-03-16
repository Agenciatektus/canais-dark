require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Extrai N frames de um vídeo usando ffmpeg e retorna como base64
 */
async function extrairFrames(videoPath, count = 3) {
  const tmpDir = path.join(os.tmpdir(), 'canais-dark-frames');
  fs.mkdirSync(tmpDir, { recursive: true });

  const frames = [];
  for (let i = 1; i <= count; i++) {
    const outPath = path.join(tmpDir, `frame_${Date.now()}_${i}.jpg`);
    const ratio = i / (count + 1);
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-ss', `${ratio}`,
        '-i', videoPath,
        '-vframes', '1',
        '-vf', 'scale=640:-1',
        '-q:v', '3',
        '-y', outPath,
      ], (err) => err ? reject(err) : resolve());
    });
    if (fs.existsSync(outPath)) {
      frames.push(fs.readFileSync(outPath).toString('base64'));
      fs.unlinkSync(outPath);
    }
  }
  return frames;
}

/**
 * Analisa os frames do vídeo com Claude Vision e descreve o conteúdo.
 * Ignora explicitamente watermarks e nomes de canais visíveis.
 */
async function analisarConteudo(framesBase64, nomeCanal, nicho) {
  const content = [
    {
      type: 'text',
      text: `Você está analisando frames de um vídeo do canal "${nomeCanal}" (nicho: ${nicho}).
Descreva brevemente o TEMA e o CONTEÚDO do vídeo: o que está acontecendo, o assunto principal, o ambiente.
IMPORTANTE: Ignore completamente qualquer watermark, logo, nome de canal ou texto sobreposto que apareça nas imagens — esses pertencem à fonte original e NÃO devem ser mencionados.
Seja objetivo e direto. Máximo 3 linhas.`,
    },
    ...framesBase64.map(b64 => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    })),
  ];

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content }],
  });

  return message.content[0].text.trim();
}

/**
 * Gera SEO com base no conteúdo real do vídeo (frames analisados pelo Claude Vision).
 * Quando videoPath é null/inexistente, gera SEO genérico do nicho sem alucinar nomes.
 */
async function gerarSEO({ videoPath, nomeArquivo, nomeCanal, nicho }) {
  let descricaoConteudo = '';

  if (videoPath && fs.existsSync(videoPath)) {
    try {
      const frames = await extrairFrames(videoPath, 3);
      if (frames.length > 0) {
        descricaoConteudo = await analisarConteudo(frames, nomeCanal, nicho);
      }
    } catch (err) {
      console.warn(`[SEO] Falha ao analisar frames: ${err.message}. Usando contexto genérico.`);
    }
  }

  const tom = nicho === 'cristão'
    ? 'espiritual, edificante'
    : nicho === 'frutas'
      ? 'informativo, curioso'
      : 'engajante';

  // Quando não há arquivo local, usa contexto genérico do nicho.
  // NÃO passa o videoId como "nome" — causaria alucinações.
  const contexto = descricaoConteudo
    ? `Conteúdo real do vídeo (analisado por visão computacional):\n"${descricaoConteudo}"`
    : `Contexto: vídeo de nicho "${nicho}" publicado pelo canal "${nomeCanal}". Sem descrição específica disponível — gere título e descrição genéricos e relevantes para este nicho.`;

  const prompt = `Você é especialista em SEO para YouTube no Brasil.

Canal publicador: "${nomeCanal}" | Nicho: "${nicho}"
${contexto}

Gere o SEO para este YouTube Short em português brasileiro.
REGRAS OBRIGATÓRIAS:
- O canal publicador é "${nomeCanal}". NUNCA mencione nenhum outro nome de canal, criador ou pessoa no título ou descrição.
- Não invente detalhes específicos do conteúdo se não souber o que o vídeo mostra.
- Foque em palavras-chave do nicho "${nicho}" que atraiam o público certo.

Retorne APENAS JSON válido (sem markdown):
{
  "titulo": "máx 60 chars, direto, palavra-chave no início",
  "descricao": "2-3 linhas curtas + 5 hashtags relevantes ao final. Máx 300 chars.",
  "tags": ["8 a 10 tags relevantes sem #"]
}

Tom: "${tom}"`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let seo;
  try {
    seo = JSON.parse(content);
  } catch {
    throw new Error(`Claude retornou JSON inválido: ${content.slice(0, 200)}`);
  }

  if (!seo.titulo || !seo.descricao || !Array.isArray(seo.tags)) {
    throw new Error(`Resposta incompleta: faltam campos titulo/descricao/tags`);
  }

  return {
    titulo:   seo.titulo.slice(0, 100),
    descricao: seo.descricao.slice(0, 5000),
    tags:     seo.tags.slice(0, 30),
  };
}

module.exports = { gerarSEO };
