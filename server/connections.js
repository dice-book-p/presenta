import { WebSocket } from 'ws';

// 단일 활성 프로젝트 기반 — 프로젝트 scoping 없음
const connections = {
  display: null,
  tablets: {},            // signId → ws
  currentActiveSignId: null,
};

export function getConnections() {
  return connections;
}

// ── Status ────────────────────────────────────────────────────────────────────

export function getConnectionStatus() {
  return {
    display: connections.display?.readyState === WebSocket.OPEN,
    tablets: Object.fromEntries(
      Object.entries(connections.tablets).map(([id, ws]) => [
        id, ws?.readyState === WebSocket.OPEN,
      ])
    ),
    currentActiveSignId: connections.currentActiveSignId,
  };
}

// ── Send helpers ──────────────────────────────────────────────────────────────

export function sendToDisplay(data) {
  if (connections.display?.readyState === WebSocket.OPEN) {
    connections.display.send(JSON.stringify(data));
  }
}

export function broadcastToTablets(data) {
  Object.values(connections.tablets).forEach(ws => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  });
}

/** display + 모든 tablet에 broadcast (active_changed 등) */
export function broadcastAll(data) {
  const msg = JSON.stringify(data);
  if (connections.display?.readyState === WebSocket.OPEN) {
    connections.display.send(msg);
  }
  Object.values(connections.tablets).forEach(ws => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

export function broadcastConnectionStatus() {
  const status = { type: 'connection_status', ...getConnectionStatus() };
  sendToDisplay(status);
  broadcastToTablets(status);
}

// ── Register / Unregister ─────────────────────────────────────────────────────

export function registerDisplay(ws) {
  const existing = connections.display;
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    return { success: false, reason: 'display_occupied' };
  }
  connections.display = ws;
  broadcastConnectionStatus();
  return { success: true };
}

export function registerTablet(ws, signId) {
  const existing = connections.tablets[signId];
  if (existing && existing !== ws) {
    if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) {
      existing.close();
    }
  }
  connections.tablets[signId] = ws;
  broadcastConnectionStatus();
  return { success: true };
}

export function unregisterDisplay() {
  connections.display = null;
  broadcastConnectionStatus();
}

export function unregisterTablet(signId) {
  delete connections.tablets[signId];
  broadcastConnectionStatus();
}

// ── Slide change ──────────────────────────────────────────────────────────────

export function handleSlideChange(slideIndex, signatories) {
  // slideIndex는 slides 배열의 order 값
  const signatory = signatories.find(s => {
    // slideId → order 는 display 페이지에서 계산 후 전송, 여기서는 그냥 index로 처리
    return s._slideOrder === slideIndex;
  }) ?? null;

  connections.currentActiveSignId = signatory?.id ?? null;

  broadcastToTablets({
    type: 'slide',
    slideIndex,
    activeSignId: connections.currentActiveSignId,
    signatory,
  });
}

// ── Force disconnect (admin) ──────────────────────────────────────────────────

export function forceDisconnect(target) {
  if (target === 'display') {
    if (connections.display) {
      connections.display.send(JSON.stringify({ type: 'force_disconnect' }));
      connections.display.close();
      connections.display = null;
    }
  } else {
    const ws = connections.tablets[target];
    if (ws) {
      ws.send(JSON.stringify({ type: 'force_disconnect' }));
      ws.close();
      delete connections.tablets[target];
    }
  }
  broadcastConnectionStatus();
}

export function forceDisconnectAll() {
  if (connections.display) {
    connections.display.send(JSON.stringify({ type: 'force_disconnect' }));
    connections.display.close();
    connections.display = null;
  }
  Object.keys(connections.tablets).forEach(id => {
    const ws = connections.tablets[id];
    if (ws) {
      ws.send(JSON.stringify({ type: 'force_disconnect' }));
      ws.close();
    }
  });
  connections.tablets = {};
  broadcastConnectionStatus();
}
