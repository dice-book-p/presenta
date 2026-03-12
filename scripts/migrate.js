/**
 * 마이그레이션 스크립트: 기존 static/img/*.jpg → Supabase + projects.json 생성
 *
 * 사용법:
 *   node --env-file=.env scripts/migrate.js
 *
 * 결과:
 *   - Supabase slides 버킷에 이미지 업로드
 *   - Supabase data 버킷에 projects.json 생성 (프로젝트 + 4명 서명자 포함)
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SLIDES_BUCKET = 'slides';
const DATA_BUCKET   = 'data';

// ── 슬라이드 목록 (순서 고정) ────────────────────────────────────────────────
// 0~15 순서대로 Supabase에 업로드됨
const SLIDE_FILES = [
  '1.jpg',
  '2.jpg',
  '3.jpg',
  '4.jpg',
  '4-1.jpg',
  '5.jpg',
  '5-1-사장.jpg',       // index 6  ← 사장 서명 슬라이드
  '5-2-노조위원장.jpg',  // index 7  ← 노조위원장 서명 슬라이드
  '5-3-부사장1.jpg',    // index 8  ← 부사장 서명 슬라이드
  '5-4-본부장.jpg',     // index 9  ← 본부장 서명 슬라이드
  '6.jpg',
  '6-1.jpg',            // index 11 ← 종합 서약서 슬라이드
  '7.jpg',
  '7-1.jpg',
  '8.jpg',
  '9.jpg',
];

// canvasArea: right → left 변환
// right: '14%', width: '17%' → left = 100 - 14 - 17 = 69%
const SIGNATORIES_CONFIG = [
  {
    title:       '사장',
    name:        '박상형',
    slideIndex:  6,
    color:       '#ffffff',
    canvasArea:  { top: '76%',   left: '69%',    width: '17%',   height: '10%' },
    summaryArea: { top: '78.1%', left: '50.9%',  width: '16.1%', height: '9.1%' },
  },
  {
    title:       '노조위원장',
    name:        '박종섭',
    slideIndex:  7,
    color:       '#ffffff',
    canvasArea:  { top: '76%',   left: '69%',    width: '17%',   height: '10%' },
    summaryArea: { top: '78.1%', left: '32.5%',  width: '16.1%', height: '9.1%' },
  },
  {
    title:       '부사장',
    name:        '김용호',
    slideIndex:  8,
    color:       '#ffffff',
    canvasArea:  { top: '76%',   left: '69%',    width: '17%',   height: '10%' },
    summaryArea: { top: '78.1%', left: '69.4%',  width: '16.1%', height: '9.1%' },
  },
  {
    title:       '본부장',
    name:        '정수옥',
    slideIndex:  9,
    color:       '#ffffff',
    canvasArea:  { top: '76%',   left: '69%',    width: '17%',   height: '10%' },
    summaryArea: { top: '78.1%', left: '14.5%',  width: '16.1%', height: '9.1%' },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function uploadImage(projectId, filename, buffer) {
  const ext = filename.split('.').pop().toLowerCase();
  const storedFilename = `${randomUUID()}.${ext}`;
  const path = `${projectId}/${storedFilename}`;

  const { error } = await supabase.storage
    .from(SLIDES_BUCKET)
    .upload(path, buffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });

  if (error) throw new Error(`Upload failed for ${filename}: ${error.message}`);

  const { data } = supabase.storage.from(SLIDES_BUCKET).getPublicUrl(path);
  return { storedFilename, url: data.publicUrl };
}

async function saveProjectData(storeData) {
  const buffer = Buffer.from(JSON.stringify(storeData, null, 2), 'utf8');
  const { error } = await supabase.storage
    .from(DATA_BUCKET)
    .upload('projects.json', buffer, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`Save projects.json failed: ${error.message}`);
}

async function saveSignaturesData() {
  const buffer = Buffer.from(JSON.stringify({}), 'utf8');
  const { error } = await supabase.storage
    .from(DATA_BUCKET)
    .upload('signatures.json', buffer, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`Save signatures.json failed: ${error.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== KDN Offline 마이그레이션 시작 ===\n');

  // 환경변수 체크
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ .env 파일에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정해주세요.');
    process.exit(1);
  }

  const projectId = randomUUID();
  console.log(`프로젝트 ID: ${projectId}`);
  console.log('');

  // 기존 데이터 확인
  const { data: existing } = await supabase.storage.from(DATA_BUCKET).download('projects.json');
  if (existing) {
    const text = await existing.text();
    try {
      const current = JSON.parse(text);
      if (current.projects?.length > 0) {
        console.log(`⚠️  이미 ${current.projects.length}개 프로젝트가 존재합니다.`);
        console.log('   계속하면 기존 데이터에 새 프로젝트가 추가됩니다.');
        console.log('');
      }
    } catch {}
  }

  // ── 슬라이드 업로드 ──────────────────────────────────────────────────────
  console.log(`슬라이드 ${SLIDE_FILES.length}개 업로드 중...`);
  const slides = [];

  for (let i = 0; i < SLIDE_FILES.length; i++) {
    const filename = SLIDE_FILES[i];
    const filepath = join(ROOT, 'static', 'img', filename);

    let buffer;
    try {
      buffer = await readFile(filepath);
    } catch {
      console.warn(`  ⚠️  ${filename} 파일 없음, 건너뜀`);
      slides.push(null);
      continue;
    }

    try {
      const { storedFilename, url } = await uploadImage(projectId, filename, buffer);
      slides.push({ id: randomUUID(), order: i, filename: storedFilename, url });
      console.log(`  ✓ [${i + 1}/${SLIDE_FILES.length}] ${filename}`);
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${SLIDE_FILES.length}] ${filename}: ${e.message}`);
      slides.push(null);
    }
  }

  const uploadedSlides = slides.filter(Boolean);
  console.log(`\n${uploadedSlides.length}개 업로드 완료\n`);

  if (uploadedSlides.length === 0) {
    console.error('❌ 업로드된 슬라이드가 없습니다. static/img/ 폴더를 확인해주세요.');
    process.exit(1);
  }

  // ── 서명자 구성 (slideIndex → slideId 매핑) ──────────────────────────────
  const summarySlide = slides[11];  // 6-1.jpg = index 11

  const signatories = SIGNATORIES_CONFIG.map((cfg, i) => {
    const assignedSlide = slides[cfg.slideIndex];
    return {
      id:          randomUUID(),
      order:       i + 1,
      title:       cfg.title,
      name:        cfg.name,
      color:       cfg.color,
      slideId:     assignedSlide?.id ?? null,
      canvasArea:  cfg.canvasArea,
      summaryArea: cfg.summaryArea,
    };
  });

  // ── 프로젝트 데이터 구성 ─────────────────────────────────────────────────
  const project = {
    id:             projectId,
    name:           '2025년 KDN 행사',
    createdAt:      new Date().toISOString(),
    summarySlideId: summarySlide?.id ?? null,
    slides:         uploadedSlides,
    signatories,
  };

  // 기존 데이터 로드 후 병합
  let storeData = { activeProjectId: projectId, projects: [] };
  if (existing) {
    const text = await existing.text();
    try {
      const current = JSON.parse(text);
      storeData.projects = current.projects ?? [];
      // 활성 프로젝트는 새 프로젝트로 설정
      storeData.activeProjectId = projectId;
    } catch {}
  }
  storeData.projects.push(project);

  // ── Supabase에 저장 ──────────────────────────────────────────────────────
  console.log('projects.json 저장 중...');
  await saveProjectData(storeData);
  console.log('  ✓ projects.json 저장됨');

  console.log('signatures.json 초기화 중...');
  await saveSignaturesData();
  console.log('  ✓ signatures.json 저장됨');

  // ── 결과 요약 ────────────────────────────────────────────────────────────
  console.log('\n=== 마이그레이션 완료 ===\n');
  console.log(`프로젝트명:  2025년 KDN 행사`);
  console.log(`프로젝트 ID: ${projectId}`);
  console.log(`슬라이드:    ${uploadedSlides.length}개`);
  console.log(`서명자:      ${signatories.length}명`);
  console.log(`종합 슬라이드: ${summarySlide ? '설정됨 (6-1.jpg)' : '없음 (파일 없음)'}`);
  console.log('');
  console.log('서명자 목록:');
  signatories.forEach(s => {
    const slide = uploadedSlides.find(sl => sl.id === s.slideId);
    const origIndex = slides.findIndex(sl => sl?.id === s.slideId);
    console.log(`  ${s.order}. ${s.title} — ${s.name} (슬라이드 ${origIndex + 1}: ${SLIDE_FILES[origIndex] ?? '미지정'})`);
  });
  console.log('');
  console.log('서버를 재시작하면 마이그레이션 데이터가 적용됩니다.');
}

main().catch(e => {
  console.error('\n❌ 오류:', e.message);
  process.exit(1);
});
