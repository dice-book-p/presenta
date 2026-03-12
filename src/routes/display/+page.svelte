<script>
  import { onMount } from 'svelte';
  import { tick } from 'svelte';
  import { wsStore } from '$lib/stores/websocket.svelte.js';
  import { API_BASE } from '$lib/config.js';

  // ── State ─────────────────────────────────────────────────────────────────────
  let project      = $state(null);
  let currentSlide = $state(0);
  let rejected     = $state(false);
  let rejectReason = $state('');
  let identified   = $state(false);
  let noProject    = $state(false);  // active project not set

  // sig.id → canvas element (populated by bind:this)
  let canvasRefs   = $state({});
  // sig.id → CanvasRenderingContext2D
  let ctxMap       = {};
  // sig.id → { lastX, lastY }
  let drawingState = {};

  // ── Derived ──────────────────────────────────────────────────────────────────
  const sortedSlides = $derived(
    [...(project?.slides ?? [])].sort((a, b) => a.order - b.order)
  );
  const currentSlideObj = $derived(sortedSlides[currentSlide] ?? null);
  const isSummarySlide  = $derived(
    !!project?.summarySlideId && currentSlideObj?.id === project.summarySlideId
  );

  // ── ±2 preload ──────────────────────────────────────────────────────────────
  let preloadedUrls = new Set();

  $effect(() => {
    const slides = sortedSlides;
    if (!slides.length) return;
    for (let i = Math.max(0, currentSlide - 2); i <= Math.min(slides.length - 1, currentSlide + 2); i++) {
      const url = slides[i]?.url;
      if (url && !preloadedUrls.has(url)) {
        const img = new Image();
        img.src = url;
        preloadedUrls.add(url);
      }
    }
  });

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  function getCtx(sig) {
    if (ctxMap[sig.id]) return ctxMap[sig.id];
    const canvas = canvasRefs[sig.id];
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = sig.color || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur  = 3;
    ctxMap[sig.id]  = ctx;
    return ctx;
  }

  function getCanvasArea(sig) {
    return isSummarySlide ? (sig.summaryArea ?? sig.canvasArea) : sig.canvasArea;
  }

  function isCanvasVisible(sig) {
    if (!project) return false;
    return isSummarySlide || currentSlideObj?.id === sig.slideId;
  }

  function areaStyle(area) {
    if (!area) return '';
    // Support both left-based and right-based (legacy) positioning
    const left = area.left
      ?? (area.right ? `calc(100% - ${area.right} - ${area.width})` : '0%');
    return `top:${area.top};left:${left};width:${area.width};height:${area.height}`;
  }

  function handleDraw(msg) {
    const sig = project?.signatories?.find(s => s.id === msg.signId);
    if (!sig) return;
    const canvas = canvasRefs[msg.signId];
    if (!canvas) return;
    const ctx = getCtx(sig);
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
    const ctx = ctxMap[signId];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function saveSignatureToServer(signId) {
    if (!project) return;
    const canvas = canvasRefs[signId];
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    try {
      await fetch(`${API_BASE}/api/projects/${project.id}/signatures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signId, dataUrl }),
      });
    } catch {}
  }

  async function restoreSignatures() {
    if (!project) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${project.id}/signatures`);
      if (!res.ok) return;
      const saved = await res.json();
      for (const [signId, dataUrl] of Object.entries(saved)) {
        if (!dataUrl) continue;
        const canvas = canvasRefs[signId];
        if (!canvas) continue;
        const sig = project.signatories.find(s => s.id === signId);
        if (!sig) continue;
        const img = new Image();
        img.onload = () => {
          const ctx = getCtx(sig);
          if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = dataUrl;
      }
    } catch {}
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const SS_SLIDE = 'display_slide';

  function goToSlide(idx) {
    if (!sortedSlides.length) return;
    const newIdx = Math.max(0, Math.min(sortedSlides.length - 1, idx));
    if (newIdx === currentSlide) return;
    currentSlide = newIdx;
    sessionStorage.setItem(SS_SLIDE, String(newIdx));
    wsStore.send({ type: 'slide_change', slideIndex: sortedSlides[newIdx].order });
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault(); goToSlide(currentSlide + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); goToSlide(currentSlide - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      document.documentElement.requestFullscreen?.();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    wsStore.connect();

    const unsubs = [];

    unsubs.push(wsStore.on('identified', async (msg) => {
      identified = true;
      if (msg.project) {
        project = msg.project;
        noProject = false;
        ctxMap = {};  // reset ctx cache on project load
        // 저장된 슬라이드 인덱스 복원
        const saved = sessionStorage.getItem(SS_SLIDE);
        if (saved !== null) {
          const idx = parseInt(saved, 10);
          if (!isNaN(idx) && idx < msg.project.slides.length) {
            currentSlide = idx;
          }
        }
        await tick(); // wait for canvas elements to bind
        restoreSignatures();
      }
    }));

    unsubs.push(wsStore.on('rejected', (msg) => {
      rejected = true;
      if (msg.reason === 'no_active_project') {
        noProject = true;
        rejectReason = '';
      } else if (msg.reason === 'display_occupied') {
        rejectReason = '이미 다른 슬라이드쇼 화면이 연결되어 있습니다.';
      } else {
        rejectReason = '연결이 거부되었습니다.';
      }
    }));

    // 활성 프로젝트 변경 → 슬라이드 인덱스 초기화 후 리로드
    unsubs.push(wsStore.on('active_changed', () => {
      sessionStorage.removeItem(SS_SLIDE);
      window.location.reload();
    }));

    unsubs.push(wsStore.on('draw', handleDraw));

    unsubs.push(wsStore.on('sign_done', (msg) => {
      saveSignatureToServer(msg.signId);
      goToSlide(currentSlide + 1);
    }));

    unsubs.push(wsStore.on('sign_clear', (msg) => {
      clearCanvas(msg.signId);
    }));

    unsubs.push(wsStore.on('remote_slide', (msg) => {
      if (msg.direction === 'next') goToSlide(currentSlide + 1);
      else if (msg.direction === 'prev') goToSlide(currentSlide - 1);
    }));

    // identify 전송 (연결 직후 & 재연결 시)
    let identifyInterval = setInterval(() => {
      if (wsStore.status === 'connected' && !identified && !rejected) {
        wsStore.send({ type: 'identify_display' });
      }
    }, 500);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(identifyInterval);
      unsubs.forEach(fn => fn());
      wsStore.disconnect();
    };
  });

  $effect(() => {
    if (wsStore.status === 'connected' && !identified && !rejected) {
      wsStore.send({ type: 'identify_display' });
    }
  });
</script>

<svelte:head>
  <title>슬라이드쇼 — 한전KDN</title>
</svelte:head>

<!-- 활성 프로젝트 없음 -->
{#if noProject}
  <div class="fullscreen center">
    <div class="info-box">
      <div class="info-icon">⏳</div>
      <h2>대기 중</h2>
      <p>활성 프로젝트가 없습니다.</p>
      <p class="sub">관리자가 프로젝트를 활성화하면 자동으로 연결됩니다.</p>
    </div>
  </div>

<!-- 연결 거부 -->
{:else if rejected}
  <div class="fullscreen center">
    <div class="info-box">
      <div class="info-icon">⚠</div>
      <h2>연결 거부됨</h2>
      <p>{rejectReason}</p>
      <button class="gold-btn" onclick={() => { rejected = false; identified = false; wsStore.connect(); }}>
        다시 시도
      </button>
    </div>
  </div>

<!-- 프로젝트 로딩 중 -->
{:else if !project}
  <div class="fullscreen center">
    <div class="info-box">
      <div class="spinner"></div>
      <p>연결 중…</p>
    </div>
  </div>

<!-- 슬라이드쇼 -->
{:else}
  <div class="fullscreen slideshow">
    <div class="slide-wrapper">
      <!-- 현재 슬라이드 이미지 -->
      {#if currentSlideObj}
        <img
          class="slide-img"
          src={currentSlideObj.url}
          alt="슬라이드 {currentSlide + 1}"
        />
      {/if}

      <!-- 서명 캔버스 오버레이 (항상 마운트, visibility만 토글) -->
      {#each project.signatories as sig (sig.id)}
        {@const visible = isCanvasVisible(sig)}
        {@const area = getCanvasArea(sig)}
        <canvas
          bind:this={canvasRefs[sig.id]}
          class="sig-canvas"
          class:visible={visible && !!area}
          style={visible && area ? areaStyle(area) : ''}
          width="600"
          height="200"
        ></canvas>
      {/each}
    </div>

    <!-- 슬라이드 카운터 -->
    <div class="slide-counter">
      {currentSlide + 1} / {sortedSlides.length}
    </div>

    <!-- 이전/다음 버튼 -->
    <button
      class="nav-btn nav-prev"
      onclick={() => goToSlide(currentSlide - 1)}
      aria-label="이전 슬라이드"
    >‹</button>
    <button
      class="nav-btn nav-next"
      onclick={() => goToSlide(currentSlide + 1)}
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

  /* ── Info / wait screens ── */
  .info-box {
    background: rgba(18, 18, 26, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.25);
    border-radius: 16px;
    padding: 48px 56px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    max-width: 400px;
  }

  .info-icon {
    font-size: 40px;
    color: #e5a44b;
  }

  .info-box h2 {
    font-size: 22px;
    font-weight: 700;
    color: #f0e8d8;
    margin: 0;
  }

  .info-box p {
    font-size: 15px;
    color: rgba(232, 224, 208, 0.6);
    margin: 0;
    line-height: 1.5;
  }

  .info-box .sub {
    font-size: 13px;
    color: rgba(232, 224, 208, 0.35);
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(201, 168, 76, 0.15);
    border-top-color: #c9a84c;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Slideshow ── */
  .slideshow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

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

  .slideshow:hover .nav-btn { opacity: 1; }
  .nav-btn:hover { color: rgba(232, 224, 208, 0.9); background: rgba(10, 10, 15, 0.75); }
  .nav-prev { left: 16px; }
  .nav-next { right: 16px; }

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
