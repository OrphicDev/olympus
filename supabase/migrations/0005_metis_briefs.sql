-- ════════════════════════════════════════════════════════════════
-- Migration 0005 — Métis (briefs de shooting)
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- Briefs partagés de l'équipe (RLS authenticated all).

create table if not exists public.briefs (
  id         bigint generated always as identity primary key,
  title      text not null,
  client     text,
  shoot_date date,
  objectives text,
  moodboard  text,
  location   text,
  material   text,
  team       text,
  shotlist   text,
  status     text default 'draft',       -- draft | ready | done
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists briefs_updated_idx on public.briefs (updated_at desc);

alter table public.briefs enable row level security;
drop policy if exists br_all on public.briefs;
create policy br_all on public.briefs for all to authenticated using (true) with check (true);
