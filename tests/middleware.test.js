/**
 * API 미들웨어 단위 테스트
 * 순수 함수만 포함하므로 모킹 불필요
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { match, checkAuth } from '../server/api/middleware.js';

describe('match()', () => {
  it('정적 경로 일치', () => {
    assert.deepEqual(match('/api/active', '/api/active'), {});
  });

  it('단일 파라미터 추출', () => {
    assert.deepEqual(match('/api/projects/:id', '/api/projects/abc-123'), { id: 'abc-123' });
  });

  it('복수 파라미터 추출', () => {
    assert.deepEqual(
      match('/api/projects/:id/slides/:slideId', '/api/projects/p1/slides/s2'),
      { id: 'p1', slideId: 's2' }
    );
  });

  it('URL 인코딩된 파라미터 디코딩', () => {
    const result = match('/api/projects/:id', '/api/projects/hello%20world');
    assert.equal(result.id, 'hello world');
  });

  it('불일치 시 null 반환', () => {
    assert.equal(match('/api/projects/:id', '/api/active'), null);
  });

  it('접두어만 일치해도 null 반환 (정확 일치)', () => {
    assert.equal(match('/api/projects', '/api/projects/extra'), null);
  });
});

describe('checkAuth()', () => {
  const makeReq = (header) => ({ headers: { authorization: header } });

  it('올바른 Bearer 토큰 → true', () => {
    assert.equal(checkAuth(makeReq('Bearer 1234'), '1234'), true);
  });

  it('토큰 불일치 → false', () => {
    assert.equal(checkAuth(makeReq('Bearer wrong'), '1234'), false);
  });

  it('Authorization 헤더 없음 → false', () => {
    assert.equal(checkAuth({ headers: {} }, '1234'), false);
  });

  it('공백 트림 처리', () => {
    assert.equal(checkAuth(makeReq('Bearer  1234 '), '1234'), true);
  });
});
