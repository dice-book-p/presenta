// 프로덕션 서버: SvelteKit + WebSocket 통합
import { createServer } from 'http';
import { handler } from '../build/handler.js';
import { createWebSocketServer } from './websocket.js';
import { handleApi } from './api.js';
import { initProjectsStore } from './projects-store.js';
import { initSignaturesStore } from './signatures-store.js';

const PORT     = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

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
