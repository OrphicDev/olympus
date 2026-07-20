-- ════════════════════════════════════════════════════════════════
-- ÉOLE — transfert de fichiers (WeTransfer interne d'Orphic)
-- À coller UNE FOIS dans le SQL Editor du projet Supabase d'OLYMPUS.
-- Réutilise l'auth Olympus : l'équipe (rôle authenticated) envoie ;
-- le destinataire télécharge via une URL signée (aucun compte requis).
-- ════════════════════════════════════════════════════════════════

-- Métadonnées des transferts
create table if not exists public.transfers (
  id             uuid primary key,
  title          text,
  note           text,
  files          jsonb,               -- [{name, size}]
  object_path    text not null,       -- chemin du .zip dans le bucket
  size_total     bigint,
  signed_url     text,                -- lien de téléchargement (valable 1 mois)
  created_by     text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  download_count int not null default 0
);
alter table public.transfers enable row level security;
create index if not exists transfers_expires_idx on public.transfers (expires_at);

-- L'équipe connectée gère les transferts ; rien de public.
drop policy if exists "eole team" on public.transfers;
create policy "eole team" on public.transfers
  for all to authenticated using (true) with check (true);

-- Bucket de stockage PRIVÉ (le téléchargement passe par une URL signée)
insert into storage.buckets (id, name, public)
values ('transfers', 'transfers', false)
on conflict (id) do nothing;

-- L'équipe connectée peut déposer / lire / supprimer dans ce bucket
drop policy if exists "eole upload" on storage.objects;
create policy "eole upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'transfers');
drop policy if exists "eole read" on storage.objects;
create policy "eole read" on storage.objects
  for select to authenticated using (bucket_id = 'transfers');
drop policy if exists "eole delete" on storage.objects;
create policy "eole delete" on storage.objects
  for delete to authenticated using (bucket_id = 'transfers');
