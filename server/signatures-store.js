import { readFileSync, mkdirSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

// DATA_DIR: 로컬 dev → ./data, Fly.io → /data (volume mount)
const DATA_DIR = process.env.DATA_DIR || './data';
const SIGNATURES_FILE = join(DATA_DIR, 'signatures.json');

// 디렉토리 없으면 생성
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// 시작 시 파일에서 로드
let signatures = {};
try {
  if (existsSync(SIGNATURES_FILE)) {
    signatures = JSON.parse(readFileSync(SIGNATURES_FILE, 'utf8'));
  }
} catch {
  signatures = {};
}

async function persist() {
  try {
    await writeFile(SIGNATURES_FILE, JSON.stringify(signatures), 'utf8');
  } catch (e) {
    console.error('[signatures] persist error:', e.message);
  }
}

export function saveSignature(signId, dataUrl) {
  signatures[signId] = dataUrl;
  persist();
}

export function getSignatures() {
  return { ...signatures };
}

export function clearSignatures() {
  for (const key of Object.keys(signatures)) delete signatures[key];
  persist();
}
