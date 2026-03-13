/**
 * ParticleEngine v2 — Canvas 2D 기반 펜/배경 파티클 렌더링
 *
 * Ambient types: dot | star | streak | twinkle
 * Config: ambientStyle: 'sparkle' | 'dust' | 'stars' | 'mixed'
 *         ambientSpeed:  'slow' | 'normal' | 'fast'
 */

const SIZE_MAP   = { small: 3, medium: 5, large: 8 };
const DENSITY_MAP = { low: 1, normal: 2, high: 3 };
const SPEED_MAP  = { slow: 0.4, normal: 1, fast: 2.2 };

export class ParticleEngine {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._particles = [];         // pen particles
    this._ambientParticles = [];  // background particles
    this._raf = null;
    this._running = false;
    this._ambientConfig = null;
    this._ambientTimer = null;
    this._lastTime = 0;
  }

  resize(w, h) {
    this._canvas.width = w;
    this._canvas.height = h;
  }

  /** 펜 파티클: 서명 draw 좌표에서 방출 */
  emit(x, y, config) {
    if (!config?.penParticle) return;
    const count = DENSITY_MAP[config.penDensity] ?? 2;
    const size  = SIZE_MAP[config.penSize] ?? 5;
    const color = config.penColor || '#c9a84c';

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 3;
      this._particles.push({
        type: Math.random() < 0.35 ? 'star' : 'dot',
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.8,
        size: size * (0.5 + Math.random() * 0.8),
        color,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.5 + Math.random() * 0.4,
        rotation: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 6,
      });
    }
    // 꼬리 glow
    this._particles.push({
      type: 'glow',
      x, y, vx: 0, vy: 0,
      size: size * 1.5,
      color,
      life: 0.25, maxLife: 0.25,
      rotation: 0, rotSpeed: 0,
    });

    if (this._particles.length > 250) this._particles = this._particles.slice(-250);
    this._ensureRunning();
  }

  /** 배경 파티클 시작 */
  startAmbient(config) {
    if (!config?.ambientParticle) return;
    this._ambientConfig = config;
    this._stopAmbientSpawn();

    const density  = DENSITY_MAP[config.ambientDensity] ?? 1;
    const style    = config.ambientStyle ?? 'sparkle';
    const maxCount = density * 100;

    // 즉시 화면 채우기 (60% 선채움)
    const initial = Math.floor(maxCount * 0.6);
    for (let i = 0; i < initial; i++) this._spawnAmbient(config, style, true);

    // 주기적 스폰
    const interval = Math.max(40, 180 / density);
    this._ambientTimer = setInterval(() => {
      if (this._ambientParticles.length < maxCount) {
        this._spawnAmbient(config, style, false);
      }
    }, interval);

    this._ensureRunning();
  }

  _spawnAmbient(config, style, initial) {
    const w     = this._canvas.width  || 1920;
    const h     = this._canvas.height || 1080;
    const color = config.ambientColor || '#c9a84c';
    const spd   = SPEED_MAP[config.ambientSpeed ?? 'normal'];

    // 타입 결정
    let type;
    const r = Math.random();
    if (style === 'dust')    type = 'dot';
    else if (style === 'stars')   type = r < 0.12 ? 'streak' : r < 0.55 ? 'star' : 'twinkle';
    else if (style === 'sparkle') type = r < 0.04 ? 'streak' : r < 0.50 ? 'star' : r < 0.75 ? 'twinkle' : 'dot';
    else /* mixed */               type = r < 0.07 ? 'streak' : r < 0.35 ? 'star' : r < 0.55 ? 'twinkle' : 'dot';

    const life = type === 'streak'  ? 0.35 + Math.random() * 0.35
               : type === 'twinkle' ? 3.5  + Math.random() * 3
               :                      2    + Math.random() * 2.5;

    const p = {
      type, color,
      x: Math.random() * w,
      y: initial ? Math.random() * h : h + 20,
      life,
      maxLife: life,
      rotation: Math.random() * Math.PI * 2,
    };
    if (initial) p.life = Math.random() * life;

    switch (type) {
      case 'dot':
        p.size = 1.5 + Math.random() * 2.5;
        p.vx   = (Math.random() - 0.5) * 12 * spd;
        p.vy   = -(8  + Math.random() * 25) * spd;
        break;
      case 'star':
        p.size     = 3 + Math.random() * 7;
        p.vx       = (Math.random() - 0.5) * 10 * spd;
        p.vy       = -(4 + Math.random() * 18) * spd;
        p.rotSpeed = (Math.random() - 0.5) * 2.5 * spd;
        break;
      case 'streak': {
        p.size   = 2 + Math.random() * 3;
        p.length = 35 + Math.random() * 90;
        const a  = -Math.PI / 2 + (Math.random() - 0.5) * 1.0;
        const sp = (200 + Math.random() * 350) * spd;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.x  = Math.random() * w;
        p.y  = initial ? Math.random() * h * 0.6 : -20;
        break;
      }
      case 'twinkle':
        p.size  = 5 + Math.random() * 10;
        p.vx    = (Math.random() - 0.5) * 6 * spd;
        p.vy    = -(3  + Math.random() * 12) * spd;
        p.phase = Math.random() * Math.PI * 2;
        break;
    }

    this._ambientParticles.push(p);
  }

  stopAmbient() {
    this._stopAmbientSpawn();
    // 빠른 페이드아웃
    for (const p of this._ambientParticles) p.life = Math.min(p.life, 0.6);
    this._ambientConfig = null;
  }

  _stopAmbientSpawn() {
    if (this._ambientTimer) { clearInterval(this._ambientTimer); this._ambientTimer = null; }
  }

  _ensureRunning() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._raf = requestAnimationFrame(t => this._loop(t));
  }

  _loop(time) {
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // ── 배경 파티클 ─────────────────────────────────────────────────────────
    for (let i = this._ambientParticles.length - 1; i >= 0; i--) {
      const p = this._ambientParticles[i];
      p.life -= dt;
      if (p.life <= 0) { this._ambientParticles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const prog = 1 - p.life / p.maxLife;
      let alpha = prog < 0.12 ? prog / 0.12 : prog > 0.82 ? (1 - prog) / 0.18 : 1;

      switch (p.type) {
        case 'dot':
          this._drawGlow(p.x, p.y, p.size, p.color, alpha * 0.75);
          break;
        case 'star':
          p.rotation = (p.rotation ?? 0) + (p.rotSpeed ?? 1) * dt;
          this._drawStar(p.x, p.y, p.size, p.color, alpha * 0.9, p.rotation);
          break;
        case 'streak':
          this._drawStreak(p.x, p.y, p.vx, p.vy, p.size, p.length ?? 50, p.color, alpha * 0.9);
          break;
        case 'twinkle': {
          const pulse = 0.45 + 0.55 * Math.sin(p.phase + time / 280);
          this._drawTwinkle(p.x, p.y, p.size, p.color, alpha * pulse);
          break;
        }
      }
    }

    // ── 펜 파티클 ────────────────────────────────────────────────────────────
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.06; // light gravity
      const alpha = p.life / p.maxLife;

      if (p.type === 'glow') {
        this._drawGlow(p.x, p.y, p.size * (1 + (1 - alpha) * 2.5), p.color, alpha * 0.45);
      } else if (p.type === 'star') {
        p.rotation = (p.rotation ?? 0) + (p.rotSpeed ?? 3) * dt;
        this._drawStar(p.x, p.y, p.size * alpha, p.color, alpha, p.rotation);
      } else {
        this._drawGlow(p.x, p.y, p.size * alpha, p.color, alpha);
      }
    }

    const alive = this._particles.length > 0 || this._ambientParticles.length > 0 || this._ambientTimer;
    if (alive) {
      this._raf = requestAnimationFrame(t => this._loop(t));
    } else {
      this._running = false;
    }
  }

  // ── Draw helpers ────────────────────────────────────────────────────────────

  _drawGlow(x, y, size, color, alpha) {
    if (size <= 0 || alpha <= 0) return;
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur  = size * 3;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, size), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 4-pointed star (✦) */
  _drawStar(x, y, size, color, alpha, rotation = 0) {
    if (size <= 0 || alpha <= 0) return;
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur  = size * 3.5;
    ctx.strokeStyle = color;
    ctx.lineWidth   = Math.max(0.8, size * 0.32);
    ctx.lineCap     = 'round';
    ctx.translate(x, y);
    ctx.rotate(rotation);
    // long arms (0°, 90°, 180°, 270°) + short arms (45°, 135°, 225°, 315°)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.18, Math.sin(a) * size * 0.18);
      ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.12, Math.sin(a) * size * 0.12);
      ctx.lineTo(Math.cos(a) * size * 0.45, Math.sin(a) * size * 0.45);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 유성/streak */
  _drawStreak(x, y, vx, vy, size, length, color, alpha) {
    if (alpha <= 0) return;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed === 0) return;
    const nx = vx / speed, ny = vy / speed;
    const tx = x - nx * length, ty = y - ny * length;
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(tx, ty, x, y);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.6, color + '60');
    grad.addColorStop(1, color);
    ctx.shadowColor = color;
    ctx.shadowBlur  = size * 4;
    ctx.strokeStyle = grad;
    ctx.lineWidth   = size;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 반짝이는 십자 별 */
  _drawTwinkle(x, y, size, color, alpha) {
    if (size <= 0 || alpha <= 0) return;
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur  = size * 4.5;
    ctx.strokeStyle = color;
    ctx.lineCap     = 'round';
    ctx.translate(x, y);
    // vertical long arm
    ctx.lineWidth = Math.max(0.6, size * 0.14);
    ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(0, size * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-size * 1.5, 0); ctx.lineTo(size * 1.5, 0); ctx.stroke();
    // diagonal short arms
    ctx.lineWidth = Math.max(0.4, size * 0.09);
    const d = size * 0.65;
    ctx.beginPath(); ctx.moveTo(-d, -d); ctx.lineTo(d, d); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d, -d); ctx.lineTo(-d, d); ctx.stroke();
    // center
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2); ctx.fill();
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
