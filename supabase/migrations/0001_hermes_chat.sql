-- ════════════════════════════════════════════════════════════════
-- Migration 0001 — Hermès (chat d'équipe)
-- Projet : Olympus (Supabase dédié)
-- ════════════════════════════════════════════════════════════════
-- Messages du chat. Lecture réservée aux membres connectés ;
-- chacun ne peut écrire que ses propres messages (auth.uid() = user_id).

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body        text not null,
  created_at  timestamptz default now()
);
create index if not exists messages_id_idx on public.messages (id);

alter table public.messages enable row level security;

drop policy if exists msg_read on public.messages;
create policy msg_read on public.messages
  for select to authenticated using (true);

drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages
  for insert to authenticated with check (auth.uid() = user_id);
