/**
 * 로컬 파일 시스템 스토리지 어댑터 (개발 환경)
 *
 * Supabase 어댑터와 동일한 인터페이스를 구현한다.
 * SUPABASE_URL 환경변수가 없을 때 자동으로 선택된다.
 *
 * 저장 경로:
 *   data/  ← projects.json, signatures.json
 *   uploads/{projectId}/  ← 슬라이드 이미지
 *
 * 이미지 URL: http://localhost:{PORT}/uploads/{projectId}/{filename}
 * (ws-dev.js가 /uploads 경로를 정적 파일로 서빙)
 */
import { readFile, writeFile, mkdir, unlink, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR   = join(ROOT, 'data');
const UPLOAD_DIR = join(ROOT, 'uploads');

const DEV_PORT   = process.env.PORT ?? '8765';
const DEV_HOST   = process.env.LOCAL_HOST ?? `http://localhost:${DEV_PORT}`;

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

// ── Slide images ──────────────────────────────────────────────────────────────

export async function uploadSlideImage(projectId, originalFilename, buffer, contentType) {
  const ext = contentType === 'image/webp' ? 'webp'
    : contentType === 'image/jpeg' ? 'jpg'
    : originalFilename.split('.').pop().toLowerCase() || 'webp';

  const filename = `${randomUUID()}.${ext}`;
  const dir      = join(UPLOAD_DIR, projectId);
  await ensureDir(dir);
  await writeFile(join(dir, filename), buffer);

  const url = `${DEV_HOST}/uploads/${projectId}/${filename}`;
  return { filename, url };
}

export async function deleteSlideImage(projectId, filename) {
  const filepath = join(UPLOAD_DIR, projectId, filename);
  if (existsSync(filepath)) await unlink(filepath).catch(() => {});
}

export async function deleteProjectImages(projectId) {
  const dir = join(UPLOAD_DIR, projectId);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true }).catch(() => {});
}

// ── Data files ────────────────────────────────────────────────────────────────

export async function loadData(filename) {
  await ensureDir(DATA_DIR);
  const filepath = join(DATA_DIR, filename);
  try {
    const text = await readFile(filepath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveData(filename, obj) {
  await ensureDir(DATA_DIR);
  await writeFile(join(DATA_DIR, filename), JSON.stringify(obj, null, 2), 'utf8');
}
