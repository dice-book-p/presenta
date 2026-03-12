/**
 * 서명 인메모리 스토어 (데이터 접근 레이어)
 *
 * - 프로젝트별로 서명 데이터를 관리: { [projectId]: { [signId]: dataUrl } }
 * - 서명은 관리자가 명시적으로 초기화하기 전까지 영속됨
 */
import { loadData, saveData } from '../infra/supabase.js';

let store = {};
let ready = false;

export async function initSignaturesStore() {
  try {
    const data = await loadData('signatures.json');
    if (data) store = data;
  } catch (e) {
    console.error('[signatures] init error:', e.message);
  }
  ready = true;
  console.log('[signatures] ready');
}

export const isSignaturesReady = () => ready;

function persist() {
  saveData('signatures.json', store).catch(e =>
    console.error('[signatures] persist error:', e.message)
  );
}

export const getSignatures = (projectId) => store[projectId] ?? {};

export function saveSignature(projectId, signId, dataUrl) {
  if (!store[projectId]) store[projectId] = {};
  store[projectId][signId] = dataUrl;
  persist();
}

export function clearSignatures(projectId) {
  store[projectId] = {};
  persist();
}

export function clearOneSignature(projectId, signId) {
  if (store[projectId]) {
    delete store[projectId][signId];
    persist();
  }
}
