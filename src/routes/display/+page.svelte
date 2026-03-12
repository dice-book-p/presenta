<script>
  import { onMount, onDestroy } from 'svelte';
  import { wsStore } from '$lib/stores/websocket.svelte.js';

  // ── Slides ──────────────────────────────────────────────────────────────────
  const SLIDES = [
    '/img/1.jpg',
    '/img/2.jpg',
    '/img/3.jpg',
    '/img/4.jpg',
    '/img/4-1.jpg',
    '/img/5.jpg',
    '/img/5-1-사장.jpg',       // index 6
    '/img/5-2-노조위원장.jpg',  // index 7
    '/img/5-3-부사장1.jpg',    // index 8
    '/img/5-4-본부장.jpg',     // index 9
    '/img/6.jpg',
    '/img/6-1.jpg',
    '/img/7.jpg',
    '/img/7-1.jpg',
    '/img/8.jpg',
    '/img/9.jpg',
  ];

  // ── Signatories ─────────────────────────────────────────────────────────────
  const SIGNATORIES = [
    { id: 'sign1', order: 1, title: '사장',     name: '박상형', slideIndex: 6, canvasArea: { top: '62%', right: '2%', width: '20%', height: '22%' } },
    { id: 'sign2', order: 2, title: '노조위원장', name: '박종섭', slideIndex: 7, canvasArea: { top: '62%', right: '2%', width: '20%', height: '22%' } },
    { id: 'sign3', order: 3, title: '부사장',    name: '김용호', slideIndex: 8, canvasArea: { top: '62%', right: '2%', width: '20%', height: '22%' } },
    { id: 'sign4', order: 4, title: '본부장',    name: '정수옥', slideIndex: 9, canvasArea: { top: '62%', right: '2%', width: '20%', height: '22%' } },
  ];

  // ── State ────────────────────────────────────────────────────────────────────
  let currentSlide = $state(0);
  let connectionStatus = $state({}); // { sign1: 'connected'|'disconnected', ... }
  let rejected = $state(false);
  let rejectReason = $state('');
  let identified = $state(false);

  // signId → canvas element map (populated in onMount)
  let canvasRefs = $state({});
  // signId → CanvasRenderingContext2D
  let ctxMap = {};

  // Pointer state per canvas for draw
  let drawingState = {}; // signId → { lastX, lastY }

  // Sign slide indices (for showing canvases)
  const SIGN_SLIDE_INDICES = new Set(SIGNATORIES.map(s => s.slideIndex));

  // ── Derived ──────────────────────────────────────────────────────────────────
  let isSignSlide = $derived(SIGN_SLIDE_INDICES.has(currentSlide));
  let currentSignatory = $derived(SIGNATORIES.find(s => s.slideIndex === currentSlide) ?? null);

  // ── Canvas helpers ────────────────────────────────────────────────────────────
  function getCtx(signId) {
    if (ctxMap[signId]) return ctxMap[signId];
    const canvas = canvasRefs[signId];
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    ctxMap[signId] = ctx;
    return ctx;
  }

  function handleDraw(msg) {
    const canvas = canvasRefs[msg.signId];
    if (!canvas) return;
    const ctx = getCtx(msg.signId);
    if (!ctx) return;

    const px = msg.x * canvas.width;
    const py = msg.y * canvas.height;

    if (msg.action === 'start') {
      ctx.beginPath();
      ctx.moveTo(px, py);
      drawingState[msg.signId] = { lastX: px, lastY: py };
    } else if (msg.action === 'move') {
      const prev = drawingState[msg.signId];
      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev.lastX, prev.lastY);
        ctx.lineTo(px, py);
        ctx.stroke();
        drawingState[msg.signId] = { lastX: px, lastY: py };
      }
    } else if (msg.action === 'end') {
      drawingState[msg.signId] = null;
    }
  }

  function clearCanvas(signId) {
    const canvas = canvasRefs[signId];
    if (!canvas) return;
    const ctx = getCtx(signId);
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ── Keyboard navigation ──────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      if (currentSlide < SLIDES.length - 1) {
        currentSlide++;
        wsStore.send({ type: 'slide_change', slideIndex: currentSlide });
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentSlide > 0) {
        currentSlide--;
        wsStore.send({ type: 'slide_change', slideIndex: currentSlide });
      }
    } else if (e.key === 'f' || e.key === 'F') {
      document.documentElement.requestFullscreen?.();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);

    // Connect WebSocket
    wsStore.connect();

    // Wait for connection then identify
    const unsubConnected = wsStore.on('identified', (msg) => {
      identified = true;
      connectionStatus = msg.connections ?? {};
    });

    const unsubRejected = wsStore.on('rejected', (msg) => {
      rejected = true;
      rejectReason = msg.reason === 'display_occupied'
        ? '이미 다른 슬라이드쇼 화면이 연결되어 있습니다.'
        : '연결이 거부되었습니다.';
    });

    const unsubStatus = wsStore.on('connection_status', (msg) => {
      connectionStatus = msg.connections ?? {};
    });

    const unsubSlide = wsStore.on('slide', (msg) => {
      // server-driven slide change (not used for display normally, but handle it)
    });

    const unsubDraw = wsStore.on('draw', handleDraw);

    const unsubSignDone = wsStore.on('sign_done', (msg) => {
      // tablet finished signing — no action needed on display
    });

    const unsubSignClear = wsStore.on('sign_clear', (msg) => {
      clearCanvas(msg.signId);
    });

    // Send identify when WS is connected (use polling via $effect-like watch)
    let identifyInterval = setInterval(() => {
      if (wsStore.status === 'connected' && !identified && !rejected) {
        wsStore.send({ type: 'identify_display' });
      }
    }, 500);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(identifyInterval);
      unsubConnected();
      unsubRejected();
      unsubStatus();
      unsubSlide();
      unsubDraw();
      unsubSignDone();
      unsubSignClear();
      wsStore.disconnect();
    };
  });

  // Re-send identify when connection state changes to connected
  $effect(() => {
    if (wsStore.status === 'connected' && !identified && !rejected) {
      wsStore.send({ type: 'identify_display' });
    }
  });

  // Status label helpers
  function tabletLabel(signId) {
    const s = SIGNATORIES.find(x => x.id === signId);
    return s ? `${s.title} (${s.name})` : signId;
  }

  function isTabletConnected(signId) {
    return connectionStatus[signId] === 'connected';
  }
