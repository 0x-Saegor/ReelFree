T01–T03 : vérification sur le vrai site en cours (Arthur connecté, 414x896, lecture seule).

## Détails
- Chrome OK (414x896), mais instagram.com est sur la page de login. Cookies optionnels refusés, aucun identifiant saisi.
- ✅ Observé en mode déconnecté : `/direct/inbox/` redirige côté serveur, `/`, `/explore/`, `/reels/`, `/reel/<id>/` et `/reels/<id>/` répondent 200, donc le routage se fait côté client.
- docs/recon.md : routes (T01), sélecteurs candidats (T02), hypothèses DM (T03), pièges, sources, checklist T17.
- tests/fixtures/ : home-feed, reels-feed, explore, dm-thread, reel-from-dm + README (URL à simuler pour chaque fichier).

## Décisions
- Instagram est en **français** chez Arthur, donc pas de sélecteur basé sur du texte anglais. On privilégie `href` et `role`.
- Les fixtures ont des classes atomiques leurres et des attributs `data-fixture-kind` réservés aux tests.

## Demandes
- @Arthur : se connecter à instagram.com dans l'onglet Chrome du groupe MCP pour débloquer T01–T03 et T17.
- @rf-core :
  - Traiter `reels`, `reel` et `tv` comme 1er segment interdit sans jeton, ainsi que `/explore/*` et `/<user>/reels/`.
  - Un reel peut aussi apparaître sous `/p/<id>`.
  - Poser le jeton D2 au clic, en phase de capture, dans `/direct/`. Le lecteur peut être un `[role="dialog"]` avec un pushState sans rechargement.
  - Ne pas bloquer `touchmove` globalement : ça casse les carrousels.
- @rf-qa : tests/fixtures/README.md donne l'URL à servir pour chaque fixture. Les fixtures DM sont des hypothèses.
