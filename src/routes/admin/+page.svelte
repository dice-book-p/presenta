<script>
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE } from '$lib/config.js';

  // ── Signatories ──────────────────────────────────────────────────────────────
  const SIGNATORIES = [
    { id: 'sign1', order: 1, title: '사장',     name: '박상형' },
    { id: 'sign2', order: 2, title: '노조위원장', name: '박종섭' },
    { id: 'sign3', order: 3, title: '부사장',    name: '김용호' },
    { id: 'sign4', order: 4, title: '본부장',    name: '정수옥' },
  ];

  const DEFAULT_PIN = '1234';

  // ── State ─────────────────────────────────────────────────────────────────────
  let pinView = $state(true);
  let pinInput = $state('');
  let pinError = $state('');
  let pin = $state('');

  let status = $state(null); // server status object
  let loading = $state(false);
  let actionMsg = $state('');
  let actionError = $state('');

  let refreshInterval = null;

  // ── PIN ───────────────────────────────────────────────────────────────────────
  function submitPin() {
    if (pinInput === DEFAULT_PIN) {
      pin = pinInput;
      pinView = false;
      fetchStatus();
      startAutoRefresh();
    } else {
      pinError = 'PIN이 올바르지 않습니다.';
      pinInput = '';
    }
  }

  function handlePinKeydown(e) {
    if (e.key === 'Enter') submitPin();
  }

  // ── API ───────────────────────────────────────────────────────────────────────
  async function fetchStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (res.ok) {
        status = await res.json();
      }
    } catch {
      // ignore network errors silently
    }
  }

  async function disconnectOne(signId) {
    actionMsg = '';
    actionError = '';
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/disconnect?pin=${encodeURIComponent(pin)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signId }),
      });
      if (res.ok) {
        const data = await res.json();
        actionMsg = data.message ?? `${signId} 연결 해제 완료`;
        await fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        actionError = data.error ?? '연결 해제에 실패했습니다.';
      }
    } catch {
      actionError = '서버에 연결할 수 없습니다.';
    } finally {
      loading = false;
    }
  }

  async function disconnectAll() {
    actionMsg = '';
    actionError = '';
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/disconnect?pin=${encodeURIComponent(pin)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const data = await res.json();
        actionMsg = data.message ?? '모든 연결을 해제했습니다.';
        await fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        actionError = data.error ?? '연결 해제에 실패했습니다.';
      }
    } catch {
      actionError = '서버에 연결할 수 없습니다.';
    } finally {
      loading = false;
    }
  }

  function startAutoRefresh() {
    clearInterval(refreshInterval);
    refreshInterval = setInterval(fetchStatus, 3000);
  }

  function isConnected(id) {
    if (!status?.connections) return false;
    return status.connections[id] === 'connected';
  }

  function isDisplayConnected() {
    return status?.display === 'connected';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  onDestroy(() => {
    clearInterval(refreshInterval);
  });
</script>

<svelte:head>
  <title>관리자 — 한전KDN</title>
</svelte:head>

<div class="page">

  {#if pinView}
    <!-- ── PIN Screen ── -->
    <div class="pin-screen">
      <div class="pin-box">
        <div class="logo-badge">한전KDN</div>
        <h1>관리자 인증</h1>
        <p class="pin-sub">관리자 PIN을 입력해주세요</p>

        {#if pinError}
          <div class="error-msg">{pinError}</div>
        {/if}

        <input
          class="pin-input"
          type="password"
          placeholder="PIN 입력"
          maxlength="10"
          bind:value={pinInput}
          onkeydown={handlePinKeydown}
          autofocus
        />

        <button class="gold-btn" onclick={submitPin}>
          확인
        </button>
      </div>
    </div>

  {:else}
    <!-- ── Admin Dashboard ── -->
    <div class="dashboard">

      <!-- Header -->
      <div class="dash-header">
        <div>
          <div class="logo-badge">한전KDN</div>
          <h1>관리자 대시보드</h1>
        </div>
        <div class="header-actions">
          <span class="refresh-note">3초마다 자동 갱신</span>
          <button class="outline-btn" onclick={fetchStatus}>새로고침</button>
          <button class="danger-btn" disabled={loading} onclick={disconnectAll}>
            전체 연결 해제
          </button>
        </div>
      </div>

      <!-- Feedback messages -->
      {#if actionMsg}
        <div class="feedback success">{actionMsg}</div>
      {/if}
      {#if actionError}
        <div class="feedback error">{actionError}</div>
      {/if}

      <!-- Status grid -->
      <div class="section">
        <h2 class="section-title">연결 현황</h2>

        <!-- Display connection -->
        <div class="conn-card" class:connected={isDisplayConnected()}>
          <div class="conn-info">
            <span class="conn-dot" class:on={isDisplayConnected()}></span>
            <div>
              <span class="conn-label">슬라이드쇼 PC</span>
              <span class="conn-status-text">
                {isDisplayConnected() ? '연결됨' : '미연결'}
              </span>
            </div>
          </div>
          {#if isDisplayConnected()}
            <button
              class="small-btn danger"
              disabled={loading}
              onclick={() => disconnectOne('display')}
            >
              해제
            </button>
          {/if}
        </div>

        <!-- Tablet connections -->
        {#each SIGNATORIES as sig}
          {@const connected = isConnected(sig.id)}
          <div class="conn-card" class:connected>
            <div class="conn-info">
              <span class="conn-dot" class:on={connected}></span>
              <div>
                <div class="conn-label">
                  <span class="conn-order">{sig.order}</span>
                  {sig.title} — {sig.name}
                </div>
                <span class="conn-status-text">
                  {connected ? '연결됨' : '미연결'}
                </span>
              </div>
            </div>
            {#if connected}
              <button
                class="small-btn danger"
                disabled={loading}
                onclick={() => disconnectOne(sig.id)}
              >
                해제
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Raw status JSON (debug) -->
      {#if status}
        <div class="section">
          <h2 class="section-title">서버 상태 (원시 데이터)</h2>
          <pre class="raw-json">{JSON.stringify(status, null, 2)}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .page {
    width: 100vw;
    min-height: 100vh;
    background: radial-gradient(ellipse at top, #12121a 0%, #0a0a0f 60%);
    display: flex;
    flex-direction: column;
  }

  /* ── PIN Screen ── */
  .pin-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .pin-box {
    background: rgba(18, 18, 26, 0.9);
    border: 1px solid rgba(201, 168, 76, 0.2);
    border-radius: 18px;
    padding: 48px 48px 40px;
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }

  .logo-badge {
    display: inline-block;
    padding: 5px 16px;
    border: 1px solid rgba(201, 168, 76, 0.5);
    border-radius: 20px;
    color: #c9a84c;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    background: rgba(201, 168, 76, 0.06);
  }

  .pin-box h1 {
    font-size: 26px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .pin-sub {
    font-size: 14px;
    color: rgba(232, 224, 208, 0.45);
  }

  .error-msg {
    background: rgba(200, 60, 60, 0.12);
    border: 1px solid rgba(200, 60, 60, 0.3);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 13px;
    color: #e07070;
    width: 100%;
  }

  .pin-input {
    width: 100%;
    padding: 14px 18px;
    background: rgba(255, 255, 255, 0.05);
    border: 1.5px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    color: #f0e8d8;
    font-size: 20px;
    text-align: center;
    letter-spacing: 0.2em;
    font-family: inherit;
    transition: border-color 0.2s;
    outline: none;
  }

  .pin-input:focus {
    border-color: rgba(201, 168, 76, 0.5);
  }

  .pin-input::placeholder {
    color: rgba(232, 224, 208, 0.2);
    letter-spacing: 0;
    font-size: 14px;
  }

  .gold-btn {
    width: 100%;
    padding: 14px;
    background: rgba(201, 168, 76, 0.15);
    border: 1.5px solid rgba(201, 168, 76, 0.5);
    border-radius: 10px;
    color: #c9a84c;
    font-size: 16px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 4px;
  }

  .gold-btn:hover {
    background: rgba(201, 168, 76, 0.25);
    border-color: #c9a84c;
    box-shadow: 0 4px 16px rgba(201, 168, 76, 0.2);
  }

  /* ── Dashboard ── */
  .dashboard {
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 40px 24px 60px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .dash-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }

  .dash-header h1 {
    font-size: 26px;
    font-weight: 700;
    color: #f0e8d8;
    margin-top: 10px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .refresh-note {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.3);
  }

  .outline-btn {
    padding: 9px 18px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: rgba(232, 224, 208, 0.7);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .outline-btn:hover {
    background: rgba(255, 255, 255, 0.09);
    color: #f0e8d8;
  }

  .danger-btn {
    padding: 9px 18px;
    background: rgba(200, 60, 60, 0.12);
    border: 1px solid rgba(200, 60, 60, 0.3);
    border-radius: 8px;
    color: #e07070;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .danger-btn:hover:not(:disabled) {
    background: rgba(200, 60, 60, 0.2);
    border-color: rgba(200, 60, 60, 0.5);
  }

  .danger-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* ── Feedback ── */
  .feedback {
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 14px;
  }

  .feedback.success {
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid rgba(76, 175, 80, 0.25);
    color: #80c883;
  }

  .feedback.error {
    background: rgba(200, 60, 60, 0.1);
    border: 1px solid rgba(200, 60, 60, 0.25);
    color: #e07070;
  }

  /* ── Section ── */
  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.4);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* ── Connection cards ── */
  .conn-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    transition: border-color 0.3s, background 0.3s;
  }

  .conn-card.connected {
    background: rgba(201, 168, 76, 0.05);
    border-color: rgba(201, 168, 76, 0.15);
  }

  .conn-info {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .conn-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #333;
    flex-shrink: 0;
    transition: background 0.3s;
  }

  .conn-dot.on {
    background: #c9a84c;
    box-shadow: 0 0 6px rgba(201, 168, 76, 0.4);
  }

  .conn-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #f0e8d8;
  }

  .conn-order {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(201, 168, 76, 0.1);
    border: 1px solid rgba(201, 168, 76, 0.25);
    color: #c9a84c;
    font-size: 11px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .conn-status-text {
    display: block;
    font-size: 12px;
    color: rgba(232, 224, 208, 0.35);
    margin-top: 2px;
    font-weight: 400;
  }

  .small-btn {
    padding: 6px 14px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .small-btn.danger {
    background: rgba(200, 60, 60, 0.1);
    border: 1px solid rgba(200, 60, 60, 0.3);
    color: #e07070;
  }

  .small-btn.danger:hover:not(:disabled) {
    background: rgba(200, 60, 60, 0.2);
  }

  .small-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Raw JSON ── */
  .raw-json {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 10px;
    padding: 16px 18px;
    font-size: 12px;
    color: rgba(232, 224, 208, 0.4);
    font-family: 'SF Mono', 'Fira Code', monospace;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
  }
</style>
