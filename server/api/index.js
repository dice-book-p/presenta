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
  getActiveProject, setActiveProject, isReady,
} from '../store/projects.js';
import {
  getSignatures, saveSignature, clearSignatures, clearOneSignature,
} from '../store/signatures.js';
import {
  getConnectionStatus, forceDisconnect, forceDisconnectAll, broadcastAll,
} from '../ws/connections.js';
import {
  uploadSlideImage, deleteSlideImage, deleteProjectImages,
} from '../infra/supabase.js';
import { MAX_SLIDE_BYTES } from '../config.js';
import { checkAuth, json, readBody, match, unauth, notFound } from './middleware.js';

// ── Active project ────────────────────────────────────────────────────────────

async function getActive({ res }) {
  json(res, 200, getActiveProject());
}

async function setActive({ req, res }) {
  const { projectId } = await readBody(req);
  const project = setActiveProject(projectId ?? null);
  broadcastAll({ type: 'active_changed', project: project ?? null });
  json(res, 200, { ok: true, project: project ?? null });
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function listProjects({ res }) {
  json(res, 200, getProjects());
}

async function createProjectHandler({ req, res }) {
  const { name } = await readBody(req);
  if (!name?.trim()) { json(res, 400, { error: 'name required' }); return; }
  json(res, 201, createProject(name.trim()));
}

async function getProjectHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 200, project);
}

async function updateProjectHandler({ req, res, params }) {
  const body = await readBody(req);
  if (body.signatories !== undefined) {
    updateSignatories(params.id, body.signatories);
    delete body.signatories;
  }
  const project = updateProject(params.id, body);
  if (!project) { notFound(res); return; }
  json(res, 200, project);
}

async function deleteProjectHandler({ res, params }) {
  if (!getProject(params.id)) { notFound(res); return; }
  deleteProjectImages(params.id).catch(e =>
    console.error('[api] deleteProjectImages:', e.message)
  );
  deleteProject(params.id);
  json(res, 200, { ok: true });
}

async function duplicateProjectHandler({ res, params }) {
  const project = duplicateProject(params.id);
  if (!project) { notFound(res); return; }
  json(res, 201, project);
}

// ── Slides ────────────────────────────────────────────────────────────────────

async function uploadSlideHandler({ req, res, params }) {
  if (!getProject(params.id)) { notFound(res); return; }

  let uploaded = null;
  let tooLarge = false;

  await new Promise((resolve) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_SLIDE_BYTES } });
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
    busboy.on('error', resolve);
    req.pipe(busboy);
  });

  if (tooLarge)   { json(res, 413, { error: '파일 크기 초과 (최대 10MB)' }); return; }
  if (!uploaded)  { json(res, 400, { error: '파일 없음' }); return; }

  try {
    const { filename, url } = await uploadSlideImage(
      params.id, uploaded.filename, uploaded.buffer, uploaded.contentType
    );
    json(res, 201, addSlide(params.id, { filename, url }));
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
    await deleteSlideImage(params.id, slide.filename).catch(() => {});
  }
  updateProject(params.id, { slides: [], summarySlideId: null });
  json(res, 200, { ok: true });
}

async function deleteSlideHandler({ res, params }) {
  const project = getProject(params.id);
  if (!project) { notFound(res); return; }
  const slide = project.slides.find(s => s.id === params.slideId);
  if (!slide) { notFound(res); return; }
  await deleteSlideImage(params.id, slide.filename).catch(() => {});
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
  json(res, 200, { ok: true });
}

async function clearOneSignatureHandler({ res, params }) {
  clearOneSignature(params.id, params.signId);
  json(res, 200, { ok: true });
}

// ── Connections ───────────────────────────────────────────────────────────────

async function getStatusHandler({ res }) {
  json(res, 200, getConnectionStatus());
}

async function disconnectHandler({ req, res }) {
  const { target } = await readBody(req);
  if (target === 'all') forceDisconnectAll();
  else if (target) forceDisconnect(target);
  json(res, 200, { ok: true });
}

// ── Route table ───────────────────────────────────────────────────────────────
// [HTTP method, URL pattern, requiresAuth, handler]

const ROUTES = [
  // Active project
  ['GET',    '/api/active',                          false, getActive],
  ['POST',   '/api/active',                          true,  setActive],

  // Projects
  ['GET',    '/api/projects',                        false, listProjects],
  ['POST',   '/api/projects',                        true,  createProjectHandler],
  ['GET',    '/api/projects/:id',                    false, getProjectHandler],
  ['PUT',    '/api/projects/:id',                    true,  updateProjectHandler],
  ['DELETE', '/api/projects/:id',                    true,  deleteProjectHandler],
  ['POST',   '/api/projects/:id/duplicate',          true,  duplicateProjectHandler],

  // Slides (slide reorder must come before :slideId to avoid ambiguity)
  ['POST',   '/api/projects/:id/slides',             true,  uploadSlideHandler],
  ['PUT',    '/api/projects/:id/slides/reorder',     true,  reorderSlidesHandler],
  ['DELETE', '/api/projects/:id/slides',             true,  clearAllSlidesHandler],
  ['DELETE', '/api/projects/:id/slides/:slideId',    true,  deleteSlideHandler],

  // Signatures
  ['GET',    '/api/projects/:id/signatures',         false, getSignaturesHandler],
  ['POST',   '/api/projects/:id/signatures',         false, saveSignatureHandler],
  ['DELETE', '/api/projects/:id/signatures',         true,  clearSignaturesHandler],
  ['DELETE', '/api/projects/:id/signatures/:signId', true,  clearOneSignatureHandler],

  // Connections / admin
  ['GET',    '/api/status',                          false, getStatusHandler],
  ['POST',   '/api/disconnect',                      true,  disconnectHandler],
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function handleApi(url, req, res, adminPin) {
  if (!isReady()) { json(res, 503, { error: 'initializing' }); return true; }

  for (const [method, pattern, auth, handler] of ROUTES) {
    if (req.method !== method) continue;
    const params = match(pattern, url.pathname);
    if (!params) continue;
    if (auth && !checkAuth(req, adminPin)) { unauth(res); return true; }
    await handler({ req, res, params, url });
    return true;
  }

  return false;
}
