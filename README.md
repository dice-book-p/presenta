# Presenta (프레젠타)

오프라인 행사(기념식, 협약식, 조인식 등)를 위한 **실시간 프레젠테이션 + 전자서명** 시스템.

행사장 메인 화면에 슬라이드를 표시하고, 서명자가 태블릿에서 서명하면 화면에 즉시 반영됩니다.
리모컨으로 슬라이드를 넘기고, 관리자 대시보드에서 모든 것을 제어합니다.

---

## 화면 구성

| 화면 | 경로 | 용도 | 기기 |
|------|------|------|------|
| **관리자** | `/admin` | 프로젝트 설정, 슬라이드 업로드, 서명자 등록, 행사 진행 관리 | PC |
| **슬라이드쇼** | `/{id}/display` | 행사장 메인 디스플레이 | PC / 빔프로젝터 |
| **서명** | `/{id}/sign` | 서명자 태블릿 입력 | 태블릿 |
| **리모컨** | `/{id}/remote` | 슬라이드 넘김 제어 (QR 접속) | 모바일 |
| **역할 선택** | `/{id}` | 슬라이드쇼 / 서명 진입 허브 (QR 코드 표시) | 공통 |

---

## 주요 기능

### 슬라이드쇼
- 이미지 / PDF 업로드 (PDF는 페이지별 자동 변환)
- 드래그 앤 드롭 순서 변경
- 자동 재생 (간격 설정 가능)
- 키보드 / 리모컨 슬라이드 제어
- 슬라이드 번호 입력(숫자+Enter) 이동
- 이전 진행 위치 이어보기 / 처음부터 선택

### 실시간 서명
- 태블릿에서 터치 서명 → 슬라이드쇼 화면에 실시간 반영
- Bezier 곡선 보간으로 부드러운 필기감
- 배치 전송 (30ms 간격) + 재시도로 네트워크 불안정 대응
- 서명자별 개별 슬라이드 + 종합서명 슬라이드 지원
- 서명 완료 상태 표시 (서명 화면, 관리자, 디스플레이)

### 리모컨
- QR 코드 스캔으로 접속 (토큰 인증)
- 이전/다음 슬라이드 제어
- 현재 슬라이드 미리보기

### 관리자
- 대시보드 (통계 요약, 활성 프로젝트 바로가기)
- 프로젝트 CRUD (생성, 편집, 복제, 삭제)
- 슬라이드 관리 (업로드, 순서 변경, 삭제)
- 서명자 관리 (등록, 서명 영역 지정, 색상 설정)
- 연결 현황 모니터링 (디스플레이, 태블릿, 리모컨)
- 슬라이드쇼 설정 (자동 재생, 슬라이드 번호 표시 등)
- PIN 보호 / 원격 토큰 관리

### 통신
- WebSocket 기반 실시간 동기화
- 클라이언트 ping/pong 헬스체크
- 지수 백오프 자동 재연결 (1s → 2s → 4s → ... → 30s)
- 재연결 시 자동 re-identify

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | SvelteKit 2 + Svelte 5 (runes) |
| Backend | Node.js (raw HTTP, Express 미사용) |
| WebSocket | `ws` 패키지 |
| 파일 업로드 | `busboy` (multipart) |
| QR 코드 | `qrcode` |
| PDF 변환 | PDF.js (CDN, 클라이언트 사이드) |
| 스토리지 | Supabase Storage (프로덕션) / 로컬 파일시스템 (개발) |
| 배포 | Render.com |

---

## 설치 및 실행

### 요구사항

- Node.js 22+
- npm

### 로컬 개발

```bash
# 의존성 설치
npm install

# 환경변수 설정 (선택 — 없으면 로컬 파일시스템 사용)
cp .env.example .env

# 개발 서버 시작
npm run dev
```

- 프론트엔드: `http://localhost:5173`
- API / WebSocket: `http://localhost:8765` (Vite가 자동 프록시)

Supabase 없이도 로컬 파일시스템 어댑터로 즉시 개발 가능합니다.
프로젝트 데이터는 `data/`, 이미지는 `uploads/`에 저장됩니다.

### 프로덕션 빌드

```bash
npm run build
node server/index.js
```

---

## 환경변수

```bash
# ── Supabase (프로덕션 필수) ──
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx

# ── 공통 ──
ADMIN_PIN=1234              # 관리자 인증 PIN (기본: 1234)
PORT=3000                   # 서버 포트 (기본: 3000)

# ── 로컬 개발 전용 ──
LOCAL_HOST=http://localhost:8765   # 이미지 URL 호스트
```

- `SUPABASE_URL`이 설정되면 → Supabase 사용 (프로덕션)
- 설정되지 않으면 → 로컬 파일시스템 사용 (개발)
- `NODE_ENV=production`인데 `SUPABASE_URL`이 없으면 → 서버 시작 실패

---

## 프로젝트 구조

