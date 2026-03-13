/**
 * Supabase 어댑터 (인프라 레이어)
 *
 * - 이미지: Supabase Storage (slides 버킷)
 * - 데이터: Supabase PostgreSQL DB (projects, slides, signatories, active_projects, signatures 테이블)
 *
 * store/ 레이어와 동일한 loadData/saveData 인터페이스를 유지한다.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SLIDES_BUCKET = 'slides';

// ── Slide images (Supabase Storage — public bucket) ──────────────────────────

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

// ── Media files (Supabase Storage — media bucket) ────────────────────────────

const MEDIA_BUCKET = 'media';

export async function uploadMediaFile(originalFilename, buffer, contentType) {
  const ext = originalFilename.split('.').pop().toLowerCase() || 'bin';
  const filename = `${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(filename, buffer, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(filename);
  return { filename, url: data.publicUrl };
}

export async function deleteMediaFile(filename) {
  await supabase.storage.from(MEDIA_BUCKET).remove([filename]);
}

// ── Data: loadData (DB → 인메모리 JSON 구조로 변환) ──────────────────────────

export async function loadData(filename) {
  if (filename === 'projects.json') return loadProjectsFromDB();
  if (filename === 'signatures.json') return loadSignaturesFromDB();
  return null;
}

async function loadProjectsFromDB() {
  const [
    { data: projects },
    { data: allSlides },
    { data: allSignatories },
    { data: activeRows },
  ] = await Promise.all([
    supabase.from('projects').select('*'),
    supabase.from('slides').select('*').order('sort_order'),
    supabase.from('signatories').select('*').order('sort_order'),
    supabase.from('active_projects').select('project_id'),
  ]);

  if (!projects) return null;

  // 프로젝트별로 슬라이드/서명자 그룹핑
  const slidesMap = {};
  for (const s of (allSlides ?? [])) {
    (slidesMap[s.project_id] ??= []).push({
      id: s.id,
      order: s.sort_order,
      filename: s.filename,
      url: s.url,
      originalFilename: s.original_filename,
    });
  }

  const sigMap = {};
  for (const s of (allSignatories ?? [])) {
    (sigMap[s.project_id] ??= []).push({
      id: s.id,
      order: s.sort_order,
      title: s.title ?? '',
      name: s.name ?? '',
      color: s.color ?? '#ffffff',
      slideId: s.slide_id,
      canvasArea: s.canvas_area,
      summaryArea: s.summary_area,
      videoId: s.video_id ?? null,
    });
  }

  return {
    activeProjectIds: (activeRows ?? []).map(r => r.project_id),
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      summarySlideId: p.summary_slide_id,
      pin: p.pin ?? '',
      remoteToken: p.remote_token ?? '',
      slideshow: p.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5 },
      signEffect: p.sign_effect ?? null,
      slides: slidesMap[p.id] ?? [],
      signatories: sigMap[p.id] ?? [],
    })),
  };
}

async function loadSignaturesFromDB() {
  const { data } = await supabase.from('signatures').select('*');
  if (!data) return {};

  const result = {};
  for (const row of data) {
    (result[row.project_id] ??= {})[row.sign_id] = row.data_url;
  }
  return result;
}

// ── Data: saveData (인메모리 JSON → DB 동기화) ───────────────────────────────

export async function saveData(filename, obj) {
  if (filename === 'projects.json') return saveProjectsToDB(obj);
  if (filename === 'signatures.json') return saveSignaturesToDB(obj);
}

async function saveProjectsToDB(store) {
  const { activeProjectIds = [], projects = [] } = store;

  // 1. 현재 DB에 있는 프로젝트 ID 조회
  const { data: existing } = await supabase.from('projects').select('id');
  const existingIds = new Set((existing ?? []).map(p => p.id));
  const currentIds = new Set(projects.map(p => p.id));

  // 2. 삭제된 프로젝트 제거 (CASCADE로 slides/signatories도 삭제)
  const toDelete = [...existingIds].filter(id => !currentIds.has(id));
  if (toDelete.length) {
    await supabase.from('projects').delete().in('id', toDelete);
  }

  // 3. 프로젝트 upsert
  if (projects.length) {
    await supabase.from('projects').upsert(
      projects.map(p => ({
        id: p.id,
        name: p.name,
        created_at: p.createdAt,
        summary_slide_id: p.summarySlideId,
        pin: p.pin ?? '',
        remote_token: p.remoteToken ?? '',
        slideshow: p.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5 },
        sign_effect: p.signEffect ?? null,
      }))
    );
  }

  // 4. 슬라이드 동기화 (프로젝트별 delete + insert)
  for (const p of projects) {
    await supabase.from('slides').delete().eq('project_id', p.id);
    if (p.slides?.length) {
      await supabase.from('slides').insert(
        p.slides.map(s => ({
          id: s.id,
          project_id: p.id,
          sort_order: s.order,
          filename: s.filename,
          url: s.url,
          original_filename: s.originalFilename ?? null,
        }))
      );
    }
  }

  // 5. 서명자 동기화 (프로젝트별 delete + insert)
  for (const p of projects) {
    await supabase.from('signatories').delete().eq('project_id', p.id);
    if (p.signatories?.length) {
      await supabase.from('signatories').insert(
        p.signatories.map(s => ({
          id: s.id,
          project_id: p.id,
          sort_order: s.order,
          title: s.title ?? '',
          name: s.name ?? '',
          color: s.color ?? '#ffffff',
          slide_id: s.slideId ?? null,
          canvas_area: s.canvasArea ?? null,
          summary_area: s.summaryArea ?? null,
          video_id: s.videoId ?? null,
        }))
      );
    }
  }

  // 6. 활성 프로젝트 동기화
  await supabase.from('active_projects').delete().not('project_id', 'is', null);
  if (activeProjectIds.length) {
    await supabase.from('active_projects').insert(
      activeProjectIds.map(id => ({ project_id: id }))
    );
  }
}

async function saveSignaturesToDB(store) {
  // 전체 삭제 후 재삽입
  await supabase.from('signatures').delete().not('project_id', 'is', null);

  const rows = [];
  for (const [projectId, signs] of Object.entries(store)) {
    for (const [signId, dataUrl] of Object.entries(signs)) {
      if (dataUrl) rows.push({ project_id: projectId, sign_id: signId, data_url: dataUrl });
    }
  }

  if (rows.length) {
    // Supabase insert 1000행 제한 → 배치 분할
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from('signatures').insert(rows.slice(i, i + 500));
    }
  }
}
