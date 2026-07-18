-- ════════════════════════════════════════════════════════════════
-- Migration 0009 — Chronos absorbe Métis
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- Un événement peut désormais porter tout un brief de shoot :
-- client, équipe, type, moodboard + fichiers, lieu, shotlist, 1er rendu.
-- + deux drapeaux : perso (privé) et indisponibilité (montrer occupé).

alter table public.events
  add column if not exists client            text,
  add column if not exists end_time          text,                 -- "HH:MM", comme time
  add column if not exists shoot_type        text,                 -- photo | video | both
  add column if not exists participants      jsonb default '[]'::jsonb,
  add column if not exists objectives        text,                 -- le brief
  add column if not exists moodboard         text,
  add column if not exists attachments       jsonb default '[]'::jsonb,
  add column if not exists location          text,
  add column if not exists shotlist          text,
  add column if not exists delivery_date     date,
  add column if not exists delivery_event_id bigint,               -- événement "Rendu" lié
  add column if not exists is_personal       boolean default false,
  add column if not exists show_busy         boolean default true; -- affiche l'indisponibilité
