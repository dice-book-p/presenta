/**
 * AudioManager — Web Audio API 기반 BGM + 효과음 관리
 *
 * BGM은 서명자별로 preload하고 signId 키로 재생한다.
 */
export class AudioManager {
  constructor() {
    this._ctx = null;
    this._bgmBuffers = {};     // signId → AudioBuffer (서명자별 BGM)
    this._completeBuffer = null;
    this._bgmSource = null;
    this._bgmGain = null;
    this._masterGain = null;
    this._fadeTimer = null;
    this._activeSignId = null; // 현재 재생 중인 서명자 ID
  }

  _ensureContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.connect(this._ctx.destination);
    }
    return this._ctx;
  }

  /** 브라우저 자동재생 정책 대응 — 사용자 인터랙션 시 호출 */
  async ensureResumed() {
    const ctx = this._ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  /** 서명자별 BGM preload. signId = 서명자 ID */
  async preloadBgm(signId, url) {
    if (!signId || !url) return;
    try {
      const ctx = this._ensureContext();
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      this._bgmBuffers[signId] = await ctx.decodeAudioData(buf);
    } catch (e) {
      console.warn(`[AudioManager] BGM preload failed (${signId}):`, e);
    }
  }

  async preloadComplete(url) {
    if (!url) return;
    try {
      const ctx = this._ensureContext();
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      this._completeBuffer = await ctx.decodeAudioData(buf);
    } catch (e) {
      console.warn('[AudioManager] complete sound preload failed:', e);
    }
  }

  /** signId에 해당하는 BGM 재생. 이미 같은 서명자 BGM이 재생 중이면 무시. */
  startBgm(signId, { fadeIn = 1.5, loop = true } = {}) {
    const buffer = this._bgmBuffers[signId];
    if (!buffer || !this._ctx) return;
    // 이미 같은 서명자 BGM 재생 중이면 중복 시작 방지
    if (this._activeSignId === signId && this._bgmSource) return;
    this.stopBgm({ fadeOut: 0 });
    this._activeSignId = signId;

    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeIn);

    source.connect(gain);
    gain.connect(this._masterGain);
    source.start(0);

    this._bgmSource = source;
    this._bgmGain = gain;
  }

  stopBgm({ fadeOut = 1.5, signId = null } = {}) {
    // signId 지정 시 해당 서명자 BGM이 재생 중일 때만 중지
    if (signId && this._activeSignId !== signId) return;
    clearTimeout(this._fadeTimer);
    if (!this._bgmSource || !this._bgmGain || !this._ctx) return;

    const gain = this._bgmGain;
    const source = this._bgmSource;
    const ctx = this._ctx;

    if (fadeOut > 0) {
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
      this._fadeTimer = setTimeout(() => {
        try { source.stop(); } catch {}
      }, fadeOut * 1000 + 100);
    } else {
      try { source.stop(); } catch {}
    }

    this._bgmSource = null;
    this._bgmGain = null;
    this._activeSignId = null;
  }

  playCompleteSound(volume = 0.8) {
    if (!this._completeBuffer || !this._ctx) return;
    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._completeBuffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume / 100, ctx.currentTime);

    source.connect(gain);
    gain.connect(this._masterGain);
    source.start(0);
  }

  destroy() {
    this.stopBgm({ fadeOut: 0 });
    this._bgmBuffers = {};
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }
  }
}
