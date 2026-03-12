import { WebSocketServer } from 'ws';
import { getActiveProject } from './projects-store.js';
import {
  registerDisplay, registerTablet,
  unregisterDisplay, unregisterTablet,
  handleSlideChange, sendToDisplay,
  broadcastConnectionStatus, getConnectionStatus, getConnections,
} from './connections.js';

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.role    = null;
    ws.signId  = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {

        case 'identify_display': {
          const project = getActiveProject();
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'no_active_project' }));
            return;
          }
          const result = registerDisplay(ws);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'rejected', reason: result.reason }));
            return;
          }
          ws.role = 'display';
          ws.send(JSON.stringify({
            type: 'identified',
            role: 'display',
            project,
            connectionStatus: getConnectionStatus(),
          }));
          break;
        }

        case 'identify_tablet': {
          const { signId } = msg;
          if (!signId) return;
          const project = getActiveProject();
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'no_active_project' }));
            return;
          }
          const signatory = project.signatories.find(s => s.id === signId);
          if (!signatory) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'invalid_signatory' }));
            return;
          }
          const result = registerTablet(ws, signId);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'rejected', reason: result.reason }));
            return;
          }
          ws.role   = 'tablet';
          ws.signId = signId;
          ws.send(JSON.stringify({
            type: 'identified',
            role: 'tablet',
            signId,
            project,
            activeSignId: getConnectionStatus().currentActiveSignId,
          }));
          break;
        }

        case 'slide_change': {
          if (ws.role !== 'display') return;
          const project = getActiveProject();
          if (!project) return;
          // attach _slideOrder to each signatory for handleSlideChange lookup
          const sigsWithOrder = project.signatories.map(s => {
            const slide = project.slides.find(sl => sl.id === s.slideId);
            return { ...s, _slideOrder: slide?.order ?? -1 };
          });
          handleSlideChange(msg.slideIndex, sigsWithOrder);
          break;
        }

        case 'draw': {
          if (ws.role !== 'tablet') return;
          sendToDisplay({ type: 'draw', signId: ws.signId, x: msg.x, y: msg.y, action: msg.action });
          break;
        }

        case 'sign_done': {
          if (ws.role !== 'tablet') return;
          sendToDisplay({ type: 'sign_done', signId: ws.signId });
          break;
        }

        case 'sign_clear': {
          if (ws.role !== 'tablet') return;
          sendToDisplay({ type: 'sign_clear', signId: ws.signId });
          break;
        }
      }
    });

    ws.on('close', () => {
      const conns = getConnections();
      if (ws.role === 'display' && conns.display === ws) {
        unregisterDisplay();
      } else if (ws.role === 'tablet' && ws.signId && conns.tablets[ws.signId] === ws) {
        unregisterTablet(ws.signId);
      }
    });

    ws.on('error', () => ws.terminate());
  });

  // Heartbeat
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  return wss;
}
