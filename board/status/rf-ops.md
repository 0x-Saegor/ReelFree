B05 terminé : revue de sécurité finale sans constat majeur, le 1er TestFlight (C03) n'est pas bloqué. Toutes mes tâches A et B sont faites, je m'arrête.

## Fait
- `.github/workflows/ci.yml` :
  - job ubuntu : `npm ci --ignore-scripts`, Playwright WebKit, `npm test`, `bin/verify --selftest`, `bin/verify` ;
  - job macos-15 : xcodegen, build-for-testing puis test-without-building sur un simulateur iPhone choisi dynamiquement, sans signature.
  - Le workflow est aussi appelable (`workflow_call`).
- `.github/workflows/testflight.yml` :
  - déclencheurs : dispatch, tags `v*`, cron le 1er de chaque mois ;
  - rejoue `ci.yml`, archive en signature automatique avec la clé API (`-allowProvisioningUpdates -authenticationKey*`), puis export avec `method=app-store-connect` et `destination=upload` ;
  - build = `run_number`, version = tag ;
  - environnement GitHub `testflight` ;
  - logs filtrés (le dépôt est public, rien n'expose l'identité de signature) et clé effacée en fin de job.
- `docs/TESTFLIGHT.md` : guide pour l'ami (App ID, fiche ASC, clé API Admin, environnement et secrets GitHub, testeur interne, dépannage, révocation).
- `bin/verify` réécrit :
  - JS dans `web/`, Swift et config dans `ios/`, secrets dans tout le dépôt ;
  - self-test 98/98 ;
  - état actuel : `OK instagram=… youtube=… swift=6`.
  - L'ancien `bin/verify` est archivé dans `archive/safari-userscript/verify-userscript`.
- `docs/SECURITY.md` réécrit pour l'app : modèle de menace T1–T8, règles de `bin/verify`, revue préliminaire § 5. L'ancien est archivé dans `archive/safari-userscript/`.
- `README.md` réécrit. L'ancien est archivé dans `archive/safari-userscript/README-userscript.md`.
- Prénom réel retiré de `docs/` et des copies archivées que j'ai créées.

## Points à confirmer au premier vrai run (C02/C03)
- Flags xcodebuild : la recherche ne les a confirmés que par des posts de forums Apple. Le workflow échoue tôt si `xcodebuild -help` ne connaît pas `-authenticationKeyIssuerID`.
- La clé API doit avoir le rôle **Admin** (signature dans le cloud).
- Run CI 41452516056 (commit 9fcf586) : vert. Actions passées à checkout@v5, setup-node@v5 et upload-artifact@v6 (la v5 de upload-artifact tourne encore en Node 20). À confirmer au prochain push.
- B05 : `bin/verify` suit l'avenant 1. L'allowlist WKAppBoundDomains est exactement : instagram.com, cdninstagram.com, fbcdn.net, youtube.com, ytimg.com, googlevideo.com, google.com, gstatic.com. Self-test 98/98, `bin/verify` OK (swift=10).
- B05 : revue finale faite par 2 sous-agents sonnet (natif, JS et workflows). Aucun constat MAJEUR. Détails dans `docs/SECURITY.md` § 5 (F1–F10).
- Corrigé dans mon périmètre :
  - F9 : `ci.yml` masquait un échec de `build-for-testing` ;
  - F10 : `testflight.yml` filtre maintenant les logs publics par liste blanche, avec masquage des noms.

## Demandes
Constats MINEURS de la revue finale B05, notés et non bloquants. Aucun constat MAJEUR.
- @rf-ios — F1 (`WebTab.swift`, `evaluateCurrentURL`) : une URL nulle ne masque pas la vue. Masquer, sauf pour le `about:blank` initial.
- @rf-ios — F4 (`Site.swift`), optionnel : les sous-frames Google peuvent charger n'importe quel chemin de google.com. Les limiter à `accounts.google.com`, `consent.google.com` et `www.google.com/recaptcha`.
- @rf-ios — F5 (`ios/ReelFreeTests`) : ajouter environ 6 XCTests sur `Site.host(isIn:)` (frontière de label, point final, `evilinstagram.com`) et sur `isAuxiliaryURL`, pour figer l'avenant 1.
- @rf-web — F6 : en mode app (bridge présent), garder `VARIANT_KEY`, `FEED_COUNT_KEY`, `FEED_SEEN_KEY` (instagram.js) et `SHORTS_LOOP_KEY` (youtube.js) en mémoire plutôt qu'en `sessionStorage`, qui est lisible par la page.
- @orchestrateur — Risques acceptés, à valider :
  - F2 : jeton DM encore valide pendant la fenêtre KVO avant le message `popstate` ;
  - F3 : un `a.click()` scripté compte comme `.linkActivated`, et les liens universels peuvent ouvrir l'app Instagram (bloquée par Temps d'écran) ;
  - F7 : pas de relecteur obligatoire sur l'environnement `testflight`, sinon le cron serait bloqué ;
  - F8 : actions épinglées par version majeure, pas par SHA.
- @orchestrateur — Rappels :
  - les modifications de `ci.yml` et `testflight.yml` (F9, F10) ne seront vérifiées qu'au prochain push ;
  - C01 : environnement `testflight` et ses 5 secrets ;
  - prénom réel ou email encore présents dans `CLAUDE.md`, `bin/launch`, `board/TASKS.md`, `board/archive/*` et `archive/safari-userscript/INSTALL-iOS.md` (dépôt public).
