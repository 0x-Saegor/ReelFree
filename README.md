# ReelFree

**App iOS qui ouvre Instagram (et YouTube) sans Reels, sans Explore et sans scroll infini.**
Les reels qu'on t'envoie en message restent visibles. L'app est distribuée par TestFlight et n'est pas publiée sur l'App Store.

> État : en développement. Voir [board/TASKS.md](board/TASKS.md).

## Ce que fait l'app

| | Comportement |
|---|---|
| **Reels** | L'onglet Reels disparaît. `/reels/`, `/reel/<id>` et `/tv/<id>` ouverts hors message renvoient vers l'accueil, et la page reste masquée pendant la redirection. Les reels du fil sont masqués. |
| **Explore** | La grille Explore est interdite. La recherche de comptes reste utilisable. |
| **Reels reçus en message** | Un reel partagé dans une conversation s'ouvre, mais seulement depuis un tap dans `/direct/`, et pour ce reel-là uniquement (jeton à usage unique, valable 10 s). Impossible d'enchaîner sur le reel suivant. Un bouton « ← Retour à la conversation » s'affiche. |
| **Fil d'accueil** | Plafonné à 15 posts (réglable), puis « Tu es à jour ✓ ». Option pour masquer complètement le fil. Stories, messages, profil et notifications restent disponibles. |
| **YouTube** | Les Shorts sont masqués, et `/shorts/<id>` s'ouvre en vidéo classique. Option pour masquer les recommandations de l'accueil. |
| **Liens externes** | Ils s'ouvrent dans Safari, jamais dans l'app. |
| **Par défaut** | Si l'app ne sait pas trancher, elle masque ou bloque (*fail-closed*). |

La spécification fonctionnelle est dans [docs/SPEC.md](docs/SPEC.md), la spécification technique dans [docs/SPEC-iOS.md](docs/SPEC-iOS.md).

## Architecture

```
ios/            App SwiftUI (projet XcodeGen : ios/project.yml, pas de .xcodeproj commité)
  ReelFree/Web/     WKWebView par onglet, garde de navigation native, bridge JS ↔ natif
  ReelFree/Policy/  RoutePolicy.swift : decide(url) → allow / redirect / hide (port de decide() JS)
  ReelFreeTests/    XCTest, dont les vecteurs partagés tests/vectors/policy.json
web/            Scripts injectés dans la WebView (instagram.js, youtube.js)
tests/          Tests JS : unitaires (node:test), E2E Playwright WebKit (iPhone 11), vecteurs partagés
bin/verify      Contrôle statique de sécurité (JS + Swift + config + secrets)
.github/        CI (ci.yml) et publication TestFlight (testflight.yml)
docs/           Specs, sécurité, guide TestFlight
```

Deux couches de défense :
1. **La garde native** décide de chaque navigation, qu'il s'agisse d'un chargement de document (`decidePolicyFor`) ou d'un changement d'URL SPA (KVO sur `webView.url`). Elle redirige ou masque la vue.
2. **Le script injecté** (monde isolé `WKContentWorld.defaultClient`, au `document-start`) masque les éléments dans la page : onglet Reels, reels du fil, plafond du fil, blocage du swipe. Il communique avec le natif via le handler `reelfree`.

## Sécurité

- Aucun serveur, aucun SDK tiers, aucun analytics, aucune télémétrie. Les seules connexions sont celles de la WebView vers Instagram, YouTube et leurs CDN.
- **App-Bound Domains** : la WebView ne navigue que sur la liste de domaines déclarée. ATS reste sans exception.
- L'app ne lit, ne copie et n'exporte jamais les cookies, les identifiants ou le contenu des messages. La session reste dans le conteneur de l'app.
- `PrivacyInfo.xcprivacy` : pas de tracking, aucune donnée collectée.
- Chaque build passe `bin/verify` (98 règles avec self-test) et les tests avant toute publication.

Le modèle de menace complet et l'état de la revue sont dans [docs/SECURITY.md](docs/SECURITY.md).

## Développer

Il n'y a pas de Mac : **le Swift est compilé et testé uniquement sur GitHub Actions** (runner `macos-15`). En local (Linux), on teste le JavaScript :

```sh
npm ci
npm run setup        # Playwright WebKit (+ bibliothèques manquantes, sans sudo)
npm test             # tests unitaires et E2E, résumé dans board/last-test.txt
bin/verify           # contrôle statique : doit finir par « OK ... »
bin/verify --selftest
```

## Builds

| Workflow | Déclencheur | Ce qu'il fait |
|---|---|---|
| `ci.yml` | push, PR | Ubuntu : `npm test` et `bin/verify`. macOS 15 : `xcodegen`, build et XCTest sur simulateur iPhone, sans signature. |
| `testflight.yml` | manuel, tag `v*`, **le 1er de chaque mois** | Rejoue `ci.yml`, puis archive en signature automatique (clé API App Store Connect) et envoie sur TestFlight. Le numéro de build est le `run_number`. |

Un build TestFlight expire au bout de 90 jours : le cron mensuel en refait un.
Configuration côté Apple (bundle id, fiche d'app, clé API, secrets GitHub, testeur interne) : [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).

## Historique

Le projet a d'abord été un userscript Safari (app *Userscripts*). Cette approche a été abandonnée le 2026-11-02 au profit de l'app. Son code JS est réutilisé dans `web/`, et l'ancienne documentation est archivée dans [archive/safari-userscript/](archive/safari-userscript/).
