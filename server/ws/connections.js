/**
 * WebSocket 연결 풀 관리 (프로젝트별)
 *
 * - 프로젝트별 독립 풀: mainDisplay, subDisplays, tablets, remotes
 * - 슬라이드 변경 시 활성 서명자 결정 및 브로드캐스트
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

// ── Per-project pool ──────────────────────────────────────────────────────────
// projectId → ProjectPool

/** @type {Map<string, ProjectPool>} */
const pools = new Map();

function createPool() {
  return {
    mainDisplay: null,      // { ws, connId, deviceInfo } | null
    subDisplays: new Map(), // connId → { ws, deviceInfo }
    tablets: {},            // signId → { ws, connId, deviceInfo }
    remotes: new Set(),     // Set<ws>
    currentSlideOrder: 0,
    currentActiveSignId: null,
  };
}

function getPool(projectId) {
  if (!pools.has(projectId)) pools.set(projectId, createPool());
  return pools.get(projectId);
}

export function deletePool(projectId) {
  pools.delete(projectId);
}

// ── 저수준 헬퍼 ───────────────────────────────────────────────────────────────

const isOpen   = (ws) => ws?.readyState === WebSocket.OPEN;
const safeSend = (ws, data) => { if (isOpen(ws)) ws.send(JSON.stringify(data)); };

// ── 조회 ──────────────────────────────────────────────────────────────────────

export function getConnectionStatus(projectId) {
  const pool = getPool(projectId);

  const mainDisplay = pool.mainDisplay
    ? { ...pool.mainDisplay.deviceInfo, connId: pool.mainDisplay.connId, connected: isOpen(pool.mainDisplay.ws) }
    : null;

  const subDisplays = [...pool.subDisplays.entries()].map(([connId, entry]) => ({
    connId,
    ...entry.deviceInfo,
    connected: isOpen(entry.ws),
  }));

  const tablets = Object.fromEntries(
    Object.entries(pool.tablets).map(([signId, entry]) => [
      signId,
      { connId: entry.connId, ...entry.deviceInfo, connected: isOpen(entry.ws) },
    ])
  );

  return {
    mainDisplay,
    subDisplays,
    tablets,
    currentActiveSignId: pool.currentActiveSignId,
    remoteCount: pool.remotes.size,
  };
}

// ── 전송 ──────────────────────────────────────────────────────────────────────

export function sendToMain(projectId, data) {
  const pool = getPool(projectId);
  if (pool.mainDisplay) safeSend(pool.mainDisplay.ws, data);
}

export function sendToSubs(projectId, data) {
  const pool = getPool(projectId);
  pool.subDisplays.forEach(entry => safeSend(entry.ws, data));
}

export function broadcastToDisplays(projectId, data) {
  sendToMain(projectId, data);
  sendToSubs(projectId, data);
}

export function broadcastToTablets(projectId, data) {
  const pool = getPool(projectId);
  Object.values(pool.tablets).forEach(entry => safeSend(entry.ws, data));
}

export function sendToRemotes(projectId, data) {
  const pool = getPool(projectId);
  pool.remotes.forEach(ws => safeSend(ws, data));
}

export function broadcastAll(projectId, data) {
  broadcastToDisplays(projectId, data);
  broadcastToTablets(projectId, data);
  sendToRemotes(projectId, data);
}

export function broadcastConnectionStatus(projectId) {
  const status = { type: 'connection_status', ...getConnectionStatus(projectId) };
  // Send to main, all subs, all tablets (not remotes)
  sendToMain(projectId, status);
  sendToSubs(projectId, status);
  broadcastToTablets(projectId, status);
}

/** 모든 풀에 브로드캐스트 (active_changed 등) */
export function broadcastActiveChanged(data) {
  for (const projectId of pools.keys()) {
    broadcastAll(projectId, data);
  }
}

// ── 등록 / 해제 ───────────────────────────────────────────────────────────────

/**
 * 메인 디스플레이 등록 (프로젝트당 최대 1개)
 * @returns {{ success: boolean, reason?: string }}
 */
export function registerMainDisplay(projectId, ws, deviceInfo) {
  const pool = getPool(projectId);
  const existing = pool.mainDisplay;

  if (existing && existing.ws !== ws && isOpen(existing.ws)) {
    return { success: false, reason: 'main_display_occupied' };
  }

  const connId = randomUUID();
  pool.mainDisplay = { ws, connId, deviceInfo: { ...deviceInfo, connectedAt: new Date().toISOString() } };
  broadcastConnectionStatus(projectId);
  return { success: true, connId };
}

/**
 * 서브 디스플레이 등록 (무제한)
 * @returns {{ success: boolean, connId: string }}
 */
export function registerSubDisplay(projectId, ws, deviceInfo) {
  const pool = getPool(projectId);
  const connId = randomUUID();
  pool.subDisplays.set(connId, { ws, deviceInfo: { ...deviceInfo, connectedAt: new Date().toISOString() } });
  broadcastConnectionStatus(projectId);
  return { success: true, connId };
}

