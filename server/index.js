// 프로덕션 서버: SvelteKit + WebSocket 통합
import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handler } from '../build/handler.js';
import { createWebSocketServer } from './ws/server.js';
import { handleApi } from './api/index.js';
import { initProjectsStore } from './store/projects.js';
import { initSignaturesStore } from './store/signatures.js';
import { PORT, ADMIN_PIN } from './config.js';

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = join(ROOT, 'uploads');

const MIME = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',   '.gif': 'image/gif',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API 라우팅
  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(url, req, res, ADMIN_PIN);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
    return;
  }

  // 로컬 스토리지 이미지 서빙: /uploads/{projectId}/{filename}
  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    const filepath = join(UPLOADS, url.pathname.replace('/uploads/', ''));
    try {
      await stat(filepath);
      const mime = MIME[extname(filepath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000' });
      createReadStream(filepath).pipe(res);
    } catch {
      res.writeHead(404); res.end();
    }
    return;
  }

  // SvelteKit 핸들러에 캐시 제어 헤더 추가
  // _app/immutable/ 에셋은 SvelteKit이 해시된 파일명으로 관리 → 장기 캐시 OK
  // HTML 페이지는 항상 최신 버전 체크하도록 no-cache 설정
  if (!url.pathname.startsWith('/_app/immutable/')) {
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = (statusCode, ...args) => {
      // writeHead(status, headers) 또는 writeHead(status, statusMessage, headers)
      const headers = typeof args[args.length - 1] === 'object' ? args[args.length - 1] : {};
      const contentType = headers['Content-Type'] || headers['content-type'] || '';
      // HTML 응답이거나, 명시적 Content-Type이 없는 페이지 요청에 no-cache 적용
      if (!contentType || contentType.includes('text/html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      return origWriteHead(statusCode, ...args);
    };
  }

  handler(req, res);
});

createWebSocketServer(server);

Promise.all([initProjectsStore(), initSignaturesStore()]).then(() => {
  server.listen(PORT, () => {
    console.log(`[Presenta] Server running on port ${PORT}`);
  });
}).catch(e => {
  console.error('[Presenta] Init failed:', e.message);
  process.exit(1);
});
