require('dotenv').config();
const { execFile } = require('child_process');
const { google } = require('googleapis');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { extrairFileId } = require('../drive');

const execFileAsync = promisify(execFile);
const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credenciais', 'google_credentials.json');

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
 * Baixa vídeo do YouTube via yt-dlp
 * @returns {{ localPath, title, duration, description }}
 */
async function downloadFromYouTube(youtubeUrl, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  const { stdout: metaJson } = await execFileAsync('yt-dlp', [
    '--dump-json', '--no-playlist', youtubeUrl,
  ]);
  const meta = JSON.parse(metaJson);

  const safeTitle = (meta.title || 'video')
    .replace(/[^\w\s-]/g, '').trim().substring(0, 60).trim();
  const outPath = path.join(destDir, `${safeTitle}.mp4`);

  await execFileAsync('yt-dlp', [
    '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', outPath,
    '--no-playlist',
    youtubeUrl,
  ]);

  if (!fs.existsSync(outPath)) {
    throw new Error(`yt-dlp não gerou o arquivo esperado: ${outPath}`);
  }

  return {
    localPath: outPath,
    title:       meta.title || safeTitle,
    duration:    meta.duration || 0,
    description: (meta.description || '').slice(0, 2000),
  };
}

/**
 * Baixa vídeo do Google Drive
 * @returns {{ localPath, title }}
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
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_format', videoPath,
  ]);
  const data = JSON.parse(stdout);
  return parseFloat(data.format?.duration || 0);
}

/**
 * Entry point unificado
 * @param {string} link - YouTube URL ou Drive link
 * @param {string} tipoFonte - 'youtube' | 'drive'
 */
async function downloadVideo(link, tipoFonte, destDir) {
  if (tipoFonte === 'youtube') return downloadFromYouTube(link, destDir);
  return downloadFromDrive(link, destDir);
}

module.exports = { downloadVideo, getVideoDuration };
