-- ════════════════════════════════════════════════════════════════
-- Migration 0007 — Métis : horaires, type de shoot, participants
-- ════════════════════════════════════════════════════════════════

alter table public.briefs add column if not exists start_time   text;              -- "HH:MM"
alter table public.briefs add column if not exists end_time     text;              -- "HH:MM"
alter table public.briefs add column if not exists shoot_type   text default 'photo'; -- photo | video | both
alter table public.briefs add column if not exists participants text;              -- noms séparés par ", "
