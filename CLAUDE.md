# ReelFree — app iOS : Instagram (et YouTube) sans Reels, sans scroll infini

## Mission
Le livrable est une **app iOS native** (SwiftUI + WKWebView), distribuée par **TestFlight** sur le compte Apple Developer d'un ami d'Arthur. Arthur l'installe sur son **iPhone 11**. Chaque build TestFlight expire au bout de 90 jours : la CI en refait un régulièrement.
- Pas de Mac. **Tout ce qui est Swift est compilé et testé sur GitHub Actions (runner macOS).** En local (Linux), on ne peut tester que le JavaScript (Node + Playwright WebKit).
- L'app charge instagram.com (et youtube.com) dans une WKWebView, avec une **garde de navigation native** et un **script injecté** qui masque Reels, Explore et le scroll infini. Les reels reçus en DM restent visibles (docs/SPEC.md, docs/SPEC-iOS.md).
- Référence produit : Relockin et SocialLite, des navigateurs « focus » qui masquent Reels et Shorts.
- Historique : l'approche « userscript Safari » a été abandonnée le 2026-11-02, son code JS est réutilisé dans `web/`. L'archive est dans `archive/` et `board/archive/`.

## Économie d'usage Claude (OBLIGATOIRE)
- **Sous-agents : toujours avec un `model` explicite.**
  - `haiku` pour la recherche, la lecture de fichiers ou de docs, les résumés, les vérifications mécaniques et les greps.
  - `sonnet` pour l'implémentation d'un module bien délimité, l'écriture de tests et les revues.
  - Jamais `opus` en sous-agent.
- Pas plus de 2 sous-agents en parallèle par agent. Donne-leur un brief précis et court, avec la liste des fichiers à lire.
- Pas de relecture inutile de gros fichiers : lis seulement les plages nécessaires.
- Une fois ta tâche finie, mets ton statut à jour et **arrête-toi**. N'attends pas en boucle (pas de polling) : l'orchestrateur te relancera.

## Règles de sécurité (non négociables)
- **Aucun serveur, aucun SDK tiers, aucun analytics, aucune télémétrie.** Les seules connexions réseau sont celles de la WebView vers Instagram, YouTube et leurs CDN.
- **App-Bound Domains** (`WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains`) : la WebView ne navigue et n'injecte que sur les domaines listés. Un lien externe s'ouvre dans Safari (`UIApplication.open`), jamais dans l'app.
- Le script injecté tourne dans un **monde isolé** (`WKContentWorld.defaultClient`), pour que la page Instagram ne puisse ni le lire ni l'altérer. Il ne fait **aucun appel réseau**, n'utilise ni `eval`/`new Function` ni sinks HTML, et ne lit pas le contenu des messages.
- Cookies et session dans `WKWebsiteDataStore.default()`, qui reste local à l'app. L'app ne lit, ne copie et n'exporte jamais les cookies, les identifiants ou le contenu.
- **La garde native décide** de chaque navigation (chargement de document **et** changement d'URL SPA, observé via KVO sur `webView.url`). Le JS est une seconde ligne de défense. Fail-closed : si la décision est incertaine, on masque ou on bloque.
- Le jeton « reel ouvert depuis un DM » vit **côté natif**, en mémoire seulement.
- Pas de secrets dans le dépôt. Les clés App Store Connect vont dans les GitHub Secrets.
- `PrivacyInfo.xcprivacy` déclare l'absence de tracking et de collecte de données.

## Organisation multi-agents (herdr desktop, space « ReelFree »)
| Agent | Rôle | Écrit dans |
|---|---|---|
| `rf-ios` | App Swift : `project.yml` (XcodeGen), SwiftUI, WKWebView, garde native, bridge, réglages, XCTest | `ios/` |
| `rf-web` | Scripts injectés (Instagram et YouTube) adaptés au bridge, correctifs de contournement, tests JS (Node + Playwright) | `web/`, `tests/`, `package.json` |
| `rf-ops` | CI GitHub Actions (build, tests, TestFlight, rebuild périodique), guide pour l'ami (TESTFLIGHT.md), revue de sécurité continue, `bin/verify`, README | `.github/`, `docs/`, `bin/verify`, `README.md` |

Contrat entre agents : **docs/SPEC-iOS.md** (bridge JS↔natif, vecteurs de test partagés `tests/vectors/policy.json`). Pour changer le contrat, passe par une demande à l'orchestrateur dans ton statut.

Protocole :
1. **Tâches** : dans `board/TASKS.md`, passe tes lignes à `[~]` (en cours), `[x]` (fait) ou `[!]` (bloqué, avec la raison). Ne touche pas aux lignes des autres agents.
2. **Statut** : `board/status/<nom>.md`. La 1re ligne est ton statut en une phrase. Mets les demandes aux autres agents sous `## Demandes` (`@rf-xxx — ...`).
3. Écris uniquement dans ton périmètre.
4. Git : pas de commit, pas de push. Arthur ou l'orchestrateur s'en chargent.
5. Code et commentaires en anglais, docs en français.
