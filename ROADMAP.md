# Olympus — Structure des apps (vision complète)

Hub desktop d'Orphic. Thème mythologie grecque. Monochrome + minimal (réf. IMG_1804).
Statuts : ✅ fait · 🟡 amorcé/à finir · ⬜ à construire.

## 📚 Alexandrie — la bibliothèque ✅
Le « store » : télécharge/installe les apps (Pegasus, Zevs). Onglets grisés tant que non installés.

## 🗂️ Espace de travail (collaboration)
| App | Rôle | Statut | Ce qu'il reste |
|---|---|---|---|
| 🪽 **Hermès** | Chat d'équipe temps réel | ✅ | Fichiers/réactions (plus tard) |
| 📅 **Chronos** | Calendrier + tâches partagés | ✅ | Sync Apple/Google Cal (plus tard) |
| ✉️ **Iris** | Email + CRM (envoi, suivi d'ouverture, contacts) | 🟡 | Connecter Gmail ; réception IMAP (phase 2) |
| 👁️ **Argos** | Analytics clients : campagnes + réseaux sociaux | ⬜ | Connecter les sources (Meta, Google Ads, IG, LinkedIn, TikTok…) |
| 🗂️ **Atlas** | Google Drive (parcourir / uploader / télécharger) | ⬜ | OAuth Google (projet Google Cloud) |
| 🖼️ **Apollon** | Galerie des shoots photo & vidéo (par client/projet) | ⬜ | Stockage médias (Supabase Storage ou Atlas), upload, vignettes |
| 📋 **Métis** | Briefs de shooting (objectifs, moodboard, logistique, shotlist) | ⬜ | Table briefs + éditeur, lien client/date Chronos |

## 🛠️ Mes applications (outils installables)
| App | Rôle | Statut |
|---|---|---|
| 🛠️ **Titan** | Espace dev (super admin) : clone tous les repos + accès git/Supabase | ✅ |
| 🦄 **Pegasus** | Gérer les WordPress clients depuis Claude Code + **clients connectés** (liste depuis le registre) 🟡 ; **historique/retour arrière** des sites ⬜ (à ajouter côté plugin WP) | ✅/🟡 |
| 📸 **Zevs** | Tri/sélection photo (Orphic PhotoFlow) | ✅ |

## 🧩 Transverse
- **Auth** : email/mot de passe, rôles classic/super_admin, membres gérés par super admin (Edge Function). ✅
- **Colonne droite** : Projet en cours (à définir), Aujourd'hui + À venir (Chronos), Équipe (présence vert/rouge). ✅
- **Boutons flottants** (thème, déconnexion) ✅
- **Design** : monochrome strict, boutons = texte lumineux animé, pas de cartes, sélection pleine largeur, **animations riches** (entrées, survols, stagger). Seule couleur = présence (vert/rouge). ✅
- **Contrôle par Claude Code** : serveur MCP one-clic (Réglages) → Claude pilote Olympus (chat, calendrier, CRM, membres) via la session. ✅

## Dépendances externes à préparer (par Sacha)
- **Iris** : mot de passe d'application Gmail (facile, 5 min). *Pas d'OAuth.*
- **Atlas** : projet Google Cloud + OAuth (Drive).
- **Argos** : accès aux plateformes clients (Meta/Google Ads business, tokens réseaux sociaux…) — le plus gros chantier d'intégrations.

## Prochaines étapes (demain)
1. Brancher Gmail → tester Iris (CRM).
2. Préparer l'OAuth Google → activer Atlas.
3. Définir les sources Argos (quels réseaux/plateformes en priorité) → intégrer une à une.
4. Commit + recompiler `Olympus.dmg`.
