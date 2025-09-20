import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import archiver from 'archiver';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY || '';

if (!YT_API_KEY) {
  console.warn('Aviso: YT_API_KEY não definido. As buscas na API do YouTube não funcionarão.');
}

app.use(express.static(join(__dirname, '../public')));

const jobs = new Map();

function setJobStatus(jobId, status) {
  if (!jobId) return;
  jobs.set(jobId, { status, updatedAt: Date.now() });
  for (const [id, meta] of jobs) {
    if (Date.now() - meta.updatedAt > 10 * 60 * 1000) jobs.delete(id);
  }
}

app.get('/api/job-status', (req, res) => {
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId ausente' });
  const meta = jobs.get(jobId);
  if (!meta) return res.json({ status: 'unknown' });
  return res.json({ status: meta.status });
});

function sanitizeFilename(name) {
  if (!name) return 'download';
  let s = name.replace(/[\/:*?"<>|\n\r\t]/g, '_');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 140) s = s.slice(0, 140);
  return s || 'download';
}

function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (match, p1) => `%${p1.toUpperCase()}`);
}

function setDownloadFilenameHeaders(res, filename) {
  const safe = sanitizeFilename(filename);
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`);
}

function parseYouTubeUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const list = u.searchParams.get('list');
      const v = u.searchParams.get('v');
      if (list) return { type: 'playlist', id: list };
      if (v) return { type: 'video', id: v };
      const pathId = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : null;
      if (pathId) return { type: 'video', id: pathId };
    }
  } catch (e) {
    // ignore
  }
  return { type: 'unknown', id: null };
}

async function fetchItemsFromYouTube(inputUrl) {
  const parsed = parseYouTubeUrl(inputUrl);
  if (!YT_API_KEY) throw new Error('API key ausente');
  if (parsed.type === 'video' && parsed.id) {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        id: parsed.id,
        key: YT_API_KEY,
        part: 'snippet,contentDetails'
      }
    });
    const items = (data.items || []).map(it => ({
      id: it.id,
      title: it.snippet?.title || 'Sem título',
      thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url,
      url: `https://www.youtube.com/watch?v=${it.id}`
    }));
    return { kind: 'video', items };
  }
  if (parsed.type === 'playlist' && parsed.id) {
    let pageToken = undefined;
    const items = [];
    do {
      const { data } = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
          playlistId: parsed.id,
          key: YT_API_KEY,
          part: 'snippet,contentDetails',
          maxResults: 50,
          pageToken
        }
      });
      for (const it of data.items || []) {
        const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
        if (!vid) continue;
        items.push({
          id: vid,
          title: it.snippet?.title || 'Sem título',
          thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url,
          url: `https://www.youtube.com/watch?v=${vid}`
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return { kind: 'playlist', items };
  }
  throw new Error('URL inválida ou não reconhecida');
}

app.post('/api/parse', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Falta url' });
    const result = await fetchItemsFromYouTube(url);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao buscar itens' });
  }
});

function runYtdlp(youtubeUrl, mode, outDir, opts = {}) {
  return new Promise((resolve, reject) => {
    const id = nanoid(8);
    const output = join(outDir, `${id}.%(title)s.%(ext)s`);
    const args = [];
    if (mode === 'audio') {
      args.push('-x', '--audio-format', 'm4a');
    } else {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4]+bestaudio/best');
      args.push('--merge-output-format', 'mp4');
      args.push('--remux-video', 'mp4');
      args.push('--audio-format', 'm4a');
      args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a aac -b:a 192k');
    }
    args.push('-o', output, youtubeUrl);

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (typeof opts.onSpawn === 'function') {
      try { opts.onSpawn(child); } catch {}
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr, pattern: output });
      } else {
        reject(new Error(`yt-dlp falhou (${code}): ${stderr || stdout}`));
      }
    });
  });
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
}

import { readdirSync } from 'node:fs';
function findDownloadedFile(dir, patternPrefix) {
  const base = basename(patternPrefix).split('.%(title)')[0];
  for (const f of readdirSync(dir)) {
    if (f.startsWith(base)) {
      return join(dir, f);
    }
  }
  return null;
}

