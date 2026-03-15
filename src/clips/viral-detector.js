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
  // Usa início + trecho do meio para melhor contexto
  const amostra = [
    fullText.slice(0, 600),
    fullText.length > 1200 ? '...' + fullText.slice(Math.floor(fullText.length / 2), Math.floor(fullText.length / 2) + 400) : '',
  ].join(' ').trim();

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 15,
    messages: [{
      role: 'user',
      content: `Classifique o tipo do vídeo em UMA palavra.

Título: "${tituloOriginal}"
Transcrição (trecho): "${amostra}"

Definições:
- podcast: conversa entre 2+ pessoas em formato de programa/episódio, geralmente gravado
- live: transmissão ao vivo com interação de chat/audiência em tempo real, perguntas da plateia
- debate: confronto de opiniões entre candidatos ou adversários com mediador
- entrevista: jornalista/apresentador faz perguntas estruturadas a um convidado
- discurso: uma pessoa fala para plateia/câmera sem interlocutor principal
- sermão: pregação religiosa
- palestra: apresentação técnica ou educativa
- vlog: diário pessoal em vídeo

Responda APENAS a palavra (podcast, live, debate, entrevista, discurso, sermão, palestra ou vlog):`,
    }],
  });
  return msg.content[0].text.trim().toLowerCase().split(/\s+/)[0];
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

  const isPolitico = nicho === 'político';

  const prompt = isPolitico
    ? `Você é analista especialista em cortes políticos virais para vídeo curto mobile-first.

VÍDEO: "${tituloOriginal}"
CANAL: ${nomeCanal} | DURAÇÃO: ${Math.floor(duracaoTotal/60)}min ${Math.floor(duracaoTotal%60)}s

═══════════════════════════════════════════
MATRIZ DE SCORING (0–10 cada critério)
Pesos maiores: hook, tese, emoção, autonomia, segurança
═══════════════════════════════════════════
1. hook          — Abertura que prende em 1–3s (pergunta forte, acusação, contraste, dado surpreendente)
2. tese          — Ideia central clara sem precisar de contexto longo (crítica, denúncia, proposta, reação)
3. emocao        — Indignação, urgência, injustiça, choque moral, coragem ou confronto
4. conflito      — Oposição explícita: nós x eles / prometeram x fizeram / povo x sistema / fato x narrativa
5. autonomia     — Começa e termina fazendo sentido sozinho, sem depender de contexto anterior
6. frases        — Densidade de frases recortáveis, memoráveis, que virem headline ou legenda de capa
7. semSom        — Funciona com legenda, sem depender de áudio (mobile silencioso)
8. mobile        — Potencial 9:16, expressividade facial, espaço para legenda, safe zone
9. presenca      — Rosto expressivo, pausa dramática, indignação real, ironia, dedo em riste
10. ritmo        — Sem enrolação, frases curtas, progressão, "anda", retenção desde o início
11. viralidade   — Desperta reação: concordância forte, revolta, vontade de marcar alguém, contra-argumentar
12. seguranca    — CRÍTICO: não distorce sentido, não omite negação, não depende de corte desonesto

NOTA GERAL = média ponderada:
  hook×1.5 + tese×1.5 + emocao×1.2 + autonomia×1.3 + seguranca×1.5 + demais×1.0 — escale para 0–100

═══════════════════════════════════════════
SINAIS POSITIVOS (valorize):
  pergunta incisiva no começo / acusação ou confronto direto / promessa quebrada / comparação forte
  número ou dado concreto / indignação, ironia, sarcasmo, urgência / frase de efeito curta
  menção a: povo, corrupção, liberdade, imposto, segurança, saúde, governo, oposição, STF, Congresso
  mudança de tom / aplauso, reação, interrupção / pausa dramática antes de frase forte

SINAIS DE DESCARTE (penalize):
  fala burocrática / dependência de contexto prévio / sem clímax / jargão técnico excessivo
  frase ambígua que gera interpretação errada / dado não verificável no trecho
  trecho só é forte por ter sido cortado desonestamente

═══════════════════════════════════════════
REGRAS DE COERÊNCIA OBRIGATÓRIAS:
- COMEÇA na pergunta ou gancho que apresenta o assunto (espectador precisa entender o contexto)
- Em debates e entrevistas: se o trecho selecionado começa com uma RESPOSTA, retroceda o "inicio" até incluir a PERGUNTA do entrevistador/moderador que motivou aquela resposta — o padrão ideal é [pergunta curta do host] → [resposta impactante do convidado]
- Se a pergunta do host estiver imediatamente antes do trecho mais impactante, inclua-a mesmo que isso consuma alguns segundos do limite
- TERMINA quando a resposta estiver COMPLETA — nunca corte no meio de uma frase
- Se a resposta for longa, identifique o sub-trecho mais impactante que ainda forme resposta completa
- Duração: entre 20 e ${maxDuracaoCorte} segundos
- Payoff claro no final: conclusão, frase de efeito, dado revelador ou reação forte

TRANSCRIÇÃO COM TIMESTAMPS:
${janelaTexto}

Identifique os ${maxCortes} melhores trechos. Retorne APENAS JSON (sem markdown):
{"cortes":[{
  "inicio": 45.2,
  "fim": 87.6,
  "notaGeral": 87,
  "notas": {"hook":9,"tese":9,"emocao":8,"conflito":8,"autonomia":9,"frases":8,"semSom":8,"mobile":8,"presenca":7,"ritmo":8,"viralidade":9,"seguranca":9},
  "frasePrincipal": "frase mais impactante do trecho",
  "tesePolitica": "resumo da tese em 1 linha",
  "emocaoPredominante": "indignação",
  "tipoDeCorte": "denúncia",
  "motivo": "justificativa objetiva do potencial",
  "alertaContexto": "risco de distorção se houver, ou vazio"
}]}

Ordene por notaGeral decrescente.`
    : `Você é especialista em criar cortes virais para ${criterios.descricao}.

VÍDEO: "${tituloOriginal}"
CANAL: ${nomeCanal} | NICHO: ${nicho}
DURAÇÃO: ${Math.floor(duracaoTotal/60)}min ${Math.floor(duracaoTotal%60)}s

CRITÉRIOS DE VIRALIDADE:
${criterios.criterios.map((c, i) => `${i+1}. ${c}`).join('\n')}
${criterios.instrucoes}

REGRAS OBRIGATÓRIAS DE COERÊNCIA:
1. O corte DEVE começar na pergunta ou gancho que introduz o assunto
2. O corte DEVE terminar quando a resposta/raciocínio estiver COMPLETO — nunca corte frase no meio
3. O corte deve fazer sentido SOZINHO, sem precisar do resto do vídeo
4. Duração: entre 20 e ${maxDuracaoCorte} segundos

TRANSCRIÇÃO COM TIMESTAMPS:
${janelaTexto}

Identifique os ${maxCortes} melhores momentos. Retorne APENAS JSON (sem markdown):
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
    .map(c => {
      const inicio = parseFloat(c.inicio);
      const fim    = Math.min(parseFloat(c.fim), inicio + maxDuracaoCorte);

      // Suporte ao formato político expandido
      const isPoliticoResult = c.notaGeral !== undefined;
      const score = isPoliticoResult
        ? parseFloat(c.notaGeral) / 10   // 0-100 → 0-10
        : parseFloat(c.score || 5);

      const motivo = isPoliticoResult
        ? [
            c.motivo          ? `${c.motivo}` : '',
            c.frasePrincipal  ? `💬 "${c.frasePrincipal}"` : '',
            c.tesePolitica    ? `🎯 ${c.tesePolitica}` : '',
            c.emocaoPredominante ? `😤 ${c.emocaoPredominante}` : '',
            c.tipoDeCorte     ? `🏷️ ${c.tipoDeCorte}` : '',
            c.alertaContexto  ? `⚠️ ${c.alertaContexto}` : '',
          ].filter(Boolean).join(' | ')
        : (c.motivo || '');

      return { inicio, fim, score, motivo, textoCorte: c.textoCorte || c.frasePrincipal || '' };
    })
    .filter(c => {
      const dur = c.fim - c.inicio;
      return dur >= 15 && dur <= maxDuracaoCorte && c.inicio >= 0 && c.fim <= duracaoTotal + 1;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCortes);
}

module.exports = { identificarMomentosVirais, detectarContexto };
