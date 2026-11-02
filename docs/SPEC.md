# Spécification — ReelFree (Instagram)

Cible : Safari iOS sur iPhone 11 (viewport 414×896, DPR 2), instagram.com en version web mobile, connecté.

## 1. Bloquer les Reels
- **R1** Masquer l'onglet Reels de la barre de navigation (`a[href="/reels/"]` et équivalents).
- **R2** La route `/reels/` et ses sous-routes (`/reels/audio/...`) sont **interdites**. Elles redirigent vers `/` et le contenu est masqué avant le premier rendu (CSS injecté à `document-start`).
- **R3** Une route `/reel/<id>` ou `/reels/<id>` atteinte **hors DM** est interdite et suit le même traitement que R2.
- **R4** Les reels dans le fil d'accueil (posts vidéo au format reel, blocs « Reels suggérés ») sont masqués.
- **R5** Explore (`/explore/` et sous-routes, ainsi que l'onglet Recherche quand il affiche la grille Explore) est interdit et masqué. La recherche par nom de compte doit rester utilisable si c'est faisable.

## 2. Autoriser les reels reçus en message
- **D1** Un reel partagé dans une conversation (`/direct/t/<thread>`) doit rester visible et lisible : inline dans le fil de discussion, ou en ouvrant `/reel/<id>`.
- **D2** L'ouverture est autorisée seulement si elle part d'un **clic dans `/direct/`**. On pose un jeton one-shot `reelfree:dm-allow=<id>` dans `sessionStorage`, consommé à l'arrivée sur `/reel/<id>` (avec un TTL court, par exemple 10 s).
- **D3** **Pas d'enchaînement** : dans un reel ouvert depuis un DM, le swipe ou scroll vertical vers le reel suivant est bloqué (wheel, touchmove, touches clavier). Toute navigation vers un autre `/reel/<id>` sans jeton ramène à la conversation d'origine.
- **D4** Un bouton « ← Retour à la conversation » est visible sur le reel autorisé.

## 3. Éviter le scroll infini
- **S1** Le fil d'accueil est plafonné à N posts (par défaut 15). Au-delà, les posts suivants sont masqués et un bloc « Tu es à jour » s'affiche. Le chargement de la suite est empêché quand c'est possible : on masque la sentinelle de pagination.
- **S2** Les posts suggérés (« Suggestions pour vous », « Suggested posts ») sont masqués.
- **S3** Option : `feedMode = "off"` masque complètement le fil d'accueil. On garde les stories, les DM, le profil, la publication et les notifications.

## 4. Robustesse
- **X1** Instagram est une SPA. Il faut détecter les changements de route via un hook sur `history.pushState`/`replaceState`, l'événement `popstate`, et en dernier recours un polling de `location.pathname` toutes les 250 ms.
- **X2** Les sélecteurs reposent sur des attributs stables (`href`, `role`, `aria-label`, structure) et **jamais** sur des classes CSS obfusquées.
- **X3** Fail-closed (voir CLAUDE.md).
- **X4** Coût négligeable : un seul MutationObserver avec debounce, aucune boucle lourde.

## 5. Configuration
Un objet `CONFIG` en tête de fichier, modifiable à la main : `feedMode` (`"limited"` | `"off"`), `feedLimit`, `blockExplore`, `dmReelTtlMs`.

## 6. YouTube (bonus, priorité basse)
Fichier séparé `src/reelfree-youtube.user.js` pour `m.youtube.com` et `www.youtube.com` :
- masquer l'onglet et les étagères Shorts ;
- rediriger `/shorts/<id>` vers `/watch?v=<id>`, pour qu'un Short partagé reste regardable sans enchaînement ;
- option pour masquer les recommandations de l'accueil.
