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

/** 요청 본문 파싱 (JSON) */
export function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

export const unauth   = (res) => json(res, 401, { error: 'unauthorized' });
export const notFound = (res) => json(res, 404, { error: 'not found' });
