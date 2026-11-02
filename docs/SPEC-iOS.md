# Spécification technique — app iOS ReelFree

Les exigences fonctionnelles (R1–R5, D1–D4, S1–S3, X1–X4) sont dans `docs/SPEC.md`. Ce document précise leur réalisation dans l'app native et fixe le **contrat entre `rf-ios` et `rf-web`**.

## Cible
- iOS 17.0 minimum (l'iPhone 11 supporte les versions actuelles). iPhone uniquement, portrait.
- Swift 5.10+, SwiftUI. Projet généré par **XcodeGen** (`ios/project.yml`) : on ne commite pas de `.xcodeproj`.
- Bundle id paramétrable : `PRODUCT_BUNDLE_IDENTIFIER = $(RF_BUNDLE_ID)`, défaut `com.example.reelfree`, surchargé en CI. Même chose pour `DEVELOPMENT_TEAM = $(RF_TEAM_ID)`.

## Structure de l'app
- `TabView` à 2 onglets : **Instagram** (`https://www.instagram.com/`) et **YouTube** (`https://m.youtube.com/`), plus un écran **Réglages**.
- Une `WKWebView` par onglet, avec un `WKWebsiteDataStore.default()` partagé (session persistante et locale).
- `customUserAgent` = UA de Safari iOS (la version doit suivre l'iOS courant), pour qu'Instagram serve la version web mobile normale sans bannière « ouvrir l'app ».
- Barre minimale : retour, accueil, recharger. Pull-to-refresh.
- Liens hors domaines autorisés : `UIApplication.shared.open(url)`, dans Safari.
- Réglages (UserDefaults) : `feedMode` (`limited` | `off`), `feedLimit` (défaut 15), `blockExplore` (défaut true), `ytHideHomeFeed` (défaut false). Les changements sont poussés au JS (voir le bridge).

## Sécurité
- `Info.plist` → `WKAppBoundDomains` : `instagram.com`, `www.instagram.com`, `cdninstagram.com`, `fbcdn.net`, `youtube.com`, `m.youtube.com`, `www.youtube.com`, `ytimg.com`, `googlevideo.com` (au plus 10 entrées). `rf-ios` vérifie que les sous-ressources (CDN) se chargent bien.
- `WKWebViewConfiguration.limitsNavigationsToAppBoundDomains = true`.
- ATS par défaut (pas d'exception). Aucun framework tiers. `PrivacyInfo.xcprivacy` sans tracking.
- Pas de `allowsLinkPreview` vers l'extérieur. Pas de `javaScriptCanOpenWindowsAutomatically`. Un `target=_blank` est rechargé dans la même vue s'il pointe vers un domaine autorisé, sinon il part dans Safari.

## Garde native (autoritaire) — `RoutePolicy.swift`
- C'est une fonction pure `decide(url: URL, ctx: PolicyContext) -> Decision`, **sémantiquement identique** à `decide()` de `web/instagram.js`.
- Elle est validée par les mêmes vecteurs : `tests/vectors/policy.json` (format ci-dessous). Ces vecteurs sont lus par XCTest **et** par les tests Node.
- Elle est appliquée :
  1. dans `webView(_:decidePolicyFor:decisionHandler:)` pour les chargements de document ;
  2. sur **chaque changement de `webView.url`** (KVO), qui couvre les navigations SPA `pushState` : une décision `redirect` déclenche `load(URLRequest(url: to))`, une décision `hide` masque la vue ;
  3. sur le message `route` envoyé par le JS (redondance).
- Le **jeton DM** (D2) est un état natif en mémoire `{ reelId, issuedAt }`, à usage unique, avec un TTL `dmReelTtlMs` (10 s). Il est posé à la réception du message `dmReelOpen` uniquement si l'URL courante de la WebView est un `/direct/t/<id>/`.

## Bridge JS ↔ natif
- Les scripts sont injectés en `WKUserScript(source:, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient)`, dans cet ordre :
  1. un script de config généré par Swift : `window.RF_CONFIG = {...};` (clés de la section Réglages + `platform: "ios-app"`) ;
  2. `web/instagram.js` ou `web/youtube.js` (copiés comme ressources du bundle, sans transformation).
- **JS → natif** : `window.webkit.messageHandlers.reelfree.postMessage(msg)`, enregistré via `add(_:contentWorld: .defaultClient, name: "reelfree")`. Valeurs de `msg` :
  - `{type: "dmReelOpen", id: "<shortcode>"}` : clic sur un reel dans `/direct/t/...` (capture phase, avant la navigation) ;
  - `{type: "route", path: "/..."}` : changement de route vu par le JS ;
  - `{type: "ready", script: "instagram"|"youtube", version: "x.y.z"}` ;
  - `{type: "error", where: "...", message: "..."}` : debug, sans données utilisateur.
  Le natif **valide** chaque message (type connu, `id` qui matche `^[A-Za-z0-9_-]{5,64}$`) et ignore le reste.
- **Natif → JS** : `evaluateJavaScript("window.reelfree && window.reelfree.onNative(<json>)", in: nil, in: .defaultClient)` avec :
  - `{type: "config", config: {...}}` quand un réglage change ;
  - `{type: "dmReelGranted", id}` / `{type: "dmReelDenied", id}`.
- Sans `window.webkit` (tests Node et Playwright), le JS garde son fonctionnement autonome actuel (jeton en `sessionStorage`).

## Vecteurs de test partagés — `tests/vectors/policy.json`
```json
[
  {"name": "R2 reels feed", "path": "/reels/", "ctx": {}, "expect": {"action": "redirect", "to": "/"}},
  {"name": "D2 reel with valid token", "path": "/reel/AbCdE12345/", "ctx": {"token": {"id": "AbCdE12345", "ageMs": 2000}, "lastThread": "/direct/t/123/"}, "expect": {"action": "allow"}}
]
```
- `ctx` utilise des âges relatifs (`ageMs`) plutôt que des horodatages.
- `expect` ne compare que les clés présentes.
- `rf-web` est propriétaire du fichier : il le génère à partir des tests unitaires existants et l'enrichit. `rf-ios` le consomme tel quel.

## CI (rf-ops)
- `ci.yml` (push et PR) :
  - job ubuntu : `npm ci && npm test` puis `bin/verify` ;
  - job `macos-15` : `brew install xcodegen`, `xcodegen`, `xcodebuild build-for-testing test` sur le simulateur iPhone, sans signature.
- `testflight.yml` (`workflow_dispatch`, tags `v*`, et **cron mensuel** pour qu'un build ne dépasse jamais 90 jours) :
  - archive en signature automatique via la clé API App Store Connect (`-allowProvisioningUpdates -authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`) ;
  - `-exportArchive` avec `destination: upload`, `method: app-store-connect` ;
  - `CURRENT_PROJECT_VERSION = ${{ github.run_number }}`.
- Secrets : `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`, `APPLE_TEAM_ID`, `RF_BUNDLE_ID`.

## Avenants au contrat (orchestrateur, 2026-11-02 14:35)
1. **WKAppBoundDomains** : les entrées sont des domaines enregistrables (eTLD+1) et couvrent leurs sous-domaines. Liste retenue : `instagram.com`, `cdninstagram.com`, `fbcdn.net`, `youtube.com`, `ytimg.com`, `googlevideo.com`, `google.com`, `gstatic.com` (connexion YouTube). Les scripts injectés doivent être **no-op** hors de leur hôte : instagram.js seulement sur `*.instagram.com`, youtube.js seulement sur `*.youtube.com`. La garde native ne s'applique qu'à ces hôtes.
2. **Traversée d'historique** : le message `route` porte `via: "popstate"` quand la navigation vient de l'historique. Le natif invalide alors tout jeton DM. Pour un chargement de document, le natif ignore le jeton si `navigationType == .backForward`.
3. **Vecteurs YouTube** : `tests/vectors/youtube.json`, au même format que policy.json, produit par rf-web et consommé par l'XCTest de rf-ios.

## Avenant 4 — routes poussées par le natif, pas de polling JS (D01, 2026-11-02)
- **Natif → JS** : à chaque changement de `webView.url` (KVO : chargement de document **et** pushState/replaceState SPA), le natif envoie `window.reelfree.onNative({type: "route", path, via})` :
  - `path` : `url.path` (chaîne obligatoire, sinon le message est ignoré) ;
  - `via: "popstate"` quand la navigation vient de l'historique (Précédent/Suivant), absent sinon.
- Côté JS, `path` n'est qu'un signal : la décision relit toujours `window.location`. Avec `via: "popstate"`, la route est traitée comme une traversée d'historique (le jeton DM local est consommé sans admettre de média, comme pour l'avenant 2).
- **En mode app, instagram.js et youtube.js n'ont plus aucun `setInterval`.** Les routes viennent du natif, de `popstate`, des hooks d'historique et d'une passe de mutation. Le polling de 250 ms ne reste qu'en mode autonome.
- Le JS continue d'envoyer `{type: "route", ...}` au natif quand il détecte un changement : le natif peut recevoir un doublon de sa propre notification, sans conséquence.
- Perf (contraintes testées) : aucun `:has()` dans le CSS injecté (les conteneurs sont marqués par JS : `data-reelfree-reel`, `data-reelfree-ad`, `data-reelfree-nav`, `data-reelfree-shorts`). Le MutationObserver traite seulement les nœuds ajoutés et les liens réécrits, une fois par frame (rAF, avec repli par minuterie de 100 ms). Un scan complet n'a lieu qu'au changement de route ou de réglages.

## Avenant 5 — `youtube-ads.js` dans le monde `.page` (D05, 2026-11-02)
- **Seule exception au monde isolé.** `web/youtube-ads.js` est injecté dans l'onglet YouTube seulement, au document-start, frame principale seulement, dans `WKContentWorld.page`. C'est nécessaire parce que les données du lecteur (`ytInitialPlayerResponse`, `fetch`, `JSON.parse` de la page) n'existent que dans le monde de la page.
- **Sans bridge** : aucun message handler n'est déclaré dans `.page`. Le script ne touche pas à `window.webkit`, n'envoie rien au natif et ne reçoit rien (ni `RF_CONFIG`, ni `onNative`).
- **Sans pouvoir** :
  - aucune requête réseau propre : il ne fait que filtrer les réponses demandées par la page (`fetch` vers `/youtubei/v1/player`, et `JSON.parse` pour la voie XHR) ;
  - aucune lecture de données utilisateur : il supprime seulement `adPlacements`, `playerAds` et `adSlots` à des chemins fixes (racine et `playerResponse`) ;
  - pas de stockage, pas de cookies, pas de code dynamique, pas de sink HTML, pas de global exposé ;
  - no-op hors de `*.youtube.com`.
  En cas d'erreur, la valeur d'origine est rendue telle quelle.
- La page peut voir ou défaire ce script : c'est accepté, car il ne porte **aucune protection ReelFree**. Shorts, garde de route, masque et repli anti-pub restent dans `youtube.js`, en monde isolé.
- **Repli dans `youtube.js`** (monde isolé, pas de minuterie) :
  - quand le lecteur a la classe `.ad-showing`, la vidéo est coupée, positionnée à sa fin, et le bouton « Ignorer » est cliqué s'il existe ;
  - l'état muet d'origine est rétabli à la fin de la pub ;
  - les encarts sponsorisés (`*-ad-slot-renderer`, `*-promoted-*`, `*-in-feed-ad-layout-renderer`, etc.) et les éléments de fil qui les contiennent (`data-reelfree-ad`) sont masqués.
- Tests : `tests/unit/youtube-ads.test.js` (prune et garanties statiques de la source) et `tests/e2e/youtube-ads.spec.mjs` (page synthétique `tests/e2e/pages/yt-watch.html`).
