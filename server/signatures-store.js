import { loadData, saveData } from './supabase.js';

// { [projectId]: { [signId]: dataUrl } }
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

function persist() {
  saveData('signatures.json', store).catch(e =>
    console.error('[signatures] persist error:', e.message)
  );
}

export function getSignatures(projectId) {
  return store[projectId] ? { ...store[projectId] } : {};
}

export function saveSignature(projectId, signId, dataUrl) {
  if (!store[projectId]) store[projectId] = {};
  store[projectId][signId] = dataUrl;
  persist();
}

export function clearSignatures(projectId) {
  delete store[projectId];
  persist();
}

export function clearOneSignature(projectId, signId) {
  if (store[projectId]) {
    delete store[projectId][signId];
    persist();
  }
}
