T16 clos (IG a01a1b20aeac, YT 27fc3a8eada6) ; surveillance de src/ continue ; T19 (README) prêt à finaliser après T17 et la boucle YouTube.

## Détails
- `bin/verify [FICHIER]` (défaut : src/reelfree.user.js) : affiche le SHA-256 complet, les findings (`L<ligne> <règle> <extrait>`), les `WARN` à revoir à la main, et se termine par `OK sha256=<12>` (code 0) ou `FAIL <raison>` (1 = violation, 2 = erreur d'usage ou d'I/O).
- `bin/verify --selftest` : 59/59 règles attrapent leur échantillon fautif, et un script propre passe.
- Le scan porte sur le texte brut, commentaires compris : **ne pas nommer les API interdites dans les commentaires**.
- La liste exacte des règles est dans docs/SECURITY.md §3.
- Le nom de fichier fixe les @match et les hôtes autorisés : reelfree.user.js → www.instagram.com ; reelfree-youtube.user.js → m.youtube.com et www.youtube.com.
- docs/INSTALL-iOS.md. Points non confirmés sur un vrai appareil : les libellés exacts des permissions par site de l'extension Safari, et l'action Raccourcis « Générer le hachage » (SHA256). À valider par Arthur lors de la première installation.

## Demandes
- ~~@rf-core — redirection ouverte vers un site tiers~~ **corrigé** (sha 42f0f231858b) : `USERNAME_RE` + `isSameOriginPath()`. Vérifié dans Node sur `/%5Cevil.com/reels/`, `/%5C%5C…`, `/%2F%2F…`, `/%09…`, `/@evil.com/…` : l'origine reste instagram.com. @rf-qa : le test de non-régression reste demandé.
- ~~@rf-core — bin/verify FAIL~~ **corrigé** (commentaire reformulé). Ancien constat : : le commentaire de la ligne 13 contient « innerHTML ». Remplace-le par « no raw HTML sinks ».
- ~~@rf-core — `/explore/search/`~~ **corrigé** (seule la page exacte est autorisée, avec masquage CSS des vignettes). Ancien constat : `seg[1] === 'search'` autorise aussi `/explore/search/keyword/?q=…`, qui affiche une grille de résultats (posts et reels). Restreindre l'autorisation à `/explore/search/` exactement, ou masquer cette grille par CSS (à confirmer par @rf-recon, T02).
- ~~@rf-core — D4 (bouton retour)~~ **conforme** (sha a01a1b20aeac : `<button>` créé par createElement, `location.assign(backTarget())` validé par THREAD_RE, aucun `href` posé). Demande : utiliser un `<button>` avec `location.assign(lastThread)` validé par THREAD_RE. Pas de `setAttribute('href', …)`, que bin/verify refuse.
- ~~@rf-core — `@inject-into`~~ **conforme** (aucune clé `@inject-into` dans les deux scripts, sha a01a1b20aeac / ce30c1a74f48). Demande : seul `content` est accepté (ou l'absence de la clé). `page` et `auto` sont refusés.

- ~~@rf-core — fichier tronqué~~ **résolu** (sha 3efa5b2c, 596 lignes, `node --check` OK). Ancien constat : (sha 0174fa9dd0d3, 201 lignes, se termine après le `return` de la ligne 200, sans `})();`) : `node --check` échoue. Un script qui ne se charge pas ne pose jamais le CSS fail-closed, donc la page reste entièrement visible (fail-open). Si une réécriture est en cours, ignore cette demande. Sinon, restaure la partie navigateur (CSS, routeur, observer).

- ~~@rf-core — durcissement CSS `:has()`~~ **fait** (sha 441548b5). Ancien constat : (lignes 241 et 244-245) : une règle qui mélange un sélecteur simple et un sélecteur `:has()` est entièrement ignorée par un moteur qui ne comprend pas `:has()`, et le masquage des liens `/reel/` et `/reels/` disparaît avec elle. Merci de mettre chaque sélecteur `:has(...)` dans **sa propre règle**, pour que `a[href="/reels/"]` et `a[href*="/reel/"]` restent masqués quoi qu'il arrive. (Le guide d'installation exige déjà iOS 15.4 ou plus.)
- @rf-qa — Tests E2E à prévoir pour D3 :
  1. Sur `/reel/A` autorisé, un `pushState` vers `/reel/B` doit, en moins de 300 ms, renvoyer vers `lastThread`, avec la vidéo en pause.
  2. Un jeton écrit pour A puis une navigation vers B : refusé, et le jeton est consommé.
  3. Un jeton de plus de 10 s : refusé.
  4. Un clic sur un lien `/reel/` hors de `/direct/` ne doit pas écrire de jeton.

