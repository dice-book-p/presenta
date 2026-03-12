/**
 * API 핸들러 통합 테스트
 * - handleApi()를 직접 호출하여 HTTP 레이어 테스트
 * - FakeReq/FakeRes로 Node.js HTTP 객체를 모킹
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const { _resetForTest, createProject, getProject, updateProjectPin, activateProject } =
  await import('../server/store/projects.js');
const { handleApi } = await import('../server/api/index.js');

const ADMIN_PIN = 'test-pin-1234';

// ── Fake HTTP objects ────────────────────────────────────────────────────────

function fakeReq(method, path, body = null, authPin = null) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'content-type': 'application/json' };
  if (authPin) headers['authorization'] = `Bearer ${authPin}`;
  // Readable stream that emits body
  const req = new Readable({ read() { this.push(bodyStr); this.push(null); } });
  req.method = method;
  req.headers = headers;
  return req;
}

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(code, hdrs) { res.statusCode = code; Object.assign(res.headers, hdrs); },
    end(data) { res.body = data ? JSON.parse(data) : null; },
  };
  return res;
}

function makeUrl(path) {
  return new URL(path, 'http://localhost');
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => _resetForTest());

// ── GET /api/active ──────────────────────────────────────────────────────────

describe('GET /api/active', () => {
  it('초기 상태 — 빈 배열 반환', async () => {
    const req = fakeReq('GET', '/api/active');
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, []);
  });

  it('활성화된 프로젝트만 반환', async () => {
    const p1 = createProject('A');
    const p2 = createProject('B');
    activateProject(p1.id);

    const req = fakeReq('GET', '/api/active');
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, p1.id);
  });

  it('PIN 필드가 응답에 노출되지 않음 (hasPin만 존재)', async () => {
    const p = createProject('Secure');
    updateProjectPin(p.id, '9999');
    activateProject(p.id);

    const req = fakeReq('GET', '/api/active');
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.body[0].hasPin, true);
    assert.equal(res.body[0].pin, undefined);
    assert.equal(res.body[0].remoteToken, undefined);
  });
});

// ── POST /api/active (activate/deactivate toggle) ────────────────────────────

describe('POST /api/active', () => {
  it('프로젝트 활성화', async () => {
    const p = createProject('Test');
    const req = fakeReq('POST', '/api/active', { projectId: p.id, active: true }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('프로젝트 비활성화', async () => {
    const p = createProject('Test');
    activateProject(p.id);
    const req = fakeReq('POST', '/api/active', { projectId: p.id, active: false }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.project, null);
  });

  it('projectId 없으면 400', async () => {
    const req = fakeReq('POST', '/api/active', { active: true }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 400);
  });

  it('존재하지 않는 프로젝트 → 404', async () => {
    const req = fakeReq('POST', '/api/active', { projectId: 'bad-id', active: true }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 404);
  });

  it('인증 없으면 401', async () => {
    const p = createProject('Test');
    const req = fakeReq('POST', '/api/active', { projectId: p.id });
    const res = fakeRes();
    await handleApi(makeUrl('/api/active'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 401);
  });
});

// ── POST /api/projects/:id/verify-pin ────────────────────────────────────────

describe('POST /api/projects/:id/verify-pin', () => {
  it('PIN이 없는 프로젝트 → 항상 ok', async () => {
    const p = createProject('NoPIN');
    const req = fakeReq('POST', `/api/projects/${p.id}/verify-pin`, { pin: '' });
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/verify-pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('올바른 PIN → 200', async () => {
    const p = createProject('Locked');
    updateProjectPin(p.id, 'secret');
    const req = fakeReq('POST', `/api/projects/${p.id}/verify-pin`, { pin: 'secret' });
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/verify-pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });

  it('잘못된 PIN → 401', async () => {
    const p = createProject('Locked');
    updateProjectPin(p.id, 'secret');
    const req = fakeReq('POST', `/api/projects/${p.id}/verify-pin`, { pin: 'wrong' });
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/verify-pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
  });

  it('존재하지 않는 프로젝트 → 404', async () => {
    const req = fakeReq('POST', '/api/projects/bad-id/verify-pin', { pin: '1234' });
    const res = fakeRes();
    await handleApi(makeUrl('/api/projects/bad-id/verify-pin'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 404);
  });
});

// ── PUT /api/projects/:id/pin ────────────────────────────────────────────────

describe('PUT /api/projects/:id/pin', () => {
  it('PIN 설정', async () => {
    const p = createProject('Test');
    const req = fakeReq('PUT', `/api/projects/${p.id}/pin`, { pin: 'new-pin' }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(getProject(p.id).pin, 'new-pin');
  });

  it('PIN 해제 (null)', async () => {
    const p = createProject('Test');
    updateProjectPin(p.id, 'old');
    const req = fakeReq('PUT', `/api/projects/${p.id}/pin`, { pin: null }, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    assert.equal(getProject(p.id).pin, '');
  });

  it('인증 없으면 401', async () => {
    const p = createProject('Test');
    const req = fakeReq('PUT', `/api/projects/${p.id}/pin`, { pin: '1234' });
    const res = fakeRes();
    await handleApi(makeUrl(`/api/projects/${p.id}/pin`), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 401);
  });
});

// ── GET /api/projects (publicProject 필터링) ─────────────────────────────────

describe('GET /api/projects', () => {
  it('PIN, remoteToken이 응답에 노출되지 않음', async () => {
    const p = createProject('Test');
    updateProjectPin(p.id, 'secret');

    const req = fakeReq('GET', '/api/projects');
    const res = fakeRes();
    await handleApi(makeUrl('/api/projects'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
    const proj = res.body.find(x => x.id === p.id);
    assert.equal(proj.pin, undefined);
    assert.equal(proj.remoteToken, undefined);
    assert.equal(proj.hasPin, true);
  });
});

// ── GET /api/me (인증 확인) ──────────────────────────────────────────────────

describe('GET /api/me', () => {
  it('올바른 PIN → 200', async () => {
    const req = fakeReq('GET', '/api/me', null, ADMIN_PIN);
    const res = fakeRes();
    await handleApi(makeUrl('/api/me'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 200);
  });

  it('잘못된 PIN → 401', async () => {
    const req = fakeReq('GET', '/api/me', null, 'wrong-pin');
    const res = fakeRes();
    await handleApi(makeUrl('/api/me'), req, res, ADMIN_PIN);
    assert.equal(res.statusCode, 401);
  });
});
