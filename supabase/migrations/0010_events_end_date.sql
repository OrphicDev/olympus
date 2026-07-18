-- ════════════════════════════════════════════════════════════════
-- Migration 0010 — Événements multi-jours
-- Projet : Olympus
-- ════════════════════════════════════════════════════════════════
-- Un événement peut s'étendre de `date` (début) à `end_date` (fin incluse).
-- end_date null (ou = date) => événement sur une seule journée.

alter table public.events add column if not exists end_date date;
