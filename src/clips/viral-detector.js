require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// =========================================================
// CRITÉRIOS DE VIRALIDADE POR NICHO
// Personalize à vontade para cada canal
// =========================================================
const CRITERIOS_POR_NICHO = {
  'político': {
    descricao: 'canal de cortes político brasileiro',
    criterios: [
      'Confronto direto ou resposta contundente a adversário',
      'Denúncia ou revelação de informação surpreendente',
      'Promessa política clara e objetiva',
      'Frase de impacto ou slogan marcante e citável',
      'Momento de indignação, paixão ou emoção intensa',
      'Debate acirrado com argumento que fecha questão',
      'Crítica certeira ao governo ou à oposição',
      'Humor político, ironia involuntária ou momento inusitado',
    ],
    instrucoes: 'Priorize alto impacto emocional e político. O público é brasileiro engajado em política.',
  },
  'cristão': {
    descricao: 'canal cristão brasileiro',
    criterios: [
      'Mensagem de fé edificante e impactante',
      'Versículo bíblico aplicado ao cotidiano de forma poderosa',
      'Testemunho pessoal emocionante',
      'Pregação com revelação ou insight espiritual marcante',
      'Momento de intercessão ou oração com unção',
      'Mensagem de esperança e encorajamento profundo',
    ],
    instrucoes: 'Priorize conteúdo que edifique, inspire e gere compartilhamento entre cristãos.',
  },
  'frutas': {
    descricao: 'canal de curiosidades sobre frutas com personagens falantes',
    criterios: [
      'Curiosidade surpreendente ou dado inusitado sobre uma fruta',
      'Momento de humor ou reação engraçada dos personagens',
      'Revelação inesperada sobre propriedades de uma fruta',
      'Interação cômica entre personagens',
      'Fato científico interessante sobre nutrição ou biologia',
    ],
    instrucoes: 'Priorize humor, curiosidade e surpresa. Público amplo e familiar.',
  },
  'default': {
    descricao: 'canal de entretenimento',
    criterios: [
      'Momento de alta emoção ou impacto',
      'Frase ou declaração memorável e citável',
      'Revelação ou virada surpreendente',
      'Conflito ou tensão dramática',
      'Humor genuíno e espontâneo',
    ],
    instrucoes: 'Priorize momentos que gerem emoção, surpresa ou vontade de compartilhar.',
  },
};

/**
 * Detecta o tipo/contexto do conteúdo (debate, discurso, podcast, etc.)
 */
async function detectarContexto(fullText, tituloOriginal) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 20,
    messages: [{
      role: 'user',
      content: `Identifique em UMA palavra o tipo do vídeo.\nTítulo: "${tituloOriginal}"\nInício: "${fullText.slice(0, 400)}"\nExemplos: debate, discurso, podcast, live, entrevista, sermão, palestra, vlog.\nResposta (só o tipo):`,
    }],
  });
  return msg.content[0].text.trim().toLowerCase();
}

/**
 * Analisa a transcrição e identifica os melhores momentos para cortes virais.
 *
 * @param {object} params
 * @param {string} params.fullText
 * @param {Array<{start,end,text}>} params.segments
 * @param {string} params.nicho
 * @param {string} params.nomeCanal
 * @param {string} params.tituloOriginal
 * @param {number} params.duracaoTotal
 * @param {number} [params.maxCortes=5]
 * @param {number} [params.maxDuracaoCorte=59]
 * @returns {Promise<Array<{inicio,fim,score,motivo,textoCorte}>>}
 */
async function identificarMomentosVirais({
  fullText, segments, nicho, nomeCanal,
  tituloOriginal, duracaoTotal,
  maxCortes = 5, maxDuracaoCorte = 59,
}) {
  const criterios = CRITERIOS_POR_NICHO[nicho] || CRITERIOS_POR_NICHO['default'];

  const janelaTexto = segments
    .map(s => `[${s.start.toFixed(0)}s-${s.end.toFixed(0)}s] ${s.text}`)
    .join('\n');

  const prompt = `Você é especialista em identificar momentos virais para ${criterios.descricao}.

VÍDEO: "${tituloOriginal}"
CANAL: ${nomeCanal} | NICHO: ${nicho}
DURAÇÃO: ${Math.floor(duracaoTotal/60)}min ${Math.floor(duracaoTotal%60)}s

CRITÉRIOS DE VIRALIDADE:
${criterios.criterios.map((c, i) => `${i+1}. ${c}`).join('\n')}
${criterios.instrucoes}

TRANSCRIÇÃO COM TIMESTAMPS:
${janelaTexto}

Identifique os ${maxCortes} melhores momentos para cortes (15 a ${maxDuracaoCorte} segundos cada).
Regras: início/fim em frases completas; sem sobreposição; faz sentido isolado.

Retorne APENAS JSON (sem markdown):
{"cortes":[{"inicio":45.2,"fim":87.6,"score":9.2,"motivo":"...","textoCorte":"..."}]}

Ordene por score decrescente (10=máximo viral).`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  const result = JSON.parse(raw);

  return (result.cortes || [])
    .map(c => ({
      inicio:     parseFloat(c.inicio),
      fim:        Math.min(parseFloat(c.fim), parseFloat(c.inicio) + maxDuracaoCorte),
      score:      parseFloat(c.score || 5),
      motivo:     c.motivo || '',
      textoCorte: c.textoCorte || '',
    }))
    .filter(c => {
      const dur = c.fim - c.inicio;
      return dur >= 10 && dur <= maxDuracaoCorte && c.inicio >= 0 && c.fim <= duracaoTotal + 1;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCortes);
}

module.exports = { identificarMomentosVirais, detectarContexto };
