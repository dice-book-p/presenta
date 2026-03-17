/**
 * REST API 라우터 (HTTP 레이어)
 *
 * ROUTE TABLE 패턴을 사용한다:
 *   [method, urlPattern, requiresAuth, handler]
 *
 * 각 핸들러는 { req, res, params, url } 을 받으며 단일 책임을 가진다.
 * 인증, 라우팅, 직렬화는 미들웨어가 처리하므로 핸들러는 비즈니스 로직만 담는다.
 */
import Busboy from 'busboy';
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  duplicateProject, addSlide, reorderSlides, removeSlide, updateSignatories,
  getActiveProjects, activateProject, deactivateProject, isProjectActive,
  updateProjectPin, isReady,
  getProjectVideos, addProjectVideo, deleteProjectVideo, updateProjectVideoSignatory,
} from '../store/projects.js';
import {
  getSignatures, saveSignature, clearSignatures, clearOneSignature,
} from '../store/signatures.js';
import {
  getConnectionStatus, forceDisconnect, forceDisconnectAll,
  broadcastAll, broadcastActiveChanged, sendToMain, deletePool,
} from '../ws/connections.js';
import {
  uploadSlideImage, deleteSlideImage, deleteProjectImages,
  uploadMediaFile, deleteMediaFile,
} from '../infra/supabase.js';
import {
  getMediaItems, getMediaItem, addMediaItem, deleteMediaItem,
} from '../store/media.js';
import {
  MAX_SLIDE_BYTES, MAX_AUDIO_BYTES, MAX_VIDEO_BYTES,
  ALLOWED_AUDIO_TYPES, ALLOWED_VIDEO_TYPES,
} from '../config.js';
import { checkAuth, json, readBody, match, unauth, notFound } from './middleware.js';

// ── PIN rate limit ───────────────────────────────────────────────────────────
const pinAttempts = new Map(); // ip → { count, lockedUntil }
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 60_000;

function checkPinRateLimit(ip) {
  const now = Date.now();
  // sweep expired entries
  for (const [key, val] of pinAttempts) {
    if (val.lockedUntil && now > val.lockedUntil) pinAttempts.delete(key);
  }
  const entry = pinAttempts.get(ip);
  if (entry?.lockedUntil && now < entry.lockedUntil) return false;
  return true;
}

function recordPinFailure(ip) {
  const entry = pinAttempts.get(ip) ?? { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= PIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + PIN_LOCK_MS;
    entry.count = 0;
  }
  pinAttempts.set(ip, entry);
}

function clearPinAttempts(ip) {
  pinAttempts.delete(ip);
}

// ── Active projects ───────────────────────────────────────────────────────────

/** pin/remoteToken 등 민감 필드를 제거한 공개용 프로젝트 객체 */
function publicProject(p) {
  if (!p) return null;
  const { pin, remoteToken, ...safe } = p;
  return { ...safe, hasPin: !!pin };
}

async function getActive({ res }) {
  json(res, 200, getActiveProjects().map(publicProject));
}

async function setActive({ req, res }) {
  const { projectId, active } = await readBody(req);

  if (!projectId) {
    json(res, 400, { error: 'projectId required' });
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    notFound(res);
    return;
  }

  let updatedProject;
  if (active === false) {
    deactivateProject(projectId);
    updatedProject = null;
  } else {
    updatedProject = activateProject(projectId);
  }

  broadcastActiveChanged({ type: 'active_changed', project: updatedProject ?? null, projectId, active: active !== false });
  json(res, 200, { ok: true, project: updatedProject ?? null });
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function listProjects({ res }) {
  json(res, 200, getProjects().map(publicProject));
}

async function createProjectHandler({ req, res }) {
  const { name } = await readBody(req);
  if (!name?.trim()) { json(res, 400, { error: 'name required' }); return; }
  json(res, 201, createProject(name.trim()));
}

async function getProjectHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 200, publicProject(project));
}

async function updateProjectHandler({ req, res, params }) {
  const body = await readBody(req);
  if (body.signatories !== undefined) {
    updateSignatories(params.id, body.signatories);
    delete body.signatories;
  }
  // Handle pin field via dedicated function for clarity, but updateProject also supports it
  const project = updateProject(params.id, body);
  if (!project) { notFound(res); return; }
  json(res, 200, project);
}

