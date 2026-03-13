/**
 * AudioManager — Web Audio API 기반 BGM + 효과음 관리
 */
export class AudioManager {
  constructor() {
    this._ctx = null;
    this._bgmBuffer = null;
    this._completeBuffer = null;
    this._bgmSource = null;
    this._bgmGain = null;
    this._masterGain = null;
    this._fadeTimer = null;
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

  async preloadBgm(url) {
    if (!url) return;
    try {
      const ctx = this._ensureContext();
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      this._bgmBuffer = await ctx.decodeAudioData(buf);
    } catch (e) {
      console.warn('[AudioManager] BGM preload failed:', e);
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

  startBgm({ fadeIn = 1.5, loop = true } = {}) {
    if (!this._bgmBuffer || !this._ctx) return;
    this.stopBgm({ fadeOut: 0 });

    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._bgmBuffer;
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

  stopBgm({ fadeOut = 1.5 } = {}) {
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
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }
  }
}
