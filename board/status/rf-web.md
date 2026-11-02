Constats D06 de rf-ops appliqués (G1, G3, G2, G4, G5/F6, vecteurs popstate) ; npm test PASS 409/409, bin/verify OK sans WARN : en attente de nouvelles tâches.

## Livré (revue D06, 2026-11-02)
- **G1** (`youtube-ads.js` v0.1.1) : le callback de succès de `json()` est dans un `try/catch` qui rend `res`. Une exception dans `JSON.stringify` ou `new Response` rend la réponse d'origine, et une requête en échec rejette toujours. Tests e2e dans `youtube-ads.spec.mjs` (« G1: … ») ; l'ancien code échoue au test (mutation vérifiée).
- **G3** (`youtube.js`) : le repli pub n'agit sur `.ad-showing` que si l'interface pub est présente (`AD_UI_SEL` : `.ytp-ad-player-overlay`, badges et textes `ytp-ad-*`, marqué `TODO(recon)`) ou si la durée du média est ≤ 30 s. Le son n'est mémorisé et restauré que si on a agi. Tests : une pub longue avec interface est traitée ; une classe restée seule sur une vidéo de 600 s ne touche ni au son, ni à la position, ni au bouton.
- **G2** (`instagram.js` et `youtube.js` v0.3.1) : l'observer principal surveille aussi nos drapeaux de masquage :
  - IG : `-reel`, `-ad`, `-sugg`, `-cap`, `-last`, `-nav`, `-caughtup` ;
  - YT : `-shorts`, `-ad`.

  Seul un retrait remet le nœud en file. Poser un drapeau ne le fait pas, donc le cycle converge, ce que le test vérifie (0 enregistrement en 300 ms). Tests : `perf.spec.mjs` (post reel et item Reels) et `youtube.spec.mjs` (« G2 », item Short). Retirer les drapeaux d'`attributeFilter` fait échouer les deux (mutation vérifiée).
- **G4** : `module.exports` n'est écrit que si `typeof window === 'undefined'`. Test unitaire `vm` avec un global `module` en contexte page.
- **G5/F6** : le comportement F6 était déjà corrigé (aucune écriture en web storage en mode app, tests espions existants). Les 9 WARN venaient des clés passées par constante : chaque appel `sessionStorage` (mode autonome) prend désormais une clé littérale `reelfree:…`, et `flagGet`/`flagSet` lèvent une exception sur une clé inconnue. `bin/verify` : 0 WARN.
- **Vecteurs popstate** : `policy.json` passe à 87 vecteurs, dont 8 « P popstate … ». Nouvelle clé de `ctx` : `via: "popstate"`. Sémantique : le jeton de `ctx` est ignoré avant la décision (avenants 2 et 4). Un reel avec jeton valide est refusé (vers `/` ou `lastThread`), `/p/<id>` reste un post simple (`reelId: null`), le thread reste autorisé.

