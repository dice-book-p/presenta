/**
 * WebSocket 서버 (인프라 레이어)
 *
 * - 클라이언트 식별 (identify_display / identify_tablet / identify_remote)
 * - 그리기 이벤트, 서명 완료/초기화 중계
 * - 주기적 Heartbeat (ping/pong)
 */
import { WebSocketServer } from 'ws';
import { getProject, isProjectActive, getActiveProjects } from '../store/projects.js';
import { getMediaItem } from '../store/media.js';
import { WS_HEARTBEAT_MS } from '../config.js';
import {
  registerMainDisplay,
  registerSubDisplay,
  registerTablet,
  registerRemote,
  unregisterConnection,
  handleSlideChange,
  sendToMain,
  broadcastConnectionStatus,
  getConnectionStatus,
  getCurrentSlideOrder,
  broadcastToDisplays,
  sendToRemotes,
} from './connections.js';

function resolveMediaUrls(project) {
  const urls = {};
  const se = project?.signEffect;
  if (!se || se.theme === 'none') return urls;
  if (se.bgmId) {
    const m = getMediaItem(se.bgmId);
    if (m) urls.bgmUrl = m.url;
  }
  if (se.completeSoundId) {
    const m = getMediaItem(se.completeSoundId);
    if (m) urls.completeSoundUrl = m.url;
  }
  if (se.mode === 'video' && project.signatories) {
    const videoMap = {};
    for (const s of project.signatories) {
      if (s.videoId) {
        const m = getMediaItem(s.videoId);
        if (m) videoMap[s.id] = m.url;
      }
    }
    if (Object.keys(videoMap).length) urls.signatoryVideos = videoMap;
  }
  return urls;
}

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Extract request-level device info
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
               ?? req.socket?.remoteAddress ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    ws._ip = ip;
    ws._userAgent = userAgent;

    ws.isAlive  = true;
    ws.role     = null;
    ws.projectId = null;
    ws.signId   = null;
    ws.connId   = null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {

        // ── 메인 디스플레이 식별 ──────────────────────────────────────────────
        case 'identify_display': {
          const { projectId, role = 'main', deviceInfo: clientDeviceInfo = {} } = msg;

          if (!projectId) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'missing_project_id' }));
            return;
          }

          const project = getProject(projectId);
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_found' }));
            return;
          }

          if (!isProjectActive(projectId)) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_active' }));
            return;
          }

          // display는 PIN 검증 불필요 (관리자 화면에서 링크로 접근)

          const deviceInfo = {
            ip: ws._ip,
            userAgent: ws._userAgent,
            screen: clientDeviceInfo.screen ?? null,
            ...clientDeviceInfo,
          };

          let result;
          if (role === 'sub') {
            result = registerSubDisplay(projectId, ws, deviceInfo);
            if (!result.success) {
              ws.send(JSON.stringify({ type: 'rejected', reason: result.reason }));
              return;
            }
            ws.role      = 'sub';
            ws.projectId = projectId;
            ws.connId    = result.connId;
          } else {
            result = registerMainDisplay(projectId, ws, deviceInfo);
            if (!result.success) {
              ws.send(JSON.stringify({ type: 'rejected', reason: result.reason }));
              return;
            }
            ws.role      = 'main';
            ws.projectId = projectId;
            ws.connId    = result.connId;
          }

          ws.send(JSON.stringify({
            type: 'identified',
            role: ws.role,
            connId: ws.connId,
            project,
            mediaUrls: resolveMediaUrls(project),
            connectionStatus: getConnectionStatus(projectId),
          }));
          break;
        }

        // ── 태블릿 식별 ───────────────────────────────────────────────────────
        case 'identify_tablet': {
          const { projectId, pin, signId, deviceInfo: clientDeviceInfo = {} } = msg;

          if (!projectId || !signId) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'missing_fields' }));
            return;
          }

          const project = getProject(projectId);
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_found' }));
            return;
          }

          if (!isProjectActive(projectId)) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_active' }));
            return;
          }

          // Pin 검증 제거 — 서명 QR은 관리자가 의도적으로 공유하므로 PIN 불필요

          const signatory = project.signatories.find(s => s.id === signId);
          if (!signatory) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'invalid_signatory' }));
            return;
          }

          const deviceInfo = {
            ip: ws._ip,
            userAgent: ws._userAgent,
            screen: clientDeviceInfo.screen ?? null,
            ...clientDeviceInfo,
          };

          const result = registerTablet(projectId, ws, signId, deviceInfo);
          if (!result.success) {
            ws.send(JSON.stringify({ type: 'rejected', reason: result.reason }));
            return;
          }

          ws.role      = 'tablet';
          ws.projectId = projectId;
          ws.signId    = signId;
          ws.connId    = result.connId;

          ws.send(JSON.stringify({
            type: 'identified',
            role: 'tablet',
            signId,
            project,
            activeSignId: getConnectionStatus(projectId).currentActiveSignId,
          }));
          break;
        }

        // ── 리모컨 식별 ───────────────────────────────────────────────────────
        case 'identify_remote': {
          const { projectId, token } = msg;

          if (!projectId) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'missing_project_id' }));
            return;
          }

          const project = getProject(projectId);
          if (!project) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_found' }));
            return;
          }

          if (!isProjectActive(projectId)) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'project_not_active' }));
            return;
          }

          if (!project.remoteToken || project.remoteToken !== token) {
            ws.send(JSON.stringify({ type: 'rejected', reason: 'invalid_token' }));
            return;
          }

          registerRemote(projectId, ws);
          ws.role      = 'remote';
          ws.projectId = projectId;

          ws.send(JSON.stringify({
            type: 'identified',
            role: 'remote',
            project,
            currentSlideOrder: getCurrentSlideOrder(projectId),
          }));
          break;
        }

        // ── 슬라이드 변경 (메인 디스플레이만) ───────────────────────────────
        case 'slide_change': {
          if (ws.role !== 'main') return;
          const project = getProject(ws.projectId);
          if (!project) return;
          handleSlideChange(ws.projectId, msg.slideIndex, project);
          break;
        }

        // ── 그리기 (태블릿만) ────────────────────────────────────────────────
        case 'draw': {
          if (ws.role !== 'tablet') return;
          sendToMain(ws.projectId, { type: 'draw', signId: ws.signId, x: msg.x, y: msg.y, action: msg.action });
          break;
        }

        // ── 그리기 배치 (태블릿만) ──────────────────────────────────────────
        case 'draw_batch': {
          if (ws.role !== 'tablet') return;
          if (!Array.isArray(msg.points)) return;
          sendToMain(ws.projectId, { type: 'draw_batch', signId: ws.signId, points: msg.points });
          break;
        }

        // ── 서명 완료 (태블릿만) ─────────────────────────────────────────────
        case 'sign_done': {
          if (ws.role !== 'tablet') return;
          sendToMain(ws.projectId, { type: 'sign_done', signId: ws.signId });
          break;
        }

        // ── 서명 초기화 (태블릿만) ───────────────────────────────────────────
        case 'sign_clear': {
          if (ws.role !== 'tablet') return;
          sendToMain(ws.projectId, { type: 'sign_clear', signId: ws.signId });
          break;
        }

        // ── 리모컨 슬라이드 제어 ─────────────────────────────────────────────
        case 'remote_slide': {
          if (ws.role !== 'remote') return;
          sendToMain(ws.projectId, { type: 'remote_slide', direction: msg.direction });
          break;
        }

        // ── 클라이언트 ping → pong 응답 ─────────────────────────────────────
        case 'ping': {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }
      }
    });

    ws.on('close', () => {
      if (ws.projectId) {
        unregisterConnection(ws.projectId, ws);
        broadcastConnectionStatus(ws.projectId);
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
