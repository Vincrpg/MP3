const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP = '/tmp/ytmp3';

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Validate YouTube URL
function isValidYouTubeUrl(url) {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;
  return pattern.test(url);
}

// Extract video ID
function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

// GET /info — return title, thumbnail, duration
app.get('/info', (req, res) => {
  const { url } = req.query;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'URL do YouTube inválida.' });
  }

  const cmd = `yt-dlp --dump-json --no-playlist "${url}"`;

  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('yt-dlp info error:', stderr);
      return res.status(500).json({ error: 'Não foi possível obter informações do vídeo. Verifique a URL.' });
    }

    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        channel: info.uploader,
        videoId: info.id,
      });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao processar informações do vídeo.' });
    }
  });
});

// GET /download — stream MP3
app.get('/download', (req, res) => {
  const { url, quality } = req.query;

  if (!url || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  const audioQuality = quality === '320' ? '0' : quality === '192' ? '4' : '6'; // yt-dlp scale 0=best
  const videoId = extractVideoId(url) || Date.now();
  const outputPath = path.join(TMP, `${videoId}_${Date.now()}.mp3`);

  const args = [
    '--no-playlist',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', audioQuality,
    '--ffmpeg-location', '/usr/bin/ffmpeg',
    '-o', outputPath,
    url
  ];

  const dl = spawn('yt-dlp', args);

  let errorOutput = '';
  dl.stderr.on('data', (data) => { errorOutput += data.toString(); });

  dl.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp download error:', errorOutput);
      return res.status(500).json({ error: 'Falha ao converter o vídeo. Tente novamente.' });
    }

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'Arquivo não encontrado após conversão.' });
    }

    const stat = fs.statSync(outputPath);
    const filename = path.basename(outputPath);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="audio_${videoId}.mp3"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);

    stream.on('close', () => {
      setTimeout(() => {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }, 5000);
    });
  });
});

app.listen(PORT, () => {
  console.log(`✅ YTMP3 server running on port ${PORT}`);
});
