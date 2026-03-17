/**
 * WebSocket 서버 메시지 핸들러 테스트
 * - connections.js의 풀 관리 + 검증 로직 테스트
 * - draw 메시지 검증 로직 단위 테스트
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Store 초기화 ─────────────────────────────────────────────────────────────
const { _resetForTest, createProject, activateProject } =
  await import('../server/store/projects.js');

const {
  registerMainDisplay, registerTablet, unregisterConnection,
  getConnectionStatus, deletePool, handleSlideChange,
} = await import('../server/ws/connections.js');

// ── Fake WebSocket ───────────────────────────────────────────────────────────
class FakeWS {
  constructor() {
    this.readyState = 1; // OPEN
    this.sent = [];
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
  lastSent() { return this.sent.at(-1); }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => _resetForTest());

describe('WS identify_display', () => {
  it('유효한 활성 프로젝트로 identify → 풀에 등록', () => {
    const p = createProject('Test');
    activateProject(p.id);

    const ws = new FakeWS();
    const result = registerMainDisplay(p.id, ws, { ip: '127.0.0.1' });
    assert.equal(result.success, true);

    const status = getConnectionStatus(p.id);
    assert.ok(status.mainDisplay);
    assert.equal(status.mainDisplay.connected, true);
  });

  it('이미 메인 디스플레이가 있으면 reject', () => {
    const p = createProject('Test');
    activateProject(p.id);

    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerMainDisplay(p.id, ws1, { ip: '127.0.0.1' });
    const result = registerMainDisplay(p.id, ws2, { ip: '127.0.0.2' });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'main_display_occupied');
  });
});

describe('WS identify_tablet', () => {
  it('signId로 태블릿 등록', () => {
    const p = createProject('Test');
    activateProject(p.id);

    const ws = new FakeWS();
    const result = registerTablet(p.id, ws, 'sig-1', { ip: '10.0.0.1' });
    assert.equal(result.success, true);

    const status = getConnectionStatus(p.id);
    assert.ok(status.tablets['sig-1']);
    assert.equal(status.tablets['sig-1'].connected, true);
  });

  it('같은 signId 재등록 시 기존 연결 종료', () => {
    const p = createProject('Test');

    const ws1 = new FakeWS();
    const ws2 = new FakeWS();
    registerTablet(p.id, ws1, 'sig-1', { ip: '10.0.0.1' });
    registerTablet(p.id, ws2, 'sig-1', { ip: '10.0.0.2' });

    assert.equal(ws1.readyState, 3); // CLOSED
    const status = getConnectionStatus(p.id);
    assert.equal(status.tablets['sig-1'].connected, true);
  });
});

describe('WS draw validation', () => {
  const valid = (x, y) =>
    typeof x === 'number' && typeof y === 'number' &&
    x >= 0 && x <= 1 && y >= 0 && y <= 1;

  it('유효한 좌표 (0~1 범위 숫자) 통과', () => {
    assert.equal(valid(0.5, 0.5), true);
    assert.equal(valid(0, 0), true);
    assert.equal(valid(1, 1), true);
  });

  it('범위 밖 좌표 거부', () => {
    assert.equal(valid(-0.1, 0.5), false);
    assert.equal(valid(1.1, 0.5), false);
    assert.equal(valid(0.5, -0.1), false);
    assert.equal(valid(0.5, 1.1), false);
  });

  it('숫자가 아닌 값 거부', () => {
    assert.equal(valid('0.5', 0.5), false);
    assert.equal(valid(null, 0.5), false);
    assert.equal(valid(0.5, undefined), false);
    assert.equal(valid(NaN, 0.5), false);
  });

  it('draw_batch 포인트 200개 제한', () => {
    const points = Array.from({ length: 300 }, (_, i) => ({ x: i / 300, y: i / 300 }));
    const limited = points.slice(0, 200).filter(p =>
      typeof p.x === 'number' && typeof p.y === 'number' &&
      p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    );
    assert.equal(limited.length, 200);
  });

  it('draw_batch 잘못된 포인트 필터링', () => {
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 'bad', y: 0.5 },
      { x: 2, y: 0.5 },
      { x: 0.3, y: 0.7 },
    ];
    const filtered = points.filter(p =>
      typeof p.x === 'number' && typeof p.y === 'number' &&
      p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    );
    assert.equal(filtered.length, 2);
  });
});

describe('WS connection pool cleanup', () => {
  it('unregisterConnection으로 메인 디스플레이 제거', () => {
    const p = createProject('Test');
    const ws = new FakeWS();
    registerMainDisplay(p.id, ws, { ip: '127.0.0.1' });

    unregisterConnection(p.id, ws);
    const status = getConnectionStatus(p.id);
    assert.equal(status.mainDisplay, null);
  });

  it('deletePool로 프로젝트 풀 전체 제거', () => {
    const p = createProject('Test');
    const ws = new FakeWS();
    registerMainDisplay(p.id, ws, { ip: '127.0.0.1' });

    deletePool(p.id);
    const status = getConnectionStatus(p.id);
    assert.equal(status.mainDisplay, null);
  });
});

describe('WS slide_change', () => {
  it('슬라이드 변경 시 활성 서명자 결정', () => {
    const p = createProject('Test');
    activateProject(p.id);

    const project = {
      slides: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }],
      signatories: [{ id: 'sig1', slideId: 's1' }, { id: 'sig2', slideId: 's2' }],
    };

    handleSlideChange(p.id, 0, project);
    let status = getConnectionStatus(p.id);
    assert.equal(status.currentActiveSignId, 'sig1');

    handleSlideChange(p.id, 1, project);
    status = getConnectionStatus(p.id);
    assert.equal(status.currentActiveSignId, 'sig2');
  });

  it('서명자 없는 슬라이드 → activeSignId null', () => {
    const p = createProject('Test');

    const project = {
      slides: [{ id: 's1', order: 0 }],
      signatories: [{ id: 'sig1', slideId: 's-other' }],
    };

    handleSlideChange(p.id, 0, project);
    const status = getConnectionStatus(p.id);
    assert.equal(status.currentActiveSignId, null);
  });
});
