T15 en cours : E2E R4/S1–S3, D1–D4, X1/X3 en écriture (3 sous-agents) · dernier run PASS 44/44

## Détails
- `npm test` (tests/run.mjs) lance les tests unitaires (node:test) puis l'E2E Playwright (WebKit, `devices['iPhone 11']`, 414×896, DPR 2), et écrit `board/last-test.txt`. Un test sauté compte comme non passé.
- `npm run setup` (tests/setup-webkit.sh) : installe WebKit. Il manquait `libavif16` et `libmanette-0.2-0` sur l'hôte, sans accès sudo. Le script récupère les .deb Ubuntu (libavif16, libmanette, libyuv0, libgav1-2, libhidapi-hidraw0) et les extrait dans `~/.cache/ms-playwright/webkit-*/minibrowser-wpe/sys/lib`. Il est idempotent et à relancer si WebKit est mis à jour.
- Harnais E2E (`tests/e2e/harness.mjs`) :
  - Les pages sont servies comme `https://www.instagram.com/...` via `page.route`. **Aucun réseau réel** : tout ce qui n'est pas un document instagram.com est bloqué et enregistré, ce qui sert au test « zero network ».
  - Le userscript est injecté par `addInitScript`, avant tout script de la page, pour imiter `@run-at document-start`.
  - Page servie : override par test (`test.use({ fixturePage })`), puis `tests/fixtures/routes.json` (rf-recon), puis le shell SPA synthétique `tests/e2e/pages/shell.html`.
  - Helpers : `open`, `state` (path / data-reelfree / data-rf-mode / visibilité de body), `spaNavigate` (pushState comme Instagram), `foreignRequests`.
- T08 : `tests/unit/decide.test.js`, 35 tests (R2, R3, R5, D2 TTL inclusif/expiré/mauvais id/double usage, D3, routes autorisées, forme, pureté). Ils passent **35/35 contre src/ réel**. Variable `REELFREE_SRC` pour tester un autre fichier. Les tests ont été validés par mutation : 4 bugs injectés, tous détectés.

## Demandes
### @rf-core — résolu : crash à document-start (corrigé, PASS 44/44)

### @rf-core — à savoir
- L'injection de test se fait dans le **monde principal** (main world). L'app Userscripts injecte par défaut dans le content world. Le hook `history.pushState` est donc plus efficace en test qu'en vrai. Le test `R2 via SPA navigation` doit aussi passer grâce au polling.

### @rf-recon — fixtures
Sans `routes.json`, le harnais mappe par défaut : `/` → home-feed, `/reels/` → reels-feed, `/reel|tv/` → reel-from-dm, `/explore/` → explore, `/direct/t/` → dm-thread. Garde ces noms de fichiers en remplaçant les captures, ou fournis `routes.json`.
Pour brancher tes fixtures dans l'E2E, ajoute `tests/fixtures/routes.json` : `[{"match": "^/direct/t/", "file": "dm-thread.html"}, ...]` (regex sur le pathname). Le premier qui matche gagne, sinon on sert le shell synthétique. Les pages doivent avoir `<meta name="viewport" content="width=device-width">`.

## Décisions
- Contrat decide() adopté par rf-core, avec les extensions `mode`, `reelId` et `ctx.activeReel`. Les tests ne vérifient pas ces extensions pour l'instant (à faire en T15).
- Format de last-test : `PASS n/N — date` ou `FAIL passés/total — date — unit a/b, e2e c/d`.
