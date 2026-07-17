-- ════════════════════════════════════════════════════════════════
-- Migration 0004 — Iris (email + CRM)
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- CRM partagé de l'équipe : contacts + journal des mails envoyés avec
-- suivi d'ouverture (pixel de tracking → Edge Function `track`).

create table if not exists public.contacts (
  id         bigint generated always as identity primary key,
  email      text not null unique,
  name       text,
  created_by uuid,
  created_at timestamptz default now()
);
alter table public.contacts enable row level security;
drop policy if exists ct_all on public.contacts;
create policy ct_all on public.contacts for all to authenticated using (true) with check (true);

create table if not exists public.emails (
  id              bigint generated always as identity primary key,
  tracking_id     text unique,
  to_email        text not null,
  to_name         text,
  subject         text,
  preview         text,
  sent_by         uuid,
  sent_by_name    text,
  sent_at         timestamptz default now(),
  open_count      int default 0,
  first_opened_at timestamptz,
  last_opened_at  timestamptz
);
create index if not exists emails_tracking_idx on public.emails (tracking_id);
create index if not exists emails_sent_idx on public.emails (sent_at desc);
alter table public.emails enable row level security;
drop policy if exists em_all on public.emails;
create policy em_all on public.emails for all to authenticated using (true) with check (true);