async function deleteProjectHandler({ res, params }) {
  if (!getProject(params.id)) { notFound(res); return; }
  deleteProjectImages(params.id).catch(e =>
    console.error('[storage] delete error:', e.message)
  );
  clearSignatures(params.id);
  deletePool(params.id);
  deleteProject(params.id);
  json(res, 200, { ok: true });
}

async function duplicateProjectHandler({ res, params }) {
  const project = duplicateProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 201, project);
}

// ── Pin ───────────────────────────────────────────────────────────────────────

async function updatePinHandler({ req, res, params }) {
  const { pin } = await readBody(req);
  if (pin === undefined) { json(res, 400, { error: 'pin required' }); return; }
  const project = updateProjectPin(params.id, pin);
  if (!project) { notFound(res); return; }
  json(res, 200, { ok: true });
}

/** POST /api/projects/:id/verify-pin — 프로젝트 PIN 검증 (공개) */
async function verifyPinHandler({ req, res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  if (!project.pin) { json(res, 200, { ok: true }); return; }

  const ip = req.socket?.remoteAddress ?? 'unknown';
  if (!checkPinRateLimit(ip)) {
    json(res, 429, { ok: false, error: '너무 많은 시도입니다. 잠시 후 다시 시도해주세요' });
    return;
  }

  const { pin } = await readBody(req);
  if (pin === project.pin) {
    clearPinAttempts(ip);
    json(res, 200, { ok: true });
  } else {
    recordPinFailure(ip);
    json(res, 401, { ok: false, error: 'PIN이 올바르지 않습니다' });
  }
}

// ── Remote token ──────────────────────────────────────────────────────────────

async function getRemoteTokenHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 200, { token: project.remoteToken ?? null });
}

// ── Slides ────────────────────────────────────────────────────────────────────

async function uploadSlideHandler({ req, res, params }) {
  if (!getProject(params.id)) { notFound(res); return; }

  let uploaded = null;
  let tooLarge = false;

  await new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_SLIDE_BYTES }, defParamCharset: 'utf8' });
    busboy.on('file', (_field, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; stream.resume(); });
      stream.on('end',  () => {
        if (!tooLarge) {
          uploaded = { buffer: Buffer.concat(chunks), filename: info.filename, contentType: info.mimeType };
        }
      });
    });
    busboy.on('close', resolve);
    busboy.on('error', (e) => reject(e));
    req.pipe(busboy);
  });

  if (tooLarge)   { json(res, 413, { error: '파일 크기 초과 (최대 10MB)' }); return; }
  if (!uploaded)  { json(res, 400, { error: '파일 없음' }); return; }

  try {
    const { filename, url } = await uploadSlideImage(
      params.id, uploaded.filename, uploaded.buffer, uploaded.contentType
    );
    json(res, 201, addSlide(params.id, { filename, url, originalFilename: uploaded.filename }));
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function reorderSlidesHandler({ req, res, params }) {
  const { orderedIds } = await readBody(req);
  const slides = reorderSlides(params.id, orderedIds);
  if (!slides) { notFound(res); return; }
  json(res, 200, slides);
}

async function clearAllSlidesHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  for (const slide of project.slides) {
    await deleteSlideImage(params.id, slide.filename).catch(e =>
      console.error('[storage] delete error:', e.message)
    );
  }
  updateProject(params.id, { slides: [], summarySlideId: null });
  json(res, 200, { ok: true });
}

async function deleteSlideHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  const slide = project.slides.find(s => s.id === params.slideId);
  if (!slide) { notFound(res); return; }
  await deleteSlideImage(params.id, slide.filename).catch(e =>
    console.error('[storage] delete error:', e.message)
  );
  removeSlide(params.id, params.slideId);
  json(res, 200, { ok: true });
}

// ── Signatures ────────────────────────────────────────────────────────────────

async function getSignaturesHandler({ res, params }) {
  json(res, 200, getSignatures(params.id));
}

async function saveSignatureHandler({ req, res, params }) {
  const { signId, dataUrl } = await readBody(req);
  if (signId && dataUrl) saveSignature(params.id, signId, dataUrl);
  json(res, 200, { ok: true });
}

async function clearSignaturesHandler({ res, params }) {
  clearSignatures(params.id);
  // display에 전체 초기화 알림
  sendToMain(params.id, { type: 'signatures_cleared', signId: null });
  json(res, 200, { ok: true });
}

async function clearOneSignatureHandler({ res, params }) {
  clearOneSignature(params.id, params.signId);
  // display에 개별 초기화 알림
  sendToMain(params.id, { type: 'signatures_cleared', signId: params.signId });
  json(res, 200, { ok: true });
}

