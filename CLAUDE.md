# Presenta - 행사 서명 프레젠테이션 시스템

## 스택
- **프론트엔드**: SvelteKit (Svelte 5 runes: $state, $derived, $effect), Vite
- **백엔드**: Node.js HTTP + WebSocket (ws 라이브러리)
- **데이터 저장**: Supabase PostgreSQL DB + Supabase Storage (프로덕션) / 로컬 파일시스템 (개발)
- **빌드**: `npm run build` → `@sveltejs/adapter-node`
- **프로덕션 실행**: `node server/index.js`
- **개발 실행**: `npm run dev` (Vite + `node server/ws-dev.js`)

## 아키텍처

### 듀얼 스토리지 어댑터
- `SUPABASE_URL` 환경변수로 어댑터 자동 선택 (`server/infra/supabase.js`)
- Supabase 모드: DB 테이블 + Storage 버킷
- 로컬 모드: `data/*.json` + `uploads/` 디렉토리
- store 레이어는 어댑터 종류를 모름 (동일 인터페이스)

### 데이터 저장 (Supabase 모드)
- **프로젝트/슬라이드/서명자**: `projects`, `slides`, `signatories` 테이블
- **활성 프로젝트**: `active_projects` 테이블
- **서명 데이터**: `signatures` 테이블
- **미디어 메타데이터**: `media` 테이블
- **슬라이드 이미지**: `slides` Storage 버킷 (public)
- **미디어 파일(음원/영상)**: `media` Storage 버킷 (public)

### 인메모리 스토어 패턴
모든 데이터는 서버 시작 시 DB에서 인메모리로 로드, 변경 시 fire-and-forget으로 DB에 persist:
```
initStore() → loadData() → 인메모리
변경 → persist() → saveData() (비동기, 에러 로깅만)
```

## 주요 경로
- `server/store/` — 인메모리 스토어 (projects, signatures, media)
- `server/infra/` — 스토리지 어댑터 (supabase-adapter, local-storage)
- `server/api/` — REST API 핸들러
- `server/ws/` — WebSocket 서버 (서명 실시간 중계)
- `src/routes/admin/` — 관리자 페이지
- `src/routes/[id]/display/` — 디스플레이(슬라이드쇼) 페이지
- `src/routes/[id]/sign/` — 서명 입력 페이지
- `src/lib/` — 공유 모듈 (audio-manager, particle-engine, seal-effect, effect-themes)

## 빌드 & 배포
```bash
npm run build          # SvelteKit 빌드
node server/index.js   # 프로덕션 서버 (SvelteKit + WS + API 통합)
```
- git push → 자동 배포
- 프로덕션에서는 `SUPABASE_URL` 필수 (없으면 서버 종료)

## 설정 저장 패턴
- 프로젝트 설정 (슬라이드쇼, 서명 연출 등): **수동 저장 버튼** (로컬 편집 → 저장 클릭 시 서버 전송)
- 서명자 편집: **수동 저장 버튼**
- 슬라이드 업로드/삭제/정렬: **즉시 반영**