```
presenta/
├── src/                          # 프론트엔드
│   ├── routes/
│   │   ├── +page.svelte          # 프로젝트 목록 (루트)
│   │   ├── admin/+page.svelte    # 관리자 대시보드
│   │   └── [id]/
│   │       ├── +page.svelte      # 역할 선택 (허브)
│   │       ├── display/          # 슬라이드쇼
│   │       ├── sign/             # 서명 입력
│   │       └── remote/           # 리모컨
│   └── lib/
│       ├── config.js             # WS_URL, API_BASE
│       └── stores/
│           └── websocket.svelte.js  # WebSocket 스토어
│
├── server/                       # 백엔드
│   ├── index.js                  # 프로덕션 서버 (HTTP + WS + SvelteKit)
│   ├── ws-dev.js                 # 개발용 WS 서버 (포트 8765)
│   ├── config.js                 # 설정 상수
│   ├── api/
│   │   ├── index.js              # REST API 라우터
│   │   └── middleware.js         # 인증, JSON 파싱
│   ├── ws/
│   │   ├── server.js             # WebSocket 메시지 핸들러
│   │   └── connections.js        # 연결 관리 및 브로드캐스트
│   ├── store/
│   │   ├── projects.js           # 프로젝트 인메모리 스토어
│   │   └── signatures.js         # 서명 데이터 스토어
│   └── infra/
│       ├── supabase-adapter.js   # Supabase 스토리지 어댑터
│       └── local-storage.js      # 로컬 파일시스템 어댑터
│
├── tests/                        # 테스트
├── data/                         # 로컬 개발 데이터 (자동 생성)
├── uploads/                      # 로컬 개발 이미지 (자동 생성)
├── render.yaml                   # Render.com 배포 설정
└── .env.example                  # 환경변수 템플릿
```

---

## API

인증이 필요한 엔드포인트는 `Authorization` 헤더에 ADMIN_PIN을 전달합니다.

### 프로젝트

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/projects` | 전체 프로젝트 목록 | O |
| POST | `/api/projects` | 프로젝트 생성 | O |
| GET | `/api/projects/:id` | 프로젝트 상세 | - |
| PUT | `/api/projects/:id` | 프로젝트 수정 | O |
| DELETE | `/api/projects/:id` | 프로젝트 삭제 | O |
| POST | `/api/projects/:id/duplicate` | 프로젝트 복제 | O |

### 활성화

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/active` | 활성 프로젝트 목록 | - |
| POST | `/api/active` | 활성화 / 비활성화 | O |

### 슬라이드

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/projects/:id/slides` | 이미지 업로드 (multipart) | O |
| PUT | `/api/projects/:id/slides/reorder` | 순서 변경 | O |
| DELETE | `/api/projects/:id/slides` | 전체 삭제 | O |
| DELETE | `/api/projects/:id/slides/:slideId` | 개별 삭제 | O |

### 서명

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/projects/:id/signatures` | 서명 목록 | - |
| POST | `/api/projects/:id/signatures` | 서명 저장 | - |
| DELETE | `/api/projects/:id/signatures` | 전체 초기화 | O |
| DELETE | `/api/projects/:id/signatures/:signId` | 개별 초기화 | O |

### 기타

| Method | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | `/api/projects/:id/verify-pin` | PIN 검증 | - |
| PUT | `/api/projects/:id/pin` | PIN 설정 | O |
| GET | `/api/projects/:id/remote-token` | 리모컨 토큰 | O |
| GET | `/api/projects/:id/status` | 연결 현황 | - |
| POST | `/api/disconnect/:id` | 강제 연결 해제 | O |

---

## WebSocket 프로토콜

경로: `/ws`

### 클라이언트 식별

```json
// 디스플레이
{ "type": "identify_display", "projectId": "...", "role": "main" }

// 태블릿 (서명)
{ "type": "identify_tablet", "projectId": "...", "signId": "..." }

// 리모컨
{ "type": "identify_remote", "projectId": "...", "token": "..." }
```

### 메시지 타입

| 타입 | 방향 | 설명 |
|------|------|------|
| `identified` | 서버→클라이언트 | 식별 완료, 프로젝트 데이터 전달 |
| `rejected` | 서버→클라이언트 | 식별 거부 (사유 포함) |
| `slide_change` | 메인→서버→전체 | 슬라이드 변경 |
| `slide_update` | 서버→리모컨 | 현재 슬라이드 동기화 |
| `draw` | 태블릿→서버→메인 | 실시간 그리기 (단일 점) |
| `draw_batch` | 태블릿→서버→메인 | 실시간 그리기 (배치) |
| `sign_done` | 태블릿→서버→메인 | 서명 완료 |
| `sign_clear` | 태블릿→서버→메인 | 서명 초기화 |
| `remote_slide` | 리모컨→서버→메인 | 슬라이드 이전/다음 |
| `connection_status` | 서버→디스플레이 | 연결 현황 업데이트 |
| `ping` / `pong` | 양방향 | 헬스체크 |

---

## 배포 (Render.com)

`render.yaml`이 포함되어 있어 Render에서 바로 배포할 수 있습니다.

1. GitHub 저장소 연결
2. Render 대시보드에서 환경변수 설정:
   - `NODE_ENV` = `production`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PIN`
3. 자동 빌드 및 배포

```yaml
# render.yaml
services:
  - type: web
    name: presenta
    runtime: node
    buildCommand: npm ci && npm run build
    startCommand: node server/index.js
    healthCheckPath: /api/active
```

---

## 테스트

```bash
npm test              # 전체 테스트 실행
npm run test:watch    # 감시 모드
```

---

## 행사 진행 순서

1. **관리자**에서 프로젝트 생성
2. 슬라이드 이미지/PDF 업로드, 순서 조정
3. 서명자 등록 (이름, 직함, 서명 슬라이드, 서명 영역, 색상)
4. 종합서명 슬라이드 지정 (선택)
5. 프로젝트 **활성화**
6. 행사장 PC에서 **슬라이드쇼** 접속
7. 서명자 태블릿에서 **서명 화면** 접속 (QR 코드)
8. 진행자 모바일에서 **리모컨** 접속 (QR 코드)
9. 리모컨으로 슬라이드 진행 → 서명 슬라이드 도달 시 서명자가 터치 서명
10. 서명 완료 → 화면에 즉시 반영, 다음 슬라이드로 자동 이동

---

## 라이선스

Private