/**
 * 태블릿 등록 (signId 키)
 * @returns {{ success: boolean, reason?: string }}
 */
export function registerTablet(projectId, ws, signId, deviceInfo) {
  const pool = getPool(projectId);
  const existing = pool.tablets[signId];

  if (existing && existing.ws !== ws) {
    if (isOpen(existing.ws) || existing.ws.readyState === WebSocket.CONNECTING) {
      existing.ws.close();
    }
  }

  const connId = randomUUID();
  pool.tablets[signId] = { ws, connId, deviceInfo: { ...deviceInfo, connectedAt: new Date().toISOString() } };
  broadcastConnectionStatus(projectId);
  return { success: true };
}

/**
 * 리모컨 등록
 * @returns {{ success: boolean }}
 */
export function registerRemote(projectId, ws) {
  const pool = getPool(projectId);
  pool.remotes.add(ws);
  return { success: true };
}

/**
 * ws가 속한 풀에서 연결을 찾아 제거한다.
 */
export function unregisterConnection(projectId, ws) {
  const pool = getPool(projectId);

  if (pool.mainDisplay?.ws === ws) {
    pool.mainDisplay = null;
    return;
  }

  for (const [connId, entry] of pool.subDisplays.entries()) {
    if (entry.ws === ws) {
      pool.subDisplays.delete(connId);
      return;
    }
  }

  for (const [signId, entry] of Object.entries(pool.tablets)) {
    if (entry.ws === ws) {
      delete pool.tablets[signId];
      return;
    }
  }

  pool.remotes.delete(ws);
}

// ── 슬라이드 변경 ────────────────────────────────────────────────────────────

/**
 * 슬라이드 인덱스(order)와 프로젝트 기준으로 활성 서명자를 결정한다.
 *
 * @param {string} projectId  프로젝트 ID
 * @param {number} slideIndex 현재 슬라이드의 order 값
 * @param {object} project    프로젝트 전체 객체
 */
export function handleSlideChange(projectId, slideIndex, project) {
  const pool = getPool(projectId);
  const slides      = project.slides      ?? [];
  const signatories = project.signatories ?? [];

  const signatory = signatories.find(sig => {
    const slide = slides.find(sl => sl.id === sig.slideId);
    return (slide?.order ?? -1) === slideIndex;
  }) ?? null;

  pool.currentActiveSignId = signatory?.id ?? null;
  pool.currentSlideOrder   = slideIndex;

  broadcastToTablets(projectId, {
    type:         'slide',
    slideIndex,
    activeSignId: pool.currentActiveSignId,
    signatory,
  });

  sendToSubs(projectId, {
    type:       'slide_update',
    slideOrder: slideIndex,
  });

  sendToRemotes(projectId, { type: 'slide_update', slideOrder: slideIndex });
}

export function getCurrentSlideOrder(projectId) {
  return getPool(projectId).currentSlideOrder;
}

// ── 관리자 강제 해제 ─────────────────────────────────────────────────────────

/**
 * @param {string} projectId
 * @param {string} target  'main' | connId (sub) | signId (tablet)
 */
export function forceDisconnect(projectId, target) {
  const pool = getPool(projectId);

  if (target === 'main') {
    if (pool.mainDisplay) {
      safeSend(pool.mainDisplay.ws, { type: 'force_disconnect' });
      pool.mainDisplay.ws?.close();
      pool.mainDisplay = null;
    }
  } else if (pool.subDisplays.has(target)) {
    const entry = pool.subDisplays.get(target);
    safeSend(entry.ws, { type: 'force_disconnect' });
    entry.ws?.close();
    pool.subDisplays.delete(target);
  } else if (pool.tablets[target]) {
    const entry = pool.tablets[target];
    safeSend(entry.ws, { type: 'force_disconnect' });
    entry.ws?.close();
    delete pool.tablets[target];
  }

  broadcastConnectionStatus(projectId);
}

export function forceDisconnectAll(projectId) {
  const pool = getPool(projectId);

  if (pool.mainDisplay) {
    safeSend(pool.mainDisplay.ws, { type: 'force_disconnect' });
    pool.mainDisplay.ws?.close();
    pool.mainDisplay = null;
  }

  pool.subDisplays.forEach(entry => {
    safeSend(entry.ws, { type: 'force_disconnect' });
    entry.ws?.close();
  });
  pool.subDisplays.clear();

  Object.values(pool.tablets).forEach(entry => {
    safeSend(entry.ws, { type: 'force_disconnect' });
    entry.ws?.close();
  });
  pool.tablets = {};

  pool.remotes.forEach(ws => {
    safeSend(ws, { type: 'force_disconnect' });
    ws?.close();
  });
  pool.remotes.clear();

  broadcastConnectionStatus(projectId);
}
