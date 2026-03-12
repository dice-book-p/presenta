<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { API_BASE } from '$lib/config.js';

  const SS_PIN_KEY = 'presenta_pin_verified';

  let projects = $state([]);
  let loading = $state(true);

  onMount(async () => {
    // 루트로 돌아오면 PIN 인증 전부 초기화
    sessionStorage.removeItem(SS_PIN_KEY);

    try {
      const res = await fetch(`${API_BASE}/api/active`);
      if (res.ok) projects = await res.json();
    } catch {}
    loading = false;
  });

  function selectProject(project) {
    goto(`/${project.id}`);
  }
</script>

<main>
  <div class="hero">
    <div class="logo-area">
      <div class="logo-badge">Presenta</div>
      <h1 class="title">프레젠타</h1>
      <p class="subtitle">행사를 선택해주세요</p>
    </div>

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

  .subtitle {
    font-size: 16px;
    color: rgba(232, 224, 208, 0.5);
    letter-spacing: 0.05em;
    margin: 0;
  }

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
</style>
