// 개발 환경 전용 서버 (Vite proxy → port 8765)
import { createServer } from 'http';
import { createWebSocketServer } from './websocket.js';
import { handleApi } from './api.js';
import { initProjectsStore } from './projects-store.js';
import { initSignaturesStore } from './signatures-store.js';

const PORT     = 8765;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS (Vite dev server와 분리된 포트이므로)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const handled = await handleApi(url, req, res, ADMIN_PIN);
  if (!handled) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

createWebSocketServer(server);

Promise.all([initProjectsStore(), initSignaturesStore()]).then(() => {
  server.listen(PORT, () => {
    console.log(`[WS Dev] Running on port ${PORT}`);
  });
}).catch(e => {
  console.error('[WS Dev] Init failed:', e.message);
  process.exit(1);
});