// ── Connections / admin ───────────────────────────────────────────────────────

/** GET /api/status — 전체 활성 프로젝트 상태 (하위 호환) */
async function getGlobalStatusHandler({ res }) {
  const active = getActiveProjects();
  const statuses = Object.fromEntries(
    active.map(p => [p.id, getConnectionStatus(p.id)])
  );
  json(res, 200, statuses);
}

/** GET /api/projects/:id/status */
async function getProjectStatusHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 200, getConnectionStatus(params.id));
}

/** POST /api/disconnect/:id */
async function disconnectHandler({ req, res, params }) {
  const { target } = await readBody(req);
  if (target === 'all') forceDisconnectAll(params.id);
  else if (target) forceDisconnect(params.id, target);
  json(res, 200, { ok: true });
}

// ── Media ─────────────────────────────────────────────────────────────────

async function listMediaHandler({ res, url }) {
  const typeFilter = url.searchParams.get('type') || null;
  json(res, 200, getMediaItems(typeFilter));
}

async function uploadMediaHandler({ req, res }) {
  let uploaded = null;
  let tooLarge = false;

  await new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_VIDEO_BYTES }, defParamCharset: 'utf8' });
    busboy.on('file', (_field, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; stream.resume(); });
      stream.on('end', () => {
        if (!tooLarge) {
          uploaded = { buffer: Buffer.concat(chunks), filename: info.filename, contentType: info.mimeType };
        }
      });
    });
    busboy.on('close', resolve);
    busboy.on('error', (e) => reject(e));
    req.pipe(busboy);
  });

  if (!uploaded) { json(res, 400, { error: '파일 없음' }); return; }

  const isAudio = ALLOWED_AUDIO_TYPES.has(uploaded.contentType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(uploaded.contentType);

  if (!isAudio && !isVideo) {
    json(res, 400, { error: '지원하지 않는 파일 형식입니다' });
    return;
  }

  const maxBytes = isAudio ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
  if (tooLarge || uploaded.buffer.length > maxBytes) {
    json(res, 413, { error: `파일 크기 초과 (최대 ${isAudio ? '5' : '20'}MB)` });
    return;
  }

  try {
    const { filename, url } = await uploadMediaFile(uploaded.filename, uploaded.buffer, uploaded.contentType);
    const item = addMediaItem({
      type: isAudio ? 'audio' : 'video',
      filename,
      originalFilename: uploaded.filename,
      url,
      mimeType: uploaded.contentType,
      size: uploaded.buffer.length,
    });
    json(res, 201, item);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function deleteMediaHandler({ res, params }) {
  const item = getMediaItem(params.mediaId);
  if (!item) { notFound(res); return; }
  deleteMediaFile(item.filename).catch(e =>
    console.error('[api] deleteMediaFile:', e.message)
  );
  deleteMediaItem(params.mediaId);
  json(res, 200, { ok: true });
}

// ── Project Videos ─────────────────────────────────────────────────────────────

async function listProjectVideosHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 200, getProjectVideos(params.id));
}

async function uploadProjectVideoHandler({ req, res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }

  let uploaded = null;
  let tooLarge = false;

  await new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_VIDEO_BYTES }, defParamCharset: 'utf8' });
    busboy.on('file', (_field, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('limit', () => { tooLarge = true; stream.resume(); });
      stream.on('end', () => { if (!tooLarge) uploaded = { buffer: Buffer.concat(chunks), filename: info.filename, contentType: info.mimeType }; });
    });
    busboy.on('close', resolve);
    busboy.on('error', (e) => reject(e));
    req.pipe(busboy);
  });

  if (!uploaded) { json(res, 400, { error: '파일 없음' }); return; }
  if (!ALLOWED_VIDEO_TYPES.has(uploaded.contentType)) { json(res, 400, { error: '지원하지 않는 형식' }); return; }
  if (tooLarge || uploaded.buffer.length > MAX_VIDEO_BYTES) { json(res, 413, { error: '파일 크기 초과 (최대 20MB)' }); return; }

  try {
    const { filename, url } = await uploadMediaFile(uploaded.filename, uploaded.buffer, uploaded.contentType);
    const video = addProjectVideo(params.id, { filename, url, originalFilename: uploaded.filename });
    json(res, 201, video);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}