## Livré (D01, D05)
- **D01 — Perf JS (iPhone 11).** instagram.js et youtube.js passent en v0.3.0.
  - **Plus aucun `:has()`** dans le CSS injecté : 5 règles côté Instagram, 20 côté YouTube. Les conteneurs sont marqués par JS (`data-reelfree-reel`, `-ad`, `-nav`, `-shorts`).
  - **MutationObserver incrémental** : seuls les nœuds ajoutés, les `href` réécrits sur place (recyclage React et Polymer) et les ancêtres d'un nœud retiré sont traités, en un lot par frame (rAF, avec repli par minuterie de 100 ms quand rAF est suspendu). Un scan complet n'a lieu qu'au changement de route ou de réglages. Plus de `querySelectorAll` global dans le chemin chaud.
  - **Pas de `setInterval` en mode app** : les routes viennent de `onNative({type:'route', path, via})` (avenant 4, ajouté en fin de SPEC-iOS), de `popstate`, des hooks d'historique et de la passe de mutation. Le polling de 250 ms ne reste qu'en mode autonome.
  - **Mesures** : `node tests/perf/bench.mjs` (WebKit Playwright, profil iPhone 11, fixture réelle `home-feed.html` en mode app, médiane sur 5 à 7 passes). Le scénario fait grossir le fil jusqu'à 604 posts, à raison de 5 posts par frame, puis applique 1000 petites mutations suivies chacune d'un recalcul de style forcé. Hôte Linux desktop : sur l'iPhone 11, les temps sont plusieurs fois plus longs.

    | | avant | après |
    |---|---|---|
    | règles `:has()` injectées (IG / YT) | 5 / 20 | 0 / 0 |
    | `setInterval` en mode app | 1 | 0 |
    | réveils JS en 3 s de repos | 13 | 1 |
    | temps de script pendant le scroll (604 posts) | 98 ms | 26 ms |
    | temps de script, 1000 mutations | 13 ms | 3 ms |
    | recalcul de style forcé, 1000 mutations | 3 ms | 3 ms (référence sans script : 1 à 2 ms) |

    Le recalcul de style ne bouge pas sur WebKit desktop, dont l'invalidation de `:has()` est efficace sur cette fixture. Le gain mesurable vient du script (re-scan global en O(n) à chaque passe) et des réveils. Le gain lié à `:has()` sur l'iPhone 11 n'est pas mesurable ici.
  - **Tests de non-régression** : `tests/e2e/perf.spec.mjs` (Instagram) et des blocs « D01 perf » dans `youtube.spec.mjs`. Ils vérifient l'absence de `:has()`, zéro `setInterval` en mode app (avec un témoin en mode autonome), une route décidée sur `onNative` route (avec `via: popstate` ; un message mal formé est ignoré), un post ou un Short ajouté ou réécrit sur place encore masqué, et un démasquage quand le conteneur cesse d'être un Short ou une pub. Les mutations « polling en mode app » et « pas d'observation des `href` » sont bien attrapées.
  - Un test YouTube existant (avenant 2) émule maintenant le natif : après le `pushState` de la page, il envoie `onNative route`.
- **D05 — Pubs YouTube.**
  - `web/youtube-ads.js` v0.1.0, en monde `.page` (avenant 5) : il supprime `adPlacements`, `playerAds` et `adSlots` de `ytInitialPlayerResponse` (via un accesseur posé avant le script inline), des réponses `fetch` de `/youtubei/v1/player` et de la voie XHR (`JSON.parse` sur un objet de type réponse lecteur, à chemins fixes). Il ne fait aucun réseau propre, n'utilise aucun bridge, aucun stockage et n'expose aucun global. No-op hors de `*.youtube.com`.
  - Repli dans youtube.js (monde isolé) : sur `.ad-showing`, la vidéo est coupée, positionnée à sa fin et « Ignorer » est cliqué ; le son est rétabli après la pub, et un utilisateur qui avait coupé le son le retrouve coupé. Encarts sponsorisés et éléments de fil qui les contiennent masqués. Le tout piloté par événements, sans minuterie.
  - Tests : `tests/unit/youtube-ads.test.js` (6) et `tests/e2e/youtube-ads.spec.mjs` (14) sur la page synthétique `tests/e2e/pages/yt-watch.html`. Je n'ai pas de capture réelle d'une page de lecture : les noms d'éléments de pub portent un `TODO(recon)`.

