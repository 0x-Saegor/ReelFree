T16 : 4 contournements majeurs + mineurs rf-sec corrigés (IG a01a1b20aeac, YT ce30c1a74f48) ; reprise de T20 (DM) dès les captures DM

## Détails
- `src/reelfree.user.js` : metadata (`@grant none`, `@noframes`, `@run-at document-start`, aucun @require/@connect/@updateURL), `CONFIG`, `decide()` pure, routeur SPA (hook pushState/replaceState, popstate, polling 250 ms, un seul MutationObserver débouncé en rAF), CSS fail-closed.
- Fail-closed : `html[data-reelfree="mask"]` est posé de manière synchrone au démarrage et masque `body`. Il ne passe à `ok` qu'après une décision `allow`. Une exception dans decide() donne `hide`.
- Mode de page exposé à la CSS via `html[data-rf-mode]` : `feed`, `feed-off`, `dm`, `dm-reel`, `search`, `explore`, `other`, `blocked`.
- Le jeton D2 est stocké dans `sessionStorage['reelfree:dm-allow']` au format `"<reelId>:<tsMs>"`. Un format invalide est purgé. Le jeton est posé en T13 (clic dans /direct/).
- Sélecteurs : seul `a[href="/reels/"]` est en place. Le reste est en TODO, en attente de docs/recon.md (T02).

## Décisions
- **Contrat decide() de rf-qa : adopté tel quel** (action/to/consumeToken/reason, ctx now/token/lastThread/config, export `module.exports = { decide, CONFIG }` + `TOKEN_KEY`, bootstrap gardé par `typeof document`).
- Extensions compatibles :
  - Le retour contient en plus `mode` et `reelId`.
  - `ctx.activeReel` (optionnel) : un reel déjà admis sur la page reste `allow` quand on réévalue la même URL (polling, replaceState) sans jeton. Sans ce champ, le test « double usage » donne bien `redirect`.
  - `/explore/search/` donne `allow` (reason `R5-search`, mode `search`), pour que la recherche de comptes reste utilisable (R5). La grille Explore y sera masquée en CSS. Les autres `/explore/...` donnent `redirect /`.
  - `/<user>/reels/` (onglet reels du profil) donne `redirect /<user>/` (reason `R2-profile`). `/<user>/reel/<id>/` suit la même règle que `/reel/<id>/`.
  - `action: 'hide'` sert aux chemins non décodables (`X3-decode`), non-string (`X3-invalid`) ou à une exception (`X3-error`).
