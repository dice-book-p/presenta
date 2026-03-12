/**
 * 프로젝트 스토어 단위 테스트
 * - SUPABASE_URL을 placeholder로 설정해 createClient 초기화 통과
 * - _resetForTest()로 initProjectsStore() 우회 (Supabase 실호출 없음)
 * - persist()의 saveData 실패는 fire-and-forget이므로 테스트에 무영향
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  _resetForTest,
  getProjects, getProject, createProject, updateProject, deleteProject, duplicateProject,
  getActiveProjects, activateProject, deactivateProject, isProjectActive, isReady,
  addSlide, reorderSlides, removeSlide,
  updateSignatories, updateProjectPin,
} = await import('../server/store/projects.js');

beforeEach(() => _resetForTest());

// ── Active project ────────────────────────────────────────────────────────────

describe('getActiveProjects() / activateProject() / deactivateProject()', () => {
  it('초기에는 활성 프로젝트 없음', () => {
    assert.deepEqual(getActiveProjects(), []);
  });

  it('프로젝트 생성 후 활성화', () => {
    const p = createProject('Test');
    activateProject(p.id);
    const actives = getActiveProjects();
    assert.equal(actives.length, 1);
    assert.equal(actives[0].id, p.id);
    assert.equal(isProjectActive(p.id), true);
  });

  it('deactivateProject 시 비활성화', () => {
    const p = createProject('Test');
    activateProject(p.id);
    deactivateProject(p.id);
    assert.deepEqual(getActiveProjects(), []);
    assert.equal(isProjectActive(p.id), false);
  });

  it('여러 프로젝트 동시 활성화 가능', () => {
    const p1 = createProject('A');
    const p2 = createProject('B');
    activateProject(p1.id);
    activateProject(p2.id);
    assert.equal(getActiveProjects().length, 2);
  });

  it('이미 활성인 프로젝트 다시 활성화해도 중복 안 됨', () => {
    const p = createProject('Test');
    activateProject(p.id);
    activateProject(p.id);
    assert.equal(getActiveProjects().length, 1);
  });

  it('존재하지 않는 프로젝트 활성화 시 null 반환', () => {
    assert.equal(activateProject('bad-id'), null);
  });
});

// ── Projects CRUD ─────────────────────────────────────────────────────────────

describe('createProject()', () => {
  it('이름으로 프로젝트 생성', () => {
    const p = createProject('행사 2025');
    assert.equal(p.name, '행사 2025');
    assert.ok(p.id);
    assert.deepEqual(p.slides, []);
    assert.deepEqual(p.signatories, []);
    assert.equal(p.summarySlideId, null);
  });

  it('생성된 프로젝트가 목록에 포함', () => {
    createProject('A');
    createProject('B');
    assert.equal(getProjects().length, 2);
  });
});

describe('getProject()', () => {
  it('존재하는 ID → 프로젝트 반환', () => {
    const p = createProject('찾기');
    assert.equal(getProject(p.id)?.name, '찾기');
  });

  it('없는 ID → null 반환', () => {
    assert.equal(getProject('nonexistent'), null);
  });
});

describe('updateProject()', () => {
  it('name 변경', () => {
    const p = createProject('원본');
    const updated = updateProject(p.id, { name: '수정됨' });
    assert.equal(updated.name, '수정됨');
  });

  it('summarySlideId 변경', () => {
    const p = createProject('Test');
    updateProject(p.id, { summarySlideId: 'slide-abc' });
    assert.equal(getProject(p.id).summarySlideId, 'slide-abc');
  });

  it('없는 ID → null 반환', () => {
    assert.equal(updateProject('bad-id', { name: '?' }), null);
  });
});

describe('deleteProject()', () => {
  it('프로젝트 삭제 후 목록에서 제거', () => {
    const p = createProject('삭제될');
    deleteProject(p.id);
    assert.equal(getProject(p.id), null);
  });

  it('활성 프로젝트 삭제 시 활성 목록에서도 제거', () => {
    const p = createProject('Active');
    activateProject(p.id);
    deleteProject(p.id);
    assert.deepEqual(getActiveProjects(), []);
    assert.equal(isProjectActive(p.id), false);
  });
});

describe('duplicateProject()', () => {
  it('복사본 생성: 이름에 "(복사본)" 추가', () => {
    const src = createProject('원본');
    const copy = duplicateProject(src.id);
    assert.ok(copy.name.includes('복사본'));
    assert.notEqual(copy.id, src.id);
  });

  it('서명자 ID는 새로 발급', () => {
    const src = createProject('원본');
    updateSignatories(src.id, [{ title: '사장', name: '홍길동' }]);
    const copy = duplicateProject(src.id);
    assert.notEqual(copy.signatories[0].id, src.signatories[0].id);
  });

  it('없는 ID → null 반환', () => {
    assert.equal(duplicateProject('bad'), null);
  });
});

// ── Slides ────────────────────────────────────────────────────────────────────

describe('addSlide()', () => {
  it('슬라이드 추가 후 프로젝트에 포함', () => {
    const p = createProject('Test');
    const slide = addSlide(p.id, { filename: 'abc.webp', url: 'https://...' });
    assert.equal(slide.filename, 'abc.webp');
    assert.equal(getProject(p.id).slides.length, 1);
    assert.equal(slide.order, 0);
  });

  it('복수 슬라이드 추가 시 order 자동 증가', () => {
    const p = createProject('Test');
    addSlide(p.id, { filename: 'a.webp', url: '' });
    addSlide(p.id, { filename: 'b.webp', url: '' });
    const slides = getProject(p.id).slides;
    assert.equal(slides[1].order, 1);
  });
});

describe('reorderSlides()', () => {
  it('지정된 ID 순서대로 order 재배정', () => {
    const p = createProject('Test');
    const s0 = addSlide(p.id, { filename: 'first.webp', url: '' });
    const s1 = addSlide(p.id, { filename: 'second.webp', url: '' });
    const slides = reorderSlides(p.id, [s1.id, s0.id]);
    assert.equal(slides[0].id, s1.id);
    assert.equal(slides[0].order, 0);
    assert.equal(slides[1].id, s0.id);
    assert.equal(slides[1].order, 1);
  });
});

describe('removeSlide()', () => {
  it('슬라이드 삭제 후 목록에서 제거', () => {
    const p = createProject('Test');
    const s = addSlide(p.id, { filename: 'del.webp', url: '' });
    removeSlide(p.id, s.id);
    assert.equal(getProject(p.id).slides.length, 0);
  });

  it('summarySlideId인 슬라이드 삭제 시 summarySlideId null 처리', () => {
    const p = createProject('Test');
    const s = addSlide(p.id, { filename: 'summary.webp', url: '' });
    updateProject(p.id, { summarySlideId: s.id });
    removeSlide(p.id, s.id);
    assert.equal(getProject(p.id).summarySlideId, null);
  });

  it('삭제 후 나머지 슬라이드 order 재배정', () => {
    const p = createProject('Test');
    const s0 = addSlide(p.id, { filename: 'a.webp', url: '' });
    addSlide(p.id, { filename: 'b.webp', url: '' });
    removeSlide(p.id, s0.id);
    assert.equal(getProject(p.id).slides[0].order, 0);
  });
});

// ── Signatories ───────────────────────────────────────────────────────────────

describe('updateSignatories()', () => {
  it('서명자 목록 업데이트', () => {
    const p = createProject('Test');
    updateSignatories(p.id, [
      { title: '사장', name: '박상형', color: '#fff' },
      { title: '노조위원장', name: '박종섭' },
    ]);
    const sigs = getProject(p.id).signatories;
    assert.equal(sigs.length, 2);
    assert.equal(sigs[0].order, 1);
    assert.equal(sigs[1].order, 2);
  });

  it('color 미지정 시 기본값 #ffffff', () => {
    const p = createProject('Test');
    updateSignatories(p.id, [{ title: '테스트' }]);
    assert.equal(getProject(p.id).signatories[0].color, '#ffffff');
  });

  it('id 미지정 시 UUID 자동 발급', () => {
    const p = createProject('Test');
    updateSignatories(p.id, [{ title: '신규' }]);
    const sig = getProject(p.id).signatories[0];
    assert.ok(sig.id.length > 0);
  });

  it('없는 프로젝트 ID → null 반환', () => {
    assert.equal(updateSignatories('bad', []), null);
  });
});

// ── PIN ──────────────────────────────────────────────────────────────────────

describe('updateProjectPin()', () => {
  it('PIN 설정', () => {
    const p = createProject('Test');
    const updated = updateProjectPin(p.id, '1234');
    assert.equal(updated.pin, '1234');
    assert.equal(getProject(p.id).pin, '1234');
  });

  it('PIN 해제 (null)', () => {
    const p = createProject('Test');
    updateProjectPin(p.id, '1234');
    updateProjectPin(p.id, null);
    assert.equal(getProject(p.id).pin, '');
  });

  it('PIN 해제 (빈 문자열)', () => {
    const p = createProject('Test');
    updateProjectPin(p.id, '1234');
    updateProjectPin(p.id, '');
    assert.equal(getProject(p.id).pin, '');
  });

  it('없는 프로젝트 → null 반환', () => {
    assert.equal(updateProjectPin('bad-id', '1234'), null);
  });
});

describe('isReady()', () => {
  it('_resetForTest 후 ready=true', () => {
    assert.equal(isReady(), true);
  });
});
