# Motion Olympus — audit & système

Passe complète du 19/07/2026, menée selon le skill `orphic-web-design`
(protocole `references/critique.md` : **les faits d'abord, le jugement
ensuite**, critique écrite — pas de correction silencieuse).

## 1. Faits mesurés (avant la passe)

| Fait | Mesure | Verdict |
|---|---|---|
| `prefers-reduced-motion` | **absent** du code (0 occurrence) | **FAIL — interdit #3** |
| Keyframes | 15 définies, ~28 usages | OK |
| Transitions CSS | 71 déclarations | OK |
| Durées distinctes | 14 (.16s → .55s), sans logique commune | FAIL — pas de tokens |
| Easings distincts | 5, mélangés au hasard | FAIL — pas de signature |
| Propriétés animées | transform/opacity en très grande majorité | PASS — budget perf tenu |
| Animations infinies | 8 (pulses d'état, spinner, glow boutons) | PASS — toutes portent un état |

## 2. Critique (grilles du skill)

**Grille 1 — intentions.** Les entrées de page, micro-interactions et pulses
d'état avaient une intention nommable. **Mais** : les listes de la plupart
des apps (Hermès, Iris, Argos, Atlas, Apollon, Pegasus, bibliothèque)
apparaissaient d'un bloc, sans mouvement — zones mortes (interdit #1,
leçon Trionn « aucune zone morte »). L'écran de connexion était statique.

**Grille 2 — signature.** Le vocabulaire existait (fadeUp, faders, glow)
mais sans grammaire : durées et easings incohérents, aucune idée de motion
propre à Olympus au-delà du fader.

**Grille 4 — user-friendly.** Aucun respect de `prefers-reduced-motion` :
violation franche de l'interdit #3.

## 3. Corrections appliquées

### Tokens (la grammaire)
```
--m-fast .16s   micro-interactions (réponse sous la main)
--m-base .32s   transitions de contenu
--m-slow .5s    entrées de page
--m-ease   cubic-bezier(.2,.8,.2,1)  glissé signature
--m-spring cubic-bezier(.2,.7,.3,1)  micro-rebond discret
```

### L'idée signature : « la structure émerge, puis les points s'allument »
À l'arrivée sur une app (`.page.arrive`, posée 700 ms par `mArrive()`),
les listes émergent en cascade à travers le fader (`fadeUp` étagé, 40 ms
par rang, plafonné au 7ᵉ), **puis** les points d'état (`pg-dot`, `ldot`,
`gdot`, `status-dot`) s'allument avec `dotBloom` (+280 ms). C'est cohérent
avec la doctrine Olympus : monochrome, la couleur n'existe que dans les
points — donc le motion les fait naître en dernier. La cascade ne rejoue
pas sur les rafraîchissements de données (la classe retombe).

### La donnée se compte (`mCountUp`)
Les KPIs entiers se comptent en ~560 ms à l'arrivée (Accueil Iris, Argos,
Pages d'un site Pegasus — une seule fois par site). Jamais sur les
versions (« 7.0.2 ») ni les tirets — filtre `^\d{1,6}$`.

### Version calme (interdit #3 réglé)
- CSS : `@media (prefers-reduced-motion: reduce)` neutralise toute
  animation/transition (durées ~0), y compris les carrousels.
- JS : `M_REDUCED` coupe l'inertie de la roue Chronos (`kickSpin`),
  le `scrollIntoView` doux, la cascade `mArrive` et les compteurs.

### Divers
- Écran de connexion : entrée `fadeUp` (zone morte comblée).
- Cascade appliquée aussi au changement de facette de la bibliothèque
  (`mArrive(#pgRefs)`).
- Micro-interactions et entrées permanentes réécrites sur les tokens.

## 4. Zones protégées (non touchées, DA validée)
- La **roue Chronos** (spin à l'élan, drag pixel-perfect des vues
  semaine/jour) — validée par Sacha, seulement gatée en version calme.
- Les **boutons texte lumineux** (`textGlow`) — signature validée.
- Les **carrousels** (colonne droite, colonne Pegasus) — glissé existant.
- Faders/masques et lignes fantômes — la matière de base d'Olympus.

## 5. Limites connues (assumées)
- Si une liste se re-rend dans les 700 ms de l'arrivée (ex. ping santé
  Pegasus très rapide), sa cascade peut rejouer une fois — accepté, lu
  comme « la donnée se pose ».
- `cal-cell` (Chronos) rejoue son fadeIn à chaque re-rendu du mois
  (préexistant, discret, conservé).

## 6. Règle pour toute nouvelle animation
1. Nomme l'intention : **révéler / guider / matérialiser**. Sinon, ne
   l'ajoute pas.
2. Utilise les tokens (`--m-*`) — pas de durée ni d'easing inventés.
3. `transform`/`opacity` seulement (budget perf).
4. Si elle boucle à l'infini, elle doit porter un **état** (live, attente,
   enregistrement).
5. Elle doit disparaître proprement sous `prefers-reduced-motion`
   (le bloc global s'en charge pour le CSS ; gate `M_REDUCED` en JS).
