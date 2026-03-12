<script>
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE } from '$lib/config.js';

  // ── Auth ───────────────────────────────────────────────────────────────────
  let authChecking = $state(true);   // 자동 로그인 확인 중 (깜빡임 방지)
  let pinView   = $state(true);
  let pinInput  = $state('');
  let pinError  = $state('');
  let token     = $state('');

  const SS_TOKEN = 'admin_token';
  const SS_STATE = 'admin_state';

  function submitPin() {
    token = pinInput;
    fetch(`${API_BASE}/api/me`, { headers: authHeaders() }).then(r => {
      if (r.status === 401) { pinError = 'PIN이 올바르지 않습니다.'; pinInput = ''; token = ''; }
      else {
        sessionStorage.setItem(SS_TOKEN, token);
        pinView = false;
        loadAll().then(restoreNavState);
        startConnPoll();
      }
    }).catch(() => { pinError = '서버에 연결할 수 없습니다.'; token = ''; });
  }

  function authHeaders(extra = {}) {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...extra };
  }

  // ── Session persistence ────────────────────────────────────────────────────
  function saveNavState() {
    if (!token) return;
    sessionStorage.setItem(SS_STATE, JSON.stringify({
      projectId: selectedProject?.id ?? null,
      tab: activeTab,
    }));
  }

  async function restoreNavState() {
    // URL param 우선 확인
    const urlProjectId = new URLSearchParams(window.location.search).get('p');
    if (urlProjectId) {
      const p = projects.find(pr => pr.id === urlProjectId);
      if (p) {
        await openProject(p);
        // sessionStorage에 탭 정보가 있으면 복원
        const raw = sessionStorage.getItem(SS_STATE);
        if (raw) {
          try {
            const { tab } = JSON.parse(raw);
            if (tab && tab !== 'slides') await changeTab(tab);
          } catch {}
        }
        return;
      }
    }
    // fallback: sessionStorage
    const raw = sessionStorage.getItem(SS_STATE);
    if (!raw) return;
    try {
      const { projectId, tab } = JSON.parse(raw);
      if (projectId) {
        const p = projects.find(pr => pr.id === projectId);
        if (p) {
          await openProject(p);
          if (tab && tab !== 'slides') await changeTab(tab);
        }
      }
    } catch {}
  }

  // onMount: 저장된 토큰으로 자동 로그인 시도
  onMount(async () => {
    const saved = sessionStorage.getItem(SS_TOKEN);
    if (!saved) { authChecking = false; return; }
    token = saved;
    const ok = await fetch(`${API_BASE}/api/me`, { headers: authHeaders() })
      .then(r => r.ok).catch(() => false);
    if (ok) {
      pinView = false;
      await loadAll();
      await restoreNavState();
      startConnPoll();
    } else {
      token = '';
      sessionStorage.removeItem(SS_TOKEN);
      sessionStorage.removeItem(SS_STATE);
    }
    authChecking = false;
  });

  // ── Navigation ─────────────────────────────────────────────────────────────
  let activeTab       = $state('slides');  // 'slides'|'signatories'|'connections'|'signatures'
  let selectedProject = $state(null);
  let sidebarOpen     = $state(false);     // mobile

  // ── Data ───────────────────────────────────────────────────────────────────
  let projects        = $state([]);
  let activeProjectIds = $state([]);
  let loading         = $state(false);
  let msg             = $state('');
  let err             = $state('');
  let connStatus      = $state(null);
  let connInterval    = null;
  let signatures      = $state({});

  // ── Remote QR ──────────────────────────────────────────────────────────────
  let remoteQr = $state('');

  async function loadRemoteQr() {
    if (!selectedProject) return;
    const r = await fetch(`${API_BASE}/api/projects/${selectedProject.id}/remote-token`, { headers: authHeaders() });
    if (!r.ok) return;
    const { token: remoteToken } = await r.json();
    const base = window.location.origin;
    const QRCode = await import('qrcode');
    remoteQr = await QRCode.default.toDataURL(`${base}/${selectedProject.id}/remote?t=${remoteToken}`, {
      width: 200, margin: 1, color: { dark: '#c9a84c', light: '#0d0d14' }
    });
  }

  // ── Sign QR ───────────────────────────────────────────────────────────────
  let signQr = $state('');

  async function loadSignQr() {
    if (!selectedProject) return;
    const base = window.location.origin;
    const QRCode = await import('qrcode');
    signQr = await QRCode.default.toDataURL(`${base}/${selectedProject.id}/sign`, {
      width: 200, margin: 1, color: { dark: '#c9a84c', light: '#0d0d14' }
    });
  }

  // ── Guide ──────────────────────────────────────────────────────────────────
  let showGuide = $state(false);

  // ── Slide upload ───────────────────────────────────────────────────────────
  let uploadFiles = $state([]);
  let uploadClearTimer = null;

  // 업로드 완료 후 5초 뒤 자동 정리 (에러 항목은 유지)
  $effect(() => {
    clearTimeout(uploadClearTimer);
    if (uploadFiles.length > 0 && uploadFiles.every(f => f.status === 'done' || f.status === 'error')) {
      uploadClearTimer = setTimeout(() => {
        uploadFiles = uploadFiles.filter(f => f.status === 'error');
      }, 5000);
    }
  });
  let isDragOver  = $state(false);

  // ── Signatory editor ───────────────────────────────────────────────────────
  let editSig      = $state(null);
  let editSigError = $state('');
  let isNewSig     = $state(false);

  const COLOR_PRESETS = [
    { value: '#ffffff', label: '흰색' },
    { value: '#000000', label: '검정' },
    { value: '#c9a84c', label: '골드' },
    { value: '#ff6b6b', label: '빨강' },
    { value: '#74b9ff', label: '파랑' },
  ];

  // ── Image color analysis ────────────────────────────────────────────────────
  let analyzedColors = $state([]);
  let analyzing      = $state(false);
  let analyzeError   = $state('');

  /** 상대 휘도 (WCAG) */
  function relativeLuminance(r, g, b) {
    const sRGB = [r, g, b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  }

  /** WCAG 대비비 */
  function contrastRatio(l1, l2) {
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  /** 이미지 URL → 추천 텍스트 색상 목록 */
  async function analyzeSlideColors(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // 분석용 캔버스 (최대 320px로 축소, 속도 우선)
          const MAX = 320;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.floor(img.width * scale);
          const h = Math.floor(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          // 픽셀 샘플링 (4픽셀 간격 → 빠른 처리)
          const data = ctx.getImageData(0, 0, w, h).data;
          const buckets = new Map();
          const STEP = 4; // px 간격
          for (let y = 0; y < h; y += STEP) {
            for (let x = 0; x < w; x += STEP) {
              const i = (y * w + x) * 4;
              if (data[i + 3] < 200) continue; // 투명 제외
              // 32단위로 양자화 (색상 버킷화)
              const r = Math.round(data[i]     / 32) * 32;
              const g = Math.round(data[i + 1] / 32) * 32;
              const b = Math.round(data[i + 2] / 32) * 32;
              const key = (r << 16) | (g << 8) | b;
              buckets.set(key, (buckets.get(key) || 0) + 1);
            }
          }

          const total = [...buckets.values()].reduce((s, c) => s + c, 0);
          if (total === 0) { resolve([]); return; }

          // 가장 많은 색 = 배경 후보 (상위 3개)
          const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
          const bgLums = sorted.slice(0, 3).map(([k]) => {
            const r = (k >> 16) & 0xff;
            const g = (k >> 8)  & 0xff;
            const b =  k        & 0xff;
            return relativeLuminance(r, g, b);
          });
          const bgLum = bgLums[0]; // 주 배경 휘도

          // 후보 색상: 빈도 0.3%~25%, 배경과 대비비 4.5 이상 (WCAG AA 기준)
          const candidates = sorted
            .filter(([, c]) => {
              const pct = c / total;
              return pct >= 0.003 && pct <= 0.25;
            })
            .map(([k, c]) => {
              const r = (k >> 16) & 0xff;
              const g = (k >> 8)  & 0xff;
              const b =  k        & 0xff;
              const lum = relativeLuminance(r, g, b);
              const cr = contrastRatio(lum, bgLum);
              const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
              return { hex, cr, count: c };
            })
            .filter(c => c.cr >= 3.5)  // 최소 대비 기준
            .sort((a, b) => b.cr - a.cr) // 대비 높은 순
            .slice(0, 8)
            .map(c => c.hex);

          resolve(candidates);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = imageUrl;
    });
  }

  async function runColorAnalysis() {
    const slide = selectedProject?.slides?.find(s => s.id === editSig?.slideId);
    if (!slide) return;
    analyzing = true;
    analyzeError = '';
    analyzedColors = [];
    try {
      const colors = await analyzeSlideColors(slide.url);
      analyzedColors = colors;
      if (colors.length === 0) analyzeError = '분석 가능한 색상을 찾지 못했습니다.';
    } catch (e) {
      analyzeError = e.message.includes('로드 실패') || e.message.includes('tainted')
        ? 'CORS 제한으로 이미지를 분석할 수 없습니다.'
        : '분석 중 오류가 발생했습니다.';
    }
    analyzing = false;
  }

  // 서명 슬라이드가 바뀌면 분석 결과 초기화
  $effect(() => {
    if (editSig?.slideId !== undefined) {
      analyzedColors = [];
      analyzeError = '';
    }
  });

  // ── Position Picker ────────────────────────────────────────────────────────
  let pickerEl   = $state(null);
  let pickerMode = $state('canvas');  // 'canvas' | 'summary'
  let isDragging = false;
  let startPct   = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clearUrlParam() {
    const url = new URL(window.location);
    url.searchParams.delete('p');
    history.replaceState(null, '', url);
  }
  function flash(m, e) { msg = m || ''; err = e || ''; setTimeout(() => { msg = ''; err = ''; }, 3000); }
  function sorted(slides) { return [...(slides || [])].sort((a, b) => a.order - b.order); }

  // ── API calls ──────────────────────────────────────────────────────────────
  async function loadAll() {
    try {
      const [pr, ar] = await Promise.all([
        fetch(`${API_BASE}/api/projects`).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/active`).then(r => r.ok ? r.json() : []),
      ]);
      projects = Array.isArray(pr) ? pr : [];
      activeProjectIds = Array.isArray(ar) ? ar.map(p => p?.id).filter(Boolean) : [];
    } catch {
      flash('', '프로젝트 목록 로드 실패');
    }
  }

  async function loadProject(id) {
    try {
      const r = await fetch(`${API_BASE}/api/projects/${id}`);
      if (!r.ok) { flash('', '프로젝트 로드 실패'); return; }
      selectedProject = await r.json();
      if (activeTab === 'signatures') await loadSignatures();
    } catch {
      flash('', '프로젝트 로드 실패');
    }
  }

  async function loadSignatures() {
    if (!selectedProject) return;
    try {
      const r = await fetch(`${API_BASE}/api/projects/${selectedProject.id}/signatures`);
      signatures = r.ok ? await r.json() : {};
    } catch { signatures = {}; }
  }

  async function loadConnStatus() {
    if (!selectedProject) { connStatus = null; return; }
    connStatus = await fetch(`${API_BASE}/api/projects/${selectedProject.id}/status`).then(r => r.json()).catch(() => null);
  }

  function startConnPoll() {
    clearInterval(connInterval);
    connInterval = setInterval(loadConnStatus, 3000);
    loadConnStatus();
  }

  async function apiPost(path, body) {
    return fetch(`${API_BASE}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  }
  async function apiPut(path, body) {
    return fetch(`${API_BASE}${path}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
  }
  async function apiDelete(path) {
    return fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: authHeaders() });
  }

  // ── Project operations ─────────────────────────────────────────────────────
  let newProjectName = $state('');
  let newProjectPin  = $state('');
  let showNewProject = $state(false);

  async function createProject() {
    if (!newProjectName.trim()) return;
    loading = true;
    try {
      const r = await apiPost('/api/projects', { name: newProjectName.trim() });
      if (!r.ok) { flash('', '프로젝트 생성 실패'); loading = false; return; }
      const created = await r.json();
      // PIN 설정이 있으면 별도로 저장
      if (newProjectPin.trim()) {
        const pinR = await apiPut(`/api/projects/${created.id}/pin`, { pin: newProjectPin.trim() });
        if (!pinR.ok) flash('', 'PIN 설정 실패 — 설정 탭에서 다시 시도해주세요.');
      }
      newProjectName = ''; newProjectPin = ''; showNewProject = false;
      await loadAll();
      flash('프로젝트가 생성되었습니다.');
    } catch {
      flash('', '프로젝트 생성 중 오류 발생');
    }
    loading = false;
  }

  function isActive(id) { return activeProjectIds.includes(id); }

  async function toggleActive(id) {
    loading = true;
    try {
      const active = !isActive(id);
      const r = await apiPost('/api/active', { projectId: id, active });
      if (r.ok) {
        if (active) activeProjectIds = [...activeProjectIds, id];
        else activeProjectIds = activeProjectIds.filter(x => x !== id);
        flash(active ? '프로젝트가 활성화되었습니다.' : '프로젝트가 비활성화되었습니다.');
      } else flash('', '변경 실패');
    } catch { flash('', '서버 연결 실패'); }
    loading = false;
  }

  async function duplicateProject(id) {
    loading = true;
    try {
      const r = await apiPost(`/api/projects/${id}/duplicate`, {});
      if (r.ok) { await loadAll(); flash('복제되었습니다.'); }
      else flash('', '복제 실패');
    } catch { flash('', '서버 연결 실패'); }
    loading = false;
  }

  async function deleteProject(id) {
    if (!confirm('프로젝트를 삭제하면 모든 슬라이드와 서명자 설정이 삭제됩니다. 계속하시겠습니까?')) return;
    loading = true;
    try {
      const r = await apiDelete(`/api/projects/${id}`);
      if (r.ok) {
        if (selectedProject?.id === id) {
          selectedProject = null;
          activeTab = 'slides';
          editSig = null;
        }
        await loadAll(); flash('삭제되었습니다.');
      } else flash('', '삭제 실패');
    } catch { flash('', '삭제 중 오류 발생'); }
    loading = false;
  }

  async function openProject(p) {
    selectedProject = p;
    activeTab = 'slides';
    editSig = null;
    sidebarOpen = false;
    showGuide = false;
    await loadProject(p.id);
    // URL에 프로젝트 ID 반영
    const url = new URL(window.location);
    url.searchParams.set('p', p.id);
    history.replaceState(null, '', url);
    saveNavState();
  }

  // Name edit
  let editingName = $state(false);
  let nameInput   = $state('');

  async function saveProjectName(newName) {
    if (!newName?.trim() || !selectedProject) return;
    try {
      const r = await apiPut(`/api/projects/${selectedProject.id}`, { name: newName.trim() });
      if (r.ok) { selectedProject = await r.json(); await loadAll(); }
      else flash('', '이름 변경 실패');
    } catch { flash('', '서버 연결 실패'); }
  }

  // ── Slide operations ───────────────────────────────────────────────────────
  async function processAndUpload(file) {
    const idx = uploadFiles.findIndex(f => f.name === file.name);
    if (idx < 0) return;
    uploadFiles[idx] = { ...uploadFiles[idx], status: 'uploading' };
    const projectId = selectedProject?.id;
    if (!projectId) { uploadFiles[idx] = { ...uploadFiles[idx], status: 'error', error: '프로젝트 미선택' }; return; }
    try {
      const blob = await resizeToWebP(file);
      const form = new FormData();
      form.append('file', blob, file.name.replace(/\.[^.]+$/, '.webp'));
      const r = await fetch(`${API_BASE}/api/projects/${projectId}/slides`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
      });
      if (r.ok) {
        const slide = await r.json();
        selectedProject = { ...selectedProject, slides: [...selectedProject.slides, slide] };
        uploadFiles[idx] = { ...uploadFiles[idx], status: 'done' };
      } else {
        const d = await r.json().catch(() => ({}));
        uploadFiles[idx] = { ...uploadFiles[idx], status: 'error', error: d.error || '업로드 실패' };
      }
    } catch (e) {
      uploadFiles[idx] = { ...uploadFiles[idx], status: 'error', error: e.message };
    }
  }

  async function resizeToWebP(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1920;
        let { width: w, height: h } = img;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objUrl);
        const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
        const type = supportsWebP ? 'image/webp' : 'image/jpeg';
        canvas.toBlob(blob => resolve(blob), type, 0.85);
      };
      img.onerror = reject;
      img.src = objUrl;
    });
  }

  function handleFileDrop(e) {
    e.preventDefault(); isDragOver = false;
    handleFiles([...(e.dataTransfer?.files ?? e.target?.files ?? [])]);
  }

  function handleFiles(files) {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const pdfFiles   = files.filter(f => f.type === 'application/pdf');

    // 이미지 파일 업로드
    if (imageFiles.length) {
      const entries = imageFiles.map(f => ({ name: f.name, status: 'pending' }));
      uploadFiles = [...uploadFiles, ...entries];
      imageFiles.forEach(processAndUpload);
    }

    // PDF → 페이지별 이미지 변환 후 업로드
    pdfFiles.forEach(processPdfUpload);
  }

  // ── PDF 처리 ──────────────────────────────────────────────────────────────
  let pdfWorkerReady = false;

  async function ensurePdfWorker() {
    if (pdfWorkerReady) return;
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
    ).href;
    pdfWorkerReady = true;
  }

  async function processPdfUpload(file) {
    const baseName = file.name.replace(/\.pdf$/i, '');

    // PDF 전체 진행 표시
    uploadFiles = [...uploadFiles, { name: `${file.name} (PDF 변환 중...)`, status: 'uploading' }];
    const pdfIdx = uploadFiles.length - 1;

    try {
      await ensurePdfWorker();
      const pdfjsLib = await import('pdfjs-dist');
      const arrayBuf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      const pageCount = pdf.numPages;

      // PDF 진행 상태 업데이트
      uploadFiles[pdfIdx] = { ...uploadFiles[pdfIdx], name: `${file.name} (${pageCount}페이지 변환 중...)` };

      for (let i = 1; i <= pageCount; i++) {
        const pageName = `${baseName}_p${i}.webp`;
        uploadFiles = [...uploadFiles, { name: pageName, status: 'uploading' }];
        const pageIdx = uploadFiles.length - 1;

        try {
          const blob = await renderPdfPageToBlob(pdf, i);
          // 가짜 File 객체 생성 후 기존 업로드 로직과 동일하게 처리
          const projectId = selectedProject?.id;
          if (!projectId) { uploadFiles[pageIdx] = { ...uploadFiles[pageIdx], status: 'error', error: '프로젝트 미선택' }; continue; }

          const form = new FormData();
          form.append('file', blob, pageName);
          const r = await fetch(`${API_BASE}/api/projects/${projectId}/slides`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form,
          });
          if (r.ok) {
            const slide = await r.json();
            if (selectedProject?.id === projectId) {
              selectedProject = { ...selectedProject, slides: [...selectedProject.slides, slide] };
            }
            uploadFiles[pageIdx] = { ...uploadFiles[pageIdx], status: 'done' };
          } else {
            const d = await r.json().catch(() => ({}));
            uploadFiles[pageIdx] = { ...uploadFiles[pageIdx], status: 'error', error: d.error || '업로드 실패' };
          }
        } catch (e) {
          uploadFiles[pageIdx] = { ...uploadFiles[pageIdx], status: 'error', error: e.message };
        }
      }

      uploadFiles[pdfIdx] = { ...uploadFiles[pdfIdx], name: `${file.name} (${pageCount}페이지)`, status: 'done' };
    } catch (e) {
      uploadFiles[pdfIdx] = { ...uploadFiles[pdfIdx], status: 'error', error: `PDF 처리 실패: ${e.message}` };
    }
  }

  async function renderPdfPageToBlob(pdf, pageNum) {
    const page = await pdf.getPage(pageNum);
    // 고해상도 렌더링 (scale 2.0 → ~1920px 상당)
    const viewport = page.getViewport({ scale: 2.0 });
    const MAX = 1920;
    let scale = 2.0;
    if (viewport.width > MAX || viewport.height > MAX) {
      scale = scale * MAX / Math.max(viewport.width, viewport.height);
    }
    const finalViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = finalViewport.width;
    canvas.height = finalViewport.height;
    const ctx = canvas.getContext('2d');

    // 흰 배경 (PDF 투명 배경 대비)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: finalViewport }).promise;

    return new Promise((resolve, reject) => {
      const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
      const type = supportsWebP ? 'image/webp' : 'image/jpeg';
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas 변환 실패')), type, 0.85);
    });
  }

  // ── Drag & Drop 슬라이드 순서 변경 ──────────────────────────────────────────
  let dragSrcId  = $state(null);
  let dragOverId = $state(null);

  function onDragStart(e, slideId) {
    dragSrcId = slideId;
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, slideId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (slideId !== dragSrcId) dragOverId = slideId;
  }

  function onDragLeave() { dragOverId = null; }

  async function onDrop(e, targetId) {
    e.preventDefault();
    dragOverId = null;
    if (!dragSrcId || dragSrcId === targetId || !selectedProject) { dragSrcId = null; return; }

    const slides = sorted(selectedProject.slides);
    const srcIdx = slides.findIndex(s => s.id === dragSrcId);
    const tgtIdx = slides.findIndex(s => s.id === targetId);
    const reordered = [...slides];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);
    const orderedIds = reordered.map(s => s.id);
    dragSrcId = null;

    // 낙관적 업데이트
    selectedProject = { ...selectedProject, slides: reordered.map((s, i) => ({ ...s, order: i })) };

    const r = await apiPut(`/api/projects/${selectedProject.id}/slides/reorder`, { orderedIds });
    if (r.ok) selectedProject = { ...selectedProject, slides: await r.json() };
  }

  function onDragEnd() { dragSrcId = null; dragOverId = null; }

  async function deleteSlide(slideId) {
    if (!selectedProject) return;

    // 연결된 서명자 확인
    const linkedSigs = (selectedProject.signatories || []).filter(s => s.slideId === slideId);
    const isSummary = selectedProject.summarySlideId === slideId;
    const warnings = [];
    if (linkedSigs.length > 0) {
      warnings.push(`서명자 ${linkedSigs.map(s => `${s.title} ${s.name}`).join(', ')}의 서명 슬라이드로 지정되어 있습니다.`);
    }
    if (isSummary) {
      warnings.push('종합 서약서 슬라이드로 지정되어 있습니다.');
    }

    const msg = warnings.length > 0
      ? `⚠️ 이 슬라이드에 연결된 데이터가 있습니다:\n\n${warnings.join('\n')}\n\n삭제하면 해당 연결이 모두 해제됩니다. 계속하시겠습니까?`
      : '이 슬라이드를 삭제하시겠습니까?';
    if (!confirm(msg)) return;

    const r = await apiDelete(`/api/projects/${selectedProject.id}/slides/${slideId}`);
    if (r.ok) {
      // 연결된 서명자의 slideId/canvasArea 해제
      let sigs = selectedProject.signatories || [];
      let sigsChanged = false;
      sigs = sigs.map(s => {
        if (s.slideId === slideId) { sigsChanged = true; return { ...s, slideId: null, canvasArea: null }; }
        return s;
      });
      const updates = { slides: selectedProject.slides.filter(s => s.id !== slideId) };
      if (isSummary) updates.summarySlideId = null;
      if (sigsChanged) {
        // 서명자 매핑도 서버에 반영
        await apiPut(`/api/projects/${selectedProject.id}`, { signatories: sigs, ...updates });
        selectedProject = { ...selectedProject, ...updates, signatories: sigs };
      } else {
        selectedProject = { ...selectedProject, ...updates };
      }
      flash('삭제되었습니다.');
    } else flash('', '슬라이드 삭제 실패');
  }

  async function clearAllSlides() {
    if (!selectedProject) return;
    const linkedSigs = (selectedProject.signatories || []).filter(s => s.slideId);
    const msg = linkedSigs.length > 0
      ? `⚠️ ${linkedSigs.length}명의 서명자에 슬라이드가 연결되어 있습니다.\n모든 슬라이드를 삭제하면 서명 영역 설정이 모두 초기화됩니다.\n\n계속하시겠습니까?`
      : '모든 슬라이드를 삭제하시겠습니까?';
    if (!confirm(msg)) return;
    const r = await apiDelete(`/api/projects/${selectedProject.id}/slides`);
    if (r.ok) {
      // 모든 서명자의 슬라이드 매핑 해제
      const sigs = (selectedProject.signatories || []).map(s => ({ ...s, slideId: null, canvasArea: null, summaryArea: null }));
      if (sigs.length > 0) await apiPut(`/api/projects/${selectedProject.id}`, { signatories: sigs });
      selectedProject = { ...selectedProject, slides: [], summarySlideId: null, signatories: sigs };
      flash('초기화되었습니다.');
    }
    else flash('', '초기화 실패');
  }

  async function setSummarySlide(slideId) {
    if (!selectedProject) return;
    const r = await apiPut(`/api/projects/${selectedProject.id}`, { summarySlideId: slideId || null });
    if (r.ok) selectedProject = await r.json();
    else flash('', '변경 실패');
  }

  // ── Signatory operations ───────────────────────────────────────────────────
  function openNewSig() {
    isNewSig = true;
    editSig  = { id: '', order: 0, title: '', name: '', color: '#ffffff', slideId: null, canvasArea: null, summaryArea: null };
    editSigError = '';
    pickerMode = 'canvas';
  }

  function openEditSig(sig) {
    isNewSig = false;
    editSig  = JSON.parse(JSON.stringify({ color: '#ffffff', ...sig }));
    editSigError = '';
    pickerMode = 'canvas';
  }

  async function saveSig() {
    if (!selectedProject || !editSig) return;
    if (!editSig.title.trim() || !editSig.name.trim()) {
      editSigError = '직함과 이름을 입력해주세요.'; return;
    }
    let sigs = [...(selectedProject.signatories || [])];
    if (isNewSig) {
      sigs.push(editSig);
    } else {
      const idx = sigs.findIndex(s => s.id === editSig.id);
      if (idx >= 0) sigs[idx] = editSig;
    }
    const r = await apiPut(`/api/projects/${selectedProject.id}`, { signatories: sigs });
    if (r.ok) { selectedProject = await r.json(); editSig = null; flash('저장되었습니다.'); }
    else flash('', '저장 실패');
  }

  async function deleteSig(sigId) {
    if (!selectedProject) return;
    const sig = (selectedProject.signatories || []).find(s => s.id === sigId);
    const hasSig = signatures[sigId];
    const warnings = [];
    if (sig?.slideId) warnings.push('서명 슬라이드가 지정되어 있습니다.');
    if (hasSig) warnings.push('서명 데이터가 존재합니다.');
    const msg = warnings.length > 0
      ? `⚠️ ${sig?.title} ${sig?.name} 서명자에 연결된 데이터가 있습니다:\n\n${warnings.join('\n')}\n\n삭제하면 모두 제거됩니다. 계속하시겠습니까?`
      : `${sig?.title} ${sig?.name} 서명자를 삭제하시겠습니까?`;
    if (!confirm(msg)) return;
    // 서명 데이터도 제거
    if (hasSig) await apiDelete(`/api/projects/${selectedProject.id}/signatures/${sigId}`).catch(() => {});
    const sigs = (selectedProject.signatories || []).filter(s => s.id !== sigId);
    const r = await apiPut(`/api/projects/${selectedProject.id}`, { signatories: sigs });
    if (r.ok) { selectedProject = await r.json(); await loadSignatures(); flash('삭제되었습니다.'); }
    else flash('', '삭제 실패');
  }

  async function moveSig(sigId, dir) {
    if (!selectedProject?.signatories) return;
    const sigs = [...selectedProject.signatories];
    const idx = sigs.findIndex(s => s.id === sigId);
    const ni = idx + dir;
    if (ni < 0 || ni >= sigs.length) return;
    [sigs[idx], sigs[ni]] = [sigs[ni], sigs[idx]];
    const r = await apiPut(`/api/projects/${selectedProject.id}`, { signatories: sigs });
    if (r.ok) selectedProject = await r.json();
  }

  // ── Position Picker ────────────────────────────────────────────────────────
  function pickerDown(e) {
    if (!pickerEl) return;
    e.preventDefault();
    pickerEl.setPointerCapture(e.pointerId);
    isDragging = true;
    const rect = pickerEl.getBoundingClientRect();
    startPct = {
      x: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)),
      y: Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100)),
    };
  }

  function pickerMove(e) {
    if (!isDragging || !pickerEl || !editSig) return;
    const rect = pickerEl.getBoundingClientRect();
    const cx = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
    const cy = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
    const area = {
      top:    `${Math.min(startPct.y, cy).toFixed(1)}%`,
      left:   `${Math.min(startPct.x, cx).toFixed(1)}%`,
      width:  `${Math.abs(cx - startPct.x).toFixed(1)}%`,
      height: `${Math.abs(cy - startPct.y).toFixed(1)}%`,
    };
    if (pickerMode === 'canvas') editSig = { ...editSig, canvasArea: area };
    else editSig = { ...editSig, summaryArea: area };
  }

  function pickerUp() { isDragging = false; }

  function areaStyle(area) {
    if (!area) return '';
    return `top:${area.top};left:${area.left};width:${area.width};height:${area.height}`;
  }

  // ── Signature operations ───────────────────────────────────────────────────
  async function clearOneSig(signId) {
    if (!selectedProject || !confirm('이 서명을 초기화하시겠습니까?')) return;
    const r = await apiDelete(`/api/projects/${selectedProject.id}/signatures/${signId}`);
    if (r.ok) { await loadSignatures(); flash('초기화되었습니다.'); }
    else flash('', '초기화 실패');
  }

  async function clearAllSigs() {
    if (!selectedProject || !confirm('모든 서명을 초기화하시겠습니까?')) return;
    const r = await apiDelete(`/api/projects/${selectedProject.id}/signatures`);
    if (r.ok) { await loadSignatures(); flash('전체 초기화되었습니다.'); }
    else flash('', '초기화 실패');
  }

  // ── Connection operations ──────────────────────────────────────────────────
  async function disconnect(target) {
    if (!selectedProject) return;
    const r = await apiPost(`/api/disconnect/${selectedProject.id}`, { target });
    if (r.ok) { await loadConnStatus(); flash('연결을 해제했습니다.'); }
  }

  // ── Tab change ─────────────────────────────────────────────────────────────
  async function changeTab(tab) {
    activeTab = tab;
    editSig = null;
    if (tab === 'signatures') await loadSignatures();
    if (tab === 'connections') {
      await loadConnStatus();
      remoteQr = '';  // 프로젝트 변경 시 QR 초기화
      signQr = '';
      await Promise.all([loadRemoteQr(), loadSignQr()]);
    }
    if (tab === 'settings') await loadProjectPin();
    saveNavState();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onDestroy(() => clearInterval(connInterval));

  // ── Project PIN edit ───────────────────────────────────────────────────────
  let editPin = $state('');
  let editPinLoaded = $state(false);

  async function loadProjectPin() {
    if (!selectedProject) return;
    // PIN은 publicProject에서 제거되므로 hasPin만 확인 가능
    // 실제 PIN 값을 보여주지 않고 변경만 지원
    editPin = '';
    editPinLoaded = true;
  }

  // ── Slideshow settings ──────────────────────────────────────────────────
  async function saveSlideshowSettings(slideshow) {
    if (!selectedProject) return;
    const pid = selectedProject.id;
    try {
      const r = await apiPut(`/api/projects/${pid}`, { slideshow });
      if (r.ok) {
        selectedProject = { ...selectedProject, slideshow };
        flash('슬라이드쇼 설정이 저장되었습니다.');
      } else flash('', '설정 저장 실패');
    } catch { flash('', '설정 저장 중 오류 발생'); }
  }

  function toggleSlideshowLoop() {
    const ss = { ...(selectedProject?.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5 }) };
    ss.loop = !ss.loop;
    saveSlideshowSettings(ss);
  }

  function toggleSlideshowAutoPlay() {
    const ss = { ...(selectedProject?.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5 }) };
    ss.autoPlay = !ss.autoPlay;
    saveSlideshowSettings(ss);
  }

  function toggleSlideNumber() {
    const ss = { ...(selectedProject?.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5, showSlideNumber: false }) };
    ss.showSlideNumber = !ss.showSlideNumber;
    saveSlideshowSettings(ss);
  }

  function setSlideshowInterval(delta) {
    const ss = { ...(selectedProject?.slideshow ?? { loop: false, autoPlay: false, autoPlaySec: 5 }) };
    ss.autoPlaySec = Math.max(1, Math.min(60, (ss.autoPlaySec ?? 5) + delta));
    saveSlideshowSettings(ss);
  }

  async function saveProjectPin() {
    if (!selectedProject) return;
    const pid = selectedProject.id;
    loading = true;
    try {
      const r = await apiPut(`/api/projects/${pid}/pin`, { pin: editPin.trim() || null });
      if (r.ok) {
        await loadAll();
        if (selectedProject?.id === pid) await loadProject(pid);
        flash(editPin.trim() ? 'PIN이 설정되었습니다.' : 'PIN이 해제되었습니다.');
        editPin = '';
      } else flash('', 'PIN 변경 실패');
    } catch { flash('', 'PIN 변경 중 오류 발생'); }
    loading = false;
  }

  const NAV_ITEMS = [
    { id: 'slides',       label: '슬라이드' },
    { id: 'signatories',  label: '서명자' },
    { id: 'connections',  label: '연결현황' },
    { id: 'signatures',   label: '서명관리' },
    { id: 'settings',     label: '설정' },
  ];
</script>

<svelte:head><title>관리자 — Presenta</title></svelte:head>

<!-- ── Loading / Auth check ── -->
{#if authChecking}
  <div class="pin-screen">
    <div class="pin-card">
      <div class="logo-badge">Presenta</div>
      <p class="auth-loading">인증 확인 중...</p>
    </div>
  </div>

<!-- ── PIN Screen ── -->
{:else if pinView}
  <div class="pin-screen">
    <div class="pin-card">
      <div class="logo-badge">Presenta</div>
      <h1>관리자 인증</h1>
      {#if pinError}<div class="flash flash-err">{pinError}</div>{/if}
      <input class="pin-input" type="password" placeholder="PIN 입력" maxlength="10"
        bind:value={pinInput} onkeydown={e => e.key === 'Enter' && submitPin()} autofocus />
      <button class="btn-gold" onclick={submitPin}>확인</button>
    </div>
  </div>

<!-- ── Main App ── -->
{:else}
  <div class="app-layout">

    <!-- ── Sidebar ── -->
    <aside class="sidebar" class:open={sidebarOpen}>
      <div class="sidebar-inner">
        <!-- Brand -->
        <div class="sidebar-brand">
          <div class="brand-logo">Presenta</div>
          <div class="brand-sub">관리자</div>
        </div>

        <!-- Project list -->
        <div class="sidebar-group">
          <div class="sidebar-group-header">
            <span class="sidebar-group-label">프로젝트</span>
            <button class="sidebar-add-btn" onclick={() => { showNewProject = !showNewProject; }} title="새 프로젝트">+</button>
          </div>

          {#if projects.length === 0}
            <div class="sidebar-empty">프로젝트 없음</div>
          {:else}
            <div class="project-list">
              {#each projects as p (p.id)}
                <button class="project-list-item" class:selected={selectedProject?.id === p.id}
                  onclick={() => openProject(p)}>
                  <span class="project-active-dot" class:active={isActive(p.id)}></span>
                  <span class="project-list-name">{p.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Guide link -->
        <div class="sidebar-spacer"></div>
        <div class="sidebar-bottom">
          <button class="sidebar-guide-btn" class:active={showGuide}
            onclick={() => { selectedProject = null; editSig = null; showGuide = true; clearUrlParam(); }}>
            📖 사용 가이드
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile overlay -->
    {#if sidebarOpen}
      <div class="sidebar-overlay" onclick={() => sidebarOpen = false}></div>
    {/if}

    <!-- ── Main Content ── -->
    <div class="main-wrap">

      <!-- Top bar -->
      <div class="topbar">
        <button class="mobile-menu-btn" onclick={() => sidebarOpen = !sidebarOpen}>
          <span></span><span></span><span></span>
        </button>

        <div class="topbar-breadcrumb">
          {#if selectedProject}
            <span class="topbar-bc-link" onclick={() => { selectedProject = null; editSig = null; showGuide = false; clearUrlParam(); }}>프로젝트</span>
            <span class="topbar-bc-sep">/</span>
            {#if editingName}
              <input class="name-edit-input" bind:value={nameInput}
                onblur={async () => { await saveProjectName(nameInput); editingName = false; }}
                onkeydown={async e => { if (e.key === 'Enter') { await saveProjectName(nameInput); editingName = false; } }}
                autofocus />
            {:else}
              <span class="topbar-bc-current" onclick={() => { nameInput = selectedProject.name; editingName = true; }}
                title="클릭하여 이름 변경">
                {selectedProject.name}
                {#if isActive(selectedProject.id)}
                  <span class="active-badge">활성</span>
                {/if}
              </span>
            {/if}
            <span class="topbar-bc-sep">/</span>
            <span class="topbar-bc-tab">{NAV_ITEMS.find(n => n.id === activeTab)?.label}</span>
          {:else if showGuide}
            <span class="topbar-bc-link" onclick={() => { showGuide = false; }}>프로젝트</span>
            <span class="topbar-bc-sep">/</span>
            <span class="topbar-bc-current">사용 가이드</span>
          {:else}
            <span class="topbar-bc-current">프로젝트 목록</span>
          {/if}
        </div>

        {#if selectedProject}
          <button class="btn-sm topbar-activate-btn" disabled={loading}
            class:btn-gold={!isActive(selectedProject.id)}
            class:btn-danger={isActive(selectedProject.id)}
            onclick={() => toggleActive(selectedProject.id)}>
            {isActive(selectedProject.id) ? '비활성화' : '활성화'}
          </button>
        {/if}
      </div>

      <!-- Flash messages -->
      {#if msg}<div class="flash flash-ok">{msg}</div>{/if}
      {#if err}<div class="flash flash-err">{err}</div>{/if}

      <!-- Project tab bar (moved from sidebar) -->
      {#if selectedProject}
        <nav class="content-tabs">
          {#each NAV_ITEMS as item}
            <button class="content-tab" class:active={activeTab === item.id}
              onclick={() => changeTab(item.id)}>
              {item.label}
            </button>
          {/each}
        </nav>
      {/if}

      <!-- ── Content Area ── -->
      <div class="content">

        <!-- ── Guide ── -->
        {#if showGuide && !selectedProject}
          <div class="content-section guide-section">
            <div class="section-header">
              <h2 class="section-title">사용 가이드</h2>
            </div>

            <div class="guide-block">
              <div class="guide-block-title">📋 시스템 개요</div>
              <p class="guide-text">이 시스템은 세 가지 화면으로 구성됩니다.</p>
              <div class="guide-table">
                <div class="guide-table-row">
                  <span class="guide-table-key">🖥 슬라이드쇼</span>
                  <span class="guide-table-val">행사장 메인 화면(PC/빔프로젝터). 슬라이드를 표시하고 서명 결과를 실시간 반영합니다.</span>
                </div>
                <div class="guide-table-row">
                  <span class="guide-table-key">✍ 서명자 화면</span>
                  <span class="guide-table-val">서명자가 사용하는 태블릿 화면. 서명 후 슬라이드쇼에 반영됩니다.</span>
                </div>
                <div class="guide-table-row">
                  <span class="guide-table-key">⚙ 관리자</span>
                  <span class="guide-table-val">현재 화면. 프로젝트·슬라이드·서명자 설정 및 행사 진행 관리.</span>
                </div>
              </div>
            </div>

            <div class="guide-block">
              <div class="guide-block-title">🚀 행사 준비 절차</div>

              <div class="guide-step">
                <div class="guide-step-num">1</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">프로젝트 생성</div>
                  <div class="guide-step-desc">왼쪽 사이드바 <strong>프로젝트 +</strong> 버튼을 눌러 새 프로젝트를 만드세요. 행사명을 입력합니다. (예: 2025년 정기총회)</div>
                </div>
              </div>

              <div class="guide-step">
                <div class="guide-step-num">2</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">슬라이드 업로드</div>
                  <div class="guide-step-desc">
                    <strong>슬라이드 탭</strong> → 이미지 업로드 버튼 또는 드래그 앤 드롭으로 이미지를 추가합니다.<br>
                    슬라이드 순서는 드래그로 변경할 수 있습니다. ⠿ 핸들을 잡고 드래그하세요.<br>
                    <span class="guide-tip">💡 JPG, PNG, WebP 이미지 및 PDF 파일을 지원합니다. PDF는 페이지별로 자동 변환됩니다.</span>
                  </div>
                </div>
              </div>

              <div class="guide-step">
                <div class="guide-step-num">3</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">종합 서약서 슬라이드 지정</div>
                  <div class="guide-step-desc">
                    <strong>슬라이드 탭</strong> → <strong>종합 서약서 슬라이드</strong> 드롭다운에서 모든 서명자가 서명하는 종합 슬라이드를 선택합니다.<br>
                    <span class="guide-tip">💡 종합 슬라이드는 행사 마지막에 모든 서명자 서명이 합쳐져 표시되는 슬라이드입니다.</span>
                  </div>
                </div>
              </div>

              <div class="guide-step">
                <div class="guide-step-num">4</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">서명자 등록 및 위치 설정</div>
                  <div class="guide-step-desc">
                    <strong>서명자 탭</strong> → <strong>+ 서명자 추가</strong>로 각 서명자를 등록합니다.<br>
                    각 서명자에 대해:
                    <ul class="guide-list">
                      <li>직함과 이름 입력</li>
                      <li>서명 색상 선택 (서명이 슬라이드에 표시되는 색)</li>
                      <li><strong>서명 슬라이드</strong> 선택 (개인 서명이 표시될 슬라이드)</li>
                      <li><strong>개인 서명 영역</strong>: 해당 슬라이드 위에서 드래그하여 서명 위치 지정</li>
                      <li><strong>종합 서명 영역</strong>: 종합 서약서 슬라이드 위에서 드래그하여 위치 지정</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div class="guide-step">
                <div class="guide-step-num">5</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">프로젝트 활성화</div>
                  <div class="guide-step-desc">
                    프로젝트 목록에서 <strong>활성화</strong> 버튼을 클릭합니다. 활성화된 프로젝트만 메인 페이지에 표시됩니다.<br>
                    <span class="guide-tip">💡 여러 프로젝트를 동시에 활성화할 수 있습니다.</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="guide-block">
              <div class="guide-block-title">🎬 행사 진행</div>
              <div class="guide-step">
                <div class="guide-step-num">1</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">기기 연결</div>
                  <div class="guide-step-desc">
                    루트 페이지(<code class="guide-code">/</code>)에 접속하면 활성화된 프로젝트 목록이 표시됩니다.<br>
                    <ul class="guide-list">
                      <li>행사(프로젝트) 선택 → PIN 입력(설정된 경우) → 역할 선택</li>
                      <li>슬라이드쇼 PC: <strong>슬라이드쇼</strong> 버튼 클릭</li>
                      <li>각 서명자 태블릿: <strong>서명</strong> 버튼 클릭 → 본인 이름 선택</li>
                    </ul>
                    <strong>연결현황 탭</strong>에서 각 기기의 연결 상태를 실시간으로 확인할 수 있습니다.<br>
                    <span class="guide-tip">💡 연결현황 탭의 QR 코드를 스캔하면 서명자 화면이나 리모컨에 바로 접속할 수 있습니다.</span>
                  </div>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-num">2</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">서명 진행</div>
                  <div class="guide-step-desc">
                    서명자가 태블릿에서 서명하면 자동으로 슬라이드쇼 화면에 반영됩니다.<br>
                    개인 슬라이드 → 해당 서명자 서명이 지정 위치에 표시<br>
                    종합 슬라이드 → 모든 서명자 서명이 합쳐져 표시
                  </div>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-num">3</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">슬라이드쇼 모드 설정</div>
                  <div class="guide-step-desc">
                    <strong>설정 탭 → 슬라이드쇼 모드</strong>에서 재생 방식을 조정합니다.<br>
                    <ul class="guide-list">
                      <li><strong>반복 모드</strong>: 마지막 슬라이드 이후 첫 슬라이드로 순환</li>
                      <li><strong>자동 넘김</strong>: 설정된 간격(초)으로 자동 전환</li>
                      <li><strong>슬라이드 번호 표시</strong>: 하단에 현재 슬라이드 번호 표시</li>
                    </ul>
                    <span class="guide-tip">💡 슬라이드쇼 화면에서 단축키 사용 가능: Space/화살표(넘기기), F(전체화면), L(반복), A(자동)</span>
                  </div>
                </div>
              </div>
              <div class="guide-step">
                <div class="guide-step-num">4</div>
                <div class="guide-step-body">
                  <div class="guide-step-title">모바일 리모컨</div>
                  <div class="guide-step-desc">
                    <strong>연결현황 탭</strong>의 리모컨 QR 코드를 스마트폰으로 스캔하면 슬라이드를 원격 조작할 수 있습니다.<br>
                    <span class="guide-tip">💡 리모컨은 슬라이드 이전/다음 이동을 지원합니다.</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="guide-block">
              <div class="guide-block-title">📝 서명 관리</div>
              <p class="guide-text">
                <strong>서명관리 탭</strong>에서 각 서명자의 서명 완료 여부를 확인하고, 필요 시 서명을 초기화할 수 있습니다.<br>
                개별 초기화 또는 전체 초기화가 가능합니다.
              </p>
            </div>

            <div class="guide-block">
              <div class="guide-block-title">⚠️ 주의사항</div>
              <ul class="guide-list guide-warn-list">
                <li>프로젝트 삭제 시 슬라이드 이미지도 함께 삭제됩니다.</li>
                <li>서명자 순서(번호)는 ↑↓ 버튼으로 조정할 수 있습니다. 순서가 변경되면 서명자 화면 목록 순서도 바뀝니다.</li>
                <li>서명 위치를 지정하지 않으면 서명이 슬라이드에 표시되지 않습니다.</li>
                <li>프로젝트를 복제하면 슬라이드 이미지는 공유되며 서명자는 새 ID로 복제됩니다.</li>
              </ul>
            </div>
          </div>

        <!-- ── Projects home (no project selected) ── -->
        {:else if !selectedProject}
          <div class="content-section">
            <div class="section-header">
              <h2 class="section-title">프로젝트 목록</h2>
            </div>

            {#if projects.length === 0}
              <div class="empty-state">
                <div>프로젝트가 없습니다.</div>
                <button class="btn-gold" onclick={() => showNewProject = true}>첫 프로젝트 만들기</button>
              </div>
            {:else}
              <div class="project-cards">
                {#each projects as p (p.id)}
                  <div class="project-card" class:active={isActive(p.id)}>
                    <div class="project-card-body" onclick={() => openProject(p)} role="button" tabindex="0">
                      <div class="project-card-name">
                        {p.name}
                        {#if isActive(p.id)}<span class="active-badge">활성</span>{/if}
                      </div>
                      <div class="project-card-meta">
                        슬라이드 {p.slides?.length ?? 0}개 · 서명자 {p.signatories?.length ?? 0}명
                      </div>
                      <div class="project-card-date">{new Date(p.createdAt).toLocaleDateString('ko-KR')}</div>
                    </div>
                    <div class="project-card-actions">
                      <button class="btn-sm" disabled={loading}
                        class:btn-gold={!isActive(p.id)} class:btn-outline={isActive(p.id)}
                        onclick={() => toggleActive(p.id)}>
                        {isActive(p.id) ? '비활성화' : '활성화'}
                      </button>
                      <button class="btn-sm btn-outline" disabled={loading} onclick={() => duplicateProject(p.id)}>복제</button>
                      <button class="btn-sm btn-danger" disabled={loading} onclick={() => deleteProject(p.id)}>삭제</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- ── Project: Slides ── -->
        {:else if activeTab === 'slides'}
          <div class="content-section">
            <div class="section-header">
              <h2 class="section-title">슬라이드</h2>
              <div class="section-header-actions">
                <label class="btn-gold btn-sm upload-btn">
                  이미지 / PDF 업로드
                  <input type="file" accept="image/*,.pdf" multiple style="display:none"
                    onchange={e => handleFiles([...e.target.files])} />
                </label>
                <button class="btn-sm btn-danger" onclick={clearAllSlides}>전체 삭제</button>
              </div>
            </div>

            {#if uploadFiles.length > 0}
              <div class="upload-queue">
                {#each uploadFiles as f, i}
                  <span class="upload-item" class:done={f.status==='done'} class:error={f.status==='error'}>
                    {f.name} {f.status==='uploading' ? '...' : f.status==='done' ? '완료' : f.status==='error' ? `오류: ${f.error}` : ''}
                    {#if f.status === 'error'}
                      <button class="upload-item-dismiss" onclick={() => { uploadFiles = uploadFiles.filter((_, idx) => idx !== i); }}>✕</button>
                    {/if}
                  </span>
                {/each}
                {#if uploadFiles.some(f => f.status === 'error')}
                  <button class="btn-ghost btn-sm" onclick={() => { uploadFiles = []; }}>모두 닫기</button>
                {/if}
              </div>
            {/if}

            <div class="drop-zone" class:dragover={isDragOver}
              ondragover={e => { e.preventDefault(); isDragOver = true; }}
              ondragleave={() => isDragOver = false}
              ondrop={handleFileDrop}>
              이미지 또는 PDF 파일을 여기에 드래그하거나 위 버튼으로 업로드하세요
            </div>

            <div class="field-row">
              <label class="field-label">종합 서약서 슬라이드</label>
              <select class="select-input select-input-inline" value={selectedProject.summarySlideId ?? ''}
                onchange={e => setSummarySlide(e.target.value)}>
                <option value="">없음</option>
                {#each sorted(selectedProject.slides) as s}
                  <option value={s.id}>슬라이드 {s.order + 1}</option>
                {/each}
              </select>
            </div>

            {#if sorted(selectedProject.slides).length === 0}
              <div class="empty-state">슬라이드가 없습니다.</div>
            {:else}
              <div class="slide-list">
                {#each sorted(selectedProject.slides) as slide, i (slide.id)}
                  <div class="slide-row"
                    class:summary={slide.id === selectedProject.summarySlideId}
                    class:dragging={dragSrcId === slide.id}
                    class:drag-over={dragOverId === slide.id}
                    draggable="true"
                    ondragstart={e => onDragStart(e, slide.id)}
                    ondragover={e => onDragOver(e, slide.id)}
                    ondragleave={onDragLeave}
                    ondrop={e => onDrop(e, slide.id)}
                    ondragend={onDragEnd}
                  >
                    <span class="drag-handle">⠿</span>
                    <span class="slide-num">{slide.order + 1}</span>
                    <img class="slide-thumb" src={slide.url} alt="슬라이드 {slide.order + 1}" loading="lazy" />
                    <div class="slide-info">
                      <span class="slide-filename">{slide.originalFilename || slide.filename}</span>
                      {#if slide.id === selectedProject.summarySlideId}
                        <span class="tag-summary">종합 서약서</span>
                      {/if}
                    </div>
                    <div class="row-actions">
                      <button class="btn-icon danger" onclick={() => deleteSlide(slide.id)}>✕</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

        <!-- ── Project: Signatories ── -->
        {:else if activeTab === 'signatories'}
          <div class="content-section">
            {#if editSig}
              <!-- Edit / New form -->
              <div class="section-header">
                <h2 class="section-title">{isNewSig ? '서명자 추가' : '서명자 편집'}</h2>
                <button class="btn-ghost" onclick={() => editSig = null}>← 목록으로</button>
              </div>

              {#if editSigError}<div class="flash flash-err">{editSigError}</div>{/if}

              <div class="form-card">
                <!-- 기본 정보 -->
                <div class="form-section-label">기본 정보</div>
                <div class="form-row-2">
                  <div class="form-group">
                    <label class="field-label">직함</label>
                    <input class="text-input" placeholder="예: 사장" bind:value={editSig.title} />
                  </div>
                  <div class="form-group">
                    <label class="field-label">이름</label>
                    <input class="text-input" placeholder="예: 홍길동" bind:value={editSig.name} />
                  </div>
                </div>

                <!-- 서명 색상 -->
                <div class="form-section-label">서명 색상</div>
                <div class="color-picker-row">
                  {#each COLOR_PRESETS as preset}
                    <button class="color-swatch"
                      class:selected={editSig.color === preset.value}
                      style="background:{preset.value};outline-color:{editSig.color === preset.value ? '#c9a84c' : 'transparent'}"
                      onclick={() => editSig = { ...editSig, color: preset.value }}
                      title={preset.label}>
                    </button>
                  {/each}
                  <label class="color-custom-wrap" title="직접 선택">
                    <input type="color" bind:value={editSig.color} />
                    <span class="color-custom-preview" style="background:{editSig.color}"></span>
                    <span class="color-custom-label">직접 선택</span>
                  </label>
                  <span class="color-preview-text" style="color:{editSig.color};text-shadow:0 0 4px rgba(0,0,0,.5)">
                    서명 미리보기
                  </span>
                </div>

                <!-- 이미지 색상 분석 -->
                {#if editSig.slideId}
                  <div class="color-analyze-wrap">
                    <button class="btn-analyze" disabled={analyzing} onclick={runColorAnalysis}>
                      {analyzing ? '분석 중...' : '🎨 슬라이드에서 색상 추출'}
                    </button>
                    {#if analyzeError}
                      <span class="analyze-error">{analyzeError}</span>
                    {/if}
                    {#if analyzedColors.length > 0}
                      <div class="analyzed-colors">
                        <span class="analyzed-label">추천 색상 (배경 대비 높은 순)</span>
                        <div class="analyzed-swatches">
                          {#each analyzedColors as color}
                            <button class="color-swatch analyzed"
                              class:selected={editSig.color === color}
                              style="background:{color};outline-color:{editSig.color === color ? '#c9a84c' : 'transparent'}"
                              onclick={() => editSig = { ...editSig, color }}
                              title={color}>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}

                <!-- 위치 설정 -->
                <div class="form-section-label">위치 설정</div>

                <!-- Position Picker -->
                <div class="form-group">
                  <div class="picker-tabs">
                    <button class="picker-tab" class:active={pickerMode==='canvas'} onclick={() => pickerMode = 'canvas'}>개인 서명 영역</button>
                    <button class="picker-tab" class:active={pickerMode==='summary'} onclick={() => pickerMode = 'summary'}>
                      종합 서명 영역
                      {#if !selectedProject.summarySlideId}<span class="tab-badge-warn">미설정</span>{/if}
                    </button>
                  </div>

                  <!-- 개인 서명 탭: 슬라이드 선택 -->
                  {#if pickerMode === 'canvas'}
                    <div class="form-group picker-slide-select">
                      <label class="field-label">서명 슬라이드</label>
                      <select class="select-input" bind:value={editSig.slideId}>
                        <option value={null}>미지정</option>
                        {#each sorted(selectedProject.slides) as s}
                          <option value={s.id}>슬라이드 {s.order + 1}{s.id === selectedProject.summarySlideId ? ' (종합)' : ''}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}

                  {#if true}
                  {@const pickerSlideId = pickerMode === 'canvas' ? editSig.slideId : selectedProject.summarySlideId}
                  {@const pickerSlide = selectedProject.slides.find(s => s.id === pickerSlideId)}
                  {@const currentArea = pickerMode === 'canvas' ? editSig.canvasArea : editSig.summaryArea}
                  {#if pickerSlide}
                    <p class="picker-hint">이미지 위에서 드래그하여 서명 영역을 지정하세요.</p>
                    <div class="picker-wrap"
                      bind:this={pickerEl}
                      onpointerdown={pickerDown}
                      onpointermove={pickerMove}
                      onpointerup={pickerUp}
                      onpointercancel={pickerUp}>
                      <img src={pickerSlide.url} alt="position picker" draggable="false" />
                      {#if currentArea}
                        <div class="picker-overlay" style="{areaStyle(currentArea)};border-color:{editSig.color};background:color-mix(in srgb, {editSig.color} 20%, transparent)"></div>
                      {/if}
                    </div>
                    {#if currentArea}
                      <div class="area-inputs">
                        {#each ['top','left','width','height'] as key}
                          <label class="area-field">
                            <span>{key}</span>
                            <input type="text" class="text-input area-input" value={currentArea[key]}
                              oninput={e => {
                                const a = { ...(pickerMode==='canvas' ? editSig.canvasArea : editSig.summaryArea), [key]: e.target.value };
                                if (pickerMode==='canvas') editSig = { ...editSig, canvasArea: a };
                                else editSig = { ...editSig, summaryArea: a };
                              }} />
                          </label>
                        {/each}
                        <button class="btn-ghost btn-sm" onclick={() => {
                          if (pickerMode==='canvas') editSig = { ...editSig, canvasArea: null };
                          else editSig = { ...editSig, summaryArea: null };
                        }}>초기화</button>
                      </div>
                    {/if}
                  {:else if pickerMode === 'summary'}
                    <div class="empty-state-warn">
                      ⚠️ 종합 서약서 슬라이드가 지정되지 않았습니다.<br>
                      <span>슬라이드 탭 → <strong>종합 서약서 슬라이드</strong> 드롭다운에서 해당 슬라이드를 먼저 선택해주세요.</span>
                    </div>
                  {:else}
                    <div class="empty-state">서명 슬라이드를 먼저 선택해주세요.</div>
                  {/if}
                  {/if}
                </div>
              </div>

              <div class="form-footer">
                <button class="btn-gold" onclick={saveSig}>저장</button>
                <button class="btn-ghost" onclick={() => editSig = null}>취소</button>
              </div>

            {:else}
              <!-- Signatories list -->
              <div class="section-header">
                <h2 class="section-title">서명자</h2>
                <button class="btn-gold btn-sm" onclick={openNewSig}>+ 서명자 추가</button>
              </div>

              {#if (selectedProject.signatories?.length ?? 0) === 0}
                <div class="empty-state">서명자가 없습니다. 추가해주세요.</div>
              {:else}
                <div class="sig-list">
                  {#each (selectedProject.signatories || []) as sig, i (sig.id)}
                    <div class="sig-row">
                      <div class="sig-color-bar" style="background:{sig.color || '#c9a84c'}"></div>
                      <div class="sig-order-badge">{sig.order}</div>
                      <div class="sig-info">
                        <div class="sig-name">{sig.title} — {sig.name}</div>
                        <div class="sig-meta">
                          {#if sig.slideId}
                            슬라이드 {(sorted(selectedProject.slides).find(s => s.id === sig.slideId)?.order ?? 0) + 1}
                          {:else}
                            슬라이드 미지정
                          {/if}
                          {' · '}{sig.canvasArea ? '위치 설정됨' : '위치 미설정'}
                          {' · '}<span class="sig-color-chip" style="background:{sig.color || '#ffffff'}"></span>
                          <span style="color:{sig.color || '#ffffff'};filter:drop-shadow(0 0 2px rgba(0,0,0,.5));font-size:11px">
                            {sig.color || '#ffffff'}
                          </span>
                        </div>
                      </div>
                      <div class="row-actions">
                        <button class="btn-icon" onclick={() => moveSig(sig.id, -1)} disabled={i === 0}>↑</button>
                        <button class="btn-icon" onclick={() => moveSig(sig.id, 1)}
                          disabled={i === selectedProject.signatories.length - 1}>↓</button>
                        <button class="btn-icon" onclick={() => openEditSig(sig)}>✎</button>
                        <button class="btn-icon danger" onclick={() => deleteSig(sig.id)}>✕</button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

        <!-- ── Project: Connections ── -->
        {:else if activeTab === 'connections'}
          <div class="content-section">
            <div class="section-header">
              <h2 class="section-title">연결현황</h2>
              <div class="section-header-actions">
                <button class="btn-outline btn-sm" onclick={loadConnStatus}>새로고침</button>
                <button class="btn-danger btn-sm" onclick={() => disconnect('all')}>전체 해제</button>
              </div>
            </div>
            <p class="helper-text">3초마다 자동 갱신</p>

            {#if connStatus}
              <div class="conn-list">
                <div class="conn-row" class:connected={connStatus.mainDisplay?.connected}>
                  <span class="conn-dot" class:on={connStatus.mainDisplay?.connected}></span>
                  <div class="conn-info">
                    <div class="conn-label">슬라이드쇼 PC</div>
                    <div class="conn-sub">{connStatus.mainDisplay?.connected ? '연결됨' : '미연결'}</div>
                  </div>
                  {#if connStatus.mainDisplay?.connected}
                    <button class="btn-sm btn-danger" onclick={() => disconnect('main')}>해제</button>
                  {/if}
                </div>
                {#each (selectedProject.signatories || []) as sig (sig.id)}
                  {@const connected = connStatus.tablets?.[sig.id]?.connected === true}
                  <div class="conn-row" class:connected>
                    <span class="conn-dot" class:on={connected}></span>
                    <div class="conn-info">
                      <div class="conn-label">{sig.order}. {sig.title} — {sig.name}</div>
                      <div class="conn-sub">{connected ? '연결됨' : '미연결'}</div>
                    </div>
                    {#if connected}
                      <button class="btn-sm btn-danger" onclick={() => disconnect(sig.id)}>해제</button>
                    {/if}
                  </div>
                {/each}
                {#if connStatus.remoteCount > 0}
                  <div class="conn-row connected">
                    <span class="conn-dot on"></span>
                    <div class="conn-info">
                      <div class="conn-label">리모컨</div>
                      <div class="conn-sub">{connStatus.remoteCount}대 연결됨</div>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- QR 코드 섹션 -->
            <div class="remote-qr-section">
              <div class="section-sub-title">📱 QR 코드</div>
              <p class="helper-text">QR 코드를 스캔하여 각 기기에서 바로 접속할 수 있습니다.</p>
              <div class="qr-grid">
                <!-- 서명 QR -->
                {#if signQr}
                  <div class="qr-card">
                    <div class="qr-card-label">서명자 화면</div>
                    <img class="qr-img" src={signQr} alt="서명 QR" />
                    <code class="qr-url">/{selectedProject?.id?.slice(0, 8)}···/sign</code>
                  </div>
                {:else}
                  <div class="qr-card">
                    <div class="qr-card-label">서명자 화면</div>
                    <button class="btn-outline btn-sm" onclick={loadSignQr}>QR 생성</button>
                  </div>
                {/if}
                <!-- 리모컨 QR -->
                {#if remoteQr}
                  <div class="qr-card">
                    <div class="qr-card-label">슬라이드 리모컨</div>
                    <img class="qr-img" src={remoteQr} alt="리모컨 QR" />
                    <code class="qr-url">/{selectedProject?.id?.slice(0, 8)}···/remote</code>
                  </div>
                {:else}
                  <div class="qr-card">
                    <div class="qr-card-label">슬라이드 리모컨</div>
                    <button class="btn-outline btn-sm" onclick={loadRemoteQr}>QR 생성</button>
                  </div>
                {/if}
              </div>
            </div>

          </div>

        <!-- ── Project: Signatures ── -->
        {:else if activeTab === 'signatures'}
          <div class="content-section">
            <div class="section-header">
              <h2 class="section-title">서명관리</h2>
              <button class="btn-danger btn-sm" onclick={clearAllSigs}>전체 초기화</button>
            </div>
            <div class="sig-list">
              {#each (selectedProject.signatories || []) as sig (sig.id)}
                {@const dataUrl = signatures[sig.id]}
                <div class="sig-row">
                  <div class="sig-color-bar" style="background:{sig.color || '#c9a84c'}"></div>
                  <span class="conn-dot" class:on={!!dataUrl}></span>
                  <div class="sig-info">
                    <div class="sig-name">{sig.order}. {sig.title} — {sig.name}</div>
                    <div class="conn-sub">{dataUrl ? '서명 완료' : '미서명'}</div>
                  </div>
                  <div class="row-actions">
                    {#if dataUrl}
                      <img class="sig-preview" src={dataUrl} alt="서명 미리보기"
                        style="background:color-mix(in srgb, {sig.color || '#fff'} 5%, #111)" />
                      <button class="btn-sm btn-danger" onclick={() => clearOneSig(sig.id)}>초기화</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

        <!-- ── Project: Settings ── -->
        {:else if activeTab === 'settings'}
          <div class="content-section">
            <div class="section-header">
              <h2 class="section-title">프로젝트 설정</h2>
            </div>

            <div class="form-card">
              <div class="form-section-label">참여 PIN</div>
              <p class="helper-text" style="margin-top:-8px">
                메인 페이지에서 이 프로젝트에 접근할 때 필요한 비밀번호입니다.
                {#if selectedProject?.hasPin}
                  <span class="active-badge" style="margin-left:8px">PIN 설정됨</span>
                {:else}
                  <span style="color:rgba(232,224,208,.55);margin-left:8px">PIN 미설정 (자유 접근)</span>
                {/if}
              </p>
              <div class="form-row-2">
                <div class="form-group">
                  <input class="text-input" type="text" placeholder={selectedProject?.hasPin ? '새 PIN 입력 (변경)' : 'PIN 입력'}
                    maxlength="10" bind:value={editPin} />
                </div>
              </div>
              <div class="form-footer">
                <button class="btn-gold btn-sm" disabled={loading} onclick={saveProjectPin}>
                  {editPin.trim() ? 'PIN 변경' : 'PIN 해제'}
                </button>
              </div>
            </div>

            <div class="form-card">
              <div class="form-section-label">슬라이드쇼 모드</div>
              <p class="helper-text" style="margin-top:-8px">
                슬라이드쇼(디스플레이) 화면에서 적용되는 재생 설정입니다.
              </p>

              <div class="slideshow-options">
                <label class="toggle-row">
                  <span class="toggle-label">
                    <strong>반복 모드</strong>
                    <span class="toggle-desc">마지막 슬라이드에서 첫 슬라이드로 순환합니다</span>
                  </span>
                  <button class="toggle-switch" class:on={selectedProject?.slideshow?.loop}
                    onclick={toggleSlideshowLoop}>
                    <span class="toggle-knob"></span>
                  </button>
                </label>

                <label class="toggle-row">
                  <span class="toggle-label">
                    <strong>자동 넘김</strong>
                    <span class="toggle-desc">설정된 간격으로 슬라이드를 자동 전환합니다</span>
                  </span>
                  <button class="toggle-switch" class:on={selectedProject?.slideshow?.autoPlay}
                    onclick={toggleSlideshowAutoPlay}>
                    <span class="toggle-knob"></span>
                  </button>
                </label>

                {#if selectedProject?.slideshow?.autoPlay}
                  <div class="interval-setting">
                    <span class="interval-label">자동 넘김 간격</span>
                    <div class="interval-control">
                      <button class="interval-btn" onclick={() => setSlideshowInterval(-1)}>-</button>
                      <span class="interval-value">{selectedProject?.slideshow?.autoPlaySec ?? 5}초</span>
                      <button class="interval-btn" onclick={() => setSlideshowInterval(1)}>+</button>
                    </div>
                  </div>
                {/if}

                <label class="toggle-row">
                  <span class="toggle-label">
                    <strong>슬라이드 번호 표시</strong>
                    <span class="toggle-desc">슬라이드쇼 화면 하단에 현재 번호를 표시합니다</span>
                  </span>
                  <button class="toggle-switch" class:on={selectedProject?.slideshow?.showSlideNumber}
                    onclick={toggleSlideNumber}>
                    <span class="toggle-knob"></span>
                  </button>
                </label>
              </div>

              <p class="helper-text" style="margin-top:12px;font-size:11px">
                단축키: Space/화살표 = 넘기기, F = 전체화면, L = 반복 토글, A = 자동 토글
              </p>
            </div>

            <div class="form-card">
              <div class="form-section-label">프로젝트 관리</div>
              <div class="form-footer">
                <button class="btn-outline btn-sm" disabled={loading} onclick={() => duplicateProject(selectedProject.id)}>프로젝트 복제</button>
                <button class="btn-danger btn-sm" disabled={loading} onclick={() => deleteProject(selectedProject.id)}>프로젝트 삭제</button>
              </div>
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>

  <!-- ── 프로젝트 생성 모달 ── -->
  {#if showNewProject}
    <div class="modal-overlay" onclick={() => { showNewProject = false; newProjectName = ''; newProjectPin = ''; }}>
      <div class="modal-card" onclick={e => e.stopPropagation()}>
        <h2 class="modal-title">새 프로젝트 만들기</h2>
        <div class="form-group">
          <label class="field-label">행사 이름</label>
          <input class="text-input modal-input" placeholder="예: 2025년 정기총회" bind:value={newProjectName}
            onkeydown={e => e.key === 'Enter' && createProject()} autofocus />
        </div>
        <div class="form-group">
          <label class="field-label">참여 PIN (선택)</label>
          <input class="text-input" type="text" placeholder="미입력 시 PIN 없이 접근 가능" maxlength="10"
            bind:value={newProjectPin} />
          <p class="helper-text">메인 페이지에서 프로젝트 접근 시 필요한 비밀번호입니다.</p>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick={() => { showNewProject = false; newProjectName = ''; newProjectPin = ''; }}>취소</button>
          <button class="btn-gold" disabled={loading || !newProjectName.trim()} onclick={createProject}>생성</button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  :global(body) { margin: 0; font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; background: #0e0e16; color: #e8e0d0; }

  /* ── PIN ── */
  .pin-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh;
    background: radial-gradient(ellipse at top, #12121a 0%, #0a0a0f 60%); padding: 20px; }
  .pin-card { background: rgba(18,18,26,.95); border: 1px solid rgba(201,168,76,.2); border-radius: 18px;
    padding: 48px; width: 100%; max-width: 360px; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
  .pin-card h1 { font-size: 22px; font-weight: 700; color: #f0e8d8; margin: 0; }
  .pin-input { width: 100%; padding: 13px 16px; background: rgba(255,255,255,.05); border: 1.5px solid rgba(255,255,255,.12);
    border-radius: 10px; color: #f0e8d8; font-size: 20px; text-align: center; letter-spacing: .2em;
    font-family: inherit; outline: none; box-sizing: border-box; }
  .pin-input:focus { border-color: rgba(201,168,76,.5); }
  .auth-loading { color: rgba(232,224,208,.6); font-size: 14px; margin: 0; }

  /* ── App layout ── */
  .app-layout { display: flex; min-height: 100vh; }

  /* ── Sidebar ── */
  .sidebar { width: 240px; flex-shrink: 0; background: #111119; border-right: 1px solid rgba(255,255,255,.1);
    display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .sidebar-inner { display: flex; flex-direction: column; padding: 20px 0 40px; min-height: 100%; }

  .sidebar-brand { padding: 0 18px 20px; border-bottom: 1px solid rgba(255,255,255,.06); margin-bottom: 8px; }
  .brand-logo { display: inline-block; padding: 4px 12px; border: 1px solid rgba(201,168,76,.4); border-radius: 20px;
    color: #c9a84c; font-size: 11px; font-weight: 700; letter-spacing: .12em; background: rgba(201,168,76,.07); }
  .brand-sub { font-size: 11px; color: rgba(232,224,208,.5); margin-top: 6px; padding-left: 2px; letter-spacing: .04em; }

  .sidebar-group { padding: 8px 0; }
  .sidebar-group-header { display: flex; align-items: center; justify-content: space-between;
    padding: 4px 18px 6px; }
  .sidebar-group-label { font-size: 10px; font-weight: 700; color: rgba(232,224,208,.65); letter-spacing: .1em; text-transform: uppercase; }
  .sidebar-group-label--project { display: block; padding: 4px 18px 8px; font-size: 11px; color: rgba(232,224,208,.65);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-add-btn { width: 20px; height: 20px; background: rgba(201,168,76,.1); border: 1px solid rgba(201,168,76,.2);
    border-radius: 4px; color: #c9a84c; font-size: 14px; line-height: 1; cursor: pointer;
    display: flex; align-items: center; justify-content: center; }
  .sidebar-add-btn:hover { background: rgba(201,168,76,.2); }

  .sidebar-empty { padding: 6px 18px; font-size: 12px; color: rgba(232,224,208,.2); }

  .new-project-form { padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; }
  .new-project-form-btns { display: flex; gap: 6px; }
  .text-input-sm { font-size: 13px; padding: 7px 10px; }

  .project-list { display: flex; flex-direction: column; }
  .project-list-item { display: flex; align-items: center; gap: 8px; padding: 8px 18px;
    background: none; border: none; color: rgba(232,224,208,.85); font-size: 13px; font-family: inherit;
    text-align: left; cursor: pointer; transition: all .15s; width: 100%; }
  .project-list-item:hover { background: rgba(255,255,255,.04); color: #f0e8d8; }
  .project-list-item.selected { background: rgba(201,168,76,.08); color: #f0e8d8; }
  .project-active-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.12); flex-shrink: 0; }
  .project-active-dot.active { background: #c9a84c; box-shadow: 0 0 5px rgba(201,168,76,.5); }
  .project-list-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }

  .sidebar-divider { margin: 8px 18px; border: none; border-top: 1px solid rgba(255,255,255,.06); }

  .sidebar-nav { display: flex; flex-direction: column; }
  .sidebar-nav-item { padding: 9px 18px 9px 28px; background: none; border: none; border-left: 2px solid transparent;
    color: rgba(232,224,208,.7); font-size: 13px; font-family: inherit; text-align: left; cursor: pointer;
    transition: all .15s; }
  .sidebar-nav-item:hover { color: #f0e8d8; background: rgba(255,255,255,.05); }
  .sidebar-nav-item.active { color: #c9a84c; border-left-color: #c9a84c; background: rgba(201,168,76,.06); }

  /* Mobile sidebar */
  .sidebar-overlay { display: none; }
  .mobile-menu-btn { display: none; }

  @media (max-width: 768px) {
    .sidebar { position: fixed; left: -240px; top: 0; z-index: 200; transition: left .25s ease; height: 100vh; }
    .sidebar.open { left: 0; }
    .sidebar-overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 190; }
    .mobile-menu-btn { display: flex; flex-direction: column; gap: 4px; background: none; border: none;
      cursor: pointer; padding: 6px; }
    .mobile-menu-btn span { display: block; width: 20px; height: 2px; background: rgba(232,224,208,.7); border-radius: 2px; }
  }

  /* ── Main ── */
  .main-wrap { flex: 1; display: flex; flex-direction: column; min-width: 0; }

  .topbar { display: flex; align-items: center; gap: 12px; padding: 14px 28px;
    border-bottom: 1px solid rgba(255,255,255,.1); background: rgba(10,10,15,.8);
    backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 10; }
  .topbar-breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 14px; flex: 1; overflow: hidden; }
  .topbar-bc-link { color: rgba(232,224,208,.6); cursor: pointer; white-space: nowrap; }
  .topbar-bc-link:hover { color: rgba(232,224,208,.7); }
  .topbar-bc-sep { color: rgba(255,255,255,.15); }
  .topbar-bc-current { font-weight: 600; color: #f0e8d8; cursor: pointer; display: flex; align-items: center; gap: 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .topbar-bc-current:hover { color: #c9a84c; }
  .topbar-bc-tab { color: rgba(232,224,208,.5); white-space: nowrap; }
  .topbar-activate-btn { flex-shrink: 0; }
  .name-edit-input { background: rgba(255,255,255,.08); border: 1px solid rgba(201,168,76,.4);
    border-radius: 6px; padding: 4px 10px; color: #f0e8d8; font-size: 14px; font-family: inherit; outline: none; }

  /* ── Content tab bar ── */
  .content-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid rgba(255,255,255,.1);
    padding: 0 28px;
    background: rgba(10,10,15,.4);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .content-tab {
    padding: 12px 18px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(232,224,208,.5);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: all .15s;
  }
  .content-tab:hover { color: rgba(232,224,208,.8); }
  .content-tab.active { color: #c9a84c; border-bottom-color: #c9a84c; }

  .content { flex: 1; padding: 28px; overflow-y: auto; color: #e8e0d0; }

  /* ── Flash ── */
  .flash { padding: 10px 16px; border-radius: 8px; font-size: 13px; margin: 0 28px 4px; }
  .flash-ok { background: rgba(76,175,80,.1); border: 1px solid rgba(76,175,80,.25); color: #80c883; }
  .flash-err { background: rgba(200,60,60,.1); border: 1px solid rgba(200,60,60,.25); color: #e07070; }

  /* ── Content sections ── */
  .content-section { display: flex; flex-direction: column; gap: 16px; max-width: 820px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .section-header-actions { display: flex; gap: 8px; }
  .section-title { font-size: 18px; font-weight: 700; color: #f0e8d8; margin: 0; }
  .helper-text { font-size: 12px; color: rgba(232,224,208,.65); margin: 0; }
  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 40px 20px; text-align: center; color: rgba(232,224,208,.5); font-size: 14px;
    border: 1px dashed rgba(255,255,255,.08); border-radius: 12px; }

  /* Badges */
  .active-badge { display: inline-block; padding: 2px 8px; background: rgba(201,168,76,.15);
    border: 1px solid rgba(201,168,76,.3); border-radius: 10px; color: #c9a84c; font-size: 11px; font-weight: 600; }
  .logo-badge { display: inline-block; padding: 4px 14px; border: 1px solid rgba(201,168,76,.5);
    border-radius: 20px; color: #c9a84c; font-size: 11px; font-weight: 600; letter-spacing: .1em;
    background: rgba(201,168,76,.06); }

  /* ── Project cards ── */
  .project-cards { display: flex; flex-direction: column; gap: 10px; }
  .project-card { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px; overflow: hidden; transition: border-color .2s; }
  .project-card.active { border-color: rgba(201,168,76,.25); background: rgba(201,168,76,.04); }
  .project-card-body { padding: 16px 20px; cursor: pointer; }
  .project-card-body:hover { background: rgba(255,255,255,.02); }
  .project-card-name { font-size: 15px; font-weight: 600; color: #f0e8d8; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .project-card-meta { font-size: 13px; color: rgba(232,224,208,.8); }
  .project-card-date { font-size: 12px; color: rgba(232,224,208,.55); margin-top: 4px; }
  .project-card-actions { display: flex; gap: 8px; padding: 10px 16px;
    border-top: 1px solid rgba(255,255,255,.05); background: rgba(0,0,0,.1); }

  /* ── Buttons ── */
  .btn-gold { padding: 9px 20px; background: rgba(201,168,76,.15); border: 1.5px solid rgba(201,168,76,.5);
    border-radius: 8px; color: #c9a84c; font-size: 14px; font-weight: 600; font-family: inherit;
    cursor: pointer; transition: all .2s; }
  .btn-gold:hover:not(:disabled) { background: rgba(201,168,76,.25); border-color: #c9a84c; }
  .btn-gold:disabled { opacity: .4; cursor: not-allowed; }
  .btn-outline { padding: 8px 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.15);
    border-radius: 8px; color: rgba(232,224,208,.8); font-size: 13px; font-family: inherit; cursor: pointer; transition: all .2s; }
  .btn-outline:hover { background: rgba(255,255,255,.09); color: #f0e8d8; }
  .btn-danger { padding: 8px 16px; background: rgba(200,60,60,.12); border: 1px solid rgba(200,60,60,.3);
    border-radius: 8px; color: #e07070; font-size: 13px; font-family: inherit; cursor: pointer; transition: all .2s; }
  .btn-danger:hover:not(:disabled) { background: rgba(200,60,60,.22); }
  .btn-ghost { padding: 7px 14px; background: none; border: none; color: rgba(232,224,208,.65); font-size: 13px; font-family: inherit; cursor: pointer; }
  .btn-ghost:hover { color: #f0e8d8; }
  .btn-sm { padding: 5px 12px; font-size: 12px; }
  .btn-icon { width: 28px; height: 28px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
    border-radius: 6px; color: rgba(232,224,208,.6); font-size: 13px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; }
  .btn-icon:hover:not(:disabled) { background: rgba(255,255,255,.12); color: #f0e8d8; }
  .btn-icon.danger { color: #e07070; }
  .btn-icon.danger:hover:not(:disabled) { background: rgba(200,60,60,.15); }
  .btn-icon:disabled { opacity: .3; cursor: not-allowed; }

  /* ── Inputs ── */
  .text-input { padding: 10px 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    border-radius: 8px; color: #f0e8d8; font-size: 14px; font-family: inherit; outline: none;
    width: 100%; box-sizing: border-box; }
  .text-input:focus { border-color: rgba(201,168,76,.4); }
  .select-input { padding: 9px 14px; background: rgba(18,18,26,.9); border: 1px solid rgba(255,255,255,.12);
    border-radius: 8px; color: #e8e0d0; font-size: 14px; font-family: inherit; outline: none; width: 100%; }
  .select-input:focus { border-color: rgba(201,168,76,.4); }
  .select-input-inline { max-width: 240px; }
  .field-row { display: flex; align-items: center; gap: 12px; }
  .field-label { font-size: 12px; font-weight: 600; color: rgba(232,224,208,.8); letter-spacing: .05em; white-space: nowrap; }

  /* ── Slides ── */
  .upload-btn { cursor: pointer; }
  .drop-zone { border: 2px dashed rgba(255,255,255,.1); border-radius: 10px; padding: 20px;
    text-align: center; color: rgba(232,224,208,.5); font-size: 13px; transition: all .2s; }
  .drop-zone.dragover { border-color: rgba(201,168,76,.5); background: rgba(201,168,76,.05); color: #c9a84c; }
  .upload-queue { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .upload-item { font-size: 12px; padding: 3px 8px; border-radius: 4px;
    background: rgba(255,255,255,.06); color: rgba(232,224,208,.5); }
  .upload-item.done { color: #80c883; background: rgba(76,175,80,.1); }
  .upload-item.error { color: #e07070; background: rgba(200,60,60,.1); display: inline-flex; align-items: center; gap: 6px; }
  .upload-item-dismiss { background: none; border: none; color: rgba(224,112,112,.6); font-size: 11px;
    cursor: pointer; padding: 0 2px; line-height: 1; font-family: inherit; }
  .upload-item-dismiss:hover { color: #e07070; }
  .slide-list { display: flex; flex-direction: column; gap: 8px; }
  .slide-row { display: flex; align-items: center; gap: 14px; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 10px 14px;
    transition: background .15s, border-color .15s, opacity .15s; cursor: grab; }
  .slide-row:hover { background: rgba(255,255,255,.1); }
  .slide-row.summary { border-color: rgba(201,168,76,.4); background: rgba(201,168,76,.04); }
  .slide-row.dragging { opacity: .4; cursor: grabbing; }
  .slide-row.drag-over { border-color: #c9a84c; background: rgba(201,168,76,.08); }
  .drag-handle { font-size: 16px; color: rgba(232,224,208,.5); cursor: grab; user-select: none;
    padding: 0 2px; flex-shrink: 0; }
  .slide-row:hover .drag-handle { color: rgba(232,224,208,.6); }
  .slide-num { font-size: 14px; font-weight: 700; color: rgba(232,224,208,.7); min-width: 24px; text-align: center; }
  .slide-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 6px;
    border: 1px solid rgba(255,255,255,.12); flex-shrink: 0; }
  .slide-info { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .slide-filename { font-size: 12px; color: rgba(232,224,208,.85); font-family: monospace;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag-summary { font-size: 11px; padding: 2px 8px; background: rgba(201,168,76,.18);
    border: 1px solid rgba(201,168,76,.4); border-radius: 8px; color: #c9a84c;
    align-self: flex-start; font-weight: 600; }
  .row-actions { margin-left: auto; display: flex; gap: 6px; flex-shrink: 0; }

  /* ── Signatory form ── */
  .form-card { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.1);
    border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
  .form-section-label { font-size: 10px; font-weight: 700; color: rgba(232,224,208,.75);
    letter-spacing: .12em; text-transform: uppercase; padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,.05); }
  .form-row-2 { display: flex; gap: 12px; }
  .form-row-2 .form-group { flex: 1; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-footer { display: flex; gap: 10px; }

  /* ── Color picker ── */
  .color-picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .color-swatch { width: 28px; height: 28px; border-radius: 6px; border: none; cursor: pointer;
    outline: 3px solid transparent; outline-offset: 2px; transition: outline-color .15s; flex-shrink: 0; }
  .color-swatch.selected { outline-color: #c9a84c; }
  .color-swatch:hover { outline-color: rgba(201,168,76,.5); }
  .color-custom-wrap { display: flex; align-items: center; gap: 6px; cursor: pointer;
    padding: 4px 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
    border-radius: 6px; }
  .color-custom-wrap input[type="color"] { width: 0; height: 0; opacity: 0; position: absolute; }
  .color-custom-preview { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255,255,255,.15); flex-shrink: 0; }
  .color-custom-label { font-size: 12px; color: rgba(232,224,208,.5); white-space: nowrap; }
  .color-preview-text { font-size: 15px; font-weight: 700; padding: 4px 8px;
    background: rgba(255,255,255,.04); border-radius: 6px; letter-spacing: .02em; }

  /* ── Color analysis ── */
  .color-analyze-wrap { display: flex; flex-direction: column; gap: 10px; }
  .btn-analyze { align-self: flex-start; padding: 6px 14px; background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: rgba(232,224,208,.7);
    font-size: 12px; font-family: inherit; cursor: pointer; transition: all .2s; }
  .btn-analyze:hover:not(:disabled) { background: rgba(201,168,76,.1); border-color: rgba(201,168,76,.3); color: #c9a84c; }
  .btn-analyze:disabled { opacity: .5; cursor: not-allowed; }
  .analyze-error { font-size: 12px; color: #e07070; }
  .analyzed-colors { display: flex; flex-direction: column; gap: 8px; }
  .analyzed-label { font-size: 11px; color: rgba(232,224,208,.55); letter-spacing: .04em; }
  .analyzed-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
  .color-swatch.analyzed { width: 32px; height: 32px; border-radius: 8px; }

  /* ── Signatory list ── */
  .sig-list { display: flex; flex-direction: column; gap: 8px; }
  .sig-row { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 12px 14px; overflow: hidden; position: relative; }
  .sig-color-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 10px 0 0 10px; }
  .sig-order-badge { width: 24px; height: 24px; border-radius: 50%; background: rgba(201,168,76,.1);
    border: 1px solid rgba(201,168,76,.25); color: #c9a84c; font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-left: 6px; }
  .sig-info { flex: 1; min-width: 0; }
  .sig-name { font-size: 14px; font-weight: 600; color: #f0e8d8; }
  .sig-meta { font-size: 12px; color: rgba(232,224,208,.55); margin-top: 2px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .sig-color-chip { display: inline-block; width: 10px; height: 10px; border-radius: 2px;
    border: 1px solid rgba(255,255,255,.2); vertical-align: middle; }

  /* ── Position picker ── */
  .picker-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .picker-slide-select { margin-bottom: 8px; }
  .picker-tab { display: flex; align-items: center; gap: 6px; padding: 6px 14px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
    border-radius: 6px; color: rgba(232,224,208,.5); font-size: 12px; font-family: inherit; cursor: pointer; }
  .picker-tab.active { background: rgba(201,168,76,.1); border-color: rgba(201,168,76,.3); color: #c9a84c; }
  .tab-badge-warn { font-size: 10px; padding: 1px 5px; background: rgba(220,80,60,.2);
    border: 1px solid rgba(220,80,60,.4); border-radius: 4px; color: #e07070; }
  .empty-state-warn { padding: 20px; border-radius: 8px; background: rgba(220,80,60,.07);
    border: 1px solid rgba(220,80,60,.2); color: rgba(232,224,208,.6); font-size: 13px;
    line-height: 1.7; }
  .empty-state-warn strong { color: #c9a84c; }
  .picker-hint { font-size: 12px; color: rgba(232,224,208,.6); margin: 0 0 8px; }
  .picker-wrap { position: relative; border-radius: 8px; overflow: hidden; cursor: crosshair;
    user-select: none; border: 1px solid rgba(255,255,255,.1); }
  .picker-wrap img { display: block; width: 100%; pointer-events: none; }
  .picker-overlay { position: absolute; border: 2px solid; pointer-events: none; }
  .area-inputs { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 8px; }
  .area-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: rgba(232,224,208,.5); }
  .area-input { width: 72px; }

  /* ── Connections ── */
  .conn-list { display: flex; flex-direction: column; gap: 8px; }
  .conn-row { display: flex; align-items: center; gap: 12px; padding: 14px 18px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px; transition: border-color .3s; }
  .conn-row.connected { background: rgba(201,168,76,.05); border-color: rgba(201,168,76,.15); }
  .conn-dot { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.1); flex-shrink: 0; }
  .conn-dot.on { background: #c9a84c; box-shadow: 0 0 6px rgba(201,168,76,.4); }
  .conn-info { flex: 1; }
  .conn-label { font-size: 14px; font-weight: 600; color: #f0e8d8; }
  .conn-sub { font-size: 12px; color: rgba(232,224,208,.7); }

  /* ── Remote QR section ── */
  .section-sub-title { font-size: 14px; font-weight: 700; color: rgba(232,224,208,.85); margin-bottom: 4px; }
  .remote-qr-section { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }

  /* ── QR ── */
  .qr-grid { display: flex; gap: 20px; flex-wrap: wrap; }
  .qr-card { display: flex; flex-direction: column; align-items: center; gap: 8px;
    background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 16px; }
  .qr-card-label { font-size: 13px; font-weight: 600; color: rgba(232,224,208,.5); }
  .qr-img { border-radius: 8px; }
  .qr-url { font-size: 11px; color: rgba(232,224,208,.6); font-family: monospace; }

  /* ── Sig preview ── */
  .sig-preview { width: 80px; height: 32px; object-fit: contain; border: 1px solid rgba(255,255,255,.1);
    border-radius: 4px; }

  /* ── Sidebar bottom / guide btn ── */
  .sidebar-spacer { flex: 1; }
  .sidebar-bottom { padding: 12px 10px; border-top: 1px solid rgba(255,255,255,.06); }
  .sidebar-guide-btn { width: 100%; padding: 9px 14px; background: none; border: 1px solid rgba(255,255,255,.08);
    border-radius: 8px; color: rgba(232,224,208,.6); font-size: 13px; font-family: inherit;
    text-align: left; cursor: pointer; transition: all .15s; }
  .sidebar-guide-btn:hover { background: rgba(255,255,255,.05); color: rgba(232,224,208,.8); }
  .sidebar-guide-btn.active { background: rgba(201,168,76,.08); border-color: rgba(201,168,76,.25); color: #c9a84c; }

  /* ── Guide content ── */
  .guide-section { max-width: 760px; }
  .guide-block { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.1);
    border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .guide-block-title { font-size: 15px; font-weight: 700; color: #f0e8d8; }
  .guide-text { margin: 0; font-size: 13px; color: rgba(232,224,208,.65); line-height: 1.7; }
  .guide-table { display: flex; flex-direction: column; gap: 10px; }
  .guide-table-row { display: flex; gap: 16px; align-items: flex-start; padding: 12px 16px;
    background: rgba(255,255,255,.03); border-radius: 8px; }
  .guide-table-key { font-size: 13px; font-weight: 700; color: #c9a84c; min-width: 130px; flex-shrink: 0; }
  .guide-table-val { font-size: 13px; color: rgba(232,224,208,.6); line-height: 1.6; }
  .guide-step { display: flex; gap: 16px; align-items: flex-start; }
  .guide-step-num { width: 28px; height: 28px; border-radius: 50%; background: rgba(201,168,76,.15);
    border: 1px solid rgba(201,168,76,.3); color: #c9a84c; font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
  .guide-step-body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .guide-step-title { font-size: 14px; font-weight: 700; color: #f0e8d8; }
  .guide-step-desc { font-size: 13px; color: rgba(232,224,208,.6); line-height: 1.7; }
  .guide-tip { display: inline-block; margin-top: 4px; padding: 4px 10px;
    background: rgba(201,168,76,.07); border: 1px solid rgba(201,168,76,.15);
    border-radius: 6px; color: rgba(232,224,208,.55); font-size: 12px; }
  .guide-list { margin: 6px 0 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
  .guide-list li { font-size: 13px; color: rgba(232,224,208,.6); line-height: 1.6; }
  .guide-warn-list li { color: rgba(232,100,100,.75); }
  .guide-code { font-family: monospace; font-size: 12px; padding: 1px 6px;
    background: rgba(255,255,255,.08); border-radius: 4px; color: rgba(232,224,208,.8); }

  /* ── Modal ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 300; padding: 20px; }
  .modal-card { background: #14141e; border: 1px solid rgba(201,168,76,.25); border-radius: 16px;
    padding: 32px; width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 16px; }
  .modal-title { font-size: 18px; font-weight: 700; color: #f0e8d8; margin: 0; }
  .modal-desc { font-size: 14px; color: rgba(232,224,208,.6); margin: 0; }
  .modal-input { font-size: 16px; padding: 14px 16px; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; }

  /* ── Slideshow settings ── */
  .slideshow-options { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
  .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 16px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
    border-radius: 10px; cursor: pointer; }
  .toggle-label { display: flex; flex-direction: column; gap: 2px; }
  .toggle-label strong { font-size: 14px; color: #f0e8d8; font-weight: 600; }
  .toggle-desc { font-size: 12px; color: rgba(232,224,208,.45); }
  .toggle-switch { width: 44px; height: 24px; border-radius: 12px; border: none; padding: 2px;
    background: rgba(255,255,255,.1); cursor: pointer; position: relative; transition: background .2s;
    flex-shrink: 0; }
  .toggle-switch.on { background: rgba(201,168,76,.5); }
  .toggle-knob { display: block; width: 20px; height: 20px; border-radius: 50%; background: #e8e0d0;
    transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
  .toggle-switch.on .toggle-knob { transform: translateX(20px); }
  .interval-setting { display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; background: rgba(201,168,76,.05); border: 1px solid rgba(201,168,76,.15);
    border-radius: 10px; }
  .interval-label { font-size: 13px; color: rgba(232,224,208,.7); }
  .interval-control { display: flex; align-items: center; gap: 8px; }
  .interval-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,.12);
    background: rgba(255,255,255,.06); color: rgba(232,224,208,.7); font-size: 16px; font-weight: 700;
    cursor: pointer; display: flex; align-items: center; justify-content: center; font-family: inherit;
    transition: all .15s; }
  .interval-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
  .interval-value { font-size: 15px; font-weight: 700; color: #c9a84c; min-width: 36px; text-align: center; }
</style>
