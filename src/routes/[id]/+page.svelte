<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { API_BASE } from '$lib/config.js';

  const projectId = $derived($page.params.id);

  const SS_PIN_KEY = 'presenta_pin_verified';

  let project = $state(null);
  let loading = $state(true);
  let step = $state('pin'); // 'pin' | 'roles'
  let pinInput = $state('');
  let pinError = $state('');
  let notFound = $state(false);
  let signQr = $state('');

  /** PIN 인증된 프로젝트 ID 목록을 sessionStorage에서 관리 */
  function isPinVerified(id) {
    try {
      const list = JSON.parse(sessionStorage.getItem(SS_PIN_KEY) || '[]');
      return list.includes(id);
    } catch { return false; }
  }

  function markPinVerified(id) {
    try {
      const list = JSON.parse(sessionStorage.getItem(SS_PIN_KEY) || '[]');
      if (!list.includes(id)) list.push(id);
      sessionStorage.setItem(SS_PIN_KEY, JSON.stringify(list));
    } catch {}
  }

  onMount(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/active`);
      if (res.ok) {
        const list = await res.json();
        project = list.find(p => p.id === projectId) ?? null;
        if (!project) notFound = true;
      }
    } catch {}

    // PIN이 없거나, 이미 인증된 프로젝트면 바로 역할 선택
    if (project && (!project.hasPin || isPinVerified(projectId))) {
      step = 'roles';
    }
    loading = false;

    // 서명 페이지 QR 생성
    if (project) {
      try {
        const QRCode = await import('qrcode');
        const signUrl = `${window.location.origin}/${projectId}/sign`;
        signQr = await QRCode.default.toDataURL(signUrl, {
          width: 160, margin: 1, color: { dark: '#c9a84c', light: '#0d0d14' }
        });
      } catch {}
    }
  });

  async function verifyPin() {
    pinError = '';
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        markPinVerified(projectId);
        step = 'roles';
      } else {
        pinError = 'PIN이 올바르지 않습니다';
      }
    } catch {
      pinError = '서버 연결 실패';
    }
  }

  function goBack() {
    goto('/');
  }
</script>

<main>
  <div class="hero">
    <div class="logo-area">
      <div class="logo-badge">Presenta</div>
      {#if loading}
        <h1 class="title">불러오는 중...</h1>
      {:else if notFound}
        <h1 class="title">프로젝트를 찾을 수 없습니다</h1>
        <button class="back-btn" onclick={() => goto('/')}>← 행사 목록으로</button>
      {:else if project}
        <h1 class="title project-name">{project.name}</h1>
      {/if}
    </div>

    {#if !loading && project}
      <!-- PIN 입력 -->
      {#if step === 'pin'}
        <div class="pin-section">
          <p class="pin-label">참여 PIN을 입력해주세요</p>
          {#if pinError}<div class="pin-error">{pinError}</div>{/if}
          <input class="pin-input" type="password" placeholder="PIN" maxlength="10"
            bind:value={pinInput} onkeydown={e => e.key === 'Enter' && verifyPin()} autofocus />
          <div class="pin-actions">
            <button class="btn-ghost" onclick={goBack}>뒤로</button>
            <button class="btn-gold" onclick={verifyPin} disabled={!pinInput.trim()}>확인</button>
          </div>
        </div>

      <!-- 역할 선택 -->
      {:else if step === 'roles'}
        <div class="buttons">
          <button class="role-btn primary" onclick={() => { sessionStorage.setItem(`display_fresh_${projectId}`, 'true'); goto(`/${projectId}/display`); }}>
            <span class="btn-icon">🖥</span>
            <span class="btn-label">슬라이드쇼</span>
            <span class="btn-desc">PC / 메인 화면용</span>
          </button>

          <button class="role-btn secondary" onclick={() => goto(`/${projectId}/sign`)}>
            <span class="btn-icon">✍</span>
            <span class="btn-label">서명</span>
            <span class="btn-desc">태블릿 / 서명 입력용</span>
          </button>
        </div>

        <!-- 서명 QR: PC에서만 표시 -->
        {#if signQr}
          <div class="qr-section">
            <div class="qr-divider"></div>
            <p class="qr-label">📱 태블릿 서명 접속</p>
            <img class="qr-img" src={signQr} alt="서명 페이지 QR" />
            <p class="qr-hint">태블릿이나 모바일에서 스캔하면 서명 페이지로 바로 접속됩니다</p>
          </div>
        {/if}

        <button class="back-btn" onclick={goBack}>← 다른 행사 선택</button>
      {/if}
    {/if}
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
    gap: 40px;
    z-index: 1;
    width: 100%;
    max-width: 700px;
  }

  .logo-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
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

  .title.project-name {
    font-size: clamp(24px, 4vw, 36px);
  }

  /* ── PIN ── */
  .pin-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
    max-width: 320px;
  }

  .pin-label {
    font-size: 15px;
    color: rgba(232, 224, 208, 0.6);
  }

  .pin-error {
    font-size: 13px;
    color: #e85d5d;
    background: rgba(232, 93, 93, 0.1);
    border: 1px solid rgba(232, 93, 93, 0.3);
    padding: 8px 16px;
    border-radius: 8px;
    width: 100%;
    text-align: center;
  }

  .pin-input {
    width: 100%;
    padding: 14px 18px;
    border-radius: 12px;
    border: 1.5px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
    color: #f0e8d8;
    font-size: 18px;
    text-align: center;
    letter-spacing: 0.3em;
    outline: none;
    font-family: inherit;
    transition: border-color 0.2s;
  }

  .pin-input:focus {
    border-color: rgba(201, 168, 76, 0.6);
  }

  .pin-actions {
    display: flex;
    gap: 12px;
    width: 100%;
  }

  .btn-gold {
    flex: 1;
    padding: 12px;
    border-radius: 10px;
    background: rgba(201, 168, 76, 0.2);
    border: 1.5px solid rgba(201, 168, 76, 0.5);
    color: #c9a84c;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }

  .btn-gold:hover:not(:disabled) {
    background: rgba(201, 168, 76, 0.3);
  }

  .btn-gold:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn-ghost {
    padding: 12px 20px;
    border-radius: 10px;
    background: none;
    border: 1.5px solid rgba(255, 255, 255, 0.12);
    color: rgba(232, 224, 208, 0.5);
    font-size: 15px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }

  .btn-ghost:hover {
    border-color: rgba(255, 255, 255, 0.3);
    color: rgba(232, 224, 208, 0.8);
  }

  /* ── Role buttons ── */
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
    font-family: inherit;
    color: inherit;
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

  .back-btn {
    background: none;
    border: none;
    color: rgba(232, 224, 208, 0.35);
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
    padding: 8px 16px;
    border-radius: 6px;
    transition: color 0.2s;
    margin-top: -16px;
  }

  .back-btn:hover {
    color: rgba(201, 168, 76, 0.7);
  }

  /* ── QR section ── */
  .qr-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: -8px;
  }

  .qr-divider {
    width: 50px;
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin-bottom: 2px;
  }

  .qr-label {
    font-size: 13px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.5);
    margin: 0;
  }

  .qr-img {
    width: 120px;
    height: 120px;
    border-radius: 10px;
    border: 1px solid rgba(201, 168, 76, 0.2);
  }

  .qr-hint {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.3);
    margin: 0;
    text-align: center;
    max-width: 260px;
    line-height: 1.4;
  }

  @media (max-width: 768px) {
    .qr-section { display: none; }
  }
</style>
