require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * GET /api/status
 * Retorna resumo de vídeos por canal (lê direto da planilha)
 */
app.get('/api/status', async (req, res) => {
  try {
    const { getAllVideos } = require('./sheets');
    const videos   = await getAllVideos();
    const pendentes = videos.filter(v => v.status.toLowerCase() === 'pendente').length;
    const postados  = videos.filter(v => v.status.toLowerCase() === 'postado').length;
    const erros     = videos.filter(v => v.status.toLowerCase() === 'erro').length;
    res.json({ success: true, pendentes, postados, erros, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/atualizar-metadata
 * Body: { channelKey, videoId, titulo, descricao, tags }
 * Atualiza título/descrição/tags de um vídeo já publicado no YouTube
 */
app.post('/api/atualizar-metadata', async (req, res) => {
  const { channelKey, videoId, titulo, descricao, tags } = req.body;
  if (!channelKey || !videoId || !titulo) {
    return res.status(400).json({ error: 'Campos obrigatórios: channelKey, videoId, titulo' });
  }
  try {
    const { getChannel } = require('./channels');
    const { atualizarMetadados } = require('./youtube');
    const channel = getChannel(channelKey);
    await atualizarMetadados(channel, videoId, {
      titulo,
      descricao: descricao || '',
      tags: Array.isArray(tags) ? tags : (tags || '').split(',').map(t => t.trim()).filter(Boolean),
    });
    res.json({ success: true, mensagem: `Metadados atualizados: ${videoId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/processar-agora
 * Força um ciclo imediato (sem aguardar o cron)
 */
app.post('/api/processar-agora', async (req, res) => {
  res.json({ success: true, mensagem: 'Ciclo iniciado em background.' });
});

/**
 * GET /api/canais
 * Lista todos os canais configurados com status do token OAuth
 */
app.get('/api/canais', async (req, res) => {
  try {
    const { CHANNELS, getChannelKeys } = require('./channels');
    const { verificarTokenCanal } = require('./youtube');

    const canais = await Promise.all(
      getChannelKeys().map(async (key) => {
        const ch = CHANNELS[key];
        let tokenStatus = 'checking';
        try { tokenStatus = await verificarTokenCanal(ch); } catch { tokenStatus = 'invalid'; }
        return {
          key,
          name:         ch.name,
          email:        ch.youtubeEmail,
          youtubeUrl:   ch.youtubeUrl,
          nicho:        ch.nicho,
          oauthPort:    ch.oauthPort,
          refreshTokenEnv: ch.refreshTokenEnv,
          tokenStatus,
        };
      })
    );
    res.json({ success: true, canais });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/canais
 * Recebe dados de um novo canal e retorna as instruções de configuração.
 * Também gera o arquivo auth_{key}.js automaticamente.
 */
app.post('/api/canais', async (req, res) => {
  try {
    const { CHANNELS, getChannelKeys } = require('./channels');
    const fs   = require('fs');
    const path = require('path');

    const { nome, youtubeEmail, youtubeUrl, nicho, youtubeCategory, driveAguardando, drivePublicados } = req.body;
    if (!nome || !youtubeEmail || !driveAguardando || !drivePublicados) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, youtubeEmail, driveAguardando, drivePublicados' });
    }

    // Gera chave slug a partir do nome
    const channelKey = nome
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '').trim()
      .replace(/\s+/g, '-');

    // Próxima porta OAuth disponível
    const usedPorts = getChannelKeys().map(k => CHANNELS[k].oauthPort);
    const oauthPort = Math.max(...usedPorts) + 1;

    const refreshTokenEnv = `YOUTUBE_REFRESH_TOKEN_${channelKey.toUpperCase().replace(/-/g, '_')}`;
    const tokenFile       = `./credenciais/token_${channelKey}.json`;
    const redirectUri     = `http://localhost:${oauthPort}/callback`;
    const authScriptPath  = `src/auth/auth_${channelKey}.js`;

    // Gera arquivo de auth script
    const authScript = `require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { getChannel }    = require('../channels');
const { autorizarCanal } = require('../youtube');

(async () => {
  const channel = getChannel('${channelKey}');
  console.log(\`\\nIniciando autorização para: \${channel.name}\`);
  const token = await autorizarCanal(channel);
  console.log(\`\\n✅ Adicione ao .env ou Coolify:\\n\${channel.refreshTokenEnv}=\${token}\\n\`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
`;
    const authScriptFullPath = path.join(__dirname, '..', authScriptPath);
    fs.mkdirSync(path.dirname(authScriptFullPath), { recursive: true });
    fs.writeFileSync(authScriptFullPath, authScript, 'utf8');

    // Snippet para channels.js
    const channelsSnippet = `  '${channelKey}': {
    name: '${nome}',
    youtubeEmail: '${youtubeEmail}',
    youtubeUrl: '${youtubeUrl || ''}',
    refreshTokenEnv: '${refreshTokenEnv}',
    tokenFile: '${tokenFile}',
    oauthPort: ${oauthPort},
    driveAguardando: '${driveAguardando}',
    drivePublicados:  '${drivePublicados}',
    nicho: '${nicho || 'default'}',
    youtubeCategory: '${youtubeCategory || '22'}',
  },`;

    res.json({
      success: true,
      channelKey,
      refreshTokenEnv,
      oauthPort,
      redirectUri,
      authScriptPath,
      channelsSnippet,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fila/adicionar
 * Body: { youtubeUrl, channelKey }
 * Baixa vídeo do YouTube via yt-dlp, envia para o Drive (pasta aguardando do canal)
 * e registra na planilha como Pendente.
 */
app.post('/api/fila/adicionar', async (req, res) => {
  req.setTimeout(300000); // 5 minutos para download + upload
  const { youtubeUrl, channelKey } = req.body;
  if (!youtubeUrl || !channelKey) {
    return res.status(400).json({ error: 'Campos obrigatórios: youtubeUrl, channelKey' });
  }
  try {
    const { getChannel } = require('./channels');
    const { downloadFromYouTube } = require('./clips/downloader');
    const { uploadFileToDrive } = require('./drive');
    const { registrarVideosEmLote } = require('./sheets');
    const fs   = require('fs');
    const path = require('path');

    const channel  = getChannel(channelKey);
    const TEMP_DIR = process.env.TEMP_DIR || '/tmp/canais-dark';

    // 1. Download via yt-dlp
    const { localPath, title } = await downloadFromYouTube(youtubeUrl, TEMP_DIR);
    const nomeArquivo = path.basename(localPath);

    // 2. Aplica transformações visuais do canal (se configuradas)
    if (channel.transformacoes) {
      const { aplicarTransformacoes } = require('./transformer');
      await aplicarTransformacoes(localPath, channel.transformacoes);
    }

    // 3. Upload para pasta "aguardando" do canal no Drive
    const { webViewLink } = await uploadFileToDrive(localPath, nomeArquivo, channel.driveAguardando);

    // 4. Registrar na planilha como Pendente
    await registrarVideosEmLote([{
      canal: channel.name,
      nicho: channel.nicho,
      nomeArquivo,
      linkDriveAguardando: webViewLink,
    }]);

    // 5. Limpar arquivo temporário
    fs.unlink(localPath, () => {});

    res.json({ success: true, title, nomeArquivo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/referencia/executar
 * Dispara o ciclo de referências imediatamente (sem aguardar o cron de 4h)
 */
app.post('/api/referencia/executar', async (req, res) => {
  res.json({ success: true, mensagem: 'Ciclo de referências iniciado em background.' });
  const { cicloReferencia } = require('./referencia');
  cicloReferencia().catch(err => console.error('❌ Erro ciclo referências:', err.message));
});

/**
 * GET /api/referencia
 * Lista todos os canais de referência configurados
 */
app.get('/api/referencia', async (req, res) => {
  try {
    const { getCanaisReferencia } = require('./sheets');
    const referencias = await getCanaisReferencia();
    res.json({ success: true, referencias });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/referencia
 * Body: { channelKey, urlReferencia }
 * Adiciona um canal de referência associado a um canal de corte
 */
app.post('/api/referencia', async (req, res) => {
  const { channelKey, urlReferencia } = req.body;
  if (!channelKey || !urlReferencia) {
    return res.status(400).json({ error: 'Campos obrigatórios: channelKey, urlReferencia' });
  }
  try {
    const { getChannel } = require('./channels');
    const { adicionarCanalReferencia } = require('./sheets');
    const channel = getChannel(channelKey);
    await adicionarCanalReferencia(channelKey, channel.name, urlReferencia);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/referencia/:rowIndex
 * Remove um canal de referência pelo rowIndex da planilha
 */
app.delete('/api/referencia/:rowIndex', async (req, res) => {
  try {
    const { removerCanalReferencia } = require('./sheets');
    await removerCanalReferencia(parseInt(req.params.rowIndex, 10));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`[Server] Canais Dark rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };
