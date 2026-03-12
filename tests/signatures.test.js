/**
 * 서명 스토어 단위 테스트
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  _resetForTest,
  getSignatures, saveSignature, clearSignatures, clearOneSignature,
  isSignaturesReady,
} = await import('../server/store/signatures.js');

beforeEach(() => _resetForTest());

describe('getSignatures()', () => {
  it('서명 없는 프로젝트 → 빈 객체', () => {
    assert.deepEqual(getSignatures('proj-1'), {});
  });

  it('저장된 서명 반환', () => {
    saveSignature('proj-1', 'sig-A', 'data:image/png;base64,AAA');
    assert.equal(getSignatures('proj-1')['sig-A'], 'data:image/png;base64,AAA');
  });
});

describe('saveSignature()', () => {
  it('프로젝트에 서명 저장', () => {
    saveSignature('p1', 's1', 'data:...');
    assert.ok(getSignatures('p1')['s1']);
  });

  it('같은 signId 덮어쓰기', () => {
    saveSignature('p1', 's1', 'v1');
    saveSignature('p1', 's1', 'v2');
    assert.equal(getSignatures('p1')['s1'], 'v2');
  });

  it('여러 서명자 독립 저장', () => {
    saveSignature('p1', 's1', 'dataA');
    saveSignature('p1', 's2', 'dataB');
    const sigs = getSignatures('p1');
    assert.equal(sigs['s1'], 'dataA');
    assert.equal(sigs['s2'], 'dataB');
  });
});

describe('clearSignatures()', () => {
  it('프로젝트의 모든 서명 삭제', () => {
    saveSignature('p1', 's1', 'data');
    saveSignature('p1', 's2', 'data');
    clearSignatures('p1');
    assert.deepEqual(getSignatures('p1'), {});
  });

  it('다른 프로젝트 서명은 영향 없음', () => {
    saveSignature('p1', 's1', 'data');
    saveSignature('p2', 's1', 'other');
    clearSignatures('p1');
    assert.equal(getSignatures('p2')['s1'], 'other');
  });
});

describe('clearOneSignature()', () => {
  it('특정 서명자만 삭제', () => {
    saveSignature('p1', 's1', 'A');
    saveSignature('p1', 's2', 'B');
    clearOneSignature('p1', 's1');
    assert.equal(getSignatures('p1')['s1'], undefined);
    assert.equal(getSignatures('p1')['s2'], 'B');
  });

  it('존재하지 않는 signId 삭제 시 에러 없음', () => {
    assert.doesNotThrow(() => clearOneSignature('p1', 'nonexistent'));
  });
});

describe('isSignaturesReady()', () => {
  it('_resetForTest 후 ready=true', () => {
    assert.equal(isSignaturesReady(), true);
  });
});
