<script>
  import { onMount } from 'svelte';
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { wsStore } from '$lib/stores/websocket.svelte.js';
  import { API_BASE } from '$lib/config.js';
  import { AudioManager } from '$lib/audio-manager.js';
  import { ParticleEngine } from '$lib/particle-engine.js';
  import { SealEffect } from '$lib/seal-effect.js';
  import { getEffectConfig } from '$lib/effect-themes.js';

  // URL 라우트에서 프로젝트 ID 추출
  const projectId = $derived($page.params.id);

  // ── State ─────────────────────────────────────────────────────────────────────
  let project      = $state(null);
  let currentSlide = $state(0);
  let rejected     = $state(false);
  let rejectReason = $state('');
  let identified   = $state(false);
  let noProject    = $state(false);  // active project not set

  // ── Effect state ────────────────────────────────────────────────────────────
  let mounted = false;
  let effectConfig  = $state(null);
  let mediaUrls     = $state({});
  let audioManager  = null;
  let particleEngine = null;
  let sealEffect    = null;
  let particleCanvas = $state(null);
  let slideWrapperEl = $state(null);
  let bgmPlaying    = $state(false);
  let playingVideo   = $state(null); // blob URL for fullscreen video overlay
  let frozenFrames   = $state({});   // slideIndex → JPEG data URL (마지막 프레임 스냅샷)
  let videoBlobUrls  = {};           // signId → blob URL cache
  let failedVideos   = new Set();    // signId set for failed video preloads

  // slide transition
  let transitionClass = $state('');
  let isTransitioning = $state(false);
  let transitionTimers = [];

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
    const color = sig.color || '#c9a84c';
    ctx.lineWidth   = 10;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = color;        // 서명자 색상 (어드민 설정값)
    ctx.shadowColor = color;        // 동일 색상으로 glow
    ctx.shadowBlur  = 22;
    ctxMap[sig.id]  = ctx;
    return ctx;
  }

  function getCanvasArea(sig) {
    if (currentSlideObj?.id === sig.slideId) return sig.canvasArea;
    const ds = sig.displaySlides?.find(d => d.slideId === currentSlideObj?.id);
    return ds?.area ?? null;
  }

  function isCanvasVisible(sig) {
    if (!project) return false;
    if (effectConfig?.mode === 'video') return false; // 영상 모드: 서명 영역 오버레이 불필요
    if (currentSlideObj?.id === sig.slideId) return true;
    return sig.displaySlides?.some(d => d.slideId === currentSlideObj?.id) ?? false;
  }

  function areaStyle(area) {
    if (!area) return '';
    // Support both left-based and right-based (legacy) positioning
    const left = area.left
      ?? (area.right ? `calc(100% - ${area.right} - ${area.width})` : '0%');
    return `top:${area.top};left:${left};width:${area.width};height:${area.height}`;
  }

  /** 베지어 곡선으로 부드럽게 한 점 그리기 */
  function drawSmoothPoint(ctx, state, px, py) {
    if (!state.lastX && state.lastX !== 0) {
      // 첫 점
      ctx.beginPath();
      ctx.moveTo(px, py);
      state.lastX = px;
      state.lastY = py;
      return;
    }
    const midX = (state.lastX + px) / 2;
    const midY = (state.lastY + py) / 2;
    // 속도 기반 두께 변화 (서예 느낌)
    const speed = Math.sqrt((px - state.lastX) ** 2 + (py - state.lastY) ** 2);
    ctx.lineWidth = Math.max(5, Math.min(13, 13 - speed * 0.22));
    ctx.quadraticCurveTo(state.lastX, state.lastY, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    state.lastX = px;
    state.lastY = py;
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

    const isVideoMode = effectConfig?.mode === 'video';

    // 실시간 모드 이펙트만 (영상 모드 제외)
    if (effectConfig && !isVideoMode && particleEngine) {
      // 서명 시작 시: ambient particle 시작
      if (msg.action === 'start' && effectConfig.ambientParticle) {
        particleEngine.startAmbient(effectConfig);
      }
      // 펜 파티클: draw 이동 중
      if (msg.action === 'move') {
        const area = getCanvasArea(sig);
        if (area) {
          const wrapW = window.innerWidth;
          const wrapH = window.innerHeight;
          const aLeft = parseFloat(area.left) / 100 * wrapW;
          const aTop = parseFloat(area.top) / 100 * wrapH;
          const aW = parseFloat(area.width) / 100 * wrapW;
          const aH = parseFloat(area.height) / 100 * wrapH;
          particleEngine.emit(aLeft + msg.x * aW, aTop + msg.y * aH, effectConfig);
        }
      }
    }

    // 서명자별 BGM: 서명 시작 시 재생
    if (effectConfig && msg.action === 'start' && audioManager) {
      audioManager.ensureResumed();
      audioManager.startBgm(msg.signId, { fadeIn: 1, loop: true });
      bgmPlaying = true;
    }

    if (msg.action === 'start') {
      ctx.beginPath();
      ctx.moveTo(px, py);
      drawingState[msg.signId] = { lastX: px, lastY: py };
    } else if (msg.action === 'move') {
      if (!drawingState[msg.signId]) {
        // start 유실 → 첫 move를 start로 처리
        ctx.beginPath();
        ctx.moveTo(px, py);
        drawingState[msg.signId] = { lastX: px, lastY: py };
      } else {
        drawSmoothPoint(ctx, drawingState[msg.signId], px, py);
      }
    } else if (msg.action === 'end') {
      // 마지막 점까지 직선 마무리
      const prev = drawingState[msg.signId];
      if (prev) {
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      drawingState[msg.signId] = null;
    }
  }

  function handleDrawBatch(msg) {
    const sig = project?.signatories?.find(s => s.id === msg.signId);
    if (!sig) return;
    const canvas = canvasRefs[msg.signId];
    if (!canvas) return;
    const ctx = getCtx(sig);
    if (!ctx) return;
    const points = msg.points;
    if (!points?.length) return;

    if (!drawingState[msg.signId]) {
      // start 유실 → 첫 배치 점을 start로
      const first = points[0];
      const fx = first.x * canvas.width;
      const fy = first.y * canvas.height;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      drawingState[msg.signId] = { lastX: fx, lastY: fy };
      // ambient 시작 (draw start 유실로 미시작된 경우 대비)
      if (effectConfig && effectConfig.mode !== 'video' && particleEngine && effectConfig.ambientParticle) {
        particleEngine.startAmbient(effectConfig);
      }
    }

    for (const pt of points) {
      const px = pt.x * canvas.width;
      const py = pt.y * canvas.height;
      drawSmoothPoint(ctx, drawingState[msg.signId], px, py);
    }

    // 펜 파티클 (실시간 모드, 배치 마지막 점 기준)
    if (effectConfig && effectConfig.mode !== 'video' && particleEngine && points.length) {
      const lastPt = points[points.length - 1];
      const area = getCanvasArea(sig);
      if (area) {
        const wrapW = window.innerWidth;
        const wrapH = window.innerHeight;
        const aLeft = parseFloat(area.left) / 100 * wrapW;
        const aTop = parseFloat(area.top) / 100 * wrapH;
        const aW = parseFloat(area.width) / 100 * wrapW;
        const aH = parseFloat(area.height) / 100 * wrapH;
        particleEngine.emit(aLeft + lastPt.x * aW, aTop + lastPt.y * aH, effectConfig);
      }
    }
  }

  function clearCanvas(signId) {
    const canvas = canvasRefs[signId];
    if (!canvas) return;
    const ctx = ctxMap[signId];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  let signSaveToast = $state('');
  let signSaveTimer = null;

  function showSignSaveToast(msg, isError = false) {
    signSaveToast = (isError ? '⚠ ' : '✓ ') + msg;
    clearTimeout(signSaveTimer);
    signSaveTimer = setTimeout(() => { signSaveToast = ''; }, 3000);
  }

  async function saveSignatureToServer(signId) {
    if (!project) return;
    const canvas = canvasRefs[signId];
    if (!canvas) return;
    const sig = project.signatories?.find(s => s.id === signId);
    const sigLabel = sig ? `${sig.title} ${sig.name}` : signId;
    const dataUrl = canvas.toDataURL('image/png');
    try {
      const res = await fetch(`${API_BASE}/api/projects/${project.id}/signatures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signId, dataUrl }),
      });
      if (res.ok) {
        showSignSaveToast(`${sigLabel} 서명 저장 완료`);
      } else {
        showSignSaveToast(`${sigLabel} 서명 저장 실패`, true);
      }
    } catch {
      showSignSaveToast(`${sigLabel} 서명 저장 실패 (네트워크)`, true);
    }
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
    } catch (e) {
      console.warn('[display] restoreSignatures failed:', e.message ?? e);
    }
  }

  // ── Slideshow modes ──────────────────────────────────────────────────────
  const SS_LOOP = 'display_loop';
  const SS_AUTO = 'display_auto';
  const SS_AUTO_SEC = 'display_auto_sec';

  let loopMode = $state(false);          // 반복 모드
  let autoPlay = $state(false);          // 자동 넘김
  let autoPlayInterval = $state(5);      // 자동 넘김 간격 (초)
  let showSlideNumber = $state(false);   // 슬라이드 번호 표시
  let slideshowTransition = $state('none'); // 슬라이드 전환 효과
  let autoPlayTimer = null;
  let boundaryToast = $state('');       // 경계 안내 메시지
  let boundaryToastTimer = null;
  let showControls = $state(false);     // 컨트롤 바 표시
  let controlsTimer = null;
  let showExitConfirm = $state(false); // 나가기 확인 다이얼로그
  let showResumePrompt = $state(false); // 이어보기 확인
  let savedSlideIdx = $state(-1);       // 저장된 슬라이드 인덱스
  let slideNumBuffer = $state('');     // 숫자 입력 버퍼 (숫자+Enter 이동)
  let slideNumTimer = null;

  const SS_SLIDE = $derived(`display_slide_${projectId}`);
  const SS_FRESH = $derived(`display_fresh_${projectId}`);

  function showBoundaryToast(msg) {
    boundaryToast = msg;
    clearTimeout(boundaryToastTimer);
    boundaryToastTimer = setTimeout(() => { boundaryToast = ''; }, 2000);
  }

  // ── Effects helpers ──────────────────────────────────────────────────────
  function isSignSlide(slideIdx) {
    if (!project?.signatories?.length || !sortedSlides.length) return false;
    const slide = sortedSlides[slideIdx];
    if (!slide) return false;
    return project.signatories.some(s =>
      s.slideId === slide.id ||
      s.displaySlides?.some(d => d.slideId === slide.id)
    );
  }

  function getSignSlideRange() {
    if (!project?.signatories?.length || !sortedSlides.length) return null;
    let first = -1, last = -1;
    for (let i = 0; i < sortedSlides.length; i++) {
      if (isSignSlide(i)) {
        if (first === -1) first = i;
        last = i;
      }
    }
    return first >= 0 ? { first, last } : null;
  }

  function isInSignRange(idx) {
    const range = getSignSlideRange();
    if (!range) return false;
    return idx >= range.first && idx <= range.last;
  }

  function initEffects(proj, urls) {
    effectConfig = getEffectConfig(proj?.signEffect);
    mediaUrls = urls || {};
    if (!effectConfig) return;

    // Audio
    audioManager = new AudioManager();
    // 서명자별 BGM preload
    if (mediaUrls.signatoryBgmUrls) {
      for (const [signId, url] of Object.entries(mediaUrls.signatoryBgmUrls)) {
        audioManager.preloadBgm(signId, url);
      }
    }
    if (mediaUrls.completeSoundUrl) audioManager.preloadComplete(mediaUrls.completeSoundUrl);

    // Particles
    if (particleCanvas) {
      particleEngine = new ParticleEngine(particleCanvas);
      particleEngine.resize(window.innerWidth, window.innerHeight);
    }

    // Seal
    sealEffect = new SealEffect();

    // Preload signatory videos
    if (effectConfig.mode === 'video' && mediaUrls.signatoryVideos) {
      for (const [signId, url] of Object.entries(mediaUrls.signatoryVideos)) {
        fetch(url).then(r => r.blob()).then(blob => {
          videoBlobUrls[signId] = URL.createObjectURL(blob);
        }).catch(() => {
          console.warn('[display] video preload failed:', url);
          failedVideos.add(signId);
        });
      }
    }
  }

  function cleanupEffects() {
    if (audioManager) { audioManager.destroy(); audioManager = null; }
    if (particleEngine) { particleEngine.destroy(); particleEngine = null; }
    if (sealEffect) { sealEffect.stop(); sealEffect = null; }
    for (const url of Object.values(videoBlobUrls)) {
      URL.revokeObjectURL(url);
    }
    videoBlobUrls = {};
    failedVideos.clear();
  }

  function handleBgmForSlide(_newIdx, _oldIdx) {
    // BGM은 이제 서명자별 재생 — 슬라이드 이동으로는 처리 불필요
  }

  function handleAmbientForSlide(newIdx) {
    if (!effectConfig || !particleEngine || effectConfig.mode === 'video') return;
    // ambient는 서명 시작(첫 draw) 시 켜짐, 비서명 슬라이드 이동 시 끔
    if (!isSignSlide(newIdx)) {
      particleEngine.stopAmbient();
    }
    // 서명 슬라이드 진입 시 자동 시작 안 함 — 첫 draw 시 시작
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function goToSlide(idx) {
    if (!sortedSlides.length) return;
    const len = sortedSlides.length;

    if (loopMode) {
      // 반복 모드: 순환
      if (idx >= len) idx = 0;
      else if (idx < 0) idx = len - 1;
    } else {
      // 비반복 모드: 경계 안내
      if (idx >= len) {
        showBoundaryToast('마지막 슬라이드입니다');
        return;
      }
      if (idx < 0) {
        showBoundaryToast('첫 번째 슬라이드입니다');
        return;
      }
    }

    if (idx === currentSlide) return;

    const oldIdx = currentSlide;
    const transition = slideshowTransition || 'none';

    if (transition !== 'none' && !isTransitioning) {
      isTransitioning = true;
      transitionClass = `trans-${transition}-out`;
      const t1 = setTimeout(() => {
        currentSlide = idx;
        transitionClass = `trans-${transition}-in`;
        const t2 = setTimeout(() => {
          transitionClass = '';
          isTransitioning = false;
        }, transition === 'diamond' ? 800 : 500);
        transitionTimers.push(t2);
      }, transition === 'diamond' ? 400 : 250);
      transitionTimers.push(t1);
    } else {
      currentSlide = idx;
    }

    sessionStorage.setItem(SS_SLIDE, String(idx));
    wsStore.send({ type: 'slide_change', slideIndex: sortedSlides[idx].order });

    // 슬라이드 이동 시 영상 오버레이 제거
    if (playingVideo) playingVideo = null;

    // Effects on slide change
    handleBgmForSlide(idx, oldIdx);
    handleAmbientForSlide(idx);
  }

  function saveSlideshowModes() {
    try {
      sessionStorage.setItem(SS_LOOP, JSON.stringify(loopMode));
      sessionStorage.setItem(SS_AUTO, JSON.stringify(autoPlay));
      sessionStorage.setItem(SS_AUTO_SEC, JSON.stringify(autoPlayInterval));
    } catch {}
  }

  function restoreSlideshowModes() {
    try {
      const l = sessionStorage.getItem(SS_LOOP);
      const a = sessionStorage.getItem(SS_AUTO);
      const s = sessionStorage.getItem(SS_AUTO_SEC);
      if (l !== null) loopMode = JSON.parse(l);
      if (a !== null) autoPlay = JSON.parse(a);
      if (s !== null) autoPlayInterval = JSON.parse(s);
    } catch {}
  }

  function toggleLoop() {
    loopMode = !loopMode;
    saveSlideshowModes();
  }

  function toggleAutoPlay() {
    autoPlay = !autoPlay;
    if (autoPlay) startAutoPlay();
    else stopAutoPlay();
    saveSlideshowModes();
  }

  function setAutoPlayInterval(sec) {
    autoPlayInterval = sec;
    if (autoPlay) { stopAutoPlay(); startAutoPlay(); }
    saveSlideshowModes();
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoPlayTimer = setInterval(() => {
      goToSlide(currentSlide + 1);
    }, autoPlayInterval * 1000);
  }

  function stopAutoPlay() {
    if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
  }

  function showControlsTemporarily() {
    showControls = true;
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => { showControls = false; }, 3000);
  }

  function handleKeyDown(e) {
    // 숫자 키 (0-9): 버퍼에 누적, 3초 후 자동 초기화
    if (e.key >= '0' && e.key <= '9') {
      slideNumBuffer += e.key;
      clearTimeout(slideNumTimer);
      slideNumTimer = setTimeout(() => { slideNumBuffer = ''; }, 3000);
      return;
    }

    // Enter: 버퍼에 숫자가 있으면 해당 슬라이드로 이동
    if (e.key === 'Enter' && slideNumBuffer) {
      const num = parseInt(slideNumBuffer, 10);
      slideNumBuffer = '';
      clearTimeout(slideNumTimer);
      if (num >= 1 && num <= sortedSlides.length) {
        goToSlide(num - 1); // 1-based → 0-based
      } else {
        showBoundaryToast(`슬라이드 ${num}번이 없습니다 (1~${sortedSlides.length})`);
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault(); goToSlide(currentSlide + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); goToSlide(currentSlide - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      document.documentElement.requestFullscreen?.();
    } else if (e.key === 'l' || e.key === 'L') {
      toggleLoop();
    } else if (e.key === 'a' || e.key === 'A') {
      toggleAutoPlay();
    } else if (e.key === 'Escape') {
      if (showExitConfirm) {
        showExitConfirm = false;
      } else {
        showExitConfirm = true;
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function applySlideshowSettings(proj) {
    const ss = proj?.slideshow;
    if (!ss) return;
    loopMode = !!ss.loop;
    autoPlay = !!ss.autoPlay;
    autoPlayInterval = Math.max(1, ss.autoPlaySec ?? 5);
    showSlideNumber = !!ss.showSlideNumber;
    slideshowTransition = ss.transition ?? 'none';
    // sessionStorage에 저장된 값이 있으면 우선 적용
    restoreSlideshowModes();
  }

  onMount(() => {
    mounted = true;
    window.addEventListener('keydown', handleKeyDown);
    const handleResize = () => {
      if (particleEngine && particleCanvas) {
        particleEngine.resize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    wsStore.connect();

    const unsubs = [];

    unsubs.push(wsStore.on('identified', async (msg) => {
      identified = true;
      if (msg.project) {
        project = msg.project;
        noProject = false;
        ctxMap = {};  // reset ctx cache on project load
        applySlideshowSettings(msg.project);
        await tick();
        cleanupEffects(); // 재접속 시 기존 blob URL/이펙트 정리
        initEffects(msg.project, msg.mediaUrls);
        const saved = sessionStorage.getItem(SS_SLIDE);
        // 역할선택 페이지에서 진입 시 플래그가 설정됨 → 새 진입
        // 새로고침 시에는 플래그 없음 → 조용히 복원
        const isFreshEntry = sessionStorage.getItem(SS_FRESH) === 'true';
        sessionStorage.removeItem(SS_FRESH); // 소비

        if (saved !== null) {
          const idx = parseInt(saved, 10);
          if (!isNaN(idx) && idx > 0 && idx < msg.project.slides.length) {
            if (isFreshEntry) {
              // 새로 진입 → 물어보기
              savedSlideIdx = idx;
              showResumePrompt = true;
            } else {
              // 새로고침 → 조용히 복원
              currentSlide = idx;
            }
          }
        }
        await tick();
        restoreSignatures();
        if (autoPlay && !showResumePrompt) startAutoPlay();
      }
    }));

    unsubs.push(wsStore.on('rejected', (msg) => {
      rejected = true;
      if (msg.reason === 'no_active_project' || msg.reason === 'project_not_active') {
        noProject = true;
        rejectReason = '';
      } else if (msg.reason === 'project_not_found') {
        rejectReason = '프로젝트를 찾을 수 없습니다.';
      } else if (msg.reason === 'display_occupied' || msg.reason === 'main_display_occupied') {
        rejectReason = '이미 다른 슬라이드쇼 화면이 연결되어 있습니다.';
      } else if (msg.reason === 'invalid_pin') {
        rejectReason = 'PIN이 올바르지 않습니다.';
      } else if (msg.reason === 'missing_project_id') {
        rejectReason = '프로젝트 ID가 없습니다. 관리자 화면에서 접속해주세요.';
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
    unsubs.push(wsStore.on('draw_batch', handleDrawBatch));

    unsubs.push(wsStore.on('sign_done', (msg) => {
      saveSignatureToServer(msg.signId);

      // Play complete sound
      if (effectConfig?.completeSoundId && audioManager) {
        audioManager.playCompleteSound(effectConfig.completeSoundVolume ?? 80);
      }

      // 서명자 BGM fadeOut (해당 서명자 BGM만 중지)
      if (bgmPlaying && audioManager) {
        audioManager.stopBgm({ fadeOut: 1, signId: msg.signId });
        bgmPlaying = false;
      }

      // Ambient 정지 (서명 완료 시)
      if (particleEngine) particleEngine.stopAmbient();

      // Mode branching
      if (!effectConfig) {
        // No effect — legacy behavior
        goToSlide(currentSlide + 1);
      } else if (effectConfig.mode === 'video') {
        // Video mode
        const blobUrl = videoBlobUrls[msg.signId];
        if (blobUrl) {
          playingVideo = blobUrl;
        } else if (effectConfig.autoAdvance) {
          goToSlide(currentSlide + 1);
        }
      } else if (effectConfig.sealEffect && sealEffect && slideWrapperEl) {
        // Realtime + seal effect
        sealEffect.play(slideWrapperEl, effectConfig, () => {
          if (mounted && effectConfig?.autoAdvance) goToSlide(currentSlide + 1);
        });
      } else {
        // Realtime, no seal
        if (effectConfig.autoAdvance) goToSlide(currentSlide + 1);
      }
    }));

    unsubs.push(wsStore.on('sign_clear', (msg) => {
      clearCanvas(msg.signId);
    }));

    // 관리자 서명 초기화 → frozenFrames + 캔버스 클리어
    unsubs.push(wsStore.on('signatures_cleared', (msg) => {
      if (msg.signId === null) {
        // 전체 초기화
        frozenFrames = {};
        playingVideo = null;
        for (const signId of Object.keys(canvasRefs)) clearCanvas(signId);
      } else {
        // 개별 초기화
        const { [msg.signId]: _removed, ...rest } = frozenFrames;
        frozenFrames = rest;
        if (playingVideo) playingVideo = null;
        clearCanvas(msg.signId);
      }
    }));

    unsubs.push(wsStore.on('remote_slide', (msg) => {
      if (msg.direction === 'next') goToSlide(currentSlide + 1);
      else if (msg.direction === 'prev') goToSlide(currentSlide - 1);
    }));

    // 재연결 시 자동 re-identify
    unsubs.push(wsStore.on('_reconnected', () => {
      identified = false;
      rejected = false;
      wsStore.send({ type: 'identify_display', projectId });
    }));

    // identify 전송 (초기 연결)
    let identifyInterval = setInterval(() => {
      if (wsStore.status === 'connected' && !identified && !rejected) {
        wsStore.send({ type: 'identify_display', projectId });
      }
    }, 500);

    return () => {
      mounted = false;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      clearInterval(identifyInterval);
      stopAutoPlay();
      clearTimeout(boundaryToastTimer);
      clearTimeout(controlsTimer);
      clearTimeout(slideNumTimer);
      clearTimeout(signSaveTimer);
      transitionTimers.forEach(t => clearTimeout(t));
      cleanupEffects();
      unsubs.forEach(fn => fn());
      wsStore.disconnect();
    };
  });

  $effect(() => {
    if (wsStore.status === 'connected' && !identified && !rejected) {
      wsStore.send({ type: 'identify_display', projectId });
    }
  });
</script>

<svelte:head>
  <title>슬라이드쇼 — Presenta</title>
</svelte:head>

<!-- 활성 프로젝트 없음 -->
{#if noProject}
  <div class="fullscreen center">
    <div class="info-box">
      <div class="info-icon">⏳</div>
      <h2>대기 중</h2>
      <p>활성 프로젝트가 없습니다.</p>
      <p class="sub">관리자가 프로젝트를 활성화하면 자동으로 연결됩니다.</p>
      <button class="back-link" onclick={() => goto(`/${projectId}`)}>← 돌아가기</button>
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
      <button class="back-link" onclick={() => goto(`/${projectId}`)}>← 돌아가기</button>
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fullscreen slideshow" onmousemove={showControlsTemporarily}
    onclick={() => audioManager?.ensureResumed()}
    onkeydown={() => audioManager?.ensureResumed()}>
    <div class="slide-wrapper {transitionClass}" bind:this={slideWrapperEl}>
      <!-- 현재 슬라이드 이미지 -->
      {#if currentSlideObj}
        <img
          class="slide-img"
          src={currentSlideObj.url}
          alt="슬라이드 {currentSlide + 1}"
        />
      {/if}

      <!-- 파티클 overlay canvas -->
      <canvas
        bind:this={particleCanvas}
        class="particle-overlay"
        width={typeof window !== 'undefined' ? window.innerWidth : 1920}
        height={typeof window !== 'undefined' ? window.innerHeight : 1080}
      ></canvas>

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

    <!-- 영상 재생 오버레이 -->
    {#if playingVideo}
      <!-- svelte-ignore a11y_media_has_caption -->
      <div class="video-overlay">
        <video src={playingVideo} autoplay
          onended={(e) => {
            // 마지막 프레임 스냅샷 저장 → 슬라이드 복귀 시 재표시
            try {
              const v = e.currentTarget;
              const snap = document.createElement('canvas');
              snap.width  = v.videoWidth  || 1920;
              snap.height = v.videoHeight || 1080;
              snap.getContext('2d').drawImage(v, 0, 0);
              frozenFrames = { ...frozenFrames, [currentSlide]: snap.toDataURL('image/jpeg', 0.92) };
            } catch {}
            playingVideo = null;
            if (mounted && effectConfig?.autoAdvance) goToSlide(currentSlide + 1);
          }}
          onerror={() => { playingVideo = null; if (mounted && effectConfig?.autoAdvance) goToSlide(currentSlide + 1); }}
          style="width:100%;height:100%;object-fit:fill"></video>
      </div>
    {/if}

    <!-- 서명 완료 영상 마지막 프레임 고정 (슬라이드 복귀 시에도 유지) -->
    {#if !playingVideo && frozenFrames[currentSlide]}
      <div class="video-overlay">
        <img src={frozenFrames[currentSlide]} alt="" style="width:100%;height:100%;object-fit:fill" />
      </div>
    {/if}

    <!-- 이어보기 확인 다이얼로그 -->
    {#if showResumePrompt}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="exit-overlay" onclick={() => { showResumePrompt = false; if (autoPlay) startAutoPlay(); }}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="exit-dialog" onclick={(e) => e.stopPropagation()}>
          <h3>이전 진행 위치가 있습니다</h3>
          <p>{savedSlideIdx + 1}번 슬라이드부터 이어서 보시겠습니까?</p>
          <div class="exit-actions">
            <button class="exit-btn cancel" onclick={() => { goToSlide(0); showResumePrompt = false; if (autoPlay) startAutoPlay(); }}>처음부터</button>
            <button class="exit-btn confirm-gold" onclick={() => { goToSlide(savedSlideIdx); showResumePrompt = false; if (autoPlay) startAutoPlay(); }}>이어보기</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- 나가기 확인 다이얼로그 -->
    {#if showExitConfirm}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="exit-overlay" onclick={() => { showExitConfirm = false; }}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="exit-dialog" onclick={(e) => e.stopPropagation()}>
          <h3>슬라이드쇼를 종료하시겠습니까?</h3>
          <p>현재 진행 중인 슬라이드쇼 연결이 해제됩니다.</p>
          <div class="exit-actions">
            <button class="exit-btn cancel" onclick={() => { showExitConfirm = false; }}>취소</button>
            <button class="exit-btn confirm" onclick={() => goto(`/${projectId}`)}>종료</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- 숫자 입력 표시 (슬라이드 번호 표시 옵션 켜져있을 때만) -->
    {#if showSlideNumber && slideNumBuffer}
      <div class="slide-num-indicator">
        <span class="num-label">이동:</span>
        <span class="num-value">{slideNumBuffer}</span>
        <span class="num-hint">Enter</span>
      </div>
    {/if}

    <!-- 서명 저장 토스트 -->
    {#if signSaveToast}
      <div class="sign-save-toast">{signSaveToast}</div>
    {/if}

    <!-- 경계 안내 토스트 -->
    {#if boundaryToast}
      <div class="boundary-toast">{boundaryToast}</div>
    {/if}

    <!-- 슬라이드 카운터 -->
    {#if showSlideNumber}
      <div class="slide-counter">
        {currentSlide + 1} / {sortedSlides.length}
        {#if loopMode}<span class="mode-badge">반복</span>{/if}
        {#if autoPlay}<span class="mode-badge">자동 {autoPlayInterval}초</span>{/if}
      </div>
    {/if}

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

    <!-- 컨트롤 바 (마우스 움직이면 표시, 3초 후 숨김) -->
    <div class="control-bar" class:visible={showControls}>
      <!-- 반복 모드 -->
      <button class="ctrl-btn" class:active={loopMode} onclick={toggleLoop} title="반복 모드 (L)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
        <span>반복</span>
      </button>

      <!-- 자동 넘김 -->
      <button class="ctrl-btn" class:active={autoPlay} onclick={toggleAutoPlay} title="자동 넘김 (A)">
        {#if autoPlay}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        {/if}
        <span>자동</span>
      </button>

      <!-- 자동 넘김 간격 -->
      {#if autoPlay}
        <div class="interval-ctrl">
          <button class="interval-btn" onclick={() => setAutoPlayInterval(Math.max(1, autoPlayInterval - 1))}>-</button>
          <span class="interval-val">{autoPlayInterval}초</span>
          <button class="interval-btn" onclick={() => setAutoPlayInterval(Math.min(60, autoPlayInterval + 1))}>+</button>
        </div>
      {/if}

      <div class="ctrl-divider"></div>

      <!-- 나가기 -->
      <button class="ctrl-btn" onclick={() => { showExitConfirm = true; }} title="나가기 (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        <span>나가기</span>
      </button>

      <div class="ctrl-divider"></div>

      <!-- 단축키 안내 -->
      <div class="ctrl-hint">
        Space/Arrow: 넘김 | 숫자+Enter: 이동 | F: 전체화면 | L: 반복 | A: 자동 | Esc: 나가기
      </div>
    </div>
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

  /* ── Particle overlay ── */
  .particle-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 5;
    pointer-events: none;
  }

  /* ── Video overlay ── */
  .video-overlay {
    position: absolute;
    inset: 0;
    z-index: 25;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Slide transitions ── */
  .trans-fade-out {
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .trans-fade-in {
    opacity: 1;
    transition: opacity 0.5s ease;
  }

  .trans-slide-out {
    transform: translateX(-100%);
    transition: transform 0.2s ease-in;
  }
  .trans-slide-in {
    transform: translateX(0);
    transition: transform 0.4s ease-out;
  }

  .trans-zoom-out {
    transform: scale(1.05);
    opacity: 0;
    transition: all 0.25s ease;
  }
  .trans-zoom-in {
    transform: scale(1);
    opacity: 1;
    transition: all 0.5s ease;
  }

  .trans-diamond-out {
    clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
    transition: clip-path 0.4s ease-in;
  }
  .trans-diamond-in {
    clip-path: polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%);
    transition: clip-path 0.8s ease-out;
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

  /* ── Exit confirmation ── */
  .exit-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
  }

  .exit-dialog {
    background: rgba(18, 18, 26, 0.98);
    border: 1px solid rgba(201, 168, 76, 0.3);
    border-radius: 16px;
    padding: 36px 40px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    max-width: 360px;
  }

  .exit-dialog h3 {
    font-size: 20px;
    font-weight: 700;
    color: #f0e8d8;
    margin: 0;
  }

  .exit-dialog p {
    font-size: 14px;
    color: rgba(232, 224, 208, 0.5);
    margin: 0;
    line-height: 1.5;
  }

  .exit-actions {
    display: flex;
    gap: 12px;
    width: 100%;
    margin-top: 4px;
  }

  .exit-btn {
    flex: 1;
    padding: 12px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.2s;
  }

  .exit-btn.cancel {
    background: rgba(255, 255, 255, 0.06);
    border: 1.5px solid rgba(255, 255, 255, 0.15);
    color: rgba(232, 224, 208, 0.6);
  }

  .exit-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #f0e8d8;
  }

  .exit-btn.confirm {
    background: rgba(200, 60, 60, 0.15);
    border: 1.5px solid rgba(200, 60, 60, 0.4);
    color: #e07070;
  }

  .exit-btn.confirm:hover {
    background: rgba(200, 60, 60, 0.25);
    border-color: #e07070;
  }

  .exit-btn.confirm-gold {
    background: rgba(201, 168, 76, 0.15);
    border: 1.5px solid rgba(201, 168, 76, 0.5);
    color: #c9a84c;
  }

  .exit-btn.confirm-gold:hover {
    background: rgba(201, 168, 76, 0.25);
    border-color: #c9a84c;
  }

  .back-link {
    margin-top: 4px;
    background: none;
    border: none;
    color: rgba(232, 224, 208, 0.35);
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    padding: 6px 12px;
    transition: color 0.2s;
  }
  .back-link:hover { color: rgba(201, 168, 76, 0.7); }

  /* ── Boundary toast ── */
  .boundary-toast {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(10, 10, 15, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(201, 168, 76, 0.3);
    border-radius: 12px;
    padding: 14px 28px;
    font-size: 16px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.8);
    z-index: 20;
    pointer-events: none;
    animation: toast-fade 2s ease-in-out;
  }

  @keyframes toast-fade {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
    15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    75% { opacity: 1; }
    100% { opacity: 0; }
  }

  /* ── Mode badges in counter ── */
  .mode-badge {
    margin-left: 8px;
    font-size: 10px;
    font-weight: 600;
    color: #c9a84c;
    background: rgba(201, 168, 76, 0.15);
    border: 1px solid rgba(201, 168, 76, 0.3);
    border-radius: 4px;
    padding: 1px 6px;
    vertical-align: middle;
  }

  /* ── Control bar ── */
  .control-bar {
    position: absolute;
    bottom: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(10, 10, 15, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 8px 16px;
    z-index: 15;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
    white-space: nowrap;
  }

  .control-bar.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(232, 224, 208, 0.5);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .ctrl-btn:hover {
    border-color: rgba(201, 168, 76, 0.4);
    color: rgba(232, 224, 208, 0.8);
  }

  .ctrl-btn.active {
    background: rgba(201, 168, 76, 0.15);
    border-color: rgba(201, 168, 76, 0.5);
    color: #c9a84c;
  }

  .interval-ctrl {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .interval-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(232, 224, 208, 0.6);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    transition: all 0.15s;
  }

  .interval-btn:hover {
    border-color: rgba(201, 168, 76, 0.4);
    color: #c9a84c;
  }

  .interval-val {
    font-size: 12px;
    font-weight: 600;
    color: #c9a84c;
    min-width: 28px;
    text-align: center;
  }

  .ctrl-divider {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 4px;
  }

  .ctrl-hint {
    font-size: 11px;
    color: rgba(232, 224, 208, 0.3);
  }

  /* ── Sign save toast ── */
  .sign-save-toast {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(10, 10, 15, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(76, 175, 80, 0.4);
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 600;
    color: rgba(232, 224, 208, 0.85);
    z-index: 20;
    pointer-events: none;
    animation: toast-fade 3s ease-in-out;
  }

  /* ── Slide number input indicator ── */
  .slide-num-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(10, 10, 15, 0.9);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(201, 168, 76, 0.4);
    border-radius: 14px;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 25;
    pointer-events: none;
    animation: num-pop 0.15s ease-out;
  }

  @keyframes num-pop {
    from { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
    to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }

  .num-label {
    font-size: 14px;
    color: rgba(232, 224, 208, 0.5);
  }

  .num-value {
    font-size: 32px;
    font-weight: 700;
    color: #c9a84c;
    letter-spacing: 0.05em;
    min-width: 40px;
    text-align: center;
  }

  .num-hint {
    font-size: 11px;
    color: rgba(232, 224, 208, 0.35);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px 6px;
  }
</style>
