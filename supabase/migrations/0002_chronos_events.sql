-- ════════════════════════════════════════════════════════════════
-- Migration 0002 — Chronos (calendrier / tâches d'équipe)
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- Calendrier partagé : tous les membres connectés voient et gèrent
-- les événements/tâches (équipe restreinte de confiance).

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  title      text not null,
  date       date not null,
  time       text,                       -- optionnel "HH:MM"
  category   text default 'general',     -- type/projet (pilote la couleur)
  assignee   text,                       -- membre assigné (nom libre)
  notes      text,
  done       boolean default false,
  created_by uuid,
  created_at timestamptz default now()
);
create index if not exists events_date_idx on public.events (date);

alter table public.events enable row level security;

drop policy if exists ev_all on public.events;
create policy ev_all on public.events
  for all to authenticated using (true) with check (true);
