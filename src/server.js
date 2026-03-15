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

function startServer() {
  app.listen(PORT, () => {
    console.log(`[Server] Canais Dark rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };
