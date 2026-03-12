/**
 * WebSocket 연결 풀 단위 테스트
 * ws 모듈의 WebSocket.OPEN=1 과 FakeWS.OPEN=1 이 동일하므로 모킹 불필요
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
FakeWS.OPEN       = 1;  // ws.WebSocket.OPEN 과 동일
FakeWS.CLOSING    = 2;
FakeWS.CLOSED     = 3;

const {
  getPool, getConnectionStatus,
  registerDisplay, registerTablet,
  unregisterDisplay, unregisterTablet,
  sendToDisplay, broadcastToTablets, broadcastAll,
  handleSlideChange,
  forceDisconnect, forceDisconnectAll,
} = await import('../server/ws/connections.js');

function resetPool() {
  const pool = getPool();
  pool.display = null;
  pool.tablets = {};
  pool.currentActiveSignId = null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getConnectionStatus()', () => {
  beforeEach(resetPool);

  it('초기 상태: display=false, tablets={}, activeSignId=null', () => {
    const status = getConnectionStatus();
    assert.equal(status.display, false);
    assert.deepEqual(status.tablets, {});
    assert.equal(status.currentActiveSignId, null);
  });
});

describe('registerDisplay()', () => {
  beforeEach(resetPool);

  it('빈 슬롯에 등록 성공', () => {
    const ws = new FakeWS();
    const result = registerDisplay(ws);
    assert.equal(result.success, true);
    assert.equal(getConnectionStatus().display, true);
  });

  it('이미 연결된 display가 있으면 거부', () => {
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerDisplay(ws1);
    const result = registerDisplay(ws2);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'display_occupied');
  });

  it('끊긴 display는 교체 가능', () => {
    const ws1 = new FakeWS('CLOSED');
    const ws2 = new FakeWS();
    registerDisplay(ws1);
    const result = registerDisplay(ws2);
    assert.equal(result.success, true);
  });
});

describe('registerTablet()', () => {
  beforeEach(resetPool);

  it('새 signId로 등록 성공', () => {
    const ws = new FakeWS();
    const result = registerTablet(ws, 'sign-1');
    assert.equal(result.success, true);
    assert.equal(getConnectionStatus().tablets['sign-1'], true);
  });

  it('같은 signId로 재등록 시 기존 연결 종료', () => {
    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerTablet(ws1, 'sign-1');
    registerTablet(ws2, 'sign-1');
    assert.equal(ws1.readyState, FakeWS.CLOSED);
    assert.equal(getPool().tablets['sign-1'], ws2);
  });
});

describe('unregisterDisplay() / unregisterTablet()', () => {
  beforeEach(resetPool);

  it('display 해제 후 status.display=false', () => {
    const ws = new FakeWS();
    registerDisplay(ws);
    unregisterDisplay();
    assert.equal(getConnectionStatus().display, false);
  });

  it('tablet 해제 후 해당 signId 제거', () => {
    const ws = new FakeWS();
    registerTablet(ws, 'sign-2');
    unregisterTablet('sign-2');
    assert.equal(getConnectionStatus().tablets['sign-2'], undefined);
  });
});

describe('sendToDisplay() / broadcastToTablets() / broadcastAll()', () => {
  beforeEach(resetPool);

  it('sendToDisplay: display에만 전송', () => {
    const display = new FakeWS();
    const tablet  = new FakeWS();
    registerDisplay(display);
    registerTablet(tablet, 'sign-1');
    // 등록 과정의 broadcastConnectionStatus 메시지 제거 후 테스트
    display.sent = [];
    tablet.sent  = [];
    sendToDisplay({ type: 'test' });
    assert.equal(display.lastSent()?.type, 'test');
    assert.equal(tablet.sent.length, 0);
  });

  it('broadcastToTablets: 모든 tablet에 전송', () => {
    const t1 = new FakeWS(); registerTablet(t1, 's1');
    const t2 = new FakeWS(); registerTablet(t2, 's2');
    broadcastToTablets({ type: 'slide', slideIndex: 2 });
    assert.equal(t1.lastSent()?.slideIndex, 2);
    assert.equal(t2.lastSent()?.slideIndex, 2);
  });

  it('broadcastAll: display + 모든 tablet에 전송', () => {
    const display = new FakeWS(); registerDisplay(display);
    const tablet  = new FakeWS(); registerTablet(tablet, 's1');
    broadcastAll({ type: 'active_changed' });
    assert.equal(display.lastSent()?.type, 'active_changed');
    assert.equal(tablet.lastSent()?.type, 'active_changed');
  });

  it('CLOSED 상태의 ws에는 전송 안 함', () => {
    const closed = new FakeWS('CLOSED');
    registerDisplay(closed);
    sendToDisplay({ type: 'test' });
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
    const t = new FakeWS(); registerTablet(t, 'sig-A');
    handleSlideChange(1, project);
    assert.equal(getPool().currentActiveSignId, 'sig-A');
    assert.equal(t.lastSent()?.activeSignId, 'sig-A');
  });

  it('서명자 없는 슬라이드 → activeSignId null', () => {
    const t = new FakeWS(); registerTablet(t, 'sig-A');
    handleSlideChange(0, project);
    assert.equal(getPool().currentActiveSignId, null);
    assert.equal(t.lastSent()?.activeSignId, null);
  });

  it('브로드캐스트 slideIndex 포함', () => {
    const t = new FakeWS(); registerTablet(t, 'sig-B');
    handleSlideChange(2, project);
    assert.equal(t.lastSent()?.slideIndex, 2);
    assert.equal(t.lastSent()?.type, 'slide');
  });
});

describe('forceDisconnect() / forceDisconnectAll()', () => {
  beforeEach(resetPool);

  it('forceDisconnect("display"): force_disconnect 전송 후 display 제거', () => {
    const ws = new FakeWS(); registerDisplay(ws);
    forceDisconnect('display');
    assert.equal(ws.lastSent()?.type, 'force_disconnect');
    assert.equal(getPool().display, null);
  });

  it('forceDisconnect(signId): 해당 tablet 제거', () => {
    const ws = new FakeWS(); registerTablet(ws, 'sign-X');
    forceDisconnect('sign-X');
    assert.equal(ws.lastSent()?.type, 'force_disconnect');
    assert.equal(getPool().tablets['sign-X'], undefined);
  });

  it('forceDisconnectAll: 모두 제거', () => {
    const d = new FakeWS(); registerDisplay(d);
    const t = new FakeWS(); registerTablet(t, 'sign-1');
    forceDisconnectAll();
    assert.equal(getPool().display, null);
    assert.deepEqual(getPool().tablets, {});
  });
});