- ~~@rf-core — repli D2 par tap~~ **fait** (`DM_TAP_WINDOW_MS = 1500`, taps sur une zone éditable ignorés). Ancien constat : : n'importe quel `pointerdown` dans une conversation, y compris dans la zone de saisie, ouvre une fenêtre de `dmReelTtlMs` (10 s). Pendant ce temps, toute navigation depuis la conversation vers une route média reçoit un jeton. Une navigation déclenchée par un tap a lieu en quelques centaines de ms, donc deux demandes :
  1. une fenêtre dédiée et courte, par exemple `DM_TAP_WINDOW_MS = 1500` ;
  2. ignorer les taps sur une cible éditable (`isEditable(ev.target)`), comme pour `keydown`.
  Ce n'est pas bloquant (le cas reste limité à une navigation qui part d'une conversation), mais cela resserre D2.

- ~~@rf-core — YouTube : boucle de redirection~~ **garde-fou fait** (sha 9a6e6bc6, puis ce30c1a74f48 : garde-fou lié au **même id** via `sessionStorage['reelfree:yt-shorts-at'] = "<videoId>:<ts>"`, car un garde-fou purement en mémoire est perdu au rechargement d'une boucle côté serveur. Testé en WebKit : boucle arrêtée après 3 documents, page masquée et message affiché. — rf-core). @rf-recon : le comportement réel de m.youtube.com reste à constater en T17. Ancien constat : (src/reelfree-youtube.user.js:92). Si m.youtube.com renvoie lui-même `/watch?v=<id d'un Short>` vers `/shorts/<id>`, ce qui est à vérifier en vrai, on obtient une boucle `shorts → watch → shorts`. La page reste masquée (fail-closed), mais elle envoie des navigations en rafale, avec un risque de limitation du compte. Demandé : un garde-fou en mémoire. Si on a déjà redirigé ce même id il y a moins de 5 s, ne pas rediriger à nouveau : rester masqué et afficher « Short non lisible hors du lecteur Shorts ».
- ~~@rf-core — mineur, YouTube : `LEGACY_NAME_RE`~~ **fait**. Ancien constat : il acceptait `..`, si bien que `/user/..%2F..%2Fx/shorts` donne `/user/..`. C'est sans danger (même origine, on revient à `/`), mais merci d'exiger au moins un caractère alphanumérique : `/^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/`.

- ~~@rf-core — T16, revue indépendante~~ **tous corrigés** (sha a01a1b20aeac), revérifiés dans Node. `/p/B` depuis un reel A donne D3 (retour à la conversation). Le repli tactile est lié à l'id du lien tapé, sans effet sur `popstate`. Le plafond du fil est persistant pour la durée de l'onglet. L'overlay compte pour n'importe quel dialog, et aucun jeton n'est posé depuis un dialog. `tv` est traité, `%2F`/`%5C`/`..` donnent `X3-path`, le jeton expiré est purgé, et le bfcache passe par `pageshow`. Ancien détail :
  1. **[majeur] D3 contourné via `/p/`** (`decidePost`).
     - `decide('/p/BBB/', {activeReel:'AAA', lastThread:'/direct/t/1/'})` donne `allow`/`post` (reproduit).
     - Depuis un reel ouvert en DM, la navigation interne d'Instagram vers un autre média en `/p/` sort de `dm-reel` sans revenir à la conversation, et le verrou de swipe tombe.
     - Correctif : dans `decidePost`, si `activeReel` (ou `lastThread` avec un `prevPath` en média) est défini et que l'id diffère, appliquer `block(back, 'D3', consume)`.
     - En plus, appeler `pauseMedia()` en mode `post` : un `display:none` ne coupe pas forcément le son sur iOS.
  2. **[majeur] D2 obtenu par l'historique** (repli `dmTapAt`, l.604-607).
     - Scénario : on ouvre `/p/<reel>` (vidéo masquée), on va dans un thread, on tape n'importe où, puis on revient par geste « Précédent » en moins de 1,5 s.
     - Un jeton est alors fabriqué pour l'id du chemin d'arrivée et le reel devient lisible (`decide('/p/AAA/', {token:{id:'AAA'}})` donne `dm-reel`).
     - Correctif :
       - noter dans `onDmTap` l'id ciblé (`mediaIdFromPath` du lien le plus proche, ou d'un `href` contenu dans l'élément tapé) et n'accepter le repli que si l'id d'arrivée est **celui-là** ;
       - **ignorer le repli quand la navigation vient de `popstate`** (marquer `state.viaPopstate = true` dans le handler).
  3. **[majeur] S1 remis à zéro par aller-retour** (l.619).
     - `feedSeq`, `feedSeen` et les clés sont remis à zéro à chaque retour sur le fil : DM → fil donne 15 posts de plus, à l'infini.
     - Correctif : **ne pas réinitialiser** sur une entrée SPA. Garder le compteur pour toute la vie de la page.
     - Option : le persister dans `sessionStorage` sous `reelfree:feed-count`, sous forme d'un simple nombre, ce qui est autorisé, pour que le rechargement ne remette pas non plus à zéro.
  4. **[majeur] Overlay DM sur une photo** (l.678).
     - `dmOverlay` n'est vrai que si le dialog contient une `video`. Sur une photo, le swipe n'est pas bloqué et un lien `/reel/` dans le dialog pose un jeton (l.570), donc on peut enchaîner jusqu'à un reel qui joue en mode `dm`.
     - Correctif : `dmOverlay = currentMode === 'dm' && !!document.querySelector('[role="dialog"]')`.
     - Ne jamais poser de jeton pour un clic **dans** un `[role="dialog"]`.
  5. [mineur] **Routes média non reconnues** : `/<user>/tv/<id>/` et `/<user>/reel/` passent en `other` (reproduit). Merci de traiter `tv` comme `reel` en position 2, et `/<user>/reel/` comme `R2-profile`.
  6. [mineur] **Décodage avant découpage** : `/direct%2F..%2Freels/` est classé `dm` (reproduit). Si, après décodage, un segment contient `/`, `\` ou vaut `..`, renvoyer `hide('X3-path')`. Le plus simple : tester `%2F`, `%5C` et `%2E%2E` sur le chemin brut, sans tenir compte de la casse, avant de décoder.
  7. [mineur] **Jeton jamais purgé** quand il n'est pas consommé. Dans `readToken`, supprimer la clé si `Date.now() - ts > dmReelTtlMs`.
  8. [mineur] **bfcache** : ajouter `window.addEventListener('pageshow', function (e) { if (e.persisted) { state.lastPath = null; state.activeReel = null; checkRoute(); } })`, pour qu'une page `dm-reel` restaurée par « Précédent » soit réévaluée, sans jeton.
  9. [info] La fenêtre de 150 à 250 ms avant détection d'un `pushState` du monde page est acceptée (limite du monde isolé, documentée dans SECURITY.md T8).
  @rf-qa : merci d'ajouter des tests unitaires pour les points 1, 2 (hors partie DOM), 5 et 6.

- @rf-core — mineur, YouTube : l'attribut `data-rfy-loop` n'est jamais retiré. Après un blocage par le garde-fou, n'importe quel masquage ultérieur affiche à tort « Short non lisible hors du lecteur Shorts ». Merci de le retirer quand une route est autorisée, ou au début de chaque `evaluate()`.

## Décisions
- 2026-11-02 : `isSuggested()` lit le `textContent` des boutons et des `span` de l'en-tête d'un post du fil, uniquement pour le **comparer** à des libellés fixes (« Suivre », « Suggestions pour vous »…). Ce texte n'est jamais stocké ni copié, et la fonction ne tourne qu'en mode `feed`, jamais dans les DM. Accepté. **Interdit** : étendre ce type de lecture aux pages `/direct/`.
- 2026-11-02 : risque résiduel accepté, et conforme à D1. Un reel envoyé par message reste ouvrable un par un (y compris dans une conversation avec soi-même), sans enchaînement.
- 2026-11-02 : bin/verify lance `node --check`. Une erreur de syntaxe est bloquante (selftest 62/62).
- 2026-11-02 : `createElement('style')` est autorisé (CSS fail-closed). `url(` et `@import` restent interdits dans le CSS.
- 2026-11-02 : le jeton `reelfree:dm-allow=<reelId>:<ts>` est accepté. L'id d'un reel est un identifiant public, pas du contenu de message, et la clé est supprimée à la consommation.
- 2026-11-02 : `@inject-into` limité à `content` (voir SECURITY.md T8).

- 2026-11-02 : `bin/verify` sans argument vérifie tous les livrables de src/ (`reelfree.user.js` obligatoire, `reelfree-youtube.user.js` optionnel) et refuse tout autre script dans src/. La dernière ligne devient `OK sha256=<12 IG> youtube=<12 YT>`. `bin/verify --readme` régénère le bloc SHA-256 du README, uniquement si la vérification passe.

## Revue src/ — journal
- 2026-11-02 sha256=04d80177f47c (squelette T05/T06) : metadata OK. Pas de réseau, pas de code dynamique. Fail-closed correct (masque posé avant toute décision, erreur → hide). Une redirection ouverte (ci-dessus).
- 2026-11-02 sha256=42f0f231858b : la redirection est corrigée et la recherche restreinte. bin/verify : `new URL(` n'est plus pris pour `url(` CSS (faux positif corrigé, selftest 61/61). Reste L13 (commentaire).
- 2026-11-02 sha256=0174fa9dd0d3 : ajout de /p/ et /tv/, de mediaIdFromPath() et du nettoyage des `;params`. La logique est correcte côté sécurité (le mode `post` masque les vidéos hors jeton DM). Mais le fichier est tronqué : erreur de syntaxe.
- 2026-11-02 sha256=3efa5b2cc2ed (596 lignes) : relecture complète.
  - Pas de réseau ni de code dynamique.
  - Navigations : `location.replace` et `location.assign` reçoivent des cibles constantes ou validées (`isSameOriginPath`, `THREAD_RE`). L'id injecté dans le CSS dynamique est validé par `REEL_ID_RE` (pas d'injection CSS possible).
  - Le jeton est validé et consommé.
  - Fail-closed : une erreur dans `onRouteAllowed` remet le masque, les médias sont mis en pause quand la page est masquée, et un observer protège les attributs de `<html>`.
  - Aucun événement synthétique n'est envoyé (pas de risque de ban).
  - Restent : le commentaire L13 et la règle `:has()` ci-dessus.
- 2026-11-02 sha256=c271f5cc554b (613 lignes) : `start()` est maintenant différé tant que `<html>` n'existe pas (WebKit à document-start). Correct : rien ne peut s'afficher avant `<html>`, et le masque et le CSS sont posés en premier dans `start()`. Restent le commentaire L13 et la séparation des règles `:has()`. Copie de cette version gardée pour les prochains diffs.
- 2026-11-02 sha256=600ead89 (diff avec c271f5cc) :
  - Numérotation persistante des posts (S1) : OK, l'attribut ne contient qu'un compteur.
  - `:has()` retiré des règles « caught up » : OK. Il reste aux lignes 240 et 244, dans des règles mélangées.
  - CSS dynamique : sélecteurs `?` et `$=` ajoutés, l'id est toujours validé : OK.
  - Verrou du scroll vertical seulement, et overlay vidéo en mode `dm` (`dmOverlay`) : OK.
  - Liens média bloqués dans un dialog au-dessus d'une conversation : OK.
  - Throttle avec `setTimeout(fonction)` : OK.
  - Repli D2 par tap : acceptable, à resserrer (voir Demandes).
- 2026-11-02 IG sha256=441548b5ad50 (diff avec 600ead89) : règles `:has()` séparées et repli par tap resserré. OK.
- 2026-11-02 YT sha256=27fc3a8eada6 (360 lignes, première revue) :
  - Pas de réseau, pas de stockage, pas de code dynamique.
  - Redirections reconstruites à partir de segments validés : sondées avec `\`, `//`, `%2F` et `..`, l'origine reste YouTube.
  - Fail-closed : masque posé par défaut, erreur → masque, vidéos mises en pause.
  - `:has()` isolé, une règle chacun.
  - `markShortsUi` compare seulement le texte au libellé « Shorts », sans le stocker. Accepté, comme pour IG.
  - À vérifier : la boucle de redirection (voir Demandes).
- 2026-11-02 IG sha256=389c11d5d2dc (diff avec 441548b5) :
  - `feedVariant: 'following'` : redirection vers la constante `/?variant=following`. Garde-fou anti-boucle : la clé sessionStorage `reelfree:feed-variant-at` ne contient qu'un horodatage, et sans stockage le script ne redirige pas. OK.
  - Pubs (`/ads/`) masquées. Plafond dur à `3 × feedLimit` posts vus. Clés des posts gardées en mémoire seulement (shortcodes publics, jamais persistés). OK.
  - `isSuggested` : comparaison exacte avec « Suivre »/« Follow », sur les boutons sans enfant uniquement (jamais une légende). OK.
  - Recherche : seul `main > nav` reste visible. OK, et plus strict qu'avant.
- 2026-11-02 fixtures (tests/fixtures/*.html, rf-recon) : contrôle vie privée.
  - Aucun token ni cookie (`csrftoken`, `sessionid`, `ds_user_id`, `fb_dtsg`, `lsd`…), aucune adresse e-mail, aucun numéro de téléphone, aucune URL CDN signée.
  - Pseudos remplacés par `user_N`, shortcodes par `FAKEIDnnnn`, textes par `TEXT`, `aria-label` personnels par `LABEL`, images en `data:`. Anonymisation conforme.
- 2026-11-02 IG sha256=1c898ae71b63 : fenêtre du garde-fou anti-boucle de `feedVariant` réduite de 5 s à 2 s. OK, aucune incidence sur la sécurité.
- 2026-11-02 revue indépendante (sous-agent, versions 600ead89 → 389c11d5) : 4 constats majeurs et 4 mineurs, tous revérifiés sur 1c898ae7 (voir Demandes). Ses points sur `:has()` et sur la lecture des `span` sont déjà corrigés.
- 2026-11-02 **T16 clos** sur IG sha256=a01a1b20aeac. Les 8 demandes de la revue indépendante sont corrigées et revérifiées. bin/verify OK et selftest 62/62. Le plafond du fil est désormais persistant (`reelfree:feed-count` et `reelfree:feed-seen`, des nombres seulement) : conforme à la règle `reelfree:` sans contenu utilisateur.
- 2026-11-02 YT sha256=9a6e6bc6a6d9 : garde-fou anti-boucle Shorts (mémoire + `reelfree:yt-shorts-at`, un horodatage seulement, conforme). Après blocage, la page reste masquée (fail-closed). `LEGACY_NAME_RE` exige maintenant un alphanumérique. OK, avec un défaut mineur d'affichage (voir Demandes).
- 2026-11-02 YT sha256=ce30c1a74f48 : le garde-fou est maintenant par id (`reelfree:yt-shorts-at` = `<videoId>:<ts>`). L'id de vidéo est public et déjà validé par `VIDEO_ID_RE`, comme pour le jeton IG. Accepté. `data-rfy-loop` n'est toujours pas retiré (demande mineure ouverte).
