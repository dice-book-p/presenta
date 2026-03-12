/**
 * 서버 공통 설정값
 * 모든 상수·환경변수는 여기에서 관리
 */
import { randomBytes } from 'crypto';

export const PORT            = parseInt(process.env.PORT ?? '3000', 10);
export const ADMIN_PIN       = process.env.ADMIN_PIN ?? '1234';
export const MAX_SLIDE_BYTES = 10 * 1024 * 1024;  // 10 MB
export const WS_HEARTBEAT_MS = 30_000;             // WebSocket ping 간격
/** 리모컨 접근 토큰 — env REMOTE_TOKEN 없으면 서버 시작 시 자동 생성 */
export const REMOTE_TOKEN    = process.env.REMOTE_TOKEN ?? randomBytes(16).toString('hex');
