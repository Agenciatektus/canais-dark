const fs = require('fs');

// ── Cores ASS (formato &HBBGGRR&) ──────────────────────────────────────────
const COR = {
  branco:       '&H00FFFFFF',
  preto:        '&H00000000',
  amarelo:      '&H0000FFFF',
  vermelho:     '&H000000FF',
  verde:        '&H0000FF00',
  azul:         '&H00FF6600',
  fundoEscuro:  '&H99000000', // semi-transparente
};

// ── Presets visuais ────────────────────────────────────────────────────────
// PrimaryColour = cor do texto base
// OutlineColour = cor do contorno
// BackColour    = fundo da caixa (se BorderStyle=4) ou sombra
const PRESETS = {
  INSTITUCIONAL: {
    primary:    COR.branco,
    outline:    COR.preto,
    back:       COR.fundoEscuro,
    destaque:   COR.amarelo,
  },
  ATAQUE: {
    primary:    COR.branco,
    outline:    '&H00000099', // vermelho escuro
    back:       COR.fundoEscuro,
    destaque:   COR.vermelho,
  },
  PROPOSTA: {
    primary:    COR.branco,
    outline:    '&H00009900', // verde escuro
    back:       COR.fundoEscuro,
    destaque:   COR.verde,
  },
};

// ── Keywords por nicho ─────────────────────────────────────────────────────
// Palavras que recebem cor de destaque inline
const KEYWORDS_NICHO = {
  político: [
    // acusação/crise → cor destaque do preset
    'corrupção','corrupto','corruptos','mentira','mentiras','roubo','roubou',
    'fraude','fraudes','escândalo','escândalos','golpe','crime','crimes',
    'bandido','bandidos','ladrão','ladrões','criminoso','criminosos',
    // impacto emocional
    'imposto','impostos','povo','Brasil','liberdade','direito','direitos',
    'urgente','absurdo','inadmissível','vergonha','denúncia','denúncias',
    // proposta
    'proposta','solução','projeto','reforma','mudança','criar','criamos',
  ],
  cristão: [
    'fé','milagre','bênção','oração','Jesus','Cristo','Deus','Espírito',
    'graça','amor','salvação','cura','poder','gloria','vitória',
  ],
  frutas: [
    'vitamina','nutriente','antioxidante','descoberta','surpresa','incrível',
    'benefício','saúde','curiosidade','segredo',
  ],
};

// ── Seleção de preset ──────────────────────────────────────────────────────
function selecionarPreset(tipoDeCorte = '') {
  const t = tipoDeCorte.toLowerCase();
  if (['denúncia','ataque','acusação','crítica','confronto','escândalo']
    .some(x => t.includes(x))) return 'ATAQUE';
  if (['proposta','defesa','solução','resposta','explicação','projeto']
    .some(x => t.includes(x))) return 'PROPOSTA';
  return 'INSTITUCIONAL';
}

// ── Formatação de tempo ASS (H:MM:SS.cc) ──────────────────────────────────
function fmtASS(secs) {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100); // centésimos
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ── Quebra texto em blocos de no máximo N palavras ─────────────────────────
function quebrarEmBlocos(text, maxWords = 6) {
  const words = text.trim().split(/\s+/);
  const blocks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    blocks.push(words.slice(i, i + maxWords).join(' '));
  }
  return blocks;
}

// ── Aplica cor de destaque às keywords no texto ────────────────────────────
function colorirKeywords(text, keywords, corDestaque) {
  if (!keywords || keywords.length === 0) return text;
  // Escapa caracteres especiais de regex e cria padrão case-insensitive
  const pattern = new RegExp(
    `\\b(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
  );
  return text.replace(pattern, `{\\c${corDestaque}&}$1{\\r}`);
}

// ── Gera cabeçalho ASS ─────────────────────────────────────────────────────
function gerarHeaderASS(preset) {
  const p = PRESETS[preset];
  // Formato do Style:
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
  // Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  // BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Arial,64,${p.primary},${p.primary},${p.outline},${p.back},-1,0,0,0,100,100,0.5,0,3,3,1,2,80,80,160,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Gera arquivo ASS com legendas avançadas para um clip.
 *
 * @param {Array<{start,end,text}>} allSegments - todos os segmentos da transcrição
 * @param {number} clipStart  - início do clip em segundos (absoluto)
 * @param {number} clipEnd    - fim do clip em segundos (absoluto)
 * @param {string} outputPath - caminho de saída do arquivo .ass
 * @param {object} [opts]
 * @param {string} [opts.tipoDeCorte] - tipo do corte vindo do viral-detector
 * @param {string} [opts.nicho]       - nicho do canal
 */
function gerarASSParaCorte(allSegments, clipStart, clipEnd, outputPath, { tipoDeCorte, nicho } = {}) {
  const preset    = selecionarPreset(tipoDeCorte);
  const corDest   = PRESETS[preset].destaque;
  const keywords  = KEYWORDS_NICHO[nicho] || [];

  // Filtra segmentos dentro do clip e ajusta timestamps para relativo ao início
  const segs = allSegments
    .filter(s => s.start < clipEnd && s.end > clipStart)
    .map(s => ({
      start: Math.max(0, s.start - clipStart),
      end:   Math.min(clipEnd - clipStart, s.end - clipStart),
      text:  s.text.trim(),
    }))
    .filter(s => s.end > s.start && s.text);

  const header = gerarHeaderASS(preset);
  const linhas = [];

  for (const seg of segs) {
    const durSeg  = seg.end - seg.start;
    const blocos  = quebrarEmBlocos(seg.text, 6);
    const durBloco = durSeg / blocos.length;

    blocos.forEach((bloco, i) => {
      const tStart = seg.start + i * durBloco;
      const tEnd   = tStart + durBloco;

      // Divide em 2 linhas se bloco tiver mais de 3 palavras
      const palavras = bloco.split(' ');
      let textoASS;
      if (palavras.length > 3) {
        const meio = Math.ceil(palavras.length / 2);
        const l1   = palavras.slice(0, meio).join(' ');
        const l2   = palavras.slice(meio).join(' ');
        textoASS = `${l1}\\N${l2}`;
      } else {
        textoASS = bloco;
      }

      // Aplica destaque de keywords
      textoASS = colorirKeywords(textoASS, keywords, corDest);

      // fade in 150ms, fade out 100ms
      const texto = `{\\fad(150,100)}${textoASS}`;

      linhas.push(
        `Dialogue: 0,${fmtASS(tStart)},${fmtASS(tEnd)},Base,,0,0,0,,${texto}`
      );
    });
  }

  fs.writeFileSync(outputPath, header + linhas.join('\n') + '\n', 'utf8');
  return outputPath;
}

module.exports = { gerarASSParaCorte, selecionarPreset };
