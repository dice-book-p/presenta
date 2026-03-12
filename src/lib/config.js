// WebSocket 서버 URL
// dev: vite dev(5173) + ws-dev(3500) 분리 구조
// prod: 같은 서버에서 처리
export const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3500/ws'
  : `ws://${window?.location?.host}/ws`;

export const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3500'
  : '';
