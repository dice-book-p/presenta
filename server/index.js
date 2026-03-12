// 프로덕션 서버: SvelteKit + WebSocket 통합
import { createServer } from 'http';
import { handler } from '../build/handler.js';
import { createWebSocketServer } from './websocket.js';
import { signatories } from './signatories.js';
import { forceDisconnect, forceDisconnectAll, getConnectionStatus } from './connections.js';
import { saveSignature, getSignatures, clearSignatures } from './signatures-store.js';

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Admin API
  if (url.pathname === '/api/signatories' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(signatories));
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getConnectionStatus()));
    return;
  }

  if (url.pathname === '/api/signatures' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSignatures()));
    return;
  }

  if (url.pathname === '/api/signatures' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { signId, dataUrl } = JSON.parse(body || '{}');
      if (signId && dataUrl) saveSignature(signId, dataUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (url.pathname === '/api/signatures' && req.method === 'DELETE') {
    const pin = url.searchParams.get('pin');
    if (pin !== ADMIN_PIN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    clearSignatures();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/admin/disconnect' && req.method === 'POST') {
    const pin = url.searchParams.get('pin');
    if (pin !== ADMIN_PIN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      const { target } = JSON.parse(body || '{}');
      if (target === 'all') forceDisconnectAll();
      else forceDisconnect(target);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // SvelteKit handler
  handler(req, res);
});

createWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`[KDN Show] Server running on port ${PORT}`);
});