</script>

<svelte:head>
  <title>슬라이드쇼 표출 — 한전KDN</title>
</svelte:head>

{#if rejected}
  <!-- Rejection screen -->
  <div class="fullscreen center">
    <div class="reject-box">
      <div class="reject-icon">⚠</div>
      <h2>연결 거부됨</h2>
      <p>{rejectReason}</p>
      <button class="gold-btn" onclick={() => { rejected = false; wsStore.connect(); }}>
        다시 시도
      </button>
    </div>
  </div>
{:else}
  <!-- Main display -->
  <div class="fullscreen slideshow">

    <!-- Slide image -->
    <img
      class="slide-img"
      src={SLIDES[currentSlide]}
      alt="슬라이드 {currentSlide + 1}"
    />

    <!-- Signature canvas overlays (always mounted, only visible on sign slides) -->
    {#each SIGNATORIES as sig (sig.id)}
      <canvas
        bind:this={canvasRefs[sig.id]}
        class="sig-canvas"
        class:visible={currentSlide === sig.slideIndex}
        style="
          top: {sig.canvasArea.top};
          right: {sig.canvasArea.right};
          width: {sig.canvasArea.width};
          height: {sig.canvasArea.height};
        "
        width="600"
        height="200"
      ></canvas>
    {/each}

    <!-- Connection status panel (top-right) -->
    <div class="status-panel">
      <div class="status-panel-header">
        <span class="ws-dot" class:connected={wsStore.status === 'connected'}></span>
        <span class="ws-label">
          {#if wsStore.status === 'connected' && identified}
            연결됨
          {:else if wsStore.status === 'connecting'}
            연결 중…
          {:else}
            미연결
          {/if}
        </span>
      </div>

      <div class="tablet-list">
        {#each SIGNATORIES as sig}
          <div class="tablet-item" class:active={isTabletConnected(sig.id)}>
            <span class="tablet-dot" class:on={isTabletConnected(sig.id)}></span>
            <span class="tablet-name">{sig.title}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Slide counter (bottom-center) -->
    <div class="slide-counter">
      {currentSlide + 1} / {SLIDES.length}
    </div>

    <!-- Arrow navigation hints -->
    <button
      class="nav-btn nav-prev"
      onclick={() => {
        if (currentSlide > 0) {
          currentSlide--;
          wsStore.send({ type: 'slide_change', slideIndex: currentSlide });
        }
      }}
      aria-label="이전 슬라이드"
    >‹</button>

    <button
      class="nav-btn nav-next"
      onclick={() => {
        if (currentSlide < SLIDES.length - 1) {
          currentSlide++;
          wsStore.send({ type: 'slide_change', slideIndex: currentSlide });
        }
      }}
      aria-label="다음 슬라이드"
    >›</button>
  </div>
{/if}

<style>
  .fullscreen {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #000;
  }

  .center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Slideshow ── */
  .slideshow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .slide-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* ── Signature canvases ── */
  .sig-canvas {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    /* transparent background so signatures float over image */
  }

  .sig-canvas.visible {
    opacity: 1;
  }

  /* ── Status panel ── */
  .status-panel {
    position: absolute;
    top: 16px;
    right: 16px;
    background: rgba(10, 10, 15, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(201, 168, 76, 0.2);
    border-radius: 10px;
    padding: 12px 14px;
    min-width: 140px;
    z-index: 10;
  }

  .status-panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .ws-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    flex-shrink: 0;
    transition: background 0.3s;
  }

  .ws-dot.connected {
    background: #4caf50;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.6);
  }

  .ws-label {
    font-size: 11px;
    color: rgba(232, 224, 208, 0.6);
    font-weight: 500;
  }

  .tablet-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tablet-item {
    display: flex;
    align-items: center;
    gap: 7px;
    opacity: 0.45;
    transition: opacity 0.3s;
  }

  .tablet-item.active {
    opacity: 1;
  }

  .tablet-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #444;
    flex-shrink: 0;
    transition: background 0.3s;
  }

  .tablet-dot.on {
    background: #c9a84c;
    box-shadow: 0 0 5px rgba(201, 168, 76, 0.5);
  }

  .tablet-name {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.8);
  }

  /* ── Slide counter ── */
  .slide-counter {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10, 10, 15, 0.7);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    padding: 5px 14px;
    font-size: 12px;
    color: rgba(232, 224, 208, 0.5);
    z-index: 10;
    pointer-events: none;
  }

  /* ── Nav buttons ── */
  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 48px;
    height: 80px;
    background: rgba(10, 10, 15, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: rgba(232, 224, 208, 0.4);
    font-size: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    opacity: 0;
    transition: opacity 0.2s, color 0.2s;
    cursor: pointer;
  }

  .slideshow:hover .nav-btn {
    opacity: 1;
  }

  .nav-btn:hover {
    color: rgba(232, 224, 208, 0.9);
    background: rgba(10, 10, 15, 0.75);
  }

  .nav-prev { left: 16px; }
  .nav-next { right: 16px; }

  /* ── Rejection screen ── */
  .reject-box {
    background: rgba(18, 18, 26, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.25);
    border-radius: 16px;
    padding: 48px 56px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    max-width: 420px;
  }

  .reject-icon {
    font-size: 40px;
    color: #e5a44b;
  }

  .reject-box h2 {
    font-size: 22px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .reject-box p {
    font-size: 15px;
    color: rgba(232, 224, 208, 0.6);
    line-height: 1.5;
  }

  .gold-btn {
    margin-top: 8px;
    padding: 12px 32px;
    background: rgba(201, 168, 76, 0.15);
    border: 1.5px solid rgba(201, 168, 76, 0.5);
    border-radius: 8px;
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
