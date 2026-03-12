<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { API_BASE } from '$lib/config.js';

  // 단계: 'projects' → 'pin' → 'roles'
  const SS_KEY = 'presenta_main_state';
  let step = $state('projects');
  let projects = $state([]);
  let loading = $state(true);
  let selectedProject = $state(null);
  let pinInput = $state('');
  let pinError = $state('');

  function saveState() {
    if (selectedProject && step !== 'projects') {
      sessionStorage.setItem(SS_KEY, JSON.stringify({ step, projectId: selectedProject.id }));
    } else {
      sessionStorage.removeItem(SS_KEY);
    }
  }

  onMount(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/active`);
      if (res.ok) projects = await res.json();
    } catch {}

    // 세션 복원
    try {
      const saved = sessionStorage.getItem(SS_KEY);
      if (saved && projects.length) {
        const { step: savedStep, projectId } = JSON.parse(saved);
        const proj = projects.find(p => p.id === projectId);
        if (proj && (savedStep === 'pin' || savedStep === 'roles')) {
          selectedProject = proj;
          step = savedStep;
        }
      }
    } catch {}

    loading = false;
  });

  function selectProject(project) {
    selectedProject = project;
    if (project.hasPin) {
      pinInput = '';
      pinError = '';
      step = 'pin';
    } else {
      step = 'roles';
    }
    saveState();
  }

  async function verifyPin() {
    pinError = '';
    try {
      const res = await fetch(`${API_BASE}/api/projects/${selectedProject.id}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        step = 'roles';
        saveState();
      } else {
        pinError = 'PIN이 올바르지 않습니다';
      }
    } catch {
      pinError = '서버 연결 실패';
    }
  }

  function goBack() {
    if (step === 'roles') {
      step = selectedProject?.hasPin ? 'pin' : 'projects';
    } else {
      step = 'projects';
      selectedProject = null;
    }
    saveState();
  }
</script>

<main>
  <div class="hero">
    <div class="logo-area">
      <div class="logo-badge">Presenta</div>
      {#if step === 'projects'}
        <h1 class="title">프레젠타</h1>
        <p class="subtitle">행사를 선택해주세요</p>
      {:else}
        <h1 class="title project-name">{selectedProject.name}</h1>
      {/if}
    </div>

    <!-- Step 1: 프로젝트 목록 -->
    {#if step === 'projects'}
      <div class="project-list">
        {#if loading}
          <p class="empty">불러오는 중...</p>
        {:else if projects.length === 0}
          <p class="empty">진행 중인 행사가 없습니다</p>
        {:else}
          {#each projects as project}
            <button class="project-card" onclick={() => selectProject(project)}>
              <div class="project-card-name">{project.name}</div>
              <div class="project-card-meta">
                <span>슬라이드 {project.slides?.length ?? 0}장</span>
                <span>서명자 {project.signatories?.length ?? 0}명</span>
              </div>
              {#if project.hasPin}
                <div class="project-card-lock">PIN</div>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

    <!-- Step 2: PIN 입력 -->
    {:else if step === 'pin'}
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

    <!-- Step 3: 역할 선택 -->
    {:else if step === 'roles'}
      <div class="buttons">
        <button class="role-btn primary" onclick={() => goto(`/display?p=${selectedProject.id}`)}>
          <span class="btn-icon">🖥</span>
          <span class="btn-label">슬라이드쇼</span>
          <span class="btn-desc">PC / 메인 화면용</span>
        </button>

        <button class="role-btn secondary" onclick={() => goto(`/sign?p=${selectedProject.id}`)}>
          <span class="btn-icon">✍</span>
          <span class="btn-label">서명</span>
          <span class="btn-desc">태블릿 / 서명 입력용</span>
        </button>
      </div>
      <button class="back-btn" onclick={goBack}>← 다른 행사 선택</button>
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

  .subtitle {
    font-size: 16px;
    color: rgba(232, 224, 208, 0.5);
    letter-spacing: 0.05em;
    margin: 0;
  }

  /* ── Step 1: Project list ── */
  .project-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 480px;
  }

  .empty {
    text-align: center;
    color: rgba(232, 224, 208, 0.4);
    font-size: 15px;
    padding: 40px 0;
  }

  .project-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 24px 28px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1.5px solid rgba(255, 255, 255, 0.1);
    text-align: left;
    transition: all 0.2s ease;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
  }

  .project-card:hover {
    border-color: rgba(201, 168, 76, 0.6);
    background: rgba(201, 168, 76, 0.08);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .project-card-name {
    font-size: 20px;
    font-weight: 700;
    color: #f0e8d8;
  }

  .project-card-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: rgba(232, 224, 208, 0.4);
  }

  .project-card-lock {
    position: absolute;
    top: 16px;
    right: 20px;
    font-size: 10px;
    font-weight: 700;
    color: #c9a84c;
    padding: 3px 8px;
    border: 1px solid rgba(201, 168, 76, 0.4);
    border-radius: 6px;
    letter-spacing: 0.05em;
  }

  /* ── Step 2: PIN ── */
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

  /* ── Step 3: Role buttons ── */
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
</style>
