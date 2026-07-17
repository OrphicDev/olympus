-- ════════════════════════════════════════════════════════════════
-- Migration 0003 — Présence (qui est en ligne)
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- Chaque membre met à jour son "last_seen" régulièrement (heartbeat).
-- En ligne = last_seen dans les ~2 dernières minutes.

create table if not exists public.presence (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  name      text,
  last_seen timestamptz default now()
);

alter table public.presence enable row level security;

drop policy if exists pr_read on public.presence;
create policy pr_read on public.presence
  for select to authenticated using (true);

drop policy if exists pr_write on public.presence;
create policy pr_write on public.presence
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
