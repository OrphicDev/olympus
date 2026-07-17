-- ════════════════════════════════════════════════════════════════
-- Migration 0008 — Métis : pièces jointes (moodboard) + stockage
-- ════════════════════════════════════════════════════════════════

-- Bucket public pour les références/moodboard
insert into storage.buckets (id, name, public)
values ('moodboards', 'moodboards', true)
on conflict (id) do update set public = excluded.public;

-- Politiques : les membres connectés peuvent uploader / lire / supprimer
drop policy if exists mb_insert on storage.objects;
create policy mb_insert on storage.objects for insert to authenticated with check (bucket_id = 'moodboards');
drop policy if exists mb_select on storage.objects;
create policy mb_select on storage.objects for select to authenticated using (bucket_id = 'moodboards');
drop policy if exists mb_delete on storage.objects;
create policy mb_delete on storage.objects for delete to authenticated using (bucket_id = 'moodboards');

-- Pièces jointes du brief : [{name, url}]
alter table public.briefs add column if not exists attachments jsonb default '[]'::jsonb;
