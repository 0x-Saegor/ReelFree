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
