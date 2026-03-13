/**
 * 미디어 라이브러리 인메모리 스토어 (Supabase: media 테이블 / 로컬: data/media.json)
 *
 * MediaItem { id, type: 'audio'|'video', filename, originalFilename, url, mimeType, size, createdAt }
 */
import { randomUUID } from 'crypto';
import { loadData, saveData } from '../infra/supabase.js';

/** @type {MediaItem[]} */
let items = [];
let ready = false;

export async function initMediaStore() {
  try {
    const data = await loadData('media.json');
    if (Array.isArray(data)) items = data;
  } catch (e) {
    console.error('[media] init error:', e.message);
  }
  ready = true;
  console.log(`[media] ready — ${items.length} items`);
}

export const isMediaReady = () => ready;

function persist() {
  saveData('media.json', items).catch(e =>
    console.error('[media] persist error:', e.message)
  );
}

export function getMediaItems(typeFilter) {
  if (typeFilter) return items.filter(m => m.type === typeFilter);
  return items;
}

export function getMediaItem(id) {
  return items.find(m => m.id === id) ?? null;
}

export function addMediaItem({ type, filename, originalFilename, url, mimeType, size }) {
  const item = {
    id: randomUUID(),
    type,
    filename,
    originalFilename,
    url,
    mimeType,
    size,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  persist();
  return item;
}

export function deleteMediaItem(id) {
  const idx = items.findIndex(m => m.id === id);
  if (idx === -1) return null;
  const [removed] = items.splice(idx, 1);
  persist();
  return removed;
}
