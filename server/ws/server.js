/**
 * WebSocket 서버 (인프라 레이어)
 *
 * - 클라이언트 식별(identify_display / identify_tablet)
 * - 그리기 이벤트, 서명 완료/초기화 중계
 * - 주기적 Heartbeat (ping/pong)
 */
import { WebSocketServer } from 'ws';
import { getActiveProject } from '../store/projects.js';
import { WS_HEARTBEAT_MS, REMOTE_TOKEN } from '../config.js';
import {
  registerDisplay, registerTablet,
  unregisterDisplay, unregisterTablet,
  handleSlideChange, sendToDisplay,
  broadcastConnectionStatus, getConnectionStatus, getPool,
  registerRemote, unregisterRemote, sendToRemotes, getCurrentSlideOrder,
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
          // project 전체를 넘겨 connections.js에서 slideOrder를 직접 계산
          handleSlideChange(msg.slideIndex, project);
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

        case 'identify_remote': {
          if (msg.token !== REMOTE_TOKEN) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'invalid_token' }));
            return;
          }
          const project = getActiveProject();
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'no_active_project' }));
            return;
          }
          registerRemote(ws);
          ws.role = 'remote';
          ws.send(JSON.stringify({
            type: 'identified',
            role: 'remote',
            project,
            currentSlideOrder: getCurrentSlideOrder(),
          }));
          break;
        }

        case 'remote_slide': {
          if (ws.role !== 'remote') return;
          // forward to display: { type: 'remote_slide', direction: 'prev'|'next' }
          sendToDisplay({ type: 'remote_slide', direction: msg.direction });
          break;
        }
      }
    });

    ws.on('close', () => {
      const { display, tablets } = getPool();
      if (ws.role === 'display' && display === ws) {
        unregisterDisplay();
      } else if (ws.role === 'tablet' && ws.signId && tablets[ws.signId] === ws) {
        unregisterTablet(ws.signId);
      } else if (ws.role === 'remote') {
        unregisterRemote(ws);
      }
    });

    ws.on('error', () => ws.terminate());
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, WS_HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
