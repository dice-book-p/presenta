// 개발 환경 전용 서버 (Vite proxy → port 8765)
import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createWebSocketServer } from './ws/server.js';
import { handleApi } from './api/index.js';
import { initProjectsStore } from './store/projects.js';
import { initSignaturesStore } from './store/signatures.js';
import { initMediaStore } from './store/media.js';
import { ADMIN_PIN } from './config.js';

const PORT    = 8765;
const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = join(ROOT, 'uploads');

const MEDIA  = join(ROOT, 'uploads', 'media');

const MIME = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',   '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS (Vite dev server와 포트가 분리되어 있으므로)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 미디어 파일 서빙: /media/{filename}
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const filepath = resolve(MEDIA, url.pathname.replace('/media/', ''));
    if (!filepath.startsWith(MEDIA)) { res.writeHead(403); res.end(); return; }
    try {
      await stat(filepath);
      const mime = MIME[extname(filepath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      createReadStream(filepath).pipe(res);
    } catch {
      res.writeHead(404); res.end();
    }
    return;
  }

  // 로컬 어댑터 이미지 서빙: /uploads/{projectId}/{filename}
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const filepath = resolve(UPLOADS, url.pathname.replace('/uploads/', ''));
    if (!filepath.startsWith(UPLOADS)) { res.writeHead(403); res.end(); return; }
    try {
      await stat(filepath);
      const mime = MIME[extname(filepath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      createReadStream(filepath).pipe(res);
    } catch {
      res.writeHead(404); res.end();
    }
    return;
  }

  const handled = await handleApi(url, req, res, ADMIN_PIN);
  if (!handled) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

createWebSocketServer(server);

Promise.all([initProjectsStore(), initSignaturesStore(), initMediaStore()]).then(() => {
  server.listen(PORT, () => {
    console.log(`[WS Dev] Running on port ${PORT}`);
  });
}).catch(e => {
  console.error('[WS Dev] Init failed:', e.message);
  process.exit(1);
});
