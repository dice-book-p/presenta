/**
 * WebSocket 연결 풀 단위 테스트
 * - 프로젝트별 풀 구조에 맞게 projectId를 항상 전달
 * - ws 모듈의 WebSocket.OPEN=1 과 FakeWS.OPEN=1 이 동일하므로 모킹 불필요
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Fake WebSocket (ws.WebSocket 상수와 값 동일) ─────────────────────────────
class FakeWS {
  constructor(state = 'OPEN') {
    this.readyState = FakeWS[state];
    this.sent = [];
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = FakeWS.CLOSED; }
  lastSent() { return this.sent.at(-1); }
}
FakeWS.CONNECTING = 0;
FakeWS.OPEN       = 1;
FakeWS.CLOSING    = 2;
FakeWS.CLOSED     = 3;

const {
  getConnectionStatus, deletePool,
  registerMainDisplay, registerTablet,
  unregisterConnection,
  sendToMain, broadcastToTablets, broadcastAll,
  handleSlideChange,
  forceDisconnect, forceDisconnectAll,
} = await import('../server/ws/connections.js');

const PID = 'test-project-1';

function resetPool() {
  deletePool(PID);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getConnectionStatus()', () => {
  beforeEach(resetPool);

  it('초기 상태: mainDisplay=null, tablets={}, activeSignId=null', () => {
    const status = getConnectionStatus(PID);
    assert.equal(status.mainDisplay, null);
    assert.deepEqual(status.tablets, {});
    assert.equal(status.currentActiveSignId, null);
  });
});

describe('registerMainDisplay()', () => {
  beforeEach(resetPool);

  it('빈 슬롯에 등록 성공', () => {
    const ws = new FakeWS();
    const result = registerMainDisplay(PID, ws, {});
    assert.equal(result.success, true);
    assert.ok(result.connId);
    assert.notEqual(getConnectionStatus(PID).mainDisplay, null);
  });

  it('이미 연결된 display가 있으면 거부', () => {
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerMainDisplay(PID, ws1, {});
    const result = registerMainDisplay(PID, ws2, {});
    assert.equal(result.success, false);
    assert.equal(result.reason, 'main_display_occupied');
  });

  it('끊긴 display는 교체 가능', () => {
    const ws1 = new FakeWS('CLOSED');
    const ws2 = new FakeWS();
    registerMainDisplay(PID, ws1, {});
    const result = registerMainDisplay(PID, ws2, {});
    assert.equal(result.success, true);
  });
});

describe('registerTablet()', () => {
  beforeEach(resetPool);

  it('새 signId로 등록 성공', () => {
    const ws = new FakeWS();
    const result = registerTablet(PID, ws, 'sign-1', {});
    assert.equal(result.success, true);
    const status = getConnectionStatus(PID);
    assert.ok(status.tablets['sign-1']);
  });

  it('같은 signId로 재등록 시 기존 연결 종료', () => {
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerTablet(PID, ws1, 'sign-1', {});
    registerTablet(PID, ws2, 'sign-1', {});
    assert.equal(ws1.readyState, FakeWS.CLOSED);
  });
});

describe('unregisterConnection()', () => {
  beforeEach(resetPool);

  it('display 해제 후 mainDisplay=null', () => {
    const ws = new FakeWS();
    registerMainDisplay(PID, ws, {});
    unregisterConnection(PID, ws);
    assert.equal(getConnectionStatus(PID).mainDisplay, null);
  });

  it('tablet 해제 후 해당 signId 제거', () => {
    const ws = new FakeWS();
    registerTablet(PID, ws, 'sign-2', {});
    unregisterConnection(PID, ws);
    assert.equal(getConnectionStatus(PID).tablets['sign-2'], undefined);
  });
});

describe('sendToMain() / broadcastToTablets() / broadcastAll()', () => {
  beforeEach(resetPool);

  it('sendToMain: display에만 전송', () => {
    const display = new FakeWS();
    const tablet  = new FakeWS();
    registerMainDisplay(PID, display, {});
    registerTablet(PID, tablet, 'sign-1', {});
    display.sent = [];
    tablet.sent  = [];
    sendToMain(PID, { type: 'test' });
    assert.equal(display.lastSent()?.type, 'test');
    assert.equal(tablet.sent.length, 0);
  });

  it('broadcastToTablets: 모든 tablet에 전송', () => {
    const t1 = new FakeWS(); registerTablet(PID, t1, 's1', {});
    const t2 = new FakeWS(); registerTablet(PID, t2, 's2', {});
    t1.sent = []; t2.sent = [];
    broadcastToTablets(PID, { type: 'slide', slideIndex: 2 });
    assert.equal(t1.lastSent()?.slideIndex, 2);
    assert.equal(t2.lastSent()?.slideIndex, 2);
  });

  it('broadcastAll: display + 모든 tablet에 전송', () => {
    const display = new FakeWS(); registerMainDisplay(PID, display, {});
    const tablet  = new FakeWS(); registerTablet(PID, tablet, 's1', {});
    display.sent = []; tablet.sent = [];
    broadcastAll(PID, { type: 'active_changed' });
    assert.equal(display.lastSent()?.type, 'active_changed');
    assert.equal(tablet.lastSent()?.type, 'active_changed');
  });

  it('CLOSED 상태의 ws에는 전송 안 함', () => {
    const closed = new FakeWS('CLOSED');
    registerMainDisplay(PID, closed, {});
    sendToMain(PID, { type: 'test' });
    assert.equal(closed.sent.length, 0);
  });
});

describe('handleSlideChange()', () => {
  beforeEach(resetPool);

  const project = {
    slides: [
      { id: 'sl-0', order: 0 },
      { id: 'sl-1', order: 1 },
      { id: 'sl-2', order: 2 },
    ],
    signatories: [
      { id: 'sig-A', slideId: 'sl-1' },
      { id: 'sig-B', slideId: 'sl-2' },
    ],
  };

  it('서명자 슬라이드 진입 시 activeSignId 설정', () => {
    const t = new FakeWS(); registerTablet(PID, t, 'sig-A', {});
    t.sent = [];
    handleSlideChange(PID, 1, project);
    assert.equal(getConnectionStatus(PID).currentActiveSignId, 'sig-A');
    assert.equal(t.lastSent()?.activeSignId, 'sig-A');
  });

  it('서명자 없는 슬라이드 → activeSignId null', () => {
    const t = new FakeWS(); registerTablet(PID, t, 'sig-A', {});
    t.sent = [];
    handleSlideChange(PID, 0, project);
    assert.equal(getConnectionStatus(PID).currentActiveSignId, null);
    assert.equal(t.lastSent()?.activeSignId, null);
  });

  it('브로드캐스트 slideIndex 포함', () => {
    const t = new FakeWS(); registerTablet(PID, t, 'sig-B', {});
    t.sent = [];
    handleSlideChange(PID, 2, project);
    assert.equal(t.lastSent()?.slideIndex, 2);
    assert.equal(t.lastSent()?.type, 'slide');
  });
});

describe('forceDisconnect() / forceDisconnectAll()', () => {
  beforeEach(resetPool);

  it('forceDisconnect("main"): force_disconnect 전송 후 display 제거', () => {
    const ws = new FakeWS(); registerMainDisplay(PID, ws, {});
    ws.sent = [];
    forceDisconnect(PID, 'main');
    assert.equal(ws.lastSent()?.type, 'force_disconnect');
    assert.equal(getConnectionStatus(PID).mainDisplay, null);
  });

  it('forceDisconnect(signId): 해당 tablet 제거', () => {
    const ws = new FakeWS(); registerTablet(PID, ws, 'sign-X', {});
    ws.sent = [];
    forceDisconnect(PID, 'sign-X');
    assert.equal(ws.lastSent()?.type, 'force_disconnect');
    assert.equal(getConnectionStatus(PID).tablets['sign-X'], undefined);
  });

  it('forceDisconnectAll: 모두 제거', () => {
    const d = new FakeWS(); registerMainDisplay(PID, d, {});
    const t = new FakeWS(); registerTablet(PID, t, 'sign-1', {});
    forceDisconnectAll(PID);
    assert.equal(getConnectionStatus(PID).mainDisplay, null);
    assert.deepEqual(getConnectionStatus(PID).tablets, {});
  });
});
