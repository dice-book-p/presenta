/**
 * 스토리지 어댑터 선택기 (인프라 레이어)
 *
 * SUPABASE_URL 환경변수 존재 여부에 따라 어댑터를 자동 선택한다.
 *   - SUPABASE_URL 있음 → Supabase Storage (프로덕션 / 원격 개발)
 *   - SUPABASE_URL 없음 → 로컬 파일 시스템 (오프라인 / 빠른 개발)
 *
 * store/ 레이어는 이 파일만 import하며 어댑터 종류를 알 필요 없다.
 */

let adapter;

if (process.env.SUPABASE_URL) {
  adapter = await import('./supabase-adapter.js');
  console.log('[storage] using Supabase (DB + Storage)');
} else if (process.env.NODE_ENV === 'production') {
  console.error('[storage] FATAL: SUPABASE_URL is required in production');
  process.exit(1);
} else {
  adapter = await import('./local-storage.js');
  console.log('[storage] using local filesystem (data/ & uploads/)');
}

export const uploadSlideImage   = adapter.uploadSlideImage;
export const deleteSlideImage   = adapter.deleteSlideImage;
export const deleteProjectImages = adapter.deleteProjectImages;
export const loadData           = adapter.loadData;
export const saveData           = adapter.saveData;
