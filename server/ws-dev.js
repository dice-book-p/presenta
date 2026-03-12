// 개발 환경 전용 서버 (Vite proxy → port 8765)
import { createServer } from 'http';
import { createWebSocketServer } from './ws/server.js';
import { handleApi } from './api/index.js';
import { initProjectsStore } from './store/projects.js';
import { initSignaturesStore } from './store/signatures.js';
import { ADMIN_PIN } from './config.js';

const PORT = 8765;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS (Vite dev server와 포트가 분리되어 있으므로)
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
