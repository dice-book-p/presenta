/**
 * ParticleEngine v3 — Sprite-cache 기반 고성능 파티클 렌더링
 *
 * 핵심 최적화:
 *   - 파티클 모양을 OffscreenCanvas에 한 번만 bake (shadowBlur 포함)
 *   - 렌더 루프에서는 drawImage() 만 호출 → per-particle shadowBlur 없음
 *   - 비회전 파티클: globalAlpha 1회 설정 후 drawImage 연속 호출
 *   - 회전 파티클: save/translate/rotate/drawImage/restore (shadowBlur 없음)
 *
 * Ambient types: dot | star | streak | twinkle
 * Config: ambientStyle: 'sparkle' | 'dust' | 'stars' | 'mixed'
 *         ambientSpeed:  'slow' | 'normal' | 'fast'
 */

const SIZE_MAP    = { small: 3, medium: 5, large: 8 };
const DENSITY_MAP = { low: 1, normal: 2, high: 3 };
const SPEED_MAP   = { slow: 0.4, normal: 1, fast: 2.2 };

// Quantize sizes to limit sprite variants
const SIZE_STEPS = [3, 5, 7, 9, 12, 16];
function snapSize(s) {
  return SIZE_STEPS.find(v => v >= s) ?? SIZE_STEPS[SIZE_STEPS.length - 1];
}

// ── Sprite Baking ─────────────────────────────────────────────────────────────

function bakeSprite(type, size, color) {
  const glow  = type === 'twinkle' ? size * 4.5 : type === 'star' ? size * 3.5 : size * 2.5;
  const pad   = Math.ceil(glow) + 2;
  const dim   = Math.ceil((size + pad) * 2);
  const c     = dim / 2;

  const oc  = document.createElement('canvas');
  oc.width  = dim;
  oc.height = dim;
  const ctx = oc.getContext('2d');

  ctx.shadowColor = color;
  ctx.fillStyle   = color;
  ctx.strokeStyle = color;

  if (type === 'dot' || type === 'glow') {
    // outer glow
    ctx.shadowBlur = glow;
    ctx.beginPath();
    ctx.arc(c, c, size, 0, Math.PI * 2);
    ctx.fill();
    // bright core
    ctx.shadowBlur  = size;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.45, 0, Math.PI * 2);
    ctx.fill();

  } else if (type === 'star') {
    ctx.shadowBlur = glow;
    ctx.lineWidth  = Math.max(0.8, size * 0.32);
    ctx.lineCap    = 'round';
    // long arms (0°, 90°, 180°, 270°)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * size * 0.18, c + Math.sin(a) * size * 0.18);
      ctx.lineTo(c + Math.cos(a) * size, c + Math.sin(a) * size);
      ctx.stroke();
    }
    // short diagonal arms (45°, 135°, 225°, 315°)
    ctx.lineWidth = Math.max(0.5, size * 0.18);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * size * 0.12, c + Math.sin(a) * size * 0.12);
      ctx.lineTo(c + Math.cos(a) * size * 0.5, c + Math.sin(a) * size * 0.5);
      ctx.stroke();
    }
    // center dot
    ctx.shadowBlur  = size * 2;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.24, 0, Math.PI * 2);
    ctx.fill();

  } else if (type === 'twinkle') {
    ctx.shadowBlur = glow;
    ctx.lineCap    = 'round';
    // vertical + horizontal arms
    ctx.lineWidth = Math.max(0.6, size * 0.14);
    ctx.beginPath(); ctx.moveTo(c, c - size * 1.5); ctx.lineTo(c, c + size * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c - size * 1.5, c); ctx.lineTo(c + size * 1.5, c); ctx.stroke();
    // diagonal short arms
    ctx.lineWidth = Math.max(0.4, size * 0.09);
    const d = size * 0.65;
    ctx.beginPath(); ctx.moveTo(c - d, c - d); ctx.lineTo(c + d, c + d); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c + d, c - d); ctx.lineTo(c - d, c + d); ctx.stroke();
    // center
    ctx.shadowBlur  = size * 2;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  return oc;
}

