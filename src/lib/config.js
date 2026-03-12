// WebSocket 서버 URL
// dev: Vite proxy가 /ws → 8765, /api → 8765 로 포워딩
// prod: 같은 서버에서 처리
const _host  = typeof window !== 'undefined' ? window.location.host : 'localhost';
const _proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';

export const WS_URL = `${_proto}://${_host}/ws`;
export const API_BASE = '';
