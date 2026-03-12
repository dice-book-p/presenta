import { WebSocket } from 'ws';

// 연결 상태 관리
const connections = {
  display: null,
  tablets: {}  // { sign1: ws, sign2: ws, ... }
};

let currentActiveSignId = null;

export function getConnections() {
  return connections;
}

export function getCurrentActiveSignId() {
  return currentActiveSignId;
}

// 연결 상태 요약 (admin/display용)
export function getConnectionStatus() {
  return {
    display: connections.display?.readyState === WebSocket.OPEN,
    tablets: Object.fromEntries(
      Object.entries(connections.tablets).map(([id, ws]) => [
        id,
        ws?.readyState === WebSocket.OPEN
      ])
    ),
    currentActiveSignId
  };
}

// PC (display) 에 메시지 전송
export function sendToDisplay(data) {
  if (connections.display?.readyState === WebSocket.OPEN) {
    connections.display.send(JSON.stringify(data));
  }
}

// 특정 태블릿에 메시지 전송
export function sendToTablet(signId, data) {
  const ws = connections.tablets[signId];
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// 모든 태블릿에 메시지 전송
export function broadcastToTablets(data) {
  Object.values(connections.tablets).forEach(ws => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });
}

// 모든 연결에 연결 상태 브로드캐스트
export function broadcastConnectionStatus() {
  const status = { type: 'connection_status', ...getConnectionStatus() };
  sendToDisplay(status);
  broadcastToTablets(status);
}

// display 등록
export function registerDisplay(ws) {
  const existing = connections.display;
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    return { success: false, reason: 'display_occupied' };
  }
  connections.display = ws;
  broadcastConnectionStatus();
  return { success: true };
}

// tablet 등록
export function registerTablet(ws, signId) {
  const existing = connections.tablets[signId];
  if (existing && existing !== ws) {
    // Close stale or reconnecting WS (same device reconnect before old close was processed)
    if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING) {
      existing.close();
    }
  }
  connections.tablets[signId] = ws;
  broadcastConnectionStatus();
  return { success: true };
}

// display 해제
export function unregisterDisplay() {
  connections.display = null;
  broadcastConnectionStatus();
}

// tablet 해제
export function unregisterTablet(signId) {
  delete connections.tablets[signId];
  broadcastConnectionStatus();
}

// ws로 signId 찾기
export function findTabletSignId(ws) {
  return Object.keys(connections.tablets).find(id => connections.tablets[id] === ws);
}

// 슬라이드 전환 처리
export function handleSlideChange(slideIndex, signatories) {
  const signatory = signatories.find(s => s.slideIndex === slideIndex);
  currentActiveSignId = signatory?.id ?? null;

  broadcastToTablets({
    type: 'slide',
    slideIndex,
    activeSignId: currentActiveSignId,
    signatory: signatory ?? null
  });
}

// 강제 해제 (admin)
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

// 전체 강제 해제 (admin)
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
