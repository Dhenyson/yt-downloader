import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { existsSync, mkdirSync, rmSync, readdirSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import archiver from 'archiver';

// Importa módulos de segurança e validação
import {
  validateYouTubeUrl,
  sanitizeFilename,
  validateDownloadMode,
  validateBatchItems,
  encodeRFC5987ValueChars
} from './validation.js';

import {
  generalLimiter,
  parseApiLimiter,
  downloadLimiter,
  batchDownloadLimiter,
  setupHelmet,
  setupCors,
  errorHandler,
  asyncHandler,
  requestLogger
} from './middleware.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));

const app = express();

// Configurações de segurança
setupHelmet(app);
app.use(setupCors(process.env.ALLOWED_ORIGINS || '*'));

// Logging de requisições (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
  app.use(requestLogger);
}

// Parsers de body
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting geral
app.use(generalLimiter);

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY || '';

if (!YT_API_KEY) {
  console.warn('⚠️  Aviso: YT_API_KEY não definido. As buscas na API do YouTube não funcionarão.');
}

// Servir arquivos estáticos
app.use(express.static(join(__dirname, '../public')));

const jobs = new Map();

function setJobStatus(jobId, status) {
  if (!jobId) return;
  jobs.set(jobId, { status, updatedAt: Date.now() });
  for (const [id, meta] of jobs) {
    if (Date.now() - meta.updatedAt > 10 * 60 * 1000) jobs.delete(id);
  }
}

// Endpoint para verificar status de jobs
app.get('/api/job-status', (req, res) => {
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId ausente' });
  const meta = jobs.get(jobId);
  if (!meta) return res.json({ status: 'unknown' });
  return res.json({ status: meta.status });
});

/**
 * Define headers de download para o arquivo
 * @param {Response} res - Objeto de resposta Express
 * @param {string} filename - Nome do arquivo
 */
function setDownloadFilenameHeaders(res, filename) {
  const safe = sanitizeFilename(filename);
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`);
}

/**
 * Busca informações de vídeos ou playlists do YouTube usando a API
 * @param {string} inputUrl - URL do YouTube
 * @returns {Promise<{kind: string, items: Array}>}
 */
async function fetchItemsFromYouTube(inputUrl) {
  // Valida a URL
  const validation = validateYouTubeUrl(inputUrl);
  if (!validation.valid) {
    throw new Error(validation.error || 'URL inválida');
  }

  if (!YT_API_KEY) {
    throw new Error('API key do YouTube não configurada');
  }

  const { type, id } = validation;

  if (type === 'video' && id) {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        id: id,
        key: YT_API_KEY,
        part: 'snippet,contentDetails'
      },
      timeout: 10000 // 10 segundos de timeout
    });

    if (!data.items || data.items.length === 0) {
      throw new Error('Vídeo não encontrado ou privado');
    }

    const items = data.items.map(it => ({
      id: it.id,
      title: it.snippet?.title || 'Sem título',
      thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url,
      url: `https://www.youtube.com/watch?v=${it.id}`
    }));
    return { kind: 'video', items };
  }

  if (type === 'playlist' && id) {
    let pageToken = undefined;
    const items = [];
    let requestCount = 0;
    const maxRequests = 20; // Limita a 1000 vídeos (20 * 50)

    do {
      if (requestCount >= maxRequests) {
        console.warn('Playlist muito grande, limitando a 1000 vídeos');
        break;
      }

      const { data } = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
          playlistId: id,
          key: YT_API_KEY,
          part: 'snippet,contentDetails',
          maxResults: 50,
          pageToken
        },
        timeout: 10000 // 10 segundos de timeout
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
      requestCount++;
    } while (pageToken);

    if (items.length === 0) {
      throw new Error('Playlist vazia ou não encontrada');
    }

    return { kind: 'playlist', items };
  }

  throw new Error('Tipo de URL não suportado');
}

// Endpoint para analisar URL do YouTube
app.post('/api/parse', parseApiLimiter, asyncHandler(async (req, res) => {
  const { url } = req.body || {};

  // Validação de input
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return res.status(400).json({ error: 'URL ausente ou inválida' });
  }

  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL muito longa' });
  }

  const result = await fetchItemsFromYouTube(url.trim());
  res.json(result);
}));

