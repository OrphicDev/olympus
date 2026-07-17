# Olympus — Architecture

Hub desktop (Electron/macOS) des outils internes d'Orphic Agency, façon Creative Cloud.
Ce document permet à quelqu'un de **reprendre le projet** sans contexte.

## Vue d'ensemble

```
Olympus.app (Electron)
├── Alexandrie   → bibliothèque : télécharge/installe les apps (Pegasus, Zevs)
├── Espace de travail
│   └── Hermès   → chat d'équipe temps réel (sondage)
│   └── Chronos  → calendrier / gestion de projet   [à venir]
│   └── Atlas    → drive (Google Drive)              [à venir]
├── Titan        → espace dev (super admin) : clone tous les repos + dépendances
└── Réglages     → gestion des membres (super admin)
```

Connexion **email + mot de passe**. Deux rôles : `classic` et `super_admin`.
Pas d'auto-inscription : un super admin crée les membres (mot de passe temporaire → reset forcé à la 1ʳᵉ connexion).

## Projets Supabase (1 par app — clés propres)

| Projet | Ref | Org | Contenu | Utilisé par |
|---|---|---|---|---|
| **Pegasus** | `wpmewwpnixfhhkflfpjg` (eu-west-3) | ycpnvohrleptxcoutlzh (Pro) | registre des sites clients : tables `sites`, `team_config`, `access_codes` + fonction `get_team_key` | plugin/MCP Pegasus, install Pegasus dans Olympus |
| **Olympus** | `ntpudyibkwluulbbokrd` (eu-west-3) | ycpnvohrleptxcoutlzh (Pro) | Auth (membres/rôles), `messages` (Hermès), Chronos/Atlas à venir + Edge Function `admin` | l'app Olympus |

> Note : il reste 2 utilisateurs auth dans le projet **Pegasus** (créés par erreur avant la séparation). Sans effet (Pegasus n'utilise pas l'auth) ; supprimables dans Dashboard → Auth → Users si on veut être 100 % propre.

## Auth & membres (projet Olympus)

- Connexion : `POST /auth/v1/token?grant_type=password` (clé anon publique).
- Nom/Prénom/`role`/`must_reset_password` stockés dans `user_metadata` (aucune table).
- **Gestion des membres via l'Edge Function `admin`** (`/functions/v1/admin`) :
  - la **clé service reste côté serveur** (env Supabase `SUPABASE_SERVICE_ROLE_KEY`), jamais dans l'app.
  - actions : `needsBootstrap`, `bootstrap` (1er super admin, si aucun n'existe), `list`, `create`, `delete`, `setRole`, `resetPassword`.
  - le rôle super_admin est **vérifié côté serveur** via le JWT de l'appelant.
  - code : `supabase/functions/admin/index.ts`.

## Base de données — migrations versionnées

- Schéma sous forme de migrations SQL dans **`supabase/migrations/`** (source de vérité, rejouable).
- Application : `node scripts/apply-migrations.mjs` (utilise l'access token Management + le ref Olympus).
- Migrations idempotentes (`create ... if not exists`, `drop policy if exists`).

## Où vivent les secrets (jamais commités — voir `.gitignore`)

| Fichier | Contenu |
|---|---|
| `config/supabase-admin.json` | access token Management Supabase + ref/db_pass/service_key du projet Olympus |
| `config/olympus.config.json` | URL + clé anon Olympus (public, mais gardé local par simplicité) |
| `~/.pegasus/team-key` | clé d'équipe Pegasus (service key + clé privée) — pour l'install Pegasus |

**Public / embarqué dans l'app** (`app-config.json`, commité) : URLs + clés **anon** (publiques) de Pegasus et Olympus + URL de l'Edge Function. Aucun secret.

## Déploiement

- **App** : `electron-builder --mac dmg --arm64` puis `--x64` (le build multi-arch en une passe échoue sur le blockmap). Non signée → 1er lancement clic-droit → Ouvrir. Publiée en Release GitHub sur `OrphicDev/olympus`.
- **Edge Function** : déployée via l'API Management (`POST /v1/projects/{ref}/functions/deploy?slug=admin`, multipart metadata+file) — voir l'historique. Peut aussi se déployer via `supabase functions deploy admin --project-ref ntpudyibkwluulbbokrd --no-verify-jwt`.

## Reprendre le projet (checklist)

1. Récupérer les fichiers de secrets ci-dessus (hors dépôt).
2. `cd desktop app` → `npm install` → `npm start` pour lancer en dev.
3. Migrations : `node scripts/apply-migrations.mjs`.
4. 1ʳᵉ install : l'app propose « Première installation » pour créer le 1er super admin.
