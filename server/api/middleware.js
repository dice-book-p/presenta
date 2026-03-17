/**
 * API 미들웨어 헬퍼 (HTTP 레이어)
 *
 * 라우트 매칭, 인증, 요청/응답 직렬화를 담당한다.
 * 비즈니스 로직은 포함하지 않는다.
 */

/** URL 패턴 매칭 — /api/projects/:id → { id: '...' } */
export function match(pattern, pathname) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  const m = pathname.match(re);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

/** Bearer 토큰 인증 */
export function checkAuth(req, adminPin) {
  return (req.headers['authorization'] ?? '').replace('Bearer ', '').trim() === adminPin;
}

/** JSON 응답 */
export function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/** 요청 본문 파싱 (JSON) — 1MB 초과 시 reject */
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        req.resume(); // drain remaining data
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => {
      if (!rejected) reject(new Error('REQUEST_ERROR'));
    });
  });
}

export const unauth   = (res) => json(res, 401, { error: 'unauthorized' });
export const notFound = (res) => json(res, 404, { error: 'not found' });
