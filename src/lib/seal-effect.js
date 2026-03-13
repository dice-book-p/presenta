/**
 * SealEffect v2 — CSS + Canvas 기반 서명완료 연출
 *
 * 1) 방사형 빛 광선 (8 rays)
 * 2) 확장 ripple 파동 (3개)
 * 3) 파티클 burst (원형 + star 혼합)
 * 4) 중앙 stamp glow 링
 */
export class SealEffect {
  constructor() {
    this._container = null;
    this._timer = null;
  }

  play(parentEl, config, onComplete) {
    this.stop();
    const color    = config.sealColor || '#c9a84c';
    const duration = (config.sealDuration || 6) * 1000;

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;';
    parentEl.appendChild(container);
    this._container = container;

    this._ensureStyles(color);
    this._addRays(container, color);
    this._addRipples(container, color);
    this._addBurst(container, color);
    this._addStamp(container, color);

    this._timer = setTimeout(() => {
      this.stop();
      if (onComplete) onComplete();
    }, duration);
  }

  /** 8개 방사형 빛 광선 */
  _addRays(container, color) {
    for (let i = 0; i < 8; i++) {
      const ray = document.createElement('div');
      const angle = (i / 8) * 360;
      const len   = 300 + Math.random() * 200;
      ray.style.cssText = `
        position:absolute;
        left:50%;top:50%;
        width:${len}px;height:${2 + Math.random() * 3}px;
        background:linear-gradient(to right, ${color}cc, transparent);
        transform-origin:left center;
        transform:translate(0,-50%) rotate(${angle}deg);
        opacity:0;
        animation:seal-ray 1.8s ${0.05 + i * 0.06}s ease-out forwards;
      `;
      container.appendChild(ray);
    }
  }

  /** 3중 ripple 파동 */
  _addRipples(container, color) {
    for (let i = 0; i < 3; i++) {
      const ripple = document.createElement('div');
      const delay  = i * 0.3;
      ripple.style.cssText = `
        position:absolute;
        left:50%;top:50%;
        width:0;height:0;
        border-radius:50%;
        border:2px solid ${color}99;
        box-shadow:0 0 12px ${color}66, inset 0 0 12px ${color}44;
        transform:translate(-50%,-50%);
        opacity:0;
        animation:seal-ripple 1.4s ${delay}s ease-out forwards;
      `;
      container.appendChild(ripple);
    }
  }

  /** burst 파티클 (원 + star 혼합) */
  _addBurst(container, color) {
    const count = 140;
    for (let i = 0; i < count; i++) {
      const p     = document.createElement('div');
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const dist  = 80 + Math.random() * 420;
      const size  = 2.5 + Math.random() * 7;
      const delay = Math.random() * 0.25;
      const dur   = 0.8 + Math.random() * 1.4;
      const isStar = Math.random() < 0.35;

      if (isStar) {
        // star shape via clip-path
        p.style.cssText = `
          position:absolute;
          left:50%;top:50%;
          width:${size * 2}px;height:${size * 2}px;
          background:${color};
          filter:drop-shadow(0 0 ${size}px ${color});
          clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
          opacity:0;
          transform:translate(-50%,-50%) scale(0);
          animation:seal-burst ${dur}s ${delay}s ease-out forwards;
          --tx:${Math.cos(angle) * dist}px;
          --ty:${Math.sin(angle) * dist}px;
        `;
      } else {
        p.style.cssText = `
          position:absolute;
          left:50%;top:50%;
          width:${size}px;height:${size}px;
          border-radius:50%;
          background:${color};
          box-shadow:0 0 ${size * 2.5}px ${color};
          opacity:0;
          transform:translate(-50%,-50%);
          animation:seal-burst ${dur}s ${delay}s ease-out forwards;
          --tx:${Math.cos(angle) * dist}px;
          --ty:${Math.sin(angle) * dist}px;
        `;
      }
      container.appendChild(p);
    }
  }

  /** 중앙 stamp glow */
  _addStamp(container, color) {
    // outer glow ring
    const ring = document.createElement('div');
    ring.style.cssText = `
      position:absolute;
      left:50%;top:50%;
      width:160px;height:160px;
      border-radius:50%;
      border:3px solid ${color};
      box-shadow:0 0 60px ${color}, 0 0 120px ${color}66, inset 0 0 40px ${color}44;
      transform:translate(-50%,-50%) scale(0);
      animation:seal-stamp 0.7s 0.1s cubic-bezier(0.34,1.56,0.64,1) forwards;
      opacity:0;
    `;
    container.appendChild(ring);

    // inner glow pulse
    const inner = document.createElement('div');
    inner.style.cssText = `
      position:absolute;
      left:50%;top:50%;
      width:80px;height:80px;
      border-radius:50%;
      background:radial-gradient(circle, ${color}88 0%, transparent 70%);
      transform:translate(-50%,-50%) scale(0);
      animation:seal-stamp 0.5s 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards;
      opacity:0;
    `;
    container.appendChild(inner);
  }

  _ensureStyles() {
    if (document.getElementById('seal-effect-styles-v2')) return;
    const style = document.createElement('style');
    style.id = 'seal-effect-styles-v2';
    style.textContent = `
      @keyframes seal-burst {
        0%   { opacity:1; transform:translate(-50%,-50%) translate(0,0) scale(1); }
        100% { opacity:0; transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) scale(0.2); }
      }
      @keyframes seal-ripple {
        0%   { width:0; height:0; opacity:0.9; }
        100% { width:900px; height:900px; opacity:0; }
      }
      @keyframes seal-ray {
        0%   { opacity:0.85; }
        30%  { opacity:0.7; }
        100% { opacity:0; }
      }
      @keyframes seal-stamp {
        0%   { transform:translate(-50%,-50%) scale(0); opacity:0; }
        60%  { opacity:1; }
        100% { transform:translate(-50%,-50%) scale(1); opacity:0.75; }
      }
    `;
    document.head.appendChild(style);
  }

  stop() {
    clearTimeout(this._timer);
    if (this._container) { this._container.remove(); this._container = null; }
  }
}