/**
 * Executa o yt-dlp para baixar vídeo ou áudio
 * @param {string} youtubeUrl - URL do vídeo do YouTube
 * @param {'video'|'audio'} mode - Modo de download
 * @param {string} outDir - Diretório de saída
 * @param {Object} opts - Opções adicionais
 * @param {Function} opts.onSpawn - Callback quando o processo é iniciado
 * @returns {Promise<{code: number, stdout: string, stderr: string, pattern: string}>}
 */
function runYtdlp(youtubeUrl, mode, outDir, opts = {}) {
  return new Promise((resolve, reject) => {
    // Valida inputs antes de executar
    const modeValidation = validateDownloadMode(mode);
    if (!modeValidation.valid) {
      return reject(new Error(modeValidation.error));
    }

    const validation = validateYouTubeUrl(youtubeUrl);
    if (!validation.valid) {
      return reject(new Error(validation.error || 'URL inválida'));
    }

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

    // Adiciona opções de segurança ao yt-dlp
    args.push('--no-playlist'); // Previne download acidental de playlists completas
    args.push('-o', output, youtubeUrl);

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    if (typeof opts.onSpawn === 'function') {
      try {
        opts.onSpawn(child);
      } catch (err) {
        console.error('Erro no callback onSpawn:', err);
      }
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
        reject(new Error(`yt-dlp falhou (código ${code}): ${stderr || stdout}`));
      }
    });
  });
}

/**
 * Mata um processo e seus filhos
 * @param {ChildProcess} child - Processo a ser terminado
 */
function killProcessTree(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch (err) {
    console.error('Erro ao enviar SIGTERM:', err);
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch (err) {
      console.error('Erro ao enviar SIGKILL:', err);
    }
  }, 2000);
}

/**
 * Procura o arquivo baixado no diretório
 * @param {string} dir - Diretório onde procurar
 * @param {string} patternPrefix - Padrão de nome do arquivo
 * @returns {string|null} Caminho do arquivo ou null se não encontrado
 */
function findDownloadedFile(dir, patternPrefix) {
  const base = basename(patternPrefix).split('.%(title)')[0];
  for (const f of readdirSync(dir)) {
    if (f.startsWith(base)) {
      return join(dir, f);
    }
  }
  return null;
}

/**
 * Extrai o título original do nome do arquivo salvo
 * @param {string} filePath - Caminho do arquivo
 * @param {string} patternPrefix - Padrão usado no download
 * @returns {string} Título extraído
 */
function extractOriginalTitleFromSavedName(filePath, patternPrefix) {
  const base = basename(patternPrefix).split('.%(title)')[0];
  const bn = basename(filePath);
  if (bn.startsWith(base + '.')) {
    return bn.slice(base.length + 1).replace(/\.[^.]+$/, '');
  }
  return bn.replace(/\.[^.]+$/, '');
}

// Endpoint para download individual
app.post('/api/download-one', downloadLimiter, asyncHandler(async (req, res) => {
  const { url, mode, title } = req.body || {};

  // Validação de URL
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL ausente ou inválida' });
  }

  const urlValidation = validateYouTubeUrl(url);
  if (!urlValidation.valid) {
    return res.status(400).json({ error: urlValidation.error || 'URL inválida' });
  }

  // Validação de modo
  const modeValidation = validateDownloadMode(mode);
  if (!modeValidation.valid) {
    return res.status(400).json({ error: modeValidation.error || 'Modo inválido' });
  }

  // Validação de título (opcional)
  if (title && typeof title !== 'string') {
    return res.status(400).json({ error: 'Título deve ser uma string' });
  }

  const sessionDir = join(tmpdir(), `yt-${nanoid(6)}`);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  try {
    const { pattern } = await runYtdlp(url, mode, sessionDir);
    const filePath = findDownloadedFile(sessionDir, pattern);

    if (!filePath || !existsSync(filePath)) {
      throw new Error('Arquivo não encontrado após download');
    }

    const ext = extname(filePath) || '';
    const origTitle = title || extractOriginalTitleFromSavedName(filePath, pattern);
    const outName = `${sanitizeFilename(origTitle)}${ext}`;

    res.setHeader('Content-Type', 'application/octet-stream');
    setDownloadFilenameHeaders(res, outName);

    const readStream = createReadStream(filePath);

    readStream.on('error', (err) => {
      console.error('Erro ao ler arquivo:', err);
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error('Erro ao limpar diretório:', cleanupErr);
      }
    });

    readStream.on('close', () => {
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Erro ao limpar diretório após envio:', err);
      }
    });

    readStream.pipe(res);

  } catch (err) {
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error('Erro ao limpar diretório:', cleanupErr);
    }
    throw err; // asyncHandler vai pegar
  }
}));

