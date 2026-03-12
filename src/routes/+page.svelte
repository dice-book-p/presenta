<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { API_BASE } from '$lib/config.js';

  let activeProject = $state(null);
  let displayQr = $state('');
  let signQr    = $state('');

  async function genQr(text) {
    const QRCode = await import('qrcode');
    return QRCode.default.toDataURL(text, { width: 160, margin: 1, color: { dark: '#c9a84c', light: '#0a0a0f' } });
  }

  onMount(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/active`);
      if (res.ok) {
        const data = await res.json();
        if (data?.id) {
          activeProject = data;
          const base = window.location.origin;
          [displayQr, signQr] = await Promise.all([
            genQr(`${base}/display`),
            genQr(`${base}/sign`),
          ]);
        }
      }
    } catch {}
  });
</script>

<main>
  <div class="hero">
    <div class="logo-area">
      <div class="logo-badge">한전KDN</div>
      <h1 class="title">단체협약 체결식</h1>
      <p class="subtitle">시스템 역할을 선택해주세요</p>
    </div>

    <div class="buttons">
      <button class="role-btn primary" onclick={() => goto('/display')}>
        <span class="btn-icon">🖥</span>
        <span class="btn-label">슬라이드쇼 표출</span>
        <span class="btn-desc">PC / 메인 화면용</span>
      </button>

      <button class="role-btn secondary" onclick={() => goto('/sign')}>
        <span class="btn-icon">✍</span>
        <span class="btn-label">서명자 화면</span>
        <span class="btn-desc">태블릿 / 서명 입력용</span>
      </button>
    </div>

    {#if activeProject && displayQr && signQr}
      <div class="qr-section">
        <div class="qr-section-label">
          <span class="qr-active-dot"></span>
          활성 프로젝트: <strong>{activeProject.name}</strong>
        </div>
        <div class="qr-grid">
          <div class="qr-card">
            <div class="qr-card-label">슬라이드쇼 PC</div>
            <img class="qr-img" src={displayQr} alt="슬라이드쇼 QR" />
            <code class="qr-url">/display</code>
          </div>
          <div class="qr-card">
            <div class="qr-card-label">서명자 태블릿</div>
            <img class="qr-img" src={signQr} alt="서명자 QR" />
            <code class="qr-url">/sign</code>
          </div>
        </div>
      </div>
    {/if}

    <div class="admin-link">
      <button class="link-btn" onclick={() => goto('/admin')}>관리자 페이지</button>
    </div>
  </div>
</main>

<style>
  main {
    width: 100vw;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at center, #12121a 0%, #0a0a0f 70%);
    overflow: hidden;
    position: relative;
    padding: 40px 20px;
    box-sizing: border-box;
  }

  main::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 20% 50%, rgba(201, 168, 76, 0.04) 0%, transparent 50%),
      radial-gradient(circle at 80% 50%, rgba(201, 168, 76, 0.04) 0%, transparent 50%);
    pointer-events: none;
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 48px;
    z-index: 1;
    width: 100%;
    max-width: 700px;
  }

  .logo-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .logo-badge {
    display: inline-block;
    padding: 6px 20px;
    border: 1px solid rgba(201, 168, 76, 0.5);
    border-radius: 20px;
    color: #c9a84c;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.15em;
    background: rgba(201, 168, 76, 0.06);
  }

  .title {
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 700;
    color: #f0e8d8;
    letter-spacing: -0.02em;
    text-align: center;
    margin: 0;
  }

  .subtitle {
    font-size: 16px;
    color: rgba(232, 224, 208, 0.5);
    letter-spacing: 0.05em;
    margin: 0;
  }

  .buttons {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .role-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 48px;
    border-radius: 16px;
    min-width: 220px;
    transition: all 0.25s ease;
    position: relative;
    overflow: hidden;
    background: none;
  }

  .role-btn.primary {
    background: rgba(201, 168, 76, 0.1);
    border: 1.5px solid rgba(201, 168, 76, 0.4);
  }

  .role-btn.primary:hover {
    border-color: rgba(201, 168, 76, 0.8);
    transform: translateY(-4px);
    box-shadow: 0 16px 40px rgba(201, 168, 76, 0.15);
    background: rgba(201, 168, 76, 0.15);
  }

  .role-btn.secondary {
    background: rgba(255, 255, 255, 0.04);
    border: 1.5px solid rgba(255, 255, 255, 0.12);
  }

  .role-btn.secondary:hover {
    border-color: rgba(201, 168, 76, 0.5);
    transform: translateY(-4px);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
    background: rgba(255, 255, 255, 0.07);
  }

  .btn-icon {
    font-size: 36px;
    line-height: 1;
  }

  .btn-label {
    font-size: 20px;
    font-weight: 700;
    color: #f0e8d8;
    letter-spacing: -0.01em;
  }

  .btn-desc {
    font-size: 13px;
    color: rgba(232, 224, 208, 0.45);
  }

  /* QR section */
  .qr-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
  }

  .qr-section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: rgba(232, 224, 208, 0.5);
  }

  .qr-section-label strong {
    color: rgba(201, 168, 76, 0.9);
    font-weight: 600;
  }

  .qr-active-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c9a84c;
    box-shadow: 0 0 6px rgba(201, 168, 76, 0.6);
    flex-shrink: 0;
  }

  .qr-grid {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .qr-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 20px;
  }

  .qr-card-label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.45);
    letter-spacing: 0.04em;
  }

  .qr-img {
    border-radius: 8px;
  }

  .qr-url {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.35);
    font-family: monospace;
  }

  .admin-link {
    margin-top: -16px;
  }

  .link-btn {
    background: none;
    color: rgba(232, 224, 208, 0.3);
    font-size: 13px;
    padding: 8px 16px;
    border-radius: 6px;
    transition: color 0.2s;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .link-btn:hover {
    color: rgba(201, 168, 76, 0.7);
  }
</style>