function extractOriginalTitleFromSavedName(filePath, patternPrefix) {
  const base = basename(patternPrefix).split('.%(title)')[0];
  const bn = basename(filePath);
  if (bn.startsWith(base + '.')) {
    return bn.slice(base.length + 1).replace(/\.[^.]+$/, '');
  }
  return bn.replace(/\.[^.]+$/, '');
}

app.post('/api/download-one', async (req, res) => {
  const { url, mode, title } = req.body || {};
  if (!url || !mode || !['video', 'audio'].includes(mode)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const sessionDir = join(tmpdir(), `yt-${nanoid(6)}`);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  try {
    const { pattern } = await runYtdlp(url, mode, sessionDir);
    const filePath = findDownloadedFile(sessionDir, pattern);
    if (!filePath || !existsSync(filePath)) throw new Error('Arquivo não encontrado após download');

    const pathMod = await import('node:path');
    const ext = pathMod.extname(filePath) || '';
    const origTitle = title || extractOriginalTitleFromSavedName(filePath, pattern);
    const outName = `${sanitizeFilename(origTitle)}${ext}`;
    res.setHeader('Content-Type', 'application/octet-stream');
    setDownloadFilenameHeaders(res, outName);

    const fs = await import('node:fs');
    const read = fs.createReadStream(filePath);
    read.on('close', () => {
      try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    });
    read.pipe(res);
  } catch (err) {
    try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    console.error(err);
    res.status(500).json({ error: err.message || 'Falha no download' });
  }
});

app.post('/api/download-all', async (req, res) => {
  let items = null;
  let mode = null;
  let jobId = null;
  if (req.is('application/json')) {
    ({ items, mode, jobId } = req.body || {});
  } else if (req.body && req.body.payload) {
    try {
      const p = JSON.parse(req.body.payload);
      items = p.items; mode = p.mode; jobId = p.jobId;
    } catch (e) {
      return res.status(400).json({ error: 'Payload inválido' });
    }
  } else {
    ({ items, mode, jobId } = req.body || {});
  }
  if (!Array.isArray(items) || items.length === 0 || !['video', 'audio'].includes(mode)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const sessionDir = join(tmpdir(), `yt-${nanoid(6)}`);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  try {
    setJobStatus(jobId, 'running');
    res.setHeader('Content-Type', 'application/zip');
    setDownloadFilenameHeaders(res, 'downloads.zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let cancelled = false;
    const activeChildren = new Set();
    const onClose = () => {
      cancelled = true;
      for (const ch of activeChildren) killProcessTree(ch);
      try { archive.abort(); } catch {}
      try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
      setJobStatus(jobId, 'cancelled');
    };
    res.on('close', onClose);
    res.on('finish', () => {
      if (!cancelled) {
        try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        setJobStatus(jobId, 'done');
      }
    });

    const used = new Map();

    for (const it of items) {
      if (cancelled) break;
      try {
        const { pattern } = await runYtdlp(it.url || `https://www.youtube.com/watch?v=${it.id}`, mode, sessionDir, {
          onSpawn(child){ activeChildren.add(child); child.on('close', () => activeChildren.delete(child)); }
        });
        const filePath = findDownloadedFile(sessionDir, pattern);
        if (filePath && existsSync(filePath)) {
          const ext = (await import('node:path')).extname(filePath) || '';
          const title = it.title || extractOriginalTitleFromSavedName(filePath, pattern);
          let name = `${sanitizeFilename(title)}${ext}`;
          if (used.has(name)) {
            const count = used.get(name) + 1;
            used.set(name, count);
            const p = await import('node:path');
            const b = name.replace(/\.[^.]+$/, '');
            const e = p.extname(name);
            name = `${b} (${count})${e}`;
          } else {
            used.set(name, 0);
          }
          const fs = await import('node:fs');
          const rs = fs.createReadStream(filePath);
          rs.on('close', () => { try { rmSync(filePath, { force: true }); } catch {} });
          archive.append(rs, { name });
        }
      } catch (e) {
        const msg = `Falha ao baixar um item: ${e.message || e}`;
        archive.append(msg, { name: `erro-${Date.now()}.txt` });
      }
    }

    if (!cancelled) {
      archive.finalize();
    }
  } catch (err) {
    try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    console.error(err);
    setJobStatus(jobId, 'error');
    res.status(500).json({ error: err.message || 'Falha no download em lote' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ytApi: !!YT_API_KEY });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});