// Endpoint para download em lote
app.post('/api/download-all', batchDownloadLimiter, asyncHandler(async (req, res) => {
  let items = null;
  let mode = null;
  let jobId = null;

  // Parse do body (pode vir como JSON ou form-encoded)
  if (req.is('application/json')) {
    ({ items, mode, jobId } = req.body || {});
  } else if (req.body && req.body.payload) {
    try {
      const p = JSON.parse(req.body.payload);
      items = p.items;
      mode = p.mode;
      jobId = p.jobId;
    } catch (e) {
      return res.status(400).json({ error: 'Payload JSON inválido' });
    }
  } else {
    ({ items, mode, jobId } = req.body || {});
  }

  // Validação de items
  const itemsValidation = validateBatchItems(items);
  if (!itemsValidation.valid) {
    return res.status(400).json({ error: itemsValidation.error });
  }

  // Validação de modo
  const modeValidation = validateDownloadMode(mode);
  if (!modeValidation.valid) {
    return res.status(400).json({ error: modeValidation.error });
  }

  const sessionDir = join(tmpdir(), `yt-${nanoid(6)}`);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  setJobStatus(jobId, 'running');
  res.setHeader('Content-Type', 'application/zip');
  setDownloadFilenameHeaders(res, 'downloads.zip');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error('Erro no archiver:', err);
    throw err;
  });

  archive.pipe(res);

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let cancelled = false;
  const activeChildren = new Set();

  const onClose = () => {
    cancelled = true;
    for (const ch of activeChildren) {
      killProcessTree(ch);
    }
    try {
      archive.abort();
    } catch (err) {
      console.error('Erro ao abortar archive:', err);
    }
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Erro ao limpar diretório:', err);
    }
    setJobStatus(jobId, 'cancelled');
  };

  res.on('close', onClose);
  res.on('finish', () => {
    if (!cancelled) {
      try {
        rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Erro ao limpar diretório após finish:', err);
      }
      setJobStatus(jobId, 'done');
    }
  });

  const used = new Set();

  for (const it of items) {
    if (cancelled) break;

    try {
      const downloadUrl = it.url || `https://www.youtube.com/watch?v=${it.id}`;

      const { pattern } = await runYtdlp(downloadUrl, mode, sessionDir, {
        onSpawn(child) {
          activeChildren.add(child);
          child.on('close', () => activeChildren.delete(child));
        }
      });

      const filePath = findDownloadedFile(sessionDir, pattern);

      if (filePath && existsSync(filePath)) {
        const ext = extname(filePath) || '';
        const title = it.title || extractOriginalTitleFromSavedName(filePath, pattern);
        let name = `${sanitizeFilename(title)}${ext}`;

        // Previne nomes duplicados
        let finalName = name;
        let counter = 1;
        while (used.has(finalName)) {
          const base = name.replace(/\.[^.]+$/, '');
          const extension = extname(name);
          finalName = `${base} (${counter})${extension}`;
          counter++;
        }
        used.add(finalName);

        const rs = createReadStream(filePath);
        rs.on('close', () => {
          try {
            rmSync(filePath, { force: true });
          } catch (err) {
            console.error('Erro ao remover arquivo:', err);
          }
        });

        archive.append(rs, { name: finalName });
      }
    } catch (e) {
      console.error(`Erro ao processar item ${it.id}:`, e);
      const msg = `Falha ao baixar "${it.title || it.id}": ${e.message || e}`;
      archive.append(msg, { name: `erro-${it.id}-${Date.now()}.txt` });
    }
  }

  if (!cancelled) {
    await archive.finalize();
  }
}));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ytApi: !!YT_API_KEY,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Middleware de tratamento de erros (deve ser o último)
app.use(errorHandler);

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://0.0.0.0:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 YouTube API: ${YT_API_KEY ? 'Configurada' : '⚠️  Não configurada'}`);
});