- Casse : les mots-clés de route (`reels`, `explore`…) sont comparés en minuscules. **L'id du reel garde sa casse**, car les shortcodes Instagram y sont sensibles : `token.id` doit être identique.
- Jeton : TTL inclusif (`0 <= now - ts <= dmReelTtlMs`). Un `ts` dans le futur est refusé. Tout jeton vu sur une route reel est consommé, qu'il soit valide ou non.
- `lastThread` doit matcher `^/direct/t/<id>/?$`, sinon on redirige vers `/` (pas d'open redirect). Il n'est gardé qu'en mémoire : après un rechargement complet, le fallback est `/`.
- La CSS n'utilise aucune classe obfusquée (X2).

## Revue indépendante (sous-agent), corrections appliquées
- Open redirect via `/%5Cevil.com/reels/` (`\` vaut `/` pour le navigateur) : la cible de R2-profile n'est construite que si le segment est un nom d'utilisateur valide (`^[A-Za-z0-9._]{1,30}$`), et le bootstrap vérifie `new URL(to).origin === location.origin` avant tout `location.replace`.
- Segments à paramètres (`/reels;x/`) : on supprime ce qui suit `;`. `/tv/<id>` est traité comme `/reel/<id>`.
- `/explore/search/<…>` (grilles de résultats) donne maintenant `redirect /`. Seul `/explore/search/` nu reste `allow`. Une règle CSS provisoire, fail-closed, masque les tuiles `/p/` et `/reel` en mode `search`.
- Le masque passe en `display:none` sur `body`. Un MutationObserver dédié rétablit `data-reelfree`/`data-rf-mode` si la page les retire. Les `<video>` sont coupées et mises en pause tant que le masque est actif.
- `onRouteAllowed()` s'exécute **avant** le démasquage. Une exception à ce stade laisse le masque en place.
- **Non résolu (pour T12)** : un reel peut être servi sous `/p/<code>/`, que l'URL seule ne distingue pas d'un post. Il faudra une détection DOM (lecteur reel), en fail-closed.
- Connu : après un rechargement d'un reel admis, on revient sur `/` et non sur la conversation, parce que `lastThread` n'est gardé qu'en mémoire.

## T12–T14 (sélecteurs de docs/recon.md, sources publiques, ⛔ à valider en T17)
- Tous les sélecteurs sont regroupés dans l'objet `SEL` en tête de la partie navigateur.
- **R1** : `a[href="/reels/"]` et son conteneur `div[role="menuitem"]`/`li` (via `:has`, Safari ≥ 15.4) sont masqués partout.
- **R4** : hors des modes `dm`/`dm-reel`, tout lien `/reel/` ou `/reels/` est masqué, ainsi que le `main article` qui le contient.
- **R3 via `/p/`** : `decide()` traite `/p/<id>` et `/<user>/p/<id>`. Sans jeton, c'est `allow` en mode `post`, et la CSS y masque `video` et `[aria-label="Video player"]`. Avec un jeton valide, c'est le mode `dm-reel`. Contrat rf-qa respecté : `/p/ABC/` sans jeton donne `allow`, `consumeToken:false`.
- **R5** : un clic sur `a[href="/explore/"]` mène à `/explore/search/`. Les tuiles `/p/` et `/reel` y sont masquées.
- **Interception des clics** (capture sur `window`) : toute navigation que `decide()` refuse est annulée avant la transition SPA, donc sans flash.
- **D2** : dans `/direct/`, un clic sur un lien de média (`mediaIdFromPath`, exporté) pose `reelfree:dm-allow = "<id>:<ts>"`.
- **D3** : en mode `dm-reel`, `wheel`, `touchmove`, `pointermove` tactile et les touches de défilement sont bloqués (sauf dans les champs de saisie). Une CSS dynamique masque les liens reel/post qui ne correspondent pas au reel admis. Un clic vers un autre reel est annulé.
- **D4** : bouton `#reelfree-back` (créé avec `createElement`) qui ramène à `lastThread`, ou à `/direct/inbox/` à défaut.
- **S1** : plafond à `feedLimit` posts « comptés » (hors reels et suggestions). Au-delà, l'attribut `data-reelfree-cap` les masque. `data-rf-capped` sur `<html>` masque le loader `[data-visualcompletion="loading-state"][role="progressbar"]`. Le dernier post affiche « Tu es à jour ✓ » en `::after`, sans insertion DOM dans l'arbre React.
- **S2** : on masque tout ce qui suit le marqueur `img[src*="illo-confirm-refresh"]`, ainsi que les posts dont le header contient un bouton « Suivre »/« Follow » ou un libellé exact « Suggestions pour vous »/« Suggested for you »… (comparaison stricte, rien n'est stocké).
- **S3** : `feedMode:'off'` masque articles, loader et marqueur, et affiche « Fil masqué par ReelFree ».

## 2e revue (sous-agents) + E2E, corrections appliquées
- **Bug bloquant corrigé** : en WebKit, `document.documentElement` est `null` à document-start, et le script plantait avant de poser le masque. Le démarrage attend maintenant `<html>` via un MutationObserver sur `document`.
- E2E (sous-agent, WebKit iPhone 11, fixtures servies comme www.instagram.com, script : `/tmp/claude-1000/-home-arlegall-reelfree/9e341d31-2bf5-47a8-835c-409c6242628e/scratchpad/e2e/verify.cjs`) : **22/22**. Couvre R1–R5, S1, S2, D1–D4, zéro réseau, zéro pageerror. @rf-qa, à reprendre dans tes E2E si utile.
- **D2, secours** : si l'élément tapé dans un fil n'est pas un `<a>` (handler React), un tap dans `/direct/t/…` suivi, dans le TTL, d'une navigation directe vers une route média admet ce média une fois. Ce secours est **en mémoire uniquement** (rien de plus dans sessionStorage).
- **D3, overlay** : si un `[role="dialog"]` contenant une `video` s'ouvre sur un fil sans changement d'URL, le swipe vertical et les clics vers un autre média dans le dialog sont bloqués.
- **D3, finesse** : seuls les mouvements verticaux sont bloqués (wheel et touchmove comparent dy à dx). Plus de `pointermove`, donc carrousels et scrubber vidéo restent utilisables. La CSS dynamique exempte aussi `/<id>?…` et `/<id>`.
- **S1** : chaque post reçoit un numéro de séquence une seule fois. Le plafond tient même si Instagram démonte les posts anciens. Une fois le plafond atteint, tous les frères qui suivent le dernier post sont masqués, sentinelle comprise.
- **X4** : MutationObserver limité à un passage toutes les 150 ms (setTimeout). La règle `div:has(> img) ~ *` est remplacée par un drapeau `data-reelfree-caughtup` posé en JS.
- `bin/verify` : le mot « innerHTML » d'un commentaire déclenchait un faux positif. Le commentaire est reformulé. Résultat : OK, 0 finding.
- **Non traité, à confirmer en T17** : un reel du fil qui pointe vers `/p/<id>` (et non `/reel/`) n'est pas reconnu par R4. Même chose pour les carrousels « Reels suggérés » hors `article`. La tâche T20 est ajoutée pour ces ajustements.

## T16 — contournements rf-sec corrigés (IG sha a01a1b20aeac, YT sha ce30c1a74f48)
1. **D3 via `/p/`** : `decidePost` refuse tout média dont l'id diffère de `activeReel` (`redirect lastThread`, reason D3, jeton consommé s'il existe). `pauseMedia()` est appelé en mode `post`.
2. **D2 par l'historique** : le repli par tap est lié à l'id du lien tapé (`a` englobant ou contenu), ignoré depuis un dialog, ignoré quand l'arrivée vient de `popstate` (`state.viaPopstate`) ou d'un `pageshow` restauré du bfcache.
3. **S1 remis à zéro** : plus aucune remise à zéro. Les compteurs sont dans `sessionStorage['reelfree:feed-count']` et `['reelfree:feed-seen']` (nombres seuls). Les shortcodes restent en mémoire. Conséquence assumée : une fois le plafond atteint, le fil reste vide jusqu'à la fermeture de l'onglet. Le message « Tu es à jour ✓ » est désormais en `main::after` pour s'afficher même quand aucun post n'est visible.
4. **Overlay photo** : `dmOverlay` vaut pour n'importe quel `[role="dialog"]` en mode `dm`. Aucun jeton n'est posé pour un clic dans un dialog (clic annulé).
5–8 (mineurs) : `/<user>/tv/<id>` suit la règle reel, `/<user>/reel/` donne R2-profile. `%2F`/`%5C`/`%2E%2E` bruts ou les segments `.`/`..`/`\` donnent `hide('X3-path')`, y compris dans `mediaIdFromPath`. Un jeton expiré est purgé à la lecture. `pageshow` (bfcache) entraîne une réévaluation sans reel admis.
YouTube : garde-fou anti-boucle lié à l'id (5 s, mémoire + `reelfree:yt-shorts-at = "<id>:<ts>"`), avec le message « Short non lisible hors du lecteur Shorts ». `LEGACY_NAME_RE` exige un alphanumérique.
Vérifié :
- Node : 14/14 reproductions.
- WebKit : `/tmp/claude-1000/-home-arlegall-reelfree/9e341d31-2bf5-47a8-835c-409c6242628e/scratchpad/e2e/t16.cjs` **9/9** (points 2, 3 et 4), captures réelles `real.cjs` **21/21**, boucle YouTube `…/scratchpad/yt/loop.cjs` PASS.
- Unitaires rf-qa 35/35. bin/verify OK.

## Demandes rf-sec traitées (sha 1c898ae71b63)
- Chaque sélecteur `:has()` a maintenant **sa propre règle** : `a[href="/reels/"]`, `a[href*="/reel/"]` et `a[href*="/reels/"]` restent masqués même sans `:has()`. Un drapeau JS `data-reelfree-reel`/`-ad` sert de secours au masquage des posts.
- Repli tap DM : fenêtre dédiée `DM_TAP_WINDOW_MS = 1500` (le minimum de cette valeur et du TTL), et les taps sur une cible éditable sont ignorés.

## T20 — calage sur les captures réelles (home-feed, feed-following, explore, rf-recon 11:51–12:00)
Écarts constatés avec le recon public, puis corrigés :
- **Les reels du fil pointent vers `/reels/<id>/`** (et non `/reel/`), avec aussi `/p/<id>/` et `/reels/audio/<n>/`. La détection prend `a[href*="/reels/"]:not([href*="/reels/audio/"])` ou `/reel/`.
- **Pas de `<header>`** dans les posts réels, donc l'ancien `isSuggested()` ne voyait rien. Les suggestions sont maintenant détectées par un `[role="button"]` **feuille** (sans enfant élément) dont le texte vaut exactement « Suivre »/« Follow ». Les `span` ne sont plus lus du tout : on ne lit jamais une légende.
- **Publicités** : lien `/ads/ig_redirect/`, masquées (`data-reelfree-ad` + `:has(a[href^="/ads/"])`).
- **Fil virtualisé** (8 articles montés au plus) : la numérotation S1 se fait par shortcode `/p/<id>` (map en mémoire), donc le plafond tient quand Instagram démonte puis remonte les posts. Il y a aussi un plafond dur à 3× `feedLimit` sur tous les posts vus (masqués compris), pour que la pagination ne tourne pas sans fin derrière des posts masqués.
- **Nouveau `CONFIG.feedVariant = 'following'`** : le fil par défaut (« Pour vous ») est surtout fait de suggestions, donc `/` est remplacé par `/?variant=following` (seuls les comptes suivis), URL observée par rf-recon. Garde anti-boucle : drapeau `sessionStorage['reelfree:feed-variant-at']` (timestamp seul, fenêtre de 2 s). Fonction pure exportée : `feedVariantTarget(search, cfg)`. Coût : un rechargement complet quand on revient sur l'accueil.
- **Recherche** : la structure réelle est `main > nav` (champ, récents, comptes) puis la grille en frère. La règle `main > nav ~ *` masque la grille et le loader. Les liens `/explore/search/keyword/` (recherches récentes par mot-clé) sont masqués. Dans cette grille, les reels sont des tuiles `/p/`.
- Nav réelle : l'onglet `/explore/` s'appelle « Recherche ». Le clic est redirigé vers `/explore/search/`.
- Vérifié en WebKit iPhone 11 sur les captures réelles (script : `/tmp/claude-1000/-home-arlegall-reelfree/9e341d31-2bf5-47a8-835c-409c6242628e/scratchpad/e2e/real.cjs`) : **21/21**. Reels, pubs et suggestions masqués, posts simples visibles et numérotés, aucune vidéo visible, plafond à 15 avec loader masqué, plafond tenu après démontage et remontage, recherche utilisable sans grille, zéro réseau, zéro erreur.
- ⚠️ Les anciens checks E2E S1 (`data-reelfree-last` sur le 15e, loader masqué) ne s'appliquent plus à `home-feed.html` : la capture réelle n'a que 4 posts, sous le plafond. @rf-qa : pour tester S1, dupliquer les articles avec des shortcodes distincts (voir real.cjs).
- **Encore à faire en T20** : D1–D3 sur le vrai DOM d'une conversation (forme du reel inline, URL au tap, dialog ou page, swipe). J'attends les captures DM de rf-recon.

## T18 — YouTube (`src/reelfree-youtube.user.js`, sha 27fc3a8eada6, bin/verify OK)
- `@match` m.youtube.com et www.youtube.com, document-start, `@noframes`, `@grant none`. **Aucun stockage**, aucun réseau.
- Fonction pure `decideYT(path, search, ctx)` exportée (`module.exports = { decideYT, CONFIG }`) :
  - `/shorts/<id11>` → `/watch?v=<id>` ;
  - `/shorts` nu, id invalide ou `/feed/shorts` → `/` ;
  - onglet Shorts d'une chaîne (`/@x/shorts`, `/channel/UC…/shorts`, `/c|user/<nom>/shorts`) → racine de la chaîne, à partir de segments validés ;
  - échec de décodage → `hide` ;
  - modes `home`/`home-off`/`watch`/`other` ;
  - `search` n'est jamais recopié.
- Navigateur : masque fail-closed jusqu'à la décision, capture des clics sur `/shorts/…`, `yt-navigate-*` + polling, CSS par balises custom (`ytd-reel-shelf-renderer`, `ytm-shorts-lockup-view-model`…), un `:has()` par règle. `CONFIG.hideHomeFeed` (false par défaut) masque les recommandations de l'accueil. Les sélecteurs non vérifiés sont marqués `TODO(recon)`.

## T16 — contournements rf-sec corrigés (IG sha a01a1b20aeac, YT sha ce30c1a74f48)
1. **D3 via `/p/`** : `decidePost` refuse tout média dont l'id diffère de `activeReel` (`redirect lastThread`, reason D3, jeton consommé s'il existe). `pauseMedia()` est appelé en mode `post`.
2. **D2 par l'historique** : le repli par tap est lié à l'id du lien tapé (`a` englobant ou contenu), ignoré depuis un dialog, ignoré quand l'arrivée vient de `popstate` (`state.viaPopstate`) ou d'un `pageshow` restauré du bfcache.
3. **S1 remis à zéro** : plus aucune remise à zéro. Les compteurs sont dans `sessionStorage['reelfree:feed-count']` et `['reelfree:feed-seen']` (nombres seuls). Les shortcodes restent en mémoire. Conséquence assumée : une fois le plafond atteint, le fil reste vide jusqu'à la fermeture de l'onglet. Le message « Tu es à jour ✓ » est désormais en `main::after` pour s'afficher même quand aucun post n'est visible.
4. **Overlay photo** : `dmOverlay` vaut pour n'importe quel `[role="dialog"]` en mode `dm`. Aucun jeton n'est posé pour un clic dans un dialog (clic annulé).
5–8 (mineurs) : `/<user>/tv/<id>` suit la règle reel, `/<user>/reel/` donne R2-profile. `%2F`/`%5C`/`%2E%2E` bruts ou les segments `.`/`..`/`\` donnent `hide('X3-path')`, y compris dans `mediaIdFromPath`. Un jeton expiré est purgé à la lecture. `pageshow` (bfcache) entraîne une réévaluation sans reel admis.
YouTube : garde-fou anti-boucle lié à l'id (5 s, mémoire + `reelfree:yt-shorts-at = "<id>:<ts>"`), avec le message « Short non lisible hors du lecteur Shorts ». `LEGACY_NAME_RE` exige un alphanumérique.
Vérifié :
- Node : 14/14 reproductions.
- WebKit : `/tmp/claude-1000/-home-arlegall-reelfree/9e341d31-2bf5-47a8-835c-409c6242628e/scratchpad/e2e/t16.cjs` **9/9** (points 2, 3 et 4), captures réelles `real.cjs` **21/21**, boucle YouTube `…/scratchpad/yt/loop.cjs` PASS.
- Unitaires rf-qa 35/35. bin/verify OK.

## Demandes
- @rf-qa — **tests de non-régression T16** (à mettre dans tests/unit, ton périmètre) :
  - [1] `decide('/p/BBB/', {now, activeReel:'AAA', lastThread:'/direct/t/1/'})` → redirect `/direct/t/1/`, reason `D3`. Même chose avec `token:{id:'BBB', ts:now}` → redirect et `consumeToken:true`. `decide('/p/AAA/', {activeReel:'AAA'})` → allow `dm-reel`. `decide('/p/BBB/', {now})` → allow `post`.
  - [2] (partie pure) `decide('/reel/X/', {now, token:null})` → redirect (pas de jeton implicite). En E2E : un tap sur un message puis `pushState` vers un reel → refusé. Un tap sur le reel A puis `pushState` vers A → `dm-reel`. Un tap sur A puis vers B → refusé. Un tap sur A puis une arrivée par `popstate` (`History.prototype.replaceState.call` + `PopStateEvent`, pour contourner le hook) → refusé. Voir t16.cjs.
  - [3] E2E : `sessionStorage['reelfree:feed-count']='15'`, puis aller-retour DM et rechargement de `/?variant=following` → 0 post visible, `data-rf-capped`, `main::after` contient « Tu es à jour ». **Attention : vider sessionStorage entre les tests de fil.**
  - [4] E2E : un dialog sans vidéo injecté dans un thread, avec un lien `/reel/CHAIN1/` : clic annulé, pas de jeton, wheel vertical bloqué.
  - [5] `decide('/u/tv/AAA/')` → redirect R3. `decide('/someuser/reel/')` → redirect `/someuser/`.
  - [6] `/direct%2F..%2Freels/`, `/direct%2f..%2freels/`, `/%5Creels/`, `/direct/%2E%2E/reels/`, `/direct/../reels/`, `/a/./reels/` → `hide` (reason `X3-path`). `mediaIdFromPath('/p%2FAAA/')` → null. ⚠️ `/%5Cevil.com/reels/` donne maintenant `hide` et non plus `redirect /` : le seul invariant à tester est l'absence de redirection hors origine.
  - YouTube : `decideYT('/user/..%2F..%2Fx/shorts')` → `/`. Boucle `/shorts/A` → `/watch?v=A` → `/shorts/A` : arrêt, `data-rfy-loop` posé, page masquée. Deux Shorts différents à moins de 5 s → les deux sont redirigés.
- @rf-qa — **tests à ajouter** :
  - Unitaires Instagram :
    - `feedVariantTarget('', {feedVariant:'following'})` → `/?variant=following` ; `('?variant=following')` → null ; `('?a=1&variant=following')` → null ; `{feedVariant:'default'}` → null.
    - `mediaIdFromPath` : `/reels/audio/1/` → null ; `/reels/X/` → `X` ; `/p/X/liked_by/` → `X`.
  - E2E Instagram sur les captures réelles :
    - `/` mène à `/?variant=following` ;
    - posts reel, pub et suggestion masqués, post simple visible ;
    - pas de `<video>` visible dans le fil ;
    - plafond S1 avec articles dupliqués (shortcodes distincts), puis démontage et remontage → toujours ≤ 15 ;
    - `/explore/search/` : champ et comptes visibles, tuiles/vidéos/liens keyword masqués.
  - Unitaires `decideYT` :
    - id valide, avec `/` final, segments en plus ou `;params` ;
    - casse (`/SHORTS/`, `/%73horts/`) ; id de 10 ou 12 caractères → `/` ; `/shorts` et `/shorts/` nus ; `/feed/shorts` ;
    - `/%`, `/shorts/%E0%A4%A` → hide ;
    - open redirect (`/shorts/%5Cevil.com`, `/shorts/%2F%2Fevil.com`, `/%5Cevil.com/shorts`) → `to` commence par un seul `/` ;
    - onglets Shorts de chaîne (`@handle`, `channel/UC…`, `c/`, `user/`) ;
    - `/` avec `hideHomeFeed` true/false ; `/watch` ; `/results`.
  - E2E YouTube (WebKit, m.youtube.com simulé) :
    - `/shorts/<id>` masqué avant la redirection vers `/watch?v=<id>` ;
    - clic sur un lien `/shorts/…` ; `pushState` vers `/shorts/…` ;
    - étagères Shorts masquées sur `/watch` et sur l'accueil ;
    - `hideHomeFeed` ;
    - aucune requête hors youtube.
- @rf-qa : `mediaIdFromPath` est exporté. Mode `post`/`dm-reel` sur `/p/<id>` avec jeton. Ancienne demande, merci d'ajouter des cas de test : `/%5Cevil.com/reels/` → `/`, `/reels;x/` → redirect, `/tv/<id>/` (règle reel), `/explore/search/keyword/` → redirect, et casse de l'id (`token.id` exact).
- @rf-sec : sous Userscripts (injection par défaut en monde isolé « content »), le hook de `history.pushState` ne voit pas les appels de la page. Le polling à 250 ms fait le vrai travail. Je ne mets **pas** `@inject-into page`, pour que la page ne puisse pas altérer nos fonctions. Le prix : un flash possible de ≤250 ms sur une navigation SPA vers une route interdite (média mis en pause dès le masque). Le clic intercepté en T12 le réduira. À arbitrer.
- @rf-recon : **priorité pour finir T20 : captures anonymisées d'une conversation contenant un reel partagé (`/direct/t/…`), puis de l'état juste après le tap sur ce reel (URL, dialog ou page, présence d'un reel suivant au swipe).** Feed et recherche réels sont intégrés, merci. Ancien : (T02 intégré, merci.) Pour T17, à vérifier en priorité : (0) le reel en DM s'ouvre-t-il en `[role="dialog"]` sans changer d'URL ? (0bis) dans le fil, un reel pointe-t-il vers `/reel/` ou vers `/p/` ? (a) un clic sur un reel en DM change-t-il l'URL ? Sinon D3 ne s'active pas ; (b) l'élément cliquable du reel inline est-il bien un `<a href>` ? ; (c) libellé FR exact du bloc suggestions. Ancien point : j'attends T02 (sélecteurs) et T03 (forme exacte des liens de reel dans un DM : `/reel/<id>/` ou `/reels/<id>/` ? navigation SPA ou rechargement complet ?).
- @rf-sec : `isSuggested()` compare le texte des boutons et des spans du **header** d'un post du fil à une liste fixe FR/EN (« Suivre », « Suggestions pour vous »…). C'est de l'interface, pas un message, et rien n'est stocké ni copié. À valider au regard de la règle « pas de lecture de contenu ».
