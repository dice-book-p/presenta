<script>
  import { onMount, onDestroy } from 'svelte';
  import { wsStore } from '$lib/stores/websocket.svelte.js';
  import { API_BASE } from '$lib/config.js';

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
  // canvasArea: 개별 서명 슬라이드에서의 위치 (이미지 기준 %)
  // summaryArea: 종합 서약서 슬라이드(index 11)에서의 위치 (이미지 기준 %)
  // left/right/top/width/height 모두 % 단위 → 브라우저 크기에 동적 대응
  const SIGNATORIES = [
    { id: 'sign1', order: 1, title: '사장',     name: '박상형', slideIndex: 6,
      canvasArea:  { top: '76%', right: '14%',   width: '17%',   height: '10%' },
      summaryArea: { top: '78.1%', left: '50.9%', width: '16.1%', height: '9.1%' } },
    { id: 'sign2', order: 2, title: '노조위원장', name: '박종섭', slideIndex: 7,
      canvasArea:  { top: '76%', right: '14%',   width: '17%',   height: '10%' },
      summaryArea: { top: '78.1%', left: '32.5%', width: '16.1%', height: '9.1%' } },
    { id: 'sign3', order: 3, title: '부사장',    name: '김용호', slideIndex: 8,
      canvasArea:  { top: '76%', right: '14%',   width: '17%',   height: '10%' },
      summaryArea: { top: '78.1%', left: '69.4%', width: '16.1%', height: '9.1%' } },
    { id: 'sign4', order: 4, title: '본부장',    name: '정수옥', slideIndex: 9,
      canvasArea:  { top: '76%', right: '14%',   width: '17%',   height: '10%' },
      summaryArea: { top: '78.1%', left: '14.5%', width: '16.1%', height: '9.1%' } },
  ];

  // 종합 서약서 슬라이드 index
  const SUMMARY_SLIDE_INDEX = 11;

  // ── State ────────────────────────────────────────────────────────────────────
  let currentSlide = $state(0);
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
  let isSummarySlide = $derived(currentSlide === SUMMARY_SLIDE_INDEX);

  // ── Canvas helpers ────────────────────────────────────────────────────────────
  function getCtx(signId) {
    if (ctxMap[signId]) return ctxMap[signId];
    const canvas = canvasRefs[signId];
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#c9a84c';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
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

  async function saveSignatureToServer(signId) {
    const canvas = canvasRefs[signId];
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    try {
      await fetch(`${API_BASE}/api/signatures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signId, dataUrl }),
      });
    } catch {}
  }

  async function restoreSignatures() {
    try {
      const res = await fetch(`${API_BASE}/api/signatures`);
      if (!res.ok) return;
      const saved = await res.json();
      for (const [signId, dataUrl] of Object.entries(saved)) {
        if (!dataUrl) continue;
        const canvas = canvasRefs[signId];
        if (!canvas) continue;
        const img = new Image();
        img.onload = () => {
          const ctx = getCtx(signId);
          if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = dataUrl;
      }
    } catch {}
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

    // Restore persisted signatures from server
    restoreSignatures();

    // Wait for connection then identify
    const unsubConnected = wsStore.on('identified', (msg) => {
      identified = true;
    });

    const unsubRejected = wsStore.on('rejected', (msg) => {
      rejected = true;
      rejectReason = msg.reason === 'display_occupied'
        ? '이미 다른 슬라이드쇼 화면이 연결되어 있습니다.'
        : '연결이 거부되었습니다.';
    });

    const unsubStatus = wsStore.on('connection_status', () => {});

    const unsubSlide = wsStore.on('slide', (msg) => {
      // server-driven slide change (not used for display normally, but handle it)
    });

    const unsubDraw = wsStore.on('draw', handleDraw);

    const unsubSignDone = wsStore.on('sign_done', (msg) => {
      // 서명 완료 → 서버에 저장 후 다음 슬라이드로 자동 전환
      saveSignatureToServer(msg.signId);
      if (currentSlide < SLIDES.length - 1) {
        currentSlide++;
        wsStore.send({ type: 'slide_change', slideIndex: currentSlide });
      }
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

    <!-- 이미지 + 캔버스를 같은 비율 래퍼로 감싸서 좌표 정합성 확보 -->
    <div class="slide-wrapper">
      <img
        class="slide-img"
        src={SLIDES[currentSlide]}
        alt="슬라이드 {currentSlide + 1}"
      />

      <!-- Signature canvas overlays (always mounted, visible on sign/summary slides) -->
      {#each SIGNATORIES as sig (sig.id)}
        {@const onIndividual = currentSlide === sig.slideIndex}
        {@const onSummary = isSummarySlide}
        {@const area = onSummary ? sig.summaryArea : sig.canvasArea}
        <canvas
          bind:this={canvasRefs[sig.id]}
          class="sig-canvas"
          class:visible={onIndividual || onSummary}
          style="
            top: {area.top};
            {area.left ? `left: ${area.left};` : `right: ${area.right};`}
            width: {area.width};
            height: {area.height};
          "
          width="600"
          height="200"
        ></canvas>
      {/each}
    </div>

    <!-- Slide counter (bottom-center) -->
    <div class="slide-counter">
      {currentSlide + 1} / {SLIDES.length}
    </div>

    <!-- Arrow navigation hints (래퍼 밖, slideshow 기준) -->
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
    background: #000;
  }

  /* 슬라이드 이미지 래퍼 — 항상 전체화면 */
  .slide-wrapper {
    position: relative;
    width: 100vw;
    height: 100vh;
  }

  .slide-img {
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  /* ── Signature canvases ── */
  .sig-canvas {
    position: absolute;
    pointer-events: none;
    display: none;
  }

  .sig-canvas.visible {
    display: block;
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
