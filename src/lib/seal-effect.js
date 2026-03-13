/**
 * SealEffect — CSS 애니메이션 기반 서명완료 이펙트
 *
 * 1) 파티클 burst (div 기반)
 * 2) 방사형 빛 퍼짐
 * 3) 서명 영역 glow + scale bounce
 */
export class SealEffect {
  constructor() {
    this._container = null;
    this._timer = null;
  }

  /**
   * @param {HTMLElement} parentEl — 풀스크린 overlay 대상
   * @param {{ sealColor: string, sealDuration: number }} config
   * @param {Function} onComplete
   */
  play(parentEl, config, onComplete) {
    this.stop();
    const color = config.sealColor || '#c9a84c';
    const duration = (config.sealDuration || 6) * 1000;

    // 컨테이너
    const container = document.createElement('div');
    container.className = 'seal-effect-container';
    container.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;';
    parentEl.appendChild(container);
    this._container = container;

    // 1) 파티클 burst
    const burstCount = 120;
    for (let i = 0; i < burstCount; i++) {
      const p = document.createElement('div');
      const angle = (Math.PI * 2 * i) / burstCount + (Math.random() - 0.5) * 0.5;
      const dist = 100 + Math.random() * 400;
      const size = 3 + Math.random() * 6;
      const delay = Math.random() * 0.3;
      const dur = 1 + Math.random() * 1.5;

      p.style.cssText = `
        position:absolute;
        left:50%;top:50%;
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${color};
        box-shadow:0 0 ${size * 2}px ${color};
        opacity:0;
        transform:translate(-50%,-50%);
        animation:seal-burst ${dur}s ${delay}s ease-out forwards;
        --tx:${Math.cos(angle) * dist}px;
        --ty:${Math.sin(angle) * dist}px;
      `;
      container.appendChild(p);
    }

    // 2) 방사형 빛 퍼짐
    const glow = document.createElement('div');
    glow.style.cssText = `
      position:absolute;
      left:50%;top:50%;
      width:0;height:0;
      border-radius:50%;
      background:radial-gradient(circle, ${color}44 0%, transparent 70%);
      transform:translate(-50%,-50%);
      animation:seal-radial 2s ease-out forwards;
    `;
    container.appendChild(glow);

    // 3) 중앙 stamp glow
    const stamp = document.createElement('div');
    stamp.style.cssText = `
      position:absolute;
      left:50%;top:50%;
      width:120px;height:120px;
      border-radius:50%;
      border:3px solid ${color};
      box-shadow:0 0 40px ${color}, inset 0 0 30px ${color}44;
      transform:translate(-50%,-50%) scale(0);
      animation:seal-stamp 0.6s 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards;
      opacity:0;
    `;
    container.appendChild(stamp);

    // CSS keyframes 삽입 (한번만)
    if (!document.getElementById('seal-effect-styles')) {
      const style = document.createElement('style');
      style.id = 'seal-effect-styles';
      style.textContent = `
        @keyframes seal-burst {
          0% { opacity:1; transform:translate(-50%,-50%) translate(0,0) scale(1); }
          100% { opacity:0; transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) scale(0.3); }
        }
        @keyframes seal-radial {
          0% { width:0; height:0; opacity:0.8; }
          100% { width:800px; height:800px; opacity:0; }
        }
        @keyframes seal-stamp {
          0% { transform:translate(-50%,-50%) scale(0); opacity:0; }
          60% { opacity:1; }
          100% { transform:translate(-50%,-50%) scale(1); opacity:0.7; }
        }
      `;
      document.head.appendChild(style);
    }

    // duration 후 정리
    this._timer = setTimeout(() => {
      this.stop();
      if (onComplete) onComplete();
    }, duration);
  }

  stop() {
    clearTimeout(this._timer);
    if (this._container) {
      this._container.remove();
      this._container = null;
    }
  }
}
