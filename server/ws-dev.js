// 개발 환경 전용 WebSocket 서버 (포트 3500)
import { createServer } from 'http';
import { createWebSocketServer } from './websocket.js';
import { signatories } from './signatories.js';
import { forceDisconnect, forceDisconnectAll, getConnectionStatus } from './connections.js';

const PORT = 3500;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS (dev: SvelteKit vite dev server와 분리되므로)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/api/signatories' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify(signatories));
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify(getConnectionStatus()));
    return;
  }

  if (url.pathname === '/api/admin/disconnect' && req.method === 'POST') {
    const pin = url.searchParams.get('pin');
    if (pin !== ADMIN_PIN) { res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { target } = JSON.parse(body || '{}');
      if (target === 'all') forceDisconnectAll();
      else forceDisconnect(target);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

createWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`[WS Dev Server] WebSocket + API running on port ${PORT}`);
});
