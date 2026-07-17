-- ════════════════════════════════════════════════════════════════
-- Migration 0006 — Métis : 2 dates + liens vers Chronos
-- ════════════════════════════════════════════════════════════════
-- Un brief a un jour de shoot ET un premier rendu. Chacun est relié à
-- un événement Chronos (créé/maj/supprimé automatiquement).

alter table public.briefs add column if not exists delivery_date date;
alter table public.briefs add column if not exists shoot_event_id bigint;
alter table public.briefs add column if not exists delivery_event_id bigint;
