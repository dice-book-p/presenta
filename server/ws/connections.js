/**
 * WebSocket 연결 풀 관리 (인프라 레이어)
 *
 * - 단일 display + 다수 tablet(signId 키) 연결 관리
 * - 슬라이드 변경 시 활성 서명자 결정 및 브로드캐스트
 */
import { WebSocket } from 'ws';

// ── 연결 풀 ────────────────────────────────────────────────────────────────────
const pool = {
  display: null,            // ws | null
  tablets: {},              // { [signId]: ws }
  currentActiveSignId: null,
  remotes: new Set(),       // mobile remote controls
  currentSlideOrder: 0,     // last known slide order
};

// ── 저수준 헬퍼 ───────────────────────────────────────────────────────────────

const isOpen   = (ws) => ws?.readyState === WebSocket.OPEN;
const safeSend = (ws, data) => { if (isOpen(ws)) ws.send(JSON.stringify(data)); };

// ── 조회 ──────────────────────────────────────────────────────────────────────

export const getPool = () => pool;

export function getConnectionStatus() {
  return {
    display: isOpen(pool.display),
    tablets: Object.fromEntries(
      Object.entries(pool.tablets).map(([id, ws]) => [id, isOpen(ws)])
    ),
    currentActiveSignId: pool.currentActiveSignId,
    remoteCount: pool.remotes.size,
  };
}

// ── 전송 ──────────────────────────────────────────────────────────────────────

export const sendToDisplay = (data) => safeSend(pool.display, data);

export const sendToRemotes = (data) => pool.remotes.forEach(ws => safeSend(ws, data));

export function broadcastToTablets(data) {
  Object.values(pool.tablets).forEach(ws => safeSend(ws, data));
}

/** display + 모든 tablet에 브로드캐스트 (active_changed 등) */
export function broadcastAll(data) {
  safeSend(pool.display, data);
  broadcastToTablets(data);
}

export function broadcastConnectionStatus() {
  const status = { type: 'connection_status', ...getConnectionStatus() };
  sendToDisplay(status);
  broadcastToTablets(status);
  sendToRemotes(status);
}

// ── 등록 / 해제 ───────────────────────────────────────────────────────────────

export function registerRemote(ws) { pool.remotes.add(ws); }
export function unregisterRemote(ws) { pool.remotes.delete(ws); }
export const getCurrentSlideOrder = () => pool.currentSlideOrder;

export function registerDisplay(ws) {
  const existing = pool.display;
  if (existing && existing !== ws && isOpen(existing)) {
    return { success: false, reason: 'display_occupied' };
  }
  pool.display = ws;
  broadcastConnectionStatus();
  return { success: true };
}

export function registerTablet(ws, signId) {
  const existing = pool.tablets[signId];
  if (existing && existing !== ws) {
    if (isOpen(existing) || existing.readyState === WebSocket.CONNECTING) existing.close();
  }
  pool.tablets[signId] = ws;
  broadcastConnectionStatus();
  return { success: true };
}

export function unregisterDisplay() {
  pool.display = null;
  broadcastConnectionStatus();
}

export function unregisterTablet(signId) {
  delete pool.tablets[signId];
  broadcastConnectionStatus();
}

// ── 슬라이드 변경 ────────────────────────────────────────────────────────────

/**
 * 슬라이드 인덱스(order)와 활성 프로젝트 기준으로 활성 서명자를 결정한다.
 * websocket.js에서 _slideOrder 임시 속성을 사용하던 방식을 대체한다.
 *
 * @param {number}  slideIndex  현재 슬라이드의 order 값
 * @param {object}  project     활성 프로젝트 전체 객체
 */
export function handleSlideChange(slideIndex, project) {
  const slides      = project.slides      ?? [];
  const signatories = project.signatories ?? [];

  const signatory = signatories.find(sig => {
    const slide = slides.find(sl => sl.id === sig.slideId);
    return (slide?.order ?? -1) === slideIndex;
  }) ?? null;

  pool.currentActiveSignId = signatory?.id ?? null;
  pool.currentSlideOrder   = slideIndex;

  broadcastToTablets({
    type:         'slide',
    slideIndex,
    activeSignId: pool.currentActiveSignId,
    signatory,
  });

  sendToRemotes({ type: 'slide_update', slideOrder: slideIndex });
}

// ── 관리자 강제 해제 ─────────────────────────────────────────────────────────

export function forceDisconnect(target) {
  if (target === 'display') {
    safeSend(pool.display, { type: 'force_disconnect' });
    pool.display?.close();
    pool.display = null;
  } else {
    const ws = pool.tablets[target];
    safeSend(ws, { type: 'force_disconnect' });
    ws?.close();
    delete pool.tablets[target];
  }
  broadcastConnectionStatus();
}

export function forceDisconnectAll() {
  safeSend(pool.display, { type: 'force_disconnect' });
  pool.display?.close();
  pool.display = null;

  Object.values(pool.tablets).forEach(ws => {
    safeSend(ws, { type: 'force_disconnect' });
    ws?.close();
  });
  pool.tablets = {};

  broadcastConnectionStatus();
}
