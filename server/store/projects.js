/**
 * 프로젝트 인메모리 스토어 (데이터 접근 레이어)
 *
 * - 다중 활성 프로젝트 모델 지원 (activeProjectIds: string[])
 * - 모든 변경은 Supabase(data 버킷)에 비동기 영속화 (fire-and-forget)
 * - 서버 시작 시 initProjectsStore()를 호출해야 한다
 */
import { randomUUID, randomBytes } from 'crypto';
import { loadData, saveData } from '../infra/supabase.js';

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {{ activeProjectIds: string[], projects: Project[] }} */
let store = { activeProjectIds: [], projects: [] };
let ready = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initProjectsStore() {
  try {
    const data = await loadData('projects.json');
    if (data) {
      // Migration: old format had activeProjectId (string|null)
      if ('activeProjectId' in data && !('activeProjectIds' in data)) {
        store = {
          activeProjectIds: [data.activeProjectId].filter(Boolean),
          projects: data.projects ?? [],
        };
      } else {
        store = data;
        if (!Array.isArray(store.activeProjectIds)) {
          store.activeProjectIds = [];
        }
      }
    }
    // Migration: 절대 URL → 상대경로 변환 (localhost:PORT/uploads/... → /uploads/...)
    let migrated = false;
    for (const p of store.projects) {
      if (!p.slideshow) { p.slideshow = { loop: false, autoPlay: false, autoPlaySec: 5, showSlideNumber: false, transition: 'none' }; migrated = true; }
      if (p.slideshow && p.slideshow.showSlideNumber === undefined) { p.slideshow.showSlideNumber = false; migrated = true; }
      // Migration: signEffect.transition → slideshow.transition
      if (p.slideshow && p.slideshow.transition === undefined) {
        p.slideshow.transition = p.signEffect?.transition ?? 'none';
        migrated = true;
      }
      if (!p.signEffect) { p.signEffect = defaultSignEffect(); migrated = true; }
      if (p.signEffect && p.signEffect.ambientStyle === undefined) { p.signEffect.ambientStyle = 'sparkle'; migrated = true; }
      if (p.signEffect && p.signEffect.ambientSpeed === undefined) { p.signEffect.ambientSpeed = 'normal'; migrated = true; }
      if (!p.videos) { p.videos = []; migrated = true; }
      // Migration: summarySlideId + summaryArea → displaySlides per-signatory
      for (const sig of (p.signatories ?? [])) {
        if (!sig.displaySlides) {
          sig.displaySlides = [];
          if (p.summarySlideId && sig.summaryArea) {
            sig.displaySlides = [{ slideId: p.summarySlideId, area: sig.summaryArea }];
          }
          delete sig.summaryArea;
          migrated = true;
        }
      }
      if ('summarySlideId' in p) { delete p.summarySlideId; migrated = true; }
      for (const s of (p.slides ?? [])) {
        if (s.url && /^https?:\/\/[^/]+\/uploads\//.test(s.url)) {
          s.url = s.url.replace(/^https?:\/\/[^/]+/, '');
          migrated = true;
        }
      }
    }
    if (migrated) persist();
  } catch (e) {
    console.error('[projects] init error:', e.message);
  }
  ready = true;
  console.log(`[projects] ready — ${store.projects.length} projects, active: ${store.activeProjectIds.join(', ') || 'none'}`);
}

export const isReady = () => ready;

/** 테스트 전용: 스토어 상태 초기화 */
export function _resetForTest(initial = { activeProjectIds: [], projects: [] }) {
  store = {
    activeProjectIds: initial.activeProjectIds ?? [],
    projects: initial.projects ?? [],
  };
  ready = true;
}

function persist() {
  saveData('projects.json', store).catch(e =>
    console.error('[projects] persist error:', e.message)
  );
}

function defaultSignEffect() {
  return {
    mode: 'realtime',
    completeSoundId: null,
    completeSoundVolume: 80,
    penParticle: false,
    penColor: '#c9a84c',
    penSize: 'medium',
    penDensity: 'normal',
    ambientParticle: false,
    ambientColor: '#c9a84c',
    ambientDensity: 'low',
    ambientStyle: 'sparkle',
    ambientSpeed: 'normal',
    sealEffect: false,
    sealColor: '#c9a84c',
    sealDuration: 6,
    transition: 'none',
    autoAdvance: false,
  };
}

// ── Active projects ───────────────────────────────────────────────────────────

export function getActiveProjects() {
  return store.projects.filter(p => store.activeProjectIds.includes(p.id));
}

export function isProjectActive(id) {
  return store.activeProjectIds.includes(id);
}

/**
 * 프로젝트를 활성화한다.
 * - 이미 활성 목록에 있으면 무시
 * - remoteToken이 없으면 생성
 */
export function activateProject(id) {
  const project = getProject(id);
  if (!project) return null;

  // Generate remoteToken if not yet assigned
  if (!project.remoteToken) {
    project.remoteToken = randomBytes(8).toString('hex');
  }

  if (!store.activeProjectIds.includes(id)) {
    store.activeProjectIds.push(id);
  }

  persist();
  return project;
}

/**
 * 프로젝트를 비활성화한다.
 */
export function deactivateProject(id) {
  const before = store.activeProjectIds.length;
  store.activeProjectIds = store.activeProjectIds.filter(pid => pid !== id);
  if (store.activeProjectIds.length !== before) {
    persist();
  }
}

