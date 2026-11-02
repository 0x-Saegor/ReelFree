# ReelFree

> **Brouillon v0.1 (T19)** : ce fichier sera finalisé quand le code sera stable (fin de T16 et validation réelle T17).
> Ne pas installer tant que la ligne « État » ci-dessous n'indique pas « publié ».

**État : brouillon, non publié.**

ReelFree est un **userscript Safari pour iPhone** qui rend Instagram utilisable sans Reels, sans Explore et sans scroll infini.
Les reels qu'on t'envoie en message restent visibles. Il tourne dans Safari via l'app gratuite et open source
[Userscripts](https://github.com/quoid/userscripts) sur `https://www.instagram.com`. L'app Instagram, elle, est bloquée par Temps d'écran.

## Ce que fait le script

| | Comportement |
|---|---|
| **Reels** | L'onglet Reels disparaît. `/reels/`, `/reel/<id>` et `/tv/<id>` ouverts hors message renvoient vers l'accueil, et la page reste masquée pendant la redirection. Les reels du fil et les liens vers des reels sont masqués. |
| **Explore** | La grille Explore est interdite. L'onglet mène à la recherche de comptes (`/explore/search/`), où les vignettes de posts et de reels sont masquées. |
| **Reels reçus en message** | Un reel partagé dans une conversation s'ouvre, mais seulement depuis un tap dans `/direct/`, et pour ce reel-là uniquement (jeton à usage unique, valable 10 s). Impossible d'enchaîner sur un autre reel ou post depuis celui-ci : on revient à la conversation. Le scroll vertical vers le reel suivant est bloqué et un bouton « ← Retour à la conversation » s'affiche. |
| **Fil d'accueil** | Le fil « Abonnements » (les comptes que tu suis) s'ouvre par défaut. Il est plafonné à 15 posts **par onglet** : le compteur ne repart pas à zéro après un aller-retour ou un rechargement. Ensuite s'affiche « Tu es à jour ✓ » et la suite ne se charge plus. Les posts suggérés et les publicités sont masqués. Option : masquer complètement le fil (`feedMode: 'off'`). Les stories, les messages, le profil, la publication et les notifications restent disponibles. |
| **Par défaut** | Si le script ne sait pas trancher, la page reste masquée (*fail-closed*). |

Les réglages se trouvent dans l'objet `CONFIG`, en tête de `src/reelfree.user.js` : `feedMode` (`'limited'` ou `'off'`), `feedLimit`, `feedVariant` (`'following'` ou `'default'`), `blockExplore`, `dmReelTtlMs`.
Modifier un réglage change le SHA-256 : relance alors `bin/verify` et compare avec ta propre empreinte, plus avec celle de ce README.

**Bonus YouTube** (`src/reelfree-youtube.user.js`, optionnel, pour `m.youtube.com` et `www.youtube.com`) : l'onglet, les étagères et les vignettes Shorts sont masqués, et `/shorts/<id>` s'ouvre en vidéo classique (`/watch?v=<id>`), sans enchaînement. Option `hideHomeFeed` pour masquer les recommandations de l'accueil. Pour l'installer, dépose aussi ce fichier dans le dossier Userscripts et autorise l'extension sur les deux domaines YouTube.

## Garanties de sécurité

Le script **ne fait aucune requête réseau**, n'exécute **aucun code dynamique**, ne **stocke rien** de façon persistante (seulement un drapeau `reelfree:` dans `sessionStorage`), ne **lit ni ne copie** tes messages, tes identifiants ou tes tokens, et ne **clique jamais à ta place**.
Il n'a **pas de mise à jour automatique**, aucune dépendance et `@grant none`. C'est un fichier unique, lisible et non minifié.
Le modèle de menace complet est dans [docs/SECURITY.md](docs/SECURITY.md).

Ces règles sont vérifiées automatiquement par `bin/verify`, une analyse statique qui sort en échec si une API interdite ou une métadonnée interdite apparaît. Une relecture humaine (T16) est faite avant chaque version.

## Installation sur iPhone (résumé)

Le guide détaillé, avec les libellés exacts d'iOS, est dans **[docs/INSTALL-iOS.md](docs/INSTALL-iOS.md)**.

1. **Prérequis** : iOS 15.4 ou plus récent ([§1](docs/INSTALL-iOS.md#1-prérequis)).
2. **Sur le PC**, vérifie le script : `bin/verify` doit finir par `OK sha256=…`, et l'empreinte doit correspondre à celle de la section [SHA-256](#sha-256) ([§4.1](docs/INSTALL-iOS.md#41-sur-le-pc-obligatoire)).
3. Installe l'app **Userscripts** depuis l'App Store et choisis un dossier de scripts dans « Sur mon iPhone » ([§2.1–2.2](docs/INSTALL-iOS.md#2-installer-et-configurer-userscripts)).
4. Active l'extension dans Safari et **autorise-la uniquement sur `www.instagram.com`** ([§2.3–2.4](docs/INSTALL-iOS.md#23-activer-lextension-dans-safari)).
5. **Transfère** `src/reelfree.user.js` vers ce dossier, via iCloud Drive comme zone de transit puis en supprimant la copie iCloud ([§3](docs/INSTALL-iOS.md#3-transférer-le-fichier-depuis-le-pc-linux)).
6. **Sur l'iPhone**, contrôle l'en-tête du fichier (`@grant none`, pas de `@require` ni de `@updateURL`) et, si possible, son SHA-256 ([§4.2](docs/INSTALL-iOS.md#42-sur-liphone)).
7. Ouvre `https://www.instagram.com` dans Safari, connecte-toi, puis vérifie que l'onglet Reels a disparu.
8. **Bloque l'app Instagram** avec Temps d'écran, avec un code confié à quelqu'un d'autre ([§5](docs/INSTALL-iOS.md#5-bloquer-lapp-instagram-avec-temps-décran)).

Mises à jour : manuelles uniquement. Remplace le fichier, puis refais les étapes 2 et 6 ([§6](docs/INSTALL-iOS.md#6-mises-à-jour)).
En cas de problème, voir le [dépannage](docs/INSTALL-iOS.md#7-dépannage).

## SHA-256

Ces empreintes sont générées par `bin/verify --readme`, qui ne les écrit que si la vérification passe. Pour vérifier sur le PC, depuis la racine du dépôt :

```
bin/verify                                            # doit finir par « OK sha256=… »
sed -n '/sha256:begin/,/sha256:end/p' README.md | grep -E '^[0-9a-f]{64}  ' | sha256sum -c
```

<!-- sha256:begin (généré par bin/verify — ne pas éditer à la main) -->
```
a01a1b20aeac590245821ee0ec9e731deb327c0b3149ef0c86bfc4602fb86f28  src/reelfree.user.js
ce30c1a74f48d6e30c350ae5668701fd2dfcf52c1014230f678c2e424e62b609  src/reelfree-youtube.user.js
```
<!-- sha256:end -->

*(Empreinte provisoire d'une version de développement : elle sera remplacée à la publication de la v0.1.)*

## Structure du dépôt

| Chemin | Contenu |
|---|---|
| `src/reelfree.user.js` | Le userscript Instagram (le seul fichier à installer). |
| `src/reelfree-youtube.user.js` | Bonus YouTube (optionnel). |
| `bin/verify` | Analyse statique, SHA-256 et `--selftest`. |
| `docs/SPEC.md` | Spécification fonctionnelle. |
| `docs/SECURITY.md` | Modèle de menace et contrôles. |
| `docs/INSTALL-iOS.md` | Guide d'installation iPhone. |
| `tests/` | Tests unitaires et E2E (Playwright, WebKit, viewport iPhone 11). |
