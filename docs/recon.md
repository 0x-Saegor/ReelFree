# Reconnaissance — instagram.com (web mobile)

Auteur : rf-recon · dernière mise à jour : 2026-11-02

> **Niveau de preuve.** Le 2026-11-02, Chrome était disponible (fenêtre 414×896) mais **Instagram n'était pas connecté**.
> Tout ce qui concerne le mode connecté vient donc des **sources publiques** : userscripts, listes uBlock et fils de discussion cités plus bas.
> Il n'a **pas** été vérifié sur le vrai site. Légende :
> - ✅ observé directement
> - 📚 source publique (code lu)
> - 🔮 inférence
> - ⛔ à vérifier sur le site connecté (T17)

## T01 — Inventaire des routes

| Route | Contenu | Politique (SPEC) | Preuve |
|---|---|---|---|
| `/` | Fil d'accueil, stories en haut | Autorisé, plafonné (S1–S3) | 📚 |
| `/reels/` | Fil Reels plein écran, scroll infini | **Interdit** (R2) | 📚 |
| `/reels/<id>/` | Reel dans le lecteur Reels, swipe vers le suivant | **Interdit hors DM** (R3) | 📚 |
| `/reel/<id>/` | Reel seul. Une redirection automatique depuis `/reels/<id>` a existé puis a été retirée selon HN 2026, d'où ⛔ | **Interdit hors DM** (R3), autorisé avec jeton (D2) | 📚 ⛔ |
| `/p/<id>/` | Post. **Le même shortcode peut être un reel** | Autorisé, mais 🔮 un reel servi sous `/p/` doit être masqué s'il est hors DM | 📚 🔮 |
| `/tv/<id>/` | Ancien IGTV, traité comme un média par les scripts publics | 🔮 Traiter comme `/reel/` | 📚 |
| `/reels/audio/<id>/` | Page d'un son, grille de reels | **Interdit** (R2) | 🔮 aucune source |
| `/explore/` | Grille Explore | **Interdit** (R5) | 📚 |
| `/explore/search/` | Recherche (mobile) | 🔮 Autoriser le champ de recherche et masquer la grille | ⛔ |
| `/explore/tags/<tag>/`, `/explore/locations/...` | Grilles par hashtag et par lieu | 🔮 Interdit, ce sont des grilles de découverte | 📚 (le gist nikspyratos les autorise, mais c'est un choix de ce projet) |
| `/direct/inbox/` | Liste des conversations | Autorisé | ✅ redirige vers le login si déconnecté |
| `/direct/t/<thread>/` | Conversation | Autorisé, et c'est l'origine du jeton D2 | 📚 |
| `/stories/<user>/<id>/` | Lecteur de stories | Autorisé | 📚 |
| `/<username>/` | Profil | Autorisé | 📚 |
| `/<username>/reels/` | Onglet Reels du profil | 🔮 Interdit, c'est une grille de reels | ⛔ |
| `/accounts/...`, `/settings/...` | Compte et réglages | Autorisé | 📚 |

✅ Mode déconnecté (2026-11-02) :
- `/direct/inbox/` redirige côté serveur.
- `/`, `/explore/`, `/reels/`, `/reel/<id>/` et `/reels/<id>/` répondent 200.
- Le routage réel se fait donc **côté client** (SPA). C'est cohérent avec X1.

**Recommandation pour `decide()`** (@rf-core) :
- Toute URL dont le 1er segment vaut `reels`, `reel` ou `tv` est interdite sans jeton.
- Pour `explore`, seule `explore/search` est éventuellement tolérée.
- La comparaison ignore la casse et le slash final.
- Une route inconnue sous un préfixe interdit reste interdite (fail-closed).

## T02 — Sélecteurs stables

Aucune source publique ne décrit le DOM mobile à 414 px. Tout ce qui suit est 📚 (code desktop ou mixte) et ⛔.

| Cible | Sélecteur proposé (stable) | Secours | Source |
|---|---|---|---|
| Onglet Reels (nav) | `a[href="/reels/"]`, `a[href^="/reels"]` | `[data-testid="reels-tab"]`, svg `aria-label`/`<title>` = « Reels » | gist nikspyratos, Better Instagram, shraiwi |
| Onglet Explore (nav) | `a[href="/explore/"]` | svg `aria-label` = « Explorer » (FR, 🔮) | viki53 |
| Conteneur d'un item de nav | `link.closest('div[role="menuitem"], li')`, sinon le parent | — | nikspyratos |
| Post du fil | `main[role="main"] article`, sinon `main article` | — | IG Scroll Brake, viki53 |
| Reel dans le fil | `article:has(a[href^="/reel/"])` | `article:has(video)` (trop large, masque toutes les vidéos) | shraiwi (rapport de 2026-09) |
| « Suggestions pour vous » | `article` contenant un bouton « Suivre » ou « Follow » 🔮 | Texte « Suggestions pour vous » / « Suggested for you » | shraiwi (EN seulement) |
| Fin du fil (« Vous êtes à jour ») | `main article + div:has(img[src$="illo-confirm-refresh-light.png"])`. Tout ce qui suit = posts suggérés | — | viki53 |
| Sentinelle / loader de pagination | `main [data-visualcompletion="loading-state"][role="progressbar"]` | — | viki53 |
| Lecteur vidéo | `div[aria-label="Video player"]` (EN) | — | shraiwi |

À éviter :
- Les classes atomiques (`x78zum5`, `xh8yej3`…). Elles changent à chaque déploiement (X2).
- Les correspondances de texte. Tous les projets publics sont en anglais seulement, alors que l'utilisateur a Instagram **en français** (✅ la page de login est en français).
- Si on garde un critère textuel, il faut une liste FR + EN, utilisée seulement en secours.

## T03 — Reel reçu en DM

Aucune source publique ne décrit le rendu web : ⛔ **[!] ça demande le vrai site connecté**. Ce qu'on sait :
- 📚 Dans l'app, un reel ouvert depuis une conversation permet de swiper vers d'autres reels (patch Android HushGram « Swipe through a chat's reels »).
- 📚 Le gist nikspyratos signale qu'une sous-fenêtre ouverte depuis les messages peut défiler à l'infini vers du contenu Explore. Il faut donc s'attendre à un **overlay/modal** (`[role="dialog"]`) et pas forcément à une navigation vers `/reel/<id>`.

Hypothèses à tester en T17 :
1. Le reel apparaît inline dans `/direct/t/<thread>/` comme une vignette avec un lien `a[href^="/reel/"]` ou `/p/`.
2. Au clic, Instagram fait un `pushState` vers `/reel/<id>/` et affiche un `[role="dialog"]` au-dessus de la conversation. Sinon c'est une navigation pleine page.
3. Le swipe vertical dans ce lecteur charge un autre reel et change l'URL. Cela justifie D3.

Conséquence pour @rf-core : le jeton D2 doit être posé **au clic** (capture sur `a[href*="/reel/"]` dans `/direct/`) et aussi accepter un affichage en dialog où l'URL change sans rechargement.

## Pièges connus
- Le routage `/reels/<id>` ↔ `/reel/<id>` a changé au moins une fois (HN 2026).
- Bloquer `touchmove` globalement casse les carrousels du fil (gist nikspyratos). Il faut limiter le blocage au lecteur reel.
- Les layouts desktop et mobile ont des conteneurs de nav distincts : barre latérale ou barre du bas.
- Supprimer les suggestions en élaguant le JSON (BevizLaszlo) demande d'intercepter le réseau. C'est **exclu** par CLAUDE.md.

## Sources
- https://gist.github.com/nikspyratos/3c5b82d24e835d63419700d26db0e696
- https://hn.nuxt.dev/item/47223147
- https://greasyfork.org/en/scripts/586838-ig-scroll-brake/code
- https://greasyfork.org/en/scripts/513830-better-instagram/code
- https://gist.github.com/viki53/74ab17ce5eb3c30699aae5620ad031e0
- https://gist.github.com/shraiwi/009c652da6ce8c99a6e1e0c86fe66886
- https://raw.githubusercontent.com/BevizLaszlo/UBlock-Filters-for-Social-Media/main/filterlist.txt
- https://github.com/SysAdminDoc/HushGram

## Checklist T17 (site réel, utilisateur connecté)
- [ ] Barre du bas à 414 px : `href` réels des onglets, présence de `role`/`aria-label`, libellés FR
- [ ] `/reels/<id>/` : redirige vers `/reel/<id>/` ou non ?
- [ ] Fil : `main article` présent ? Comment distinguer un reel (`a[href^="/reel/"]`) ?
- [ ] Bloc « Suggestions pour vous » : structure, et texte FR exact
- [ ] Loader `data-visualcompletion="loading-state"` présent en bas du fil ?
- [ ] DM : rendu d'un reel partagé, URL au clic, dialog ou page, swipe vers d'autres reels
- [ ] `/explore/search/` : le champ de recherche est-il séparable de la grille ?
- [ ] `/<username>/reels/` existe-t-il sur mobile web ?