// ── Projects CRUD ─────────────────────────────────────────────────────────────

export const getProjects = () => store.projects;

export const getProject  = (id) => store.projects.find(p => p.id === id) ?? null;

export function createProject(name) {
  const project = {
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    slides: [],
    signatories: [],
    videos: [],
    pin: '',
    remoteToken: '',
    slideshow: { loop: false, autoPlay: false, autoPlaySec: 5, showSlideNumber: false, transition: 'none' },
    signEffect: defaultSignEffect(),
  };
  store.projects.push(project);
  persist();
  return project;
}

export function updateProject(id, updates) {
  const project = getProject(id);
  if (!project) return null;
  for (const key of ['name', 'signatories', 'slides', 'pin', 'slideshow', 'signEffect']) {
    if (key in updates) project[key] = updates[key];
  }
  persist();
  return project;
}

export function updateProjectPin(id, pin) {
  const project = getProject(id);
  if (!project) return null;
  project.pin = pin ?? '';
  persist();
  return project;
}

export function deleteProject(id) {
  const idx = store.projects.findIndex(p => p.id === id);
  if (idx === -1) return false;
  store.projects.splice(idx, 1);
  // Also deactivate
  store.activeProjectIds = store.activeProjectIds.filter(pid => pid !== id);
  persist();
  return true;
}

export function duplicateProject(id) {
  const src = getProject(id);
  if (!src) return null;
  const copy = {
    ...JSON.parse(JSON.stringify(src)),
    id: randomUUID(),
    name: `${src.name} (복사본)`,
    createdAt: new Date().toISOString(),
    pin: '',
    remoteToken: '',
    // 서명자 ID만 새로 발급, 슬라이드 URL은 공유
    signatories: src.signatories.map(s => ({ ...s, id: randomUUID() })),
    videos: (src.videos ?? []).map(v => ({ ...v, id: randomUUID() })),
  };
  store.projects.push(copy);
  persist();
  return copy;
}

// ── Slides ────────────────────────────────────────────────────────────────────

export function addSlide(projectId, { filename, url, originalFilename }) {
  const project = getProject(projectId);
  if (!project) return null;
  const slide = { id: randomUUID(), order: project.slides.length, filename, originalFilename: originalFilename || filename, url };
  project.slides.push(slide);
  persist();
  return slide;
}

export function reorderSlides(projectId, orderedIds) {
  const project = getProject(projectId);
  if (!project) return null;
  const map = Object.fromEntries(project.slides.map(s => [s.id, s]));
  project.slides = orderedIds
    .filter(id => map[id])
    .map((id, i) => ({ ...map[id], order: i }));
  persist();
  return project.slides;
}

export function removeSlide(projectId, slideId) {
  const project = getProject(projectId);
  if (!project) return false;
  const before = project.slides.length;
  project.slides = project.slides
    .filter(s => s.id !== slideId)
    .map((s, i) => ({ ...s, order: i }));
  if (project.slides.length === before) return false;
  // displaySlides에서 해당 slideId 제거
  for (const sig of (project.signatories ?? [])) {
    if (sig.displaySlides?.some(d => d.slideId === slideId)) {
      sig.displaySlides = sig.displaySlides.filter(d => d.slideId !== slideId);
    }
  }
  persist();
  return true;
}

// ── Signatories ───────────────────────────────────────────────────────────────

export function updateSignatories(projectId, signatories) {
  const project = getProject(projectId);
  if (!project) return null;
  project.signatories = signatories.map((s, i) => ({
    id:           s.id || randomUUID(),
    order:        i + 1,
    title:        s.title        || '',
    name:         s.name         || '',
    color:        s.color        || '#ffffff',
    slideId:      s.slideId      || null,
    canvasArea:   s.canvasArea   || null,
    displaySlides: Array.isArray(s.displaySlides) ? s.displaySlides : [],
    videoId:      s.videoId      || null,
    bgmId:        s.bgmId        || null,
  }));
  persist();
  return project.signatories;
}

// ── Project Videos ─────────────────────────────────────────────────────────────

export function getProjectVideos(projectId) {
  const project = getProject(projectId);
  if (!project) return [];
  return project.videos ?? [];
}

export function addProjectVideo(projectId, { filename, url, originalFilename, signatoryId = null }) {
  const project = getProject(projectId);
  if (!project) return null;
  if (!project.videos) project.videos = [];
  const video = {
    id: randomUUID(),
    filename,
    originalFilename: originalFilename || filename,
    url,
    signatoryId,
    createdAt: new Date().toISOString(),
  };
  project.videos.push(video);
  persist();
  return video;
}

export function deleteProjectVideo(projectId, videoId) {
  const project = getProject(projectId);
  if (!project || !project.videos) return false;
  const before = project.videos.length;
  project.videos = project.videos.filter(v => v.id !== videoId);
  if (project.videos.length === before) return false;
  // also clear signatoryId references
  for (const sig of (project.signatories ?? [])) {
    if (sig.videoId === videoId) sig.videoId = null;
  }
  persist();
  return true;
}

export function updateProjectVideoSignatory(projectId, videoId, signatoryId) {
  const project = getProject(projectId);
  if (!project?.videos) return null;
  const video = project.videos.find(v => v.id === videoId);
  if (!video) return null;
  video.signatoryId = signatoryId ?? null;
  persist();
  return video;
}
