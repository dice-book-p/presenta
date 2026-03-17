/**
 * 미디어 스토어 단위 테스트
 * - addMediaItem, deleteMediaItem, getMediaItems, getMediaItem
 * - 프로젝트 비디오: getProjectVideos, addProjectVideo, deleteProjectVideo
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getMediaItems, getMediaItem, addMediaItem, deleteMediaItem } =
  await import('../server/store/media.js');

const { _resetForTest, createProject, getProjectVideos, addProjectVideo, deleteProjectVideo } =
  await import('../server/store/projects.js');

beforeEach(() => {
  _resetForTest();
});

describe('Media Store', () => {
  it('addMediaItem → 항목 추가 + id/createdAt 자동 생성', () => {
    const item = addMediaItem({
      type: 'audio',
      filename: 'test.mp3',
      originalFilename: 'song.mp3',
      url: '/media/test.mp3',
      mimeType: 'audio/mpeg',
      size: 1024,
    });

    assert.ok(item.id);
    assert.ok(item.createdAt);
    assert.equal(item.type, 'audio');
    assert.equal(item.filename, 'test.mp3');
    assert.equal(item.size, 1024);
  });

  it('getMediaItem → id로 조회', () => {
    const item = addMediaItem({
      type: 'audio',
      filename: 'test.mp3',
      originalFilename: 'song.mp3',
      url: '/media/test.mp3',
      mimeType: 'audio/mpeg',
      size: 512,
    });

    const found = getMediaItem(item.id);
    assert.equal(found.id, item.id);
    assert.equal(found.filename, 'test.mp3');
  });

  it('getMediaItem → 없는 id → null', () => {
    assert.equal(getMediaItem('nonexistent'), null);
  });

  it('getMediaItems → 전체 목록 반환', () => {
    addMediaItem({ type: 'audio', filename: 'a.mp3', originalFilename: 'a.mp3', url: '/a', mimeType: 'audio/mpeg', size: 1 });
    addMediaItem({ type: 'video', filename: 'b.mp4', originalFilename: 'b.mp4', url: '/b', mimeType: 'video/mp4', size: 2 });

    const all = getMediaItems(null);
    assert.ok(all.length >= 2);
  });

  it('getMediaItems → 타입 필터', () => {
    addMediaItem({ type: 'audio', filename: 'c.mp3', originalFilename: 'c.mp3', url: '/c', mimeType: 'audio/mpeg', size: 1 });
    addMediaItem({ type: 'video', filename: 'd.mp4', originalFilename: 'd.mp4', url: '/d', mimeType: 'video/mp4', size: 2 });

    const audios = getMediaItems('audio');
    assert.ok(audios.every(m => m.type === 'audio'));

    const videos = getMediaItems('video');
    assert.ok(videos.every(m => m.type === 'video'));
  });

  it('deleteMediaItem → 항목 제거 + 반환', () => {
    const item = addMediaItem({
      type: 'audio',
      filename: 'del.mp3',
      originalFilename: 'del.mp3',
      url: '/del',
      mimeType: 'audio/mpeg',
      size: 100,
    });

    const removed = deleteMediaItem(item.id);
    assert.equal(removed.id, item.id);
    assert.equal(getMediaItem(item.id), null);
  });

  it('deleteMediaItem → 없는 id → null', () => {
    assert.equal(deleteMediaItem('nonexistent'), null);
  });
});

describe('Project Videos', () => {
  it('addProjectVideo + getProjectVideos', () => {
    const p = createProject('Video Test');

    const video = addProjectVideo(p.id, {
      filename: 'vid.mp4',
      url: '/media/vid.mp4',
      originalFilename: 'video.mp4',
    });

    assert.ok(video.id);
    assert.equal(video.filename, 'vid.mp4');

    const videos = getProjectVideos(p.id);
    assert.equal(videos.length, 1);
    assert.equal(videos[0].id, video.id);
  });

  it('deleteProjectVideo', () => {
    const p = createProject('Video Test 2');
    const video = addProjectVideo(p.id, {
      filename: 'del.mp4',
      url: '/media/del.mp4',
      originalFilename: 'delete.mp4',
    });

    deleteProjectVideo(p.id, video.id);
    const videos = getProjectVideos(p.id);
    assert.equal(videos.length, 0);
  });

  it('존재하지 않는 프로젝트 → 빈 배열', () => {
    const videos = getProjectVideos('nonexistent');
    assert.deepEqual(videos, []);
  });
});
