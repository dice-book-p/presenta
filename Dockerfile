# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# production 의존성만 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 결과물 + 서버 코드 복사
COPY --from=builder /app/build ./build
COPY server ./server

# 서명 데이터 저장 디렉토리 (Fly Volume 마운트 포인트)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server/index.js"]
