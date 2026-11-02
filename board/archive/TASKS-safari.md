# Tâches ReelFree
Légende : [ ] à faire · [~] en cours · [x] fait · [!] bloqué

## Phase 1 — Reconnaissance & fondations (parallèle)
- [!] T01 @rf-recon — Inventaire des routes Instagram web mobile (feed, /reels/, /reel/<id>, /explore/, /direct/inbox, /direct/t/<id>, profil, stories) — fait depuis les sources publiques (docs/recon.md), vérif réelle bloquée : pas de session Instagram dans Chrome
- [!] T02 @rf-recon — Sélecteurs stables : barre de nav (Reels, Explore), posts du fil, blocs suggérés, sentinelle de pagination — candidats publics documentés, à valider sur le DOM mobile réel : pas de session Instagram
- [!] T03 @rf-recon — Comportement d'un reel reçu en DM : rendu inline ? lien /reel/<id> ? swipe vers d'autres reels ? — aucune source publique, hypothèses dans docs/recon.md, demande le vrai site connecté
- [x] T04 @rf-recon — Fixtures HTML anonymisées (sans nom, sans message, sans token) dans tests/fixtures/ — synthétiques, à remplacer par des captures après T17
- [x] T05 @rf-core — Squelette du userscript : en-tête metadata, CONFIG, routeur SPA (X1), CSS fail-closed à document-start
- [x] T06 @rf-core — Politique d'URL pure et testable (fonction `decide(path, ctx)`), exportée pour les tests
- [x] T07 @rf-qa — Harnais : package.json, Playwright WebKit avec device « iPhone 11 », injection du userscript dans des pages fixtures
- [x] T08 @rf-qa — Tests unitaires de `decide()` : R2, R3, R5, D2, D3 (jeton expiré, mauvais id, double usage)
- [x] T09 @rf-sec — docs/SECURITY.md : modèle de menace (supply chain, exfiltration, ban de compte, pistage) et contrôles
- [x] T10 @rf-sec — bin/verify : SHA-256, puis grep des API interdites (fetch, XMLHttpRequest, eval, Function, innerHTML, localStorage, @require, @connect, updateURL)
- [x] T11 @rf-sec — docs/INSTALL-iOS.md : app Userscripts, dossier iCloud, activation de l'extension Safari, Temps d'écran pour bloquer l'app Instagram

## Phase 2 — Fonctionnalités
- [x] T12 @rf-core — R1–R5 : masquage et redirections
- [x] T13 @rf-core — D1–D4 : jeton DM, blocage du swipe, bouton retour
- [x] T14 @rf-core — S1–S3 : plafond du fil, posts suggérés, mode off
- [~] T15 @rf-qa — Tests E2E sur les fixtures pour chaque exigence de SPEC.md
- [x] T16 @rf-sec — Revue de sécurité de src/ (bloquante avant livraison) — clos sur sha a01a1b20aeac (toute modif ultérieure de src/ sera re-revue avant T19)

## Phase 3 — Validation réelle & bonus
- [~] T17 @rf-recon — Test manuel guidé sur le vrai instagram.com (Chrome, viewport iPhone), checklist dans docs/recon.md
- [~] T20 @rf-core — Ajuster les sélecteurs SEL et le comportement D2/D3 après les constats réels de T17 (lien inline en DM, overlay, reels servis en /p/ dans le fil)
- [x] T18 @rf-core — YouTube : src/reelfree-youtube.user.js (SPEC §6)
- [~] T19 @rf-sec — Release v0.1 : SHA-256 dans le README, instructions de transfert vers l'iPhone
