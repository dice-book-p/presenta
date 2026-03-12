/**
 * Supabase 스토리지 어댑터 (인프라 레이어)
 *
 * 외부 서비스(Supabase)와의 모든 통신을 여기에서 캡슐화한다.
 * 비즈니스 로직(store/)은 이 모듈에만 의존하며, Supabase SDK를 직접 import하지 않는다.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SLIDES_BUCKET = 'slides';
const DATA_BUCKET   = 'data';

// ── Slide images (public bucket) ──────────────────────────────────────────────

export async function uploadSlideImage(projectId, originalFilename, buffer, contentType) {
  const ext = originalFilename.split('.').pop().toLowerCase() || 'webp';
  const filename = `${randomUUID()}.${ext}`;
  const path = `${projectId}/${filename}`;

  const { error } = await supabase.storage
    .from(SLIDES_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(SLIDES_BUCKET).getPublicUrl(path);
  return { filename, url: data.publicUrl };
}

export async function deleteSlideImage(projectId, filename) {
  await supabase.storage.from(SLIDES_BUCKET).remove([`${projectId}/${filename}`]);
}

export async function deleteProjectImages(projectId) {
  const { data } = await supabase.storage.from(SLIDES_BUCKET).list(projectId);
  if (data?.length) {
    await supabase.storage
      .from(SLIDES_BUCKET)
      .remove(data.map(f => `${projectId}/${f.name}`));
  }
}

// ── Data files (private bucket) ───────────────────────────────────────────────

export async function loadData(filename) {
  const { data, error } = await supabase.storage.from(DATA_BUCKET).download(filename);
  if (error) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

export async function saveData(filename, obj) {
  const buffer = Buffer.from(JSON.stringify(obj), 'utf8');
  const { error } = await supabase.storage
    .from(DATA_BUCKET)
    .upload(filename, buffer, { contentType: 'application/json', upsert: true });
  if (error) throw new Error(error.message);
}
