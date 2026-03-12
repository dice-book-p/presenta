<script>
  import { onMount } from 'svelte';
  import { wsStore } from '$lib/stores/websocket.svelte.js';
  import { API_BASE } from '$lib/config.js';

  // URL에서 토큰 + 프로젝트 ID 추출
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const token = params.get('t') ?? '';
  const projectId = params.get('p') ?? '';

  let project      = $state(null);
  let slideOrder   = $state(0);
  let rejected     = $state(false);
  let rejectReason = $state('');
  let identified   = $state(false);
  let noProject    = $state(false);

  const sortedSlides = $derived(
    [...(project?.slides ?? [])].sort((a, b) => a.order - b.order)
  );
  const currentSlide = $derived(
    sortedSlides.findIndex(s => s.order === slideOrder)
  );
  const currentSlideObj = $derived(sortedSlides[Math.max(0, currentSlide)] ?? null);
  const totalSlides = $derived(sortedSlides.length);

  function sendSlide(direction) {
    wsStore.send({ type: 'remote_slide', direction });
  }

  onMount(() => {
    if (!token) {
      rejected = true;
      rejectReason = '접근 토큰이 없습니다. 관리자 화면의 QR 코드를 스캔해주세요.';
      return;
    }

    wsStore.connect();
    const unsubs = [];

    unsubs.push(wsStore.on('identified', (msg) => {
      identified = true;
      project = msg.project;
      slideOrder = msg.currentSlideOrder ?? 0;
      noProject = false;
    }));

    unsubs.push(wsStore.on('rejected', (msg) => {
      rejected = true;
      if (msg.reason === 'no_active_project') {
        noProject = true;
        rejectReason = '';
      } else if (msg.reason === 'invalid_token') {
        rejectReason = '유효하지 않은 접근 토큰입니다.';
      } else {
        rejectReason = '연결이 거부되었습니다.';
      }
    }));

    unsubs.push(wsStore.on('slide_update', (msg) => {
      slideOrder = msg.slideOrder ?? slideOrder;
    }));

    unsubs.push(wsStore.on('active_changed', () => {
      window.location.reload();
    }));

    // Identify
    let identifyInterval = setInterval(() => {
      if (wsStore.status === 'connected' && !identified && !rejected) {
        wsStore.send({ type: 'identify_remote', token, projectId });
      }
    }, 500);

    return () => {
      clearInterval(identifyInterval);
      unsubs.forEach(fn => fn());
      wsStore.disconnect();
    };
  });

  $effect(() => {
    if (wsStore.status === 'connected' && !identified && !rejected && token) {
      wsStore.send({ type: 'identify_remote', token });
    }
  });
</script>

<svelte:head><title>리모컨 — Presenta</title></svelte:head>

{#if !token || (rejected && !noProject)}
  <div class="screen center">
    <div class="info-box">
      <div class="info-icon">🔒</div>
      <h2>접근 불가</h2>
      <p>{rejectReason || '유효하지 않은 접근입니다.'}</p>
    </div>
  </div>

{:else if noProject}
  <div class="screen center">
    <div class="info-box">
      <div class="info-icon">⏳</div>
      <h2>대기 중</h2>
      <p>활성 프로젝트가 없습니다.</p>
    </div>
  </div>

{:else if !identified}
  <div class="screen center">
    <div class="info-box">
      <div class="spinner"></div>
      <p>연결 중…</p>
    </div>
  </div>

{:else}
  <div class="screen remote">
    <!-- 슬라이드 썸네일 -->
    <div class="slide-preview">
      {#if currentSlideObj}
        <img class="preview-img" src={currentSlideObj.url} alt="현재 슬라이드" />
      {/if}
    </div>

    <!-- 슬라이드 인디케이터 -->
    <div class="slide-indicator">
      <span class="slide-num">{Math.max(1, currentSlide + 1)}</span>
      <span class="slide-sep"> / </span>
      <span class="slide-total">{totalSlides}</span>
    </div>

    <!-- 점 인디케이터 (최대 12개) -->
    {#if totalSlides <= 20}
      <div class="dot-row">
        {#each sortedSlides as sl, i}
          <span class="dot" class:active={i === Math.max(0, currentSlide)}></span>
        {/each}
      </div>
    {/if}

    <!-- 이전 / 다음 버튼 -->
    <div class="nav-row">
      <button class="nav-btn prev"
        disabled={currentSlide <= 0}
        onclick={() => sendSlide('prev')}>
        ‹
      </button>
      <button class="nav-btn next"
        disabled={currentSlide >= totalSlides - 1}
        onclick={() => sendSlide('next')}>
        ›
      </button>
    </div>

    <div class="project-name">{project?.name ?? ''}</div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
    background: #0a0a0f;
    color: #f0e8d8;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .screen {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .info-box {
    background: rgba(18, 18, 26, 0.95);
    border: 1px solid rgba(201, 168, 76, 0.25);
    border-radius: 16px;
    padding: 40px 48px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 320px;
  }

  .info-icon { font-size: 36px; }
  .info-box h2 { font-size: 20px; font-weight: 700; color: #f0e8d8; margin: 0; }
  .info-box p { font-size: 14px; color: rgba(232, 224, 208, 0.55); margin: 0; line-height: 1.6; }

  .spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(201, 168, 76, 0.15);
    border-top-color: #c9a84c;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Remote UI ── */
  .remote {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 24px 20px 40px;
    box-sizing: border-box;
    gap: 16px;
  }

  .slide-preview {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

  .preview-img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 10px;
    object-fit: contain;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .slide-indicator {
    font-size: 22px;
    font-weight: 700;
    display: flex;
    align-items: baseline;
    gap: 4px;
    flex-shrink: 0;
  }

  .slide-num { color: #c9a84c; font-size: 28px; }
  .slide-sep { color: rgba(232, 224, 208, 0.3); font-size: 18px; }
  .slide-total { color: rgba(232, 224, 208, 0.45); }

  .dot-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    flex-shrink: 0;
    max-width: 300px;
  }

  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    transition: background 0.2s, transform 0.2s;
  }

  .dot.active {
    background: #c9a84c;
    transform: scale(1.35);
    box-shadow: 0 0 6px rgba(201, 168, 76, 0.5);
  }

  .nav-row {
    display: flex;
    gap: 24px;
    flex-shrink: 0;
  }

  .nav-btn {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: rgba(201, 168, 76, 0.1);
    border: 2px solid rgba(201, 168, 76, 0.35);
    color: #c9a84c;
    font-size: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  .nav-btn:active:not(:disabled) {
    background: rgba(201, 168, 76, 0.25);
    border-color: #c9a84c;
    transform: scale(0.94);
  }

  .nav-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  .project-name {
    font-size: 12px;
    color: rgba(232, 224, 208, 0.25);
    text-align: center;
    flex-shrink: 0;
  }
</style>
