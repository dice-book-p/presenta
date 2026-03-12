import { randomUUID } from 'crypto';
import { loadData, saveData } from './supabase.js';

// ── State ─────────────────────────────────────────────────────────────────────

let store = { activeProjectId: null, projects: [] };
let ready = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initProjectsStore() {
  try {
    const data = await loadData('projects.json');
    if (data) store = data;
  } catch (e) {
    console.error('[projects] init error:', e.message);
  }
  ready = true;
  console.log(`[projects] ready — ${store.projects.length} projects, active: ${store.activeProjectId}`);
}

export function isReady() {
  return ready;
}

function persist() {
  saveData('projects.json', store).catch(e =>
    console.error('[projects] persist error:', e.message)
  );
}

// ── Active project ────────────────────────────────────────────────────────────

export function getActiveProject() {
  if (!store.activeProjectId) return null;
  return store.projects.find(p => p.id === store.activeProjectId) ?? null;
}

export function setActiveProject(projectId) {
  store.activeProjectId = projectId ?? null;
  persist();
  return getActiveProject();
}

// ── Projects CRUD ─────────────────────────────────────────────────────────────

export function getProjects() {
  return store.projects;
}

export function getProject(id) {
  return store.projects.find(p => p.id === id) ?? null;
}

export function createProject(name) {
  const project = {
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    summarySlideId: null,
    slides: [],
    signatories: [],
  };
  store.projects.push(project);
  persist();
  return project;
}

export function updateProject(id, updates) {
  const project = getProject(id);
  if (!project) return null;
  const allowed = ['name', 'summarySlideId', 'signatories', 'slides'];
  for (const key of allowed) {
    if (key in updates) project[key] = updates[key];
  }
  persist();
  return project;
}

export function deleteProject(id) {
  const idx = store.projects.findIndex(p => p.id === id);
  if (idx === -1) return false;
  store.projects.splice(idx, 1);
  if (store.activeProjectId === id) store.activeProjectId = null;
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
    signatories: src.signatories.map(s => ({ ...s, id: randomUUID() })),
    // slides share same Supabase URLs (no re-upload)
  };
  store.projects.push(copy);
  persist();
  return copy;
}

// ── Slides ────────────────────────────────────────────────────────────────────

export function addSlide(projectId, { filename, url }) {
  const project = getProject(projectId);
  if (!project) return null;
  const slide = { id: randomUUID(), order: project.slides.length, filename, url };
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
  // Clear summarySlideId if removed
  if (project.summarySlideId === slideId) project.summarySlideId = null;
  persist();
  return true;
}

// ── Signatories ───────────────────────────────────────────────────────────────

export function updateSignatories(projectId, signatories) {
  const project = getProject(projectId);
  if (!project) return null;
  project.signatories = signatories.map((s, i) => ({
    id: s.id || randomUUID(),
    order: i + 1,
    title: s.title || '',
    name: s.name || '',
    color: s.color || '#ffffff',
    slideId: s.slideId || null,
    canvasArea: s.canvasArea || null,
    summaryArea: s.summaryArea || null,
  }));
  persist();
  return project.signatories;
}