class SpriteCache {
  constructor() { this._map = new Map(); }

  get(type, rawSize, color) {
    const size = snapSize(rawSize);
    const key  = `${type}|${size}|${color}`;
    if (!this._map.has(key)) {
      this._map.set(key, bakeSprite(type, size, color));
    }
    return this._map.get(key);
  }

  clear() { this._map.clear(); }
}

// ── ParticleEngine ─────────────────────────────────────────────────────────────

export class ParticleEngine {
  constructor(canvas) {
    this._canvas   = canvas;
    this._ctx      = canvas.getContext('2d');
    this._sprites  = new SpriteCache();
    this._particles        = [];
    this._ambientParticles = [];
    this._raf          = null;
    this._running      = false;
    this._ambientConfig = null;
    this._ambientTimer  = null;
    this._lastTime      = 0;
  }

  resize(w, h) {
    this._canvas.width  = w;
    this._canvas.height = h;
  }

  // ── Pen Particles ──────────────────────────────────────────────────────────

  emit(x, y, config) {
    if (!config?.penParticle) return;
    const count = DENSITY_MAP[config.penDensity] ?? 2;
    const size  = SIZE_MAP[config.penSize] ?? 5;
    const color = config.penColor || '#c9a84c';

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 3;
      this._particles.push({
        type: Math.random() < 0.4 ? 'star' : 'dot',
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
    // glow trail at cursor
    this._particles.push({
      type: 'glow',
      x, y, vx: 0, vy: 0,
      size: size * 1.6,
      color,
      life: 0.22, maxLife: 0.22,
      rotation: 0, rotSpeed: 0,
    });

    if (this._particles.length > 280) this._particles = this._particles.slice(-280);
    this._ensureRunning();
  }

  // ── Ambient Particles ──────────────────────────────────────────────────────

  startAmbient(config) {
    if (!config?.ambientParticle) return;
    this._ambientConfig = config;
    this._stopAmbientSpawn();

    const density  = DENSITY_MAP[config.ambientDensity] ?? 1;
    const style    = config.ambientStyle ?? 'sparkle';
    const maxCount = density * 120;

    // pre-fill 65% immediately
    const initial = Math.floor(maxCount * 0.65);
    for (let i = 0; i < initial; i++) this._spawnAmbient(config, style, true);

    const interval = Math.max(30, 160 / density);
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

    // type distribution by style
    const r = Math.random();
    let type;
    if      (style === 'dust')    type = 'dot';
    else if (style === 'stars')   type = r < 0.10 ? 'streak' : r < 0.55 ? 'star' : 'twinkle';
    else if (style === 'sparkle') type = r < 0.03 ? 'streak' : r < 0.55 ? 'star' : r < 0.78 ? 'twinkle' : 'dot';
    else /* mixed */              type = r < 0.06 ? 'streak' : r < 0.38 ? 'star' : r < 0.60 ? 'twinkle' : 'dot';

    const life = type === 'streak'  ? 0.3  + Math.random() * 0.3
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
        p.vx   = (Math.random() - 0.5) * 10 * spd;
        p.vy   = -(6 + Math.random() * 22) * spd;
        break;
      case 'star':
        p.size     = 4 + Math.random() * 8;
        p.vx       = (Math.random() - 0.5) * 8 * spd;
        p.vy       = -(3 + Math.random() * 15) * spd;
        p.rotSpeed = (Math.random() - 0.5) * 2.2 * spd;
        break;
      case 'streak': {
        p.size   = 2 + Math.random() * 3;
        p.length = 40 + Math.random() * 100;
        const a  = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
        const sp = (220 + Math.random() * 340) * spd;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.x  = Math.random() * w;
        p.y  = initial ? Math.random() * h * 0.6 : -20;
        break;
      }
      case 'twinkle':
        p.size  = 5 + Math.random() * 11;
        p.vx    = (Math.random() - 0.5) * 5 * spd;
        p.vy    = -(2 + Math.random() * 10) * spd;
        p.phase = Math.random() * Math.PI * 2;
        break;
    }

    this._ambientParticles.push(p);
  }

  stopAmbient() {
    this._stopAmbientSpawn();
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

  // ── Render Loop (sprite-based) ─────────────────────────────────────────────

  _loop(time) {
    const dt  = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // ── Ambient particles ──────────────────────────────────────────────────
    for (let i = this._ambientParticles.length - 1; i >= 0; i--) {
      const p = this._ambientParticles[i];
      p.life -= dt;
      if (p.life <= 0) { this._ambientParticles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const prog  = 1 - p.life / p.maxLife;
      let   alpha = prog < 0.12 ? prog / 0.12 : prog > 0.82 ? (1 - prog) / 0.18 : 1;

      if (p.type === 'streak') {
        // streak is directional — keep vector draw (rare, <5%)
        this._drawStreak(p, alpha * 0.9);
        continue;
      }

      if (p.type === 'twinkle') {
        p.phase = (p.phase ?? 0);
        alpha *= 0.45 + 0.55 * Math.sin(p.phase + time / 280);
      }

      const sprite = this._sprites.get(p.type, p.size, p.color);
      const hw     = sprite.width  / 2;
      const hh     = sprite.height / 2;

      if (p.type === 'dot') {
        // no rotation — cheapest path
        ctx.globalAlpha = alpha * 0.78;
        ctx.drawImage(sprite, p.x - hw, p.y - hh);
      } else {
        // star / twinkle — rotation
        p.rotation = (p.rotation ?? 0) + (p.rotSpeed ?? 1) * dt;
        ctx.save();
        ctx.globalAlpha = alpha * (p.type === 'star' ? 0.9 : 1);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.drawImage(sprite, -hw, -hh);
        ctx.restore();
      }
    }

    // ── Pen particles ──────────────────────────────────────────────────────
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.06;
      const alpha = p.life / p.maxLife;

      if (p.type === 'glow') {
        const scale  = 1 + (1 - alpha) * 2.5;
        const sprite = this._sprites.get('glow', p.size, p.color);
        const hw     = sprite.width  / 2 * scale;
        const hh     = sprite.height / 2 * scale;
        ctx.globalAlpha = alpha * 0.45;
        ctx.drawImage(sprite, p.x - hw, p.y - hh, sprite.width * scale, sprite.height * scale);
      } else if (p.type === 'star') {
        p.rotation = (p.rotation ?? 0) + (p.rotSpeed ?? 3) * dt;
        const sz     = p.size * alpha;
        const sprite = this._sprites.get('star', sz, p.color);
        const hw     = sprite.width  / 2;
        const hh     = sprite.height / 2;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.drawImage(sprite, -hw, -hh);
        ctx.restore();
      } else {
        // dot
        const sz     = p.size * alpha;
        const sprite = this._sprites.get('dot', sz, p.color);
        const hw     = sprite.width  / 2;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - hw, p.y - hw);
      }
    }

    // reset globalAlpha
    ctx.globalAlpha = 1;

    const alive = this._particles.length > 0
               || this._ambientParticles.length > 0
               || this._ambientTimer;
    if (alive) {
      this._raf = requestAnimationFrame(t => this._loop(t));
    } else {
      this._running = false;
    }
  }

  // ── Vector draw (streak only) ──────────────────────────────────────────────

  _drawStreak(p, alpha) {
    const { vx, vy, x, y, size, length = 60, color } = p;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed === 0 || alpha <= 0) return;
    const nx = vx / speed, ny = vy / speed;
    const tx = x - nx * length, ty = y - ny * length;
    const ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(tx, ty, x, y);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.55, color + '55');
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
    ctx.shadowBlur  = size * 2;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  destroy() {
    this._stopAmbientSpawn();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._running  = false;
    this._particles        = [];
    this._ambientParticles = [];
    this._sprites.clear();
  }
}
