/**
 * 서버 공통 설정값
 * 모든 상수·환경변수는 여기에서 관리
 */
export const PORT            = parseInt(process.env.PORT ?? '3000', 10);
export const ADMIN_PIN       = process.env.ADMIN_PIN ?? '1234';
export const MAX_SLIDE_BYTES = 10 * 1024 * 1024;  // 10 MB
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;   // 5 MB
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;   // 20 MB

export const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac',
]);
export const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/ogg',
]);
export const WS_HEARTBEAT_MS = 30_000;             // WebSocket ping 간격
