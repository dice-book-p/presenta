/**
 * ParticleEngine — Canvas 2D 기반 펜/배경 파티클 렌더링
 */

const SIZE_MAP = { small: 3, medium: 5, large: 8 };
const DENSITY_MAP = { low: 1, normal: 2, high: 3 };

export class ParticleEngine {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._particles = [];
    this._ambientParticles = [];
    this._raf = null;
    this._running = false;
    this._ambientConfig = null;
    this._ambientTimer = null;
  }

  resize(w, h) {
    this._canvas.width = w;
    this._canvas.height = h;
  }

  /** 펜 파티클: 서명 draw 좌표에서 방출 */
  emit(x, y, config) {
    if (!config?.penParticle) return;
    const count = DENSITY_MAP[config.penDensity] ?? 2;
    const size = SIZE_MAP[config.penSize] ?? 5;
    const color = config.penColor || '#c9a84c';

    for (let i = 0; i < count; i++) {
      this._particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2 - 1,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        life: 0.8,
        maxLife: 0.8,
      });
    }

    // 풀 제한
    if (this._particles.length > 150) {
      this._particles = this._particles.slice(-150);
    }

    this._ensureRunning();
  }

  /** 배경 파티클: 슬라이드 전체 반짝이는 입자 */
  startAmbient(config) {
    if (!config?.ambientParticle) return;
    this._ambientConfig = config;

    const density = DENSITY_MAP[config.ambientDensity] ?? 1;
    const spawnInterval = Math.max(80, 300 / density);

    this._stopAmbientSpawn();
    this._ambientTimer = setInterval(() => {
      if (this._ambientParticles.length >= 80) return;
      const w = this._canvas.width;
      const h = this._canvas.height;
      this._ambientParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 2 + Math.random() * 4,
        color: config.ambientColor || '#c9a84c',
        life: 2 + Math.random() * 2,
        maxLife: 2 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }, spawnInterval);

    this._ensureRunning();
  }

  stopAmbient() {
    this._stopAmbientSpawn();
    this._ambientParticles = [];
    this._ambientConfig = null;
  }

  _stopAmbientSpawn() {
    if (this._ambientTimer) {
      clearInterval(this._ambientTimer);
      this._ambientTimer = null;
    }
  }

  _ensureRunning() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  _loop(time) {
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;

    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // 펜 파티클
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      const alpha = p.life / p.maxLife;
      this._drawGlow(p.x, p.y, p.size * alpha, p.color, alpha);
    }

    // 배경 파티클
    for (let i = this._ambientParticles.length - 1; i >= 0; i--) {
      const p = this._ambientParticles[i];
      p.life -= dt;
      if (p.life <= 0) { this._ambientParticles.splice(i, 1); continue; }
      const progress = 1 - p.life / p.maxLife;
      // fade in first 20%, fade out last 20%
      let alpha;
      if (progress < 0.2) alpha = progress / 0.2;
      else if (progress > 0.8) alpha = (1 - progress) / 0.2;
      else alpha = 1;
      alpha *= 0.6;
      // gentle float
      const floatY = Math.sin(p.phase + performance.now() / 1000) * 0.3;
      p.y += floatY * dt * 10;
      this._drawGlow(p.x, p.y, p.size, p.color, alpha);
    }

    const hasParticles = this._particles.length > 0 || this._ambientParticles.length > 0 || this._ambientTimer;
    if (hasParticles) {
      this._raf = requestAnimationFrame((t) => this._loop(t));
    } else {
      this._running = false;
    }
  }

  _drawGlow(x, y, size, color, alpha) {
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  destroy() {
    this._stopAmbientSpawn();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._running = false;
    this._particles = [];
    this._ambientParticles = [];
  }
}
