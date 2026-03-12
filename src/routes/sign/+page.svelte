<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { wsStore } from '$lib/stores/websocket.svelte.js';
  import { session } from '$lib/stores/session.svelte.js';

  // ── Signatories ──────────────────────────────────────────────────────────────
  const SIGNATORIES = [
    { id: 'sign1', order: 1, title: '사장',     name: '박상형', slideIndex: 6 },
    { id: 'sign2', order: 2, title: '노조위원장', name: '박종섭', slideIndex: 7 },
    { id: 'sign3', order: 3, title: '부사장',    name: '김용호', slideIndex: 8 },
    { id: 'sign4', order: 4, title: '본부장',    name: '정수옥', slideIndex: 9 },
  ];

  // ── State ─────────────────────────────────────────────────────────────────────
  let view = $state('login'); // 'login' | 'signing' | 'done'
  let errorMsg = $state('');
  let connectedTablets = $state({}); // signId → bool
  let activeSignId = $state(null);   // which tablet is currently active (from server)
  let signDone = $state(false);

  // Canvas
  let canvasEl = $state(null);
  let ctx = $derived.by(() => {
    if (!canvasEl) return null;
    const c = canvasEl.getContext('2d');
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#1a1a2e';
    return c;
  });

  let isDrawing = $state(false);
  let lastX = 0;
  let lastY = 0;

  // Derived: is it my turn?
  let isMyTurn = $derived(
    session.data !== null && activeSignId === session.data.signId
  );

  // ── Login: select signatory ───────────────────────────────────────────────────
  function selectSignatory(sig) {
    errorMsg = '';
    session.save({ signId: sig.id, title: sig.title, name: sig.name, order: sig.order });
    connectAndIdentify();
  }

  function connectAndIdentify() {
    wsStore.connect();
    view = 'signing';
    signDone = false;
  }

  // ── Logout ────────────────────────────────────────────────────────────────────
  function logout() {
    wsStore.disconnect();
    session.clear();
    view = 'login';
    errorMsg = '';
    signDone = false;
    activeSignId = null;
    connectedTablets = {};
    if (canvasEl) {
      const c = canvasEl.getContext('2d');
      c.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
  }

  // ── Drawing (Pointer Events) ──────────────────────────────────────────────────
  function onPointerDown(e) {
    if (!isMyTurn || !canvasEl) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    isDrawing = true;
    const x = e.offsetX / canvasEl.clientWidth;
    const y = e.offsetY / canvasEl.clientHeight;
    lastX = e.offsetX * (canvasEl.width / canvasEl.clientWidth);
    lastY = e.offsetY * (canvasEl.height / canvasEl.clientHeight);
    ctx?.beginPath();
    ctx?.moveTo(lastX, lastY);
    wsStore.send({ type: 'draw', signId: session.data.signId, x, y, action: 'start' });
  }

  function onPointerMove(e) {
    if (!isDrawing || !isMyTurn || !canvasEl || !ctx) return;
    e.preventDefault();
    const x = e.offsetX / canvasEl.clientWidth;
    const y = e.offsetY / canvasEl.clientHeight;
    const px = e.offsetX * (canvasEl.width / canvasEl.clientWidth);
    const py = e.offsetY * (canvasEl.height / canvasEl.clientHeight);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(px, py);
    ctx.stroke();
    lastX = px;
    lastY = py;
    wsStore.send({ type: 'draw', signId: session.data.signId, x, y, action: 'move' });
  }

  function onPointerUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    const x = e.offsetX / canvasEl.clientWidth;
    const y = e.offsetY / canvasEl.clientHeight;
    wsStore.send({ type: 'draw', signId: session.data.signId, x, y, action: 'end' });
  }

  function clearSignature() {
    if (!canvasEl || !ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    wsStore.send({ type: 'sign_clear', signId: session.data.signId });
  }

  function completeSignature() {
    wsStore.send({ type: 'sign_done', signId: session.data.signId });
    signDone = true;
  }

  // ── WebSocket handlers ────────────────────────────────────────────────────────
  let cleanups = [];

  function setupHandlers() {
    cleanups.push(wsStore.on('identified', (msg) => {
      connectedTablets = msg.connections ?? {};
    }));

    cleanups.push(wsStore.on('rejected', (msg) => {
      const reason = msg.reason === 'tablet_occupied'
        ? '이미 해당 서명자로 다른 기기가 연결되어 있습니다.'
        : '연결이 거부되었습니다.';
      session.clear();
      wsStore.disconnect();
      view = 'login';
      errorMsg = reason;
    }));

    cleanups.push(wsStore.on('connection_status', (msg) => {
      connectedTablets = msg.connections ?? {};
    }));

    cleanups.push(wsStore.on('slide', (msg) => {
      activeSignId = msg.activeSignId ?? null;
    }));

    cleanups.push(wsStore.on('sign_clear', (msg) => {
      // Optionally handle remote clear (for display page; tablet doesn't need this)
    }));

    cleanups.push(wsStore.on('force_disconnect', () => {
      session.clear();
      wsStore.disconnect();
      view = 'login';
      errorMsg = '관리자에 의해 연결이 해제되었습니다. 다시 선택해주세요.';
      activeSignId = null;
    }));
  }

  function teardownHandlers() {
    cleanups.forEach(fn => fn());
    cleanups = [];
  }

  // ── Send identify whenever WS connects ──────────────────────────────────────
  $effect(() => {
    if (wsStore.status === 'connected' && view === 'signing' && session.data) {
      wsStore.send({ type: 'identify_tablet', signId: session.data.signId });
    }
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  onMount(() => {
    setupHandlers();

    // Restore session
    if (session.hasSession) {
      view = 'signing';
      connectAndIdentify();
    }

    return () => {
      teardownHandlers();
    };
  });
</script>

<svelte:head>
  <title>서명자 화면 — 한전KDN</title>
</svelte:head>

{#if view === 'login'}
  <!-- ── LOGIN ── -->
  <div class="page login-page">
    <div class="login-container">
      <div class="login-header">
        <div class="logo-badge">한전KDN</div>
        <h1>서명자 선택</h1>
        <p class="login-sub">서명하실 역할을 선택해주세요</p>
      </div>

      {#if errorMsg}
        <div class="error-banner">
          <span>⚠</span> {errorMsg}
        </div>
      {/if}

      <div class="sign-list">
        {#each SIGNATORIES as sig}
          {@const isConnected = connectedTablets[sig.id] === 'connected'}
          <button
            class="sign-item"
            class:occupied={isConnected}
            disabled={isConnected}
            onclick={() => selectSignatory(sig)}
          >
            <div class="sign-item-info">
              <span class="sign-order">{sig.order}</span>
              <div class="sign-text">
                <span class="sign-title">{sig.title}</span>
                <span class="sign-name">{sig.name}</span>
              </div>
            </div>
            {#if isConnected}
              <span class="badge-connected">연결됨</span>
            {:else}
              <span class="badge-select">선택 →</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>

{:else if view === 'signing'}
  <!-- ── SIGNING ── -->
  <div class="page signing-page">

    <!-- Top bar -->
    <div class="top-bar">
      <div class="signer-info">
        <span class="signer-title">{session.data?.title ?? ''}</span>
        <span class="signer-name">{session.data?.name ?? ''}</span>
      </div>
      <div class="top-bar-right">
        <!-- WS status dot -->
        <div class="ws-status" title={wsStore.status}>
          <span class="ws-dot" class:connected={wsStore.status === 'connected'}></span>
          <span class="ws-label">
            {#if wsStore.status === 'connected'}연결됨{:else if wsStore.status === 'connecting'}연결 중…{:else}미연결{/if}
          </span>
        </div>
        <button class="logout-btn" onclick={logout}>나가기</button>
      </div>
    </div>

    {#if signDone}
      <!-- Completion screen -->
      <div class="done-screen">
        <div class="done-icon">✓</div>
        <h2>서명 완료</h2>
        <p>서명이 성공적으로 제출되었습니다.</p>
        <button class="gold-btn" onclick={logout}>처음으로</button>
      </div>

    {:else}
      <!-- Status banner -->
      <div class="status-banner" class:active={isMyTurn}>
        {#if isMyTurn}
          <span class="status-dot blink"></span>
          <span>서명 진행 중</span>
        {:else}
          <span class="status-dot waiting"></span>
          <span>대기 중</span>
        {/if}
      </div>

      <!-- Canvas area -->
      <div class="canvas-wrap">
        <canvas
          bind:this={canvasEl}
          class="sig-canvas"
          class:inactive={!isMyTurn}
          width="800"
          height="400"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
        ></canvas>

        {#if !isMyTurn}
          <div class="waiting-overlay">
            <div class="waiting-content">
              <div class="waiting-icon">⏳</div>
              <p>차례를 기다리고 있습니다</p>
              <p class="waiting-sub">슬라이드가 진행되면 자동으로 활성화됩니다</p>
            </div>
          </div>
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="action-row">
        <button
          class="action-btn clear-btn"
          disabled={!isMyTurn}
          onclick={clearSignature}
        >
          다시 서명
        </button>
        <button
          class="action-btn done-btn"
          disabled={!isMyTurn}
          onclick={completeSignature}
        >
          서명 완료
        </button>
      </div>

      <p class="hint-text">
        {#if isMyTurn}
          위 영역에 서명해주세요. 서명이 완료되면 "서명 완료" 버튼을 눌러주세요.
        {:else}
          PC 화면의 슬라이드가 해당 서약서 페이지로 이동하면 서명이 활성화됩니다.
        {/if}
      </p>
    {/if}
  </div>
{/if}

<style>
  .page {
    width: 100vw;
    min-height: 100vh;
    background: radial-gradient(ellipse at top, #12121a 0%, #0a0a0f 60%);
    display: flex;
    flex-direction: column;
  }

  /* ── LOGIN ── */
  .login-page {
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .login-container {
    width: 100%;
    max-width: 500px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .login-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
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

  .login-header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .login-sub {
    font-size: 14px;
    color: rgba(232, 224, 208, 0.45);
  }

  .error-banner {
    background: rgba(200, 60, 60, 0.12);
    border: 1px solid rgba(200, 60, 60, 0.3);
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 14px;
    color: #e07070;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sign-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sign-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    background: rgba(255, 255, 255, 0.03);
    border: 1.5px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    color: inherit;
  }

  .sign-item:not(:disabled):hover {
    border-color: rgba(201, 168, 76, 0.5);
    background: rgba(201, 168, 76, 0.07);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .sign-item.occupied {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .sign-item-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .sign-order {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(201, 168, 76, 0.1);
    border: 1px solid rgba(201, 168, 76, 0.3);
    color: #c9a84c;
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sign-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
  }

  .sign-title {
    font-size: 15px;
    font-weight: 600;
    color: #f0e8d8;
  }

  .sign-name {
    font-size: 13px;
    color: rgba(232, 224, 208, 0.5);
  }

  .badge-connected {
    font-size: 12px;
    font-weight: 600;
    color: #4caf50;
    background: rgba(76, 175, 80, 0.12);
    border: 1px solid rgba(76, 175, 80, 0.3);
    padding: 4px 10px;
    border-radius: 12px;
  }

  .badge-select {
    font-size: 13px;
    color: rgba(201, 168, 76, 0.7);
  }

  /* ── SIGNING ── */
  .signing-page {
    padding: 0;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: rgba(10, 10, 15, 0.9);
    border-bottom: 1px solid rgba(201, 168, 76, 0.15);
    backdrop-filter: blur(12px);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .signer-info {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .signer-title {
    font-size: 13px;
    color: #c9a84c;
    font-weight: 600;
    background: rgba(201, 168, 76, 0.1);
    border: 1px solid rgba(201, 168, 76, 0.25);
    padding: 3px 10px;
    border-radius: 12px;
  }

  .signer-name {
    font-size: 20px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .top-bar-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .ws-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ws-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    transition: background 0.3s;
  }

  .ws-dot.connected {
    background: #4caf50;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.5);
  }

  .ws-label {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.5);
  }

  .logout-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: rgba(232, 224, 208, 0.6);
    font-size: 13px;
    padding: 8px 16px;
    font-family: inherit;
    transition: all 0.2s;
  }

  .logout-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f0e8d8;
  }

  /* ── Status banner ── */
  .status-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 24px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 14px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.45);
    transition: all 0.3s;
  }

  .status-banner.active {
    background: rgba(201, 168, 76, 0.08);
    border-bottom-color: rgba(201, 168, 76, 0.2);
    color: #c9a84c;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.waiting {
    background: #555;
  }

  .status-dot.blink {
    background: #c9a84c;
    animation: pulse-dot 1.2s infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(201, 168, 76, 0.5); }
    50% { opacity: 0.7; box-shadow: 0 0 0 5px rgba(201, 168, 76, 0); }
  }

  /* ── Canvas area ── */
  .canvas-wrap {
    flex: 1;
    position: relative;
    margin: 24px 20px 0;
    border-radius: 14px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.97);
    border: 2px solid rgba(255, 255, 255, 0.12);
    min-height: 320px;
    max-height: 50vh;
  }

  .sig-canvas {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: crosshair;
  }

  .sig-canvas.inactive {
    cursor: not-allowed;
  }

  .waiting-overlay {
    position: absolute;
    inset: 0;
    background: rgba(10, 10, 15, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
  }

  .waiting-content {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .waiting-icon {
    font-size: 36px;
    opacity: 0.7;
  }

  .waiting-content p {
    font-size: 16px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.85);
  }

  .waiting-sub {
    font-size: 13px !important;
    color: rgba(232, 224, 208, 0.45) !important;
    font-weight: 400 !important;
  }

  /* ── Action buttons ── */
  .action-row {
    display: flex;
    gap: 12px;
    padding: 20px 20px 8px;
  }

  .action-btn {
    flex: 1;
    padding: 18px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 700;
    font-family: inherit;
    transition: all 0.2s;
    cursor: pointer;
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .clear-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1.5px solid rgba(255, 255, 255, 0.12);
    color: rgba(232, 224, 208, 0.7);
  }

  .clear-btn:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .done-btn {
    background: rgba(201, 168, 76, 0.15);
    border: 1.5px solid rgba(201, 168, 76, 0.4);
    color: #c9a84c;
  }

  .done-btn:not(:disabled):hover {
    background: rgba(201, 168, 76, 0.25);
    border-color: #c9a84c;
    box-shadow: 0 4px 16px rgba(201, 168, 76, 0.2);
  }

  .hint-text {
    padding: 0 20px 20px;
    font-size: 13px;
    color: rgba(232, 224, 208, 0.35);
    text-align: center;
    line-height: 1.5;
  }

  /* ── Done screen ── */
  .done-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 40px 20px;
    text-align: center;
  }

  .done-icon {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(76, 175, 80, 0.12);
    border: 2px solid rgba(76, 175, 80, 0.4);
    color: #4caf50;
    font-size: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .done-screen h2 {
    font-size: 26px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .done-screen p {
    font-size: 15px;
    color: rgba(232, 224, 208, 0.55);
  }

  .gold-btn {
    margin-top: 8px;
    padding: 14px 36px;
    background: rgba(201, 168, 76, 0.15);
    border: 1.5px solid rgba(201, 168, 76, 0.5);
    border-radius: 10px;
    color: #c9a84c;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .gold-btn:hover {
    background: rgba(201, 168, 76, 0.25);
    border-color: #c9a84c;
  }
</style>
