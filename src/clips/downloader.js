require('dotenv').config();
const { execFile } = require('child_process');
const { google } = require('googleapis');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { extrairFileId } = require('../drive');

const execFileAsync = promisify(execFile);
const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');
const YTDLP  = process.env.YTDLP_PATH  || 'yt-dlp';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function getDriveClient() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const creds = raw.web || raw.installed;
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || creds.client_id,
    process.env.GOOGLE_CLIENT_SECRET || creds.client_secret,
    'http://localhost:8080/callback'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Baixa vídeo do YouTube via yt-dlp.
 * Usa o ID do vídeo como nome do arquivo para evitar problemas com caracteres especiais.
 */
async function downloadFromYouTube(youtubeUrl, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  // Busca metadados primeiro
  const { stdout: metaJson } = await execFileAsync(YTDLP, [
    '--dump-json', '--no-playlist', youtubeUrl,
  ]);
  const meta = JSON.parse(metaJson);

  // Usa o ID do vídeo como nome — evita problemas com caracteres especiais no título
  const videoId = meta.id || 'video';
  const outPath = path.join(destDir, `${videoId}.mp4`);

  // Extrai diretório do ffmpeg para que o yt-dlp consiga fazer o merge
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffmpegDir = ffmpegBin !== 'ffmpeg' ? path.dirname(ffmpegBin) : null;

  const ytdlpArgs = [
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '-o', outPath,
    '--no-playlist',
  ];
  if (ffmpegDir) ytdlpArgs.push('--ffmpeg-location', ffmpegDir);
  ytdlpArgs.push(youtubeUrl);

  await execFileAsync(YTDLP, ytdlpArgs, { maxBuffer: 50 * 1024 * 1024 });

  // Verifica o arquivo criado
  if (!fs.existsSync(outPath)) {
    // Prefere arquivo sem código de formato no nome (ex: video.mp4, não video.f399.mp4)
    const allMp4s = fs.readdirSync(destDir).filter(f => f.endsWith('.mp4'));
    const merged  = allMp4s.find(f => !/\.\w+\.mp4$/.test(f)); // sem .fXXX. no nome
    const chosen  = merged || allMp4s[0];
    if (!chosen) throw new Error(`yt-dlp não gerou nenhum arquivo MP4 em: ${destDir}`);
    return {
      localPath:   path.join(destDir, chosen),
      title:       meta.title || videoId,
      duration:    meta.duration || 0,
      description: (meta.description || '').slice(0, 2000),
    };
  }

  return {
    localPath:   outPath,
    title:       meta.title || videoId,
    duration:    meta.duration || 0,
    description: (meta.description || '').slice(0, 2000),
  };
}

/**
 * Baixa vídeo do Google Drive
 */
async function downloadFromDrive(driveLink, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  const fileId = extrairFileId(driveLink);
  if (!fileId) throw new Error(`Não foi possível extrair fileId do link: ${driveLink}`);

  const drive = getDriveClient();
  const fileMeta = await drive.files.get({
    fileId, fields: 'name', supportsAllDrives: true,
  });
  const fileName = fileMeta.data.name || `video_${fileId}.mp4`;
  const localPath = path.join(destDir, fileName);

  const dest = fs.createWriteStream(localPath);
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data.on('end', resolve).on('error', reject).pipe(dest);
  });

  return {
    localPath,
    title:       path.basename(fileName, path.extname(fileName)),
    duration:    0,
    description: '',
  };
}

/** Detecta duração do vídeo com ffprobe */
async function getVideoDuration(videoPath) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', videoPath,
  ]);
  const data = JSON.parse(stdout);
  return parseFloat(data.format?.duration || 0);
}

/**
 * Entry point unificado
 */
async function downloadVideo(link, tipoFonte, destDir) {
  if (tipoFonte === 'youtube') return downloadFromYouTube(link, destDir);
  return downloadFromDrive(link, destDir);
}

module.exports = { downloadVideo, getVideoDuration };
