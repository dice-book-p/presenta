// 프로덕션 서버: SvelteKit + WebSocket 통합
import { createServer } from 'http';
import { handler } from '../build/handler.js';
import { createWebSocketServer } from './ws/server.js';
import { handleApi } from './api/index.js';
import { initProjectsStore } from './store/projects.js';
import { initSignaturesStore } from './store/signatures.js';
import { PORT, ADMIN_PIN } from './config.js';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(url, req, res, ADMIN_PIN);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
    return;
  }

  handler(req, res);
});

createWebSocketServer(server);

Promise.all([initProjectsStore(), initSignaturesStore()]).then(() => {
  server.listen(PORT, () => {
    console.log(`[KDN Show] Server running on port ${PORT}`);
  });
}).catch(e => {
  console.error('[KDN Show] Init failed:', e.message);
  process.exit(1);
});
