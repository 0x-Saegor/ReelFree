Phases A et B, avenants 1 à 3 et F6 (B05) faits ; npm test PASS 366/366 : en attente de nouvelles tâches.

## Livré
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
