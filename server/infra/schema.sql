-- Presenta DB Schema (Supabase PostgreSQL)
-- Supabase SQL Editor에서 실행

-- ── 프로젝트 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary_slide_id UUID,
  pin TEXT DEFAULT '',
  remote_token TEXT DEFAULT '',
  slideshow JSONB DEFAULT '{"loop":false,"autoPlay":false,"autoPlaySec":5}'::jsonb
);

-- ── 슬라이드 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slides (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  original_filename TEXT
);

CREATE INDEX IF NOT EXISTS idx_slides_project ON slides(project_id);

-- ── 서명자 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signatories (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  title TEXT DEFAULT '',
  name TEXT DEFAULT '',
  color TEXT DEFAULT '#ffffff',
  slide_id UUID,
  canvas_area JSONB,
  summary_area JSONB
);

CREATE INDEX IF NOT EXISTS idx_signatories_project ON signatories(project_id);

-- ── 활성 프로젝트 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS active_projects (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  activated_at TIMESTAMPTZ DEFAULT now()
);

-- ── 서명 데이터 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signatures (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sign_id TEXT NOT NULL,
  data_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, sign_id)
);

CREATE INDEX IF NOT EXISTS idx_signatures_project ON signatures(project_id);
