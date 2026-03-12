import { WebSocketServer } from 'ws';
import { signatories } from './signatories.js';
import {
  registerDisplay, registerTablet,
  unregisterDisplay, unregisterTablet,
  findTabletSignId, handleSlideChange,
  sendToDisplay, broadcastConnectionStatus,
  getConnectionStatus
} from './connections.js';

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.role = null;
    ws.signId = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {

        case 'identify_display': {
          const result = registerDisplay(ws);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'display_occupied' }));
            return;
          }
          ws.role = 'display';
          ws.send(JSON.stringify({
            type: 'identified',
            role: 'display',
            signatories,
            connectionStatus: getConnectionStatus()
          }));
          break;
        }

        case 'identify_tablet': {
          const { signId } = msg;
          if (!signId) return;
          const result = registerTablet(ws, signId);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'tablet_occupied', signId }));
            return;
          }
          ws.role = 'tablet';
          ws.signId = signId;
          ws.send(JSON.stringify({
            type: 'identified',
            role: 'tablet',
            signId,
            signatories
          }));
          broadcastConnectionStatus();
          break;
        }

        case 'slide_change': {
          if (ws.role !== 'display') return;
          handleSlideChange(msg.slideIndex, signatories);
          break;
        }

        case 'draw': {
          if (ws.role !== 'tablet') return;
          sendToDisplay({
            type: 'draw',
            signId: ws.signId,
            x: msg.x,
            y: msg.y,
            action: msg.action
          });
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
      if (ws.role === 'display') {
        unregisterDisplay();
      } else if (ws.role === 'tablet' && ws.signId) {
        unregisterTablet(ws.signId);
      }
    });

    ws.on('error', () => {
      ws.terminate();
    });
  });

  // 연결 상태 주기적 체크 (heartbeat)
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