async function deleteProjectVideoHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  const videos = getProjectVideos(params.id);
  const video = videos.find(v => v.id === params.videoId);
  if (!video) { notFound(res); return; }
  deleteMediaFile(video.filename).catch(e => console.error('[api] deleteMediaFile:', e.message));
  deleteProjectVideo(params.id, params.videoId);
  json(res, 200, { ok: true });
}

async function updateProjectVideoSignatoryHandler({ req, res, params }) {
  const body = await readBody(req);
  const video = updateProjectVideoSignatory(params.id, params.videoId, body.signatoryId ?? null);
  if (!video) { notFound(res); return; }
  json(res, 200, video);
}

// ── Route table ───────────────────────────────────────────────────────────────
// [HTTP method, URL pattern, requiresAuth, handler]

const ROUTES = [
  // Active projects
  ['GET',    '/api/active',                              false, getActive],
  ['POST',   '/api/active',                              true,  setActive],

  // Projects
  ['GET',    '/api/projects',                            false, listProjects],
  ['POST',   '/api/projects',                            true,  createProjectHandler],
  ['GET',    '/api/projects/:id',                        false, getProjectHandler],
  ['PUT',    '/api/projects/:id',                        true,  updateProjectHandler],
  ['DELETE', '/api/projects/:id',                        true,  deleteProjectHandler],
  ['POST',   '/api/projects/:id/duplicate',              true,  duplicateProjectHandler],

  // Per-project PIN and remote token
  ['POST',   '/api/projects/:id/verify-pin',             false, verifyPinHandler],
  ['PUT',    '/api/projects/:id/pin',                    true,  updatePinHandler],
  ['GET',    '/api/projects/:id/remote-token',           true,  getRemoteTokenHandler],

  // Per-project connection status and disconnect
  ['GET',    '/api/projects/:id/status',                 false, getProjectStatusHandler],
  ['POST',   '/api/disconnect/:id',                      true,  disconnectHandler],

  // Slides (reorder must come before :slideId to avoid ambiguity)
  ['POST',   '/api/projects/:id/slides',                 true,  uploadSlideHandler],
  ['PUT',    '/api/projects/:id/slides/reorder',         true,  reorderSlidesHandler],
  ['DELETE', '/api/projects/:id/slides',                 true,  clearAllSlidesHandler],
  ['DELETE', '/api/projects/:id/slides/:slideId',        true,  deleteSlideHandler],

  // Signatures
  ['GET',    '/api/projects/:id/signatures',             false, getSignaturesHandler],
  ['POST',   '/api/projects/:id/signatures',             false, saveSignatureHandler],
  ['DELETE', '/api/projects/:id/signatures',             true,  clearSignaturesHandler],
  ['DELETE', '/api/projects/:id/signatures/:signId',     true,  clearOneSignatureHandler],

  // Project videos
  ['GET',    '/api/projects/:id/videos',                        false, listProjectVideosHandler],
  ['POST',   '/api/projects/:id/videos',                        true,  uploadProjectVideoHandler],
  ['DELETE', '/api/projects/:id/videos/:videoId',               true,  deleteProjectVideoHandler],
  ['PUT',    '/api/projects/:id/videos/:videoId/signatory',     true,  updateProjectVideoSignatoryHandler],

  // Media library
  ['GET',    '/api/media',                               true,  listMediaHandler],
  ['POST',   '/api/media',                               true,  uploadMediaHandler],
  ['DELETE', '/api/media/:mediaId',                      true,  deleteMediaHandler],

  // Auth ping (PIN 검증용)
  ['GET',    '/api/me',                                  true,  ({ res }) => json(res, 200, { ok: true })],

  // Global status (하위 호환)
  ['GET',    '/api/status',                              false, getGlobalStatusHandler],
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function handleApi(url, req, res, adminPin) {
  if (!isReady()) { json(res, 503, { error: 'initializing' }); return true; }

  for (const [method, pattern, auth, handler] of ROUTES) {
    if (req.method !== method) continue;
    const params = match(pattern, url.pathname);
    if (!params) continue;
    if (auth && !checkAuth(req, adminPin)) { unauth(res); return true; }
    if (auth) console.log('[audit]', req.method, url.pathname);
    try {
      await handler({ req, res, params, url });
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        json(res, 413, { error: '요청 본문이 너무 큽니다 (최대 1MB)' });
      } else {
        console.error('[api] handler error:', e.message);
        json(res, 500, { error: 'internal error' });
      }
    }
    return true;
  }

  return false;
}