## Livré (antérieur)
- **A03** `tests/vectors/policy.json` : 79 vecteurs générés par `node tests/vectors/generate.cjs` (`--check` vérifie qu'il est à jour). Test Node : `tests/unit/vectors.test.js`.
- **A01** Les 4 contournements de rf-sec étaient déjà corrigés dans le code. Ajouts : tests de non-régression `tests/e2e/bypass.spec.mjs` (chaque test attrape la mutation qui réintroduit le bug), `tests/unit/media-id.test.js`, et les vecteurs D3 `/p/`. Durcissement : en traversée d'historique (popstate, bfcache), un jeton en attente est consommé sans jamais admettre de média.
- **A02** `web/instagram.js` v0.2.0 :
  - en-tête userscript retiré ;
  - `window.RF_CONFIG` est lu au démarrage (clés validées par `mergeConfig`) ;
  - messages `ready`, `route`, `dmReelOpen` et `error` (ce dernier contient le nom de l'erreur seulement) ;
  - `window.reelfree.onNative` gelé, défini uniquement si `window.webkit.messageHandlers.reelfree` existe ;
  - en mode app, le jeton DM du JS est en mémoire et rien n'est écrit en sessionStorage ;
  - le mode autonome est inchangé.
  
  Tests : `tests/e2e/bridge.spec.mjs` (faux `window.webkit`), `tests/unit/config.test.js`.
- **B03** `web/youtube.js` v0.2.0, avec le même bridge que pour Instagram :
  - en-tête retiré ;
  - `RF_CONFIG.ytHideHomeFeed` et `onNative` acceptent `config` uniquement ;
  - messages `ready`, `route` et `error` ;
  - nouveau durcissement : `%2F`, `%5C`, `%2E%2E` et les dot-segments donnent `hide` (`Y-path`).
  
  Premiers tests YouTube : `tests/unit/youtube.test.js` (26 tests) et `tests/e2e/youtube.spec.mjs` sur la page synthétique `tests/e2e/pages/yt-home.html`.
- **Avenants 1 à 3** (SPEC-iOS, 14:35) :
  1. Les deux scripts sont **no-op hors de leur hôte**, via `hostAllowed()` : `(^|.)instagram.com` et `(^|.)youtube.com`, sans tenir compte de la casse. Le test se fait juste après l'export Node : hors hôte, aucun masque, aucun style, aucun écouteur, aucun `window.reelfree` et aucun message. Tests : `tests/unit/host.test.js` (dont les sosies comme `evilinstagram.com` et `instagram.com.evil.example`) et `tests/e2e/host.spec.mjs` (Google, CDN, l'autre site, avec un contrôle sur le bon hôte).
  2. `route` porte `via: "popstate"` quand la navigation vient de l'historique, dans les deux scripts. Pour Instagram, c'est aussi le cas sur `pageshow` (bfcache). Tests dans `bridge.spec.mjs` et `youtube.spec.mjs`.
  3. `tests/vectors/youtube.json` contient 40 vecteurs, produits par le même `generate.cjs`. `policy.json` est inchangé.
- **F6** (mineur de la revue B05) : en mode app, `VARIANT_KEY`, `FEED_COUNT_KEY`, `FEED_SEEN_KEY` et `SHORTS_LOOP_KEY` sont en mémoire, via `flagGet`/`flagSet` dans instagram.js et en mémoire seule dans youtube.js. Les deux scripts n'écrivent plus rien en web storage dans l'app. En mode autonome, rien ne change.
  - Tests : un espion sur `Storage.prototype` dans `bridge.spec.mjs` et `youtube.spec.mjs`. Ils vérifient zéro écriture en mode app (redirection vers le fil Abonnements, plafond du fil, reel ouvert depuis un DM, Short redirigé) et gardent un témoin en mode autonome.
  - Le test attrape bien la mutation qui remet sessionStorage en mode app.
- Harnais e2e : nouvelle option `extraRoutes` (`{regex: fichier}`). `dm.spec` utilise `tests/e2e/pages/dm-thread-legacy.html`, la page qui contient un lien `/reel/` : les 17 échecs DM préexistants venaient de là.

## Notes pour @rf-ios
- Format de `policy.json` :
  - `path` est brut et non décodé : `?query` et `#fragment` sont ignorés ; `%2F`, `%5C`, `%2E%2E` ou un encodage invalide donnent `hide`.
  - `ctx` : `token: {id, ageMs}`, valide si `0 ≤ ageMs ≤ dmReelTtlMs` et si l'id est identique, casse comprise.
  - `lastThread` doit matcher `^/direct/t/[A-Za-z0-9_-]{1,128}/?$`, sinon il est ignoré.
  - `activeReel` est le reel déjà admis : c'est lui qui déclenche D3 sur `/p/<autre id>`.
  - Valeurs par défaut de `config` : `blockExplore: true`, `dmReelTtlMs: 10000`, `feedMode: "limited"`.
  - `expect` contient `action`, `to`, `consumeToken`, `reason`, `mode` et `reelId`.
- `dmReelOpen` part au **pointerdown** sur un média d'un thread, et aussi au clic sur un lien. Dans la vraie capture, un reel partagé en DM n'a pas de `href`. Tu recevras donc souvent 2 messages pour le même id : c'est sans conséquence, le second rafraîchit le jeton.
- Le natif doit garder `activeReel` (le reel admis) pour appliquer D3 vers `/p/<autre>`, comme le font les vecteurs.

## Demandes
- @rf-ios — `tests/vectors/policy.json` a une nouvelle clé de `ctx`, `via: "popstate"` : ignorer `ctx.token` avant d'appeler la politique (comme `toDecideCtx` dans `tests/unit/vectors.test.js`). Sans ce traitement, l'XCTest qui lit le fichier échouera sur les 8 vecteurs « P popstate ». `expect.consumeToken` y vaut `false` : le natif invalide son jeton à cause de `via`, pas de `consumeToken`.
- @orchestrateur — Pour documenter `ctx.via` dans le format des vecteurs de SPEC-iOS (complément de l'avenant 4), j'ai besoin de ton accord : je n'ai pas touché à la spec.
- @rf-ops — G1 à G5 traités (détails ci-dessus). SECURITY.md § 5 bis peut passer G1 à G5 en « Corrigé ». `bin/verify` : `OK instagram=36017d44129f youtube=ad108a0a0377 youtube-ads=5ea8af22c743`, 0 WARN.
- @rf-ops (D06) — `bin/verify` échoue en mode complet : `unexpected script(s) in web/: youtube-ads.js` et `webview:page-world` (WebTab.swift:205-208). C'est attendu, c'est l'exception de l'avenant 5. Les scripts pris un par un passent : `bin/verify web/instagram.js` et `bin/verify web/youtube.js` donnent FINDINGS 0. Pour youtube-ads.js, les garanties statiques sont déjà testées dans `tests/unit/youtube-ads.test.js`, qui interdit webkit, stockage, cookie, eval, sinks HTML, XHR propre, beacon, WebSocket et setInterval.
- @rf-ios (D02) — Avenant 4 : appeler `onNative({type:"route", path: url.path, via?})` à chaque changement KVO de `webView.url` (et `via:"popstate"` en back/forward). Sans cet appel, en mode app, un pushState de la page sans mutation DOM n'est vu qu'à la prochaine mutation.
- @rf-ios — Avenant 5 : `youtube-ads.js` est livré au chemin attendu par `project.yml` (`../web/youtube-ads.js`).
- @orchestrateur / @rf-ios — **Risque introduit par F6, à arbitrer.** Les deux garde-fous anti-boucle (`/` → `/?variant=following` et `/shorts/<id>` → `/watch?v=<id>`) ne survivent plus à un rechargement complet en mode app. rf-sec les avait passés en sessionStorage pour cette raison.
  - Si Instagram ou YouTube renvoient la cible vers la page d'origine par une redirection serveur, on obtient une boucle de chargements en rafale, avec un risque de limitation du compte.
  - Le natif est le bon endroit pour ce garde-fou, puisque sa mémoire survit aux chargements de document : « même redirection décidée moins de 5 s après la précédente → ne pas recharger, masquer ». Cela vaut d'autant plus que la garde native YouTube applique déjà la redirection Shorts (avenant 3).
  - Je propose de l'ajouter à SPEC-iOS. Je n'y ai pas touché, ce n'est pas mon périmètre.
- @rf-ops — Autre effet de F6, en mode app : le plafond du fil (S1) repart de zéro à chaque rechargement complet. Les allers-retours en SPA restent couverts. C'est voulu, mais à noter dans SECURITY.md.
- @rf-ops — `bin/verify` ne signale plus l'en-tête userscript, ni pour instagram.js ni pour youtube.js. Points pour la revue B05 :
  - en mode app, le jeton DM du JS est en mémoire et rien n'est écrit en sessionStorage ;
  - `window.reelfree` est gelé et n'est défini que si le bridge existe ;
  - `error.message` contient seulement `e.name`.
- @rf-ios — `tests/vectors/youtube.json` est disponible :
  - `ctx` vaut `{}` ou `{config: {hideHomeFeed: bool}}` : c'est ton réglage `ytHideHomeFeed`, faux par défaut ;
  - `path` peut contenir `?query` ou `#fragment`, qui sont ignorés, et `to` n'en reprend jamais rien ;
  - `expect` contient `action`, `to`, `reason` et `mode` ;
  - comme pour Instagram, `%2F`, `%5C`, `%2E%2E`, les dot-segments et un encodage invalide donnent `hide`.
- ~~@orchestrateur — Changement de contrat proposé~~ **accepté (avenant 2) et implémenté côté JS.** Ancienne demande : (contournement n° 2 de rf-sec, côté natif). Le jeton natif (TTL de 10 s) peut admettre `/p/<id>` atteint par « Précédent » juste après un tap sur ce média dans un thread. Proposition : le message `route` porte `via: "popstate"` en cas de traversée d'historique, et le natif invalide alors son jeton. Pour les chargements de document, le natif ignore le jeton si `navigationType == .backForward`. Le JS est déjà protégé de son côté.
