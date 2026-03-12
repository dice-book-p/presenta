import Busboy from 'busboy';
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  duplicateProject, addSlide, reorderSlides, removeSlide, updateSignatories,
  getActiveProject, setActiveProject, isReady,
} from './projects-store.js';
import {
  getSignatures, saveSignature, clearSignatures, clearOneSignature,
} from './signatures-store.js';
import {
  getConnectionStatus, forceDisconnect, forceDisconnectAll, broadcastAll,
} from './connections.js';
import { uploadSlideImage, deleteSlideImage, deleteProjectImages } from './supabase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function match(pattern, pathname) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  const m = pathname.match(re);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

function checkAuth(req, adminPin) {
  const auth = req.headers['authorization'] ?? '';
  return auth.replace('Bearer ', '').trim() === adminPin;
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

const unauth  = (res) => json(res, 401, { error: 'unauthorized' });
const notFound = (res) => json(res, 404, { error: 'not found' });

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleApi(url, req, res, adminPin) {
  const p = url.pathname;
  const m = req.method;
  let params;

  // Service ready check
  if (!isReady()) { json(res, 503, { error: 'initializing' }); return true; }

  // ── Active project ─────────────────────────────────────────────────────────

  if (p === '/api/active' && m === 'GET') {
    json(res, 200, getActiveProject());
    return true;
  }

  if (p === '/api/active' && m === 'POST') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const { projectId } = await readBody(req);
    const project = setActiveProject(projectId ?? null);
    broadcastAll({ type: 'active_changed', project: project ?? null });
    json(res, 200, { ok: true, project: project ?? null });
    return true;
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  if (p === '/api/projects' && m === 'GET') {
    json(res, 200, getProjects());
    return true;
  }

  if (p === '/api/projects' && m === 'POST') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const { name } = await readBody(req);
    if (!name?.trim()) { json(res, 400, { error: 'name required' }); return true; }
    json(res, 201, createProject(name.trim()));
    return true;
  }

  if ((params = match('/api/projects/:id', p)) && m === 'GET') {
    const project = getProject(params.id);
    if (!project) { notFound(res); return true; }
    json(res, 200, project);
    return true;
  }

  if ((params = match('/api/projects/:id', p)) && m === 'PUT') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const body = await readBody(req);
    // Handle signatories update separately
    if (body.signatories !== undefined) {
      updateSignatories(params.id, body.signatories);
      delete body.signatories;
    }
    const project = updateProject(params.id, body);
    if (!project) { notFound(res); return true; }
    json(res, 200, project);
    return true;
  }

  if ((params = match('/api/projects/:id', p)) && m === 'DELETE') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    if (!getProject(params.id)) { notFound(res); return true; }
    deleteProjectImages(params.id).catch(e =>
      console.error('[api] deleteProjectImages:', e.message)
    );
    deleteProject(params.id);
    json(res, 200, { ok: true });
    return true;
  }

  if ((params = match('/api/projects/:id/duplicate', p)) && m === 'POST') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const project = duplicateProject(params.id);
    if (!project) { notFound(res); return true; }
    json(res, 201, project);
    return true;
  }

  // ── Slides ─────────────────────────────────────────────────────────────────

  if ((params = match('/api/projects/:id/slides', p)) && m === 'POST') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    if (!getProject(params.id)) { notFound(res); return true; }

    let uploaded = null;
    let tooLarge = false;

    await new Promise((resolve) => {
      const busboy = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
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
      busboy.on('error', resolve);
      req.pipe(busboy);
    });

    if (tooLarge) { json(res, 413, { error: '파일 크기 초과 (최대 10MB)' }); return true; }
    if (!uploaded) { json(res, 400, { error: '파일 없음' }); return true; }

    try {
      const { filename, url } = await uploadSlideImage(
        params.id, uploaded.filename, uploaded.buffer, uploaded.contentType
      );
      json(res, 201, addSlide(params.id, { filename, url }));
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return true;
  }

  if ((params = match('/api/projects/:id/slides/reorder', p)) && m === 'PUT') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const { orderedIds } = await readBody(req);
    const slides = reorderSlides(params.id, orderedIds);
    if (!slides) { notFound(res); return true; }
    json(res, 200, slides);
    return true;
  }

  if ((params = match('/api/projects/:id/slides', p)) && m === 'DELETE') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const project = getProject(params.id);
    if (!project) { notFound(res); return true; }
    for (const slide of project.slides) {
      await deleteSlideImage(params.id, slide.filename).catch(() => {});
    }
    updateProject(params.id, { slides: [], summarySlideId: null });
    json(res, 200, { ok: true });
    return true;
  }

  if ((params = match('/api/projects/:id/slides/:slideId', p)) && m === 'DELETE') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const project = getProject(params.id);
    if (!project) { notFound(res); return true; }
    const slide = project.slides.find(s => s.id === params.slideId);
    if (!slide) { notFound(res); return true; }
    await deleteSlideImage(params.id, slide.filename).catch(() => {});
    removeSlide(params.id, params.slideId);
    json(res, 200, { ok: true });
    return true;
  }

  // ── Signatures ─────────────────────────────────────────────────────────────

  if ((params = match('/api/projects/:id/signatures', p)) && m === 'GET') {
    json(res, 200, getSignatures(params.id));
    return true;
  }

  if ((params = match('/api/projects/:id/signatures', p)) && m === 'POST') {
    const { signId, dataUrl } = await readBody(req);
    if (signId && dataUrl) saveSignature(params.id, signId, dataUrl);
    json(res, 200, { ok: true });
    return true;
  }

  if ((params = match('/api/projects/:id/signatures', p)) && m === 'DELETE') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    clearSignatures(params.id);
    json(res, 200, { ok: true });
    return true;
  }

  if ((params = match('/api/projects/:id/signatures/:signId', p)) && m === 'DELETE') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    clearOneSignature(params.id, params.signId);
    json(res, 200, { ok: true });
    return true;
  }

  // ── Connection status ──────────────────────────────────────────────────────

  if (p === '/api/status' && m === 'GET') {
    json(res, 200, getConnectionStatus());
    return true;
  }

  if (p === '/api/disconnect' && m === 'POST') {
    if (!checkAuth(req, adminPin)) { unauth(res); return true; }
    const { target } = await readBody(req);
    if (target === 'all') forceDisconnectAll();
    else if (target) forceDisconnect(target);
    json(res, 200, { ok: true });
    return true;
  }

  return false; // not handled
}
