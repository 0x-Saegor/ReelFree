# Sécurité — ReelFree (app iOS)

Document maintenu par `rf-ops`. Il couvre l'app iOS (`ios/`), les scripts injectés (`web/instagram.js` et `web/youtube.js` en monde isolé, `web/youtube-ads.js` en monde `.page`), le bloqueur de pubs natif (`ios/ReelFree/Resources/adblock-rules.json`) et la chaîne de build et de distribution (GitHub Actions vers TestFlight).
Règles de référence : `CLAUDE.md`, section « Règles de sécurité ». En cas de conflit, `CLAUDE.md` prévaut.
L'ancien modèle de menace, celui du userscript Safari, est archivé dans `archive/safari-userscript/SECURITY-userscript.md`.

## 1. Périmètre et actifs

| Actif | Pourquoi il compte | Exposition |
|---|---|---|
| Session Instagram et YouTube (cookies dans `WKWebsiteDataStore.default()`) | Qui la détient contrôle le compte | Les cookies sont stockés dans le conteneur de l'app. Le code natif **pourrait** les lire (`httpCookieStore`), ce qui est interdit et vérifié. Le script injecté tourne dans un monde isolé, mais il partage le DOM avec la page. |
| Contenu des DM | Données personnelles de tiers | Le contenu est visible dans le DOM de `/direct/`, où le script agit pour poser le jeton D2. |
| Compte Instagram de l'utilisateur | Risque de ban en cas de comportement automatisé | Toute action faite au nom de l'utilisateur engage le compte. |
| Compte Apple Developer de l'ami | Clé API **Admin**, certificat de distribution | La clé est dans les secrets GitHub (environnement `testflight`). |
| Intégrité du binaire | Un binaire altéré hérite de tous les accès ci-dessus | Chaîne : dépôt, puis GitHub Actions, puis App Store Connect, puis TestFlight. |

**Hors périmètre** : la sécurité d'Instagram, d'iOS et de WebKit, et la volonté de l'utilisateur de contourner son propre blocage (voir T7).

## 2. Modèle de menace

Échelle : impact et probabilité, chacun **Faible**, **Moyen** ou **Élevé**.

### T1 — Supply chain et build
| Sous-menace | Impact | Proba. | Contrôles |
|---|---|---|---|
| T1.a Dépendance tierce (SPM, CocoaPods, Carthage, binaire) | Élevé | Nulle si la règle tient | Aucune dépendance. `bin/verify` refuse `packages:`, `- package:`, `- framework:`, les dossiers `Pods`, `Carthage` et `*.xcframework`, les `Package.swift`, `Podfile` et `Cartfile`, les `.a`/`.dylib`, et tout `import` hors de la liste blanche (SwiftUI, UIKit, WebKit, Foundation, Combine, os, OSLog, Observation, XCTest). |
| T1.b Script de build qui télécharge du code | Élevé | Faible | `bin/verify` refuse `curl`, `wget`, `git clone`, `npm install`, `pip install` et `brew install` dans `ios/*.yml`. En CI, seul `xcodegen` est installé via Homebrew, sur le runner et non dans l'app. |
| T1.c Actions GitHub compromises | Élevé | Faible | Uniquement les actions officielles `actions/*`, épinglées par version majeure (`checkout@v5`, `setup-node@v5`, `upload-artifact@v6`, toutes en Node 24). `permissions: contents: read`. `persist-credentials: false`. Les secrets ne sont exposés qu'aux étapes qui en ont besoin. |
| T1.d Compromission du dépôt ou de l'agent | Élevé | Faible | Les agents ne commitent pas : le mainteneur relit et commite. `bin/verify` est bloquant en CI, avant toute archive. TestFlight dépend de `ci.yml` (`needs: tests`). |
| T1.e Dépendances npm | Moyen | Faible | Elles ne servent qu'aux tests (Playwright) et ne sont **jamais** embarquées. `npm ci --ignore-scripts`. |

### T2 — Exfiltration
**Scénario** : l'app ou le script envoie cookies, tokens ou contenu de DM vers un tiers.
**Contrôles** :
- **natif** : aucune pile réseau hors WebView (`URLSession`, `NSURLConnection`, CFNetwork, Network.framework et `contentsOf: URL(string:)` sont refusés par `bin/verify`), aucun SDK d'analytics ou de pub, pas d'IDFA ni d'IDFV ;
- **WebView** : App-Bound Domains (`WKAppBoundDomains` limité aux 8 domaines enregistrables de l'avenant 1 de `docs/SPEC-iOS.md` : `instagram.com`, `cdninstagram.com`, `fbcdn.net`, `youtube.com`, `ytimg.com`, `googlevideo.com`, `google.com`, `gstatic.com`. Chaque entrée couvre ses sous-domaines. Côté natif, seuls `accounts.google.com` et `consent.google.com` se chargent dans l'app, pour la connexion YouTube ; le reste de `google.com` part dans Safari), `limitsNavigationsToAppBoundDomains = true`, ATS sans aucune exception ;
- **script** : aucune API réseau, aucune URL absolue hors du domaine du script, un seul canal de sortie, le handler `reelfree` (voir T4) ;
- **données** : l'app ne lit, ne copie et n'exporte jamais les cookies (`httpCookieStore`, `HTTPCookieStorage` et `HTTPCookie` sont refusés), n'accède ni au presse-papiers ni au trousseau.

### T3 — Injection (page vers script, page vers natif)
**Scénario** : le JS d'Instagram (ou un contenu piégé) lit ou modifie le script injecté, ou envoie de faux messages au natif.
**Contrôles** :
- le script tourne dans `WKContentWorld.defaultClient`, invisible pour le JS de la page. `bin/verify` exige `in: .defaultClient` sur chaque `WKUserScript`, `evaluateJavaScript` et `callAsyncJavaScript`, `contentWorld: .defaultClient` sur le handler, et `forMainFrameOnly: true` ; il refuse `.page` ;
- le handler `reelfree` n'est enregistré que dans `.defaultClient` : la page ne peut pas poster dessus ;
- le natif **valide** chaque message (type connu, `id` conforme à `^[A-Za-z0-9_-]{5,64}$`, frame principale) et ignore le reste ;
- natif vers JS : le message est sérialisé avec `JSONSerialization`, jamais par interpolation de chaînes ;
- dans le script, pas de sink HTML ni de code dynamique (règles `bin/verify` reprises du userscript, § 3).

### T4 — Contournement de la garde par la page
**Scénario** : Instagram navigue vers `/reels/` en SPA (`pushState`), ouvre une popup ou une iframe, ou le script plante.
**Contrôles** :
- **la garde native décide** : `decidePolicyFor` pour les chargements de document, KVO sur `webView.url` pour les changements SPA, plus le message `route` en redondance ;
- **fail-closed** : URL ou hôte absent, schéma autre que `https`, décision inconnue : on bloque ou on masque ;
- `javaScriptCanOpenWindowsAutomatically = false`. Un `target=_blank` est rechargé dans la même vue s'il pointe vers un domaine autorisé, sinon il part dans Safari ;
- **jeton DM** (D2) côté natif, en mémoire, à usage unique, avec un TTL de 10 s, émis seulement si l'URL courante est `/direct/t/<id>/` ;
- si le script plante, la garde native continue de bloquer `/reels/` et `/explore/`. Seuls le plafond du fil (S1) et le masquage dans la page sont perdus.

### T5 — Ban du compte
Inchangé par rapport au userscript : le script **n'agit jamais au nom de l'utilisateur**. Pas de requête, pas de clic synthétique, pas d'appel aux API internes. Il masque, bloque des événements de l'utilisateur et redirige. L'UA est celui de Safari iOS, sans marqueur.

### T6 — Vie privée
- `PrivacyInfo.xcprivacy` : `NSPrivacyTracking = false`, aucun domaine de tracking, aucune donnée collectée (vérifié par `bin/verify`). Les API à raison déclarée (« required reason API », par exemple `UserDefaults`) sont déclarées avec leur raison.
- `UserDefaults` ne contient que les réglages. Pas de journal d'URL ni de contenu (`os_log` sans URL complète).
- Le jeton DM du script est en mémoire en mode app. Quelques compteurs `reelfree:` restent en `sessionStorage` (F6, à corriger).

### T7 — Contournement volontaire par l'utilisateur
| Scénario | Contrôle |
|---|---|
| Ouvrir l'app Instagram ou Safari | Hors app. Temps d'écran bloque l'app Instagram et `instagram.com` dans Safari, avec un code confié à un tiers. |
| Taper une URL interdite | L'app n'a pas de barre d'adresse. La garde native redirige. |
| Lien externe vers un reel | Il s'ouvre dans Safari, où Temps d'écran le bloque. |
| Supprimer l'app | Hors périmètre technique. |

### T8 — Distribution (clé API, TestFlight)
| Risque | Contrôles |
|---|---|
| Fuite de la clé `.p8` (Admin sur le compte de l'ami) | Elle vit uniquement dans les secrets de l'environnement GitHub `testflight`, limité à la branche principale et aux tags `v*`. Écrite dans `$RUNNER_TEMP` en `umask 077`, effacée en fin de job (`if: always()`). Jamais affichée. Les PR de forks n'ont pas accès aux secrets. `bin/verify` refuse tout `.p8`, `.p12`, `.mobileprovision`, `.cer`, `.pem` ou bloc `PRIVATE KEY` dans le dépôt. Révocation documentée dans `docs/TESTFLIGHT.md` § 8. |
| Build envoyé sans tests | `testflight.yml` dépend de `ci.yml` (JS, `bin/verify`, XCTest). |
| Build expiré (90 jours) | Cron mensuel. Le dépôt est public : GitHub désactive le cron après 60 jours sans commit. Il faut alors le réactiver (`docs/TESTFLIGHT.md` § 7). |
| Logs publics (dépôt public) | L'archive et l'export écrivent dans un fichier temporaire. Seules les lignes d'erreur sont affichées, sans les lignes `Apple Distribution:` qui contiennent le nom réel du titulaire. Aucun artefact de l'archive n'est publié. Logs effacés en fin de job. Aucun email, nom réel ou donnée Instagram dans le dépôt (règle `CLAUDE.md`). |

### T9 — Monde `.page` et bloqueur de pubs (D04, D05, avenant 5)
`web/youtube-ads.js` est la **seule** exception au monde isolé. Il tourne à côté du code de YouTube, qui peut le lire, le remplacer ou le défaire.
| Risque | Contrôles |
|---|---|
| La page atteint le bridge via le script `.page` | Aucun message handler dans `.page` : le seul `add(…, contentWorld: .defaultClient, name: "reelfree")` est vérifié par `bin/verify`. Le script ne nomme ni `webkit`, ni `messageHandlers`, ni `RF_CONFIG`, ni `onNative` (règle `page:bridge`). Il n'émet aucun événement et n'en écoute aucun (`page:events`), et ne fait pas de `postMessage` : il n'existe aucun canal vers `youtube.js`. |
| Le script `.page` sert de relais réseau ou d'exfiltration | Le seul appel au `fetch` de la page est `origFetch.apply(this, arguments)`, qui transmet les arguments de la page sans rien y ajouter (`page:fetch-call`). Pas de `fetch(` direct, pas de `new Request`, pas de XHR et **aucune** URL littérale. Il ne lit ni stockage ni DOM, n'a pas de minuterie et ne navigue pas (`page:storage`, `page:dom`, `page:timer`, `page:navigation`). |
| Le script `.page` pollue la page ou expose un global | Un seul IIFE en mode strict (`page:iife`). Le seul global réassigné est `window.fetch` ; `JSON.parse` est enveloppé ; `defineProperty` n'est permis que sur `window` (piège de `ytInitialPlayerResponse`) ; pas de `__proto__`, pas de `setPrototypeOf`, pas d'affectation dans un `prototype` (`page:global`, `page:define`). Les suppressions portent sur trois clés fixes, en propriété propre. |
| Le script `.page` agit hors YouTube ou dans des frames | Swift : un seul `WKUserScript` en `.page`, dans `WebTab.swift`, sous la forme exacte `source: page, .atDocumentStart, forMainFrameOnly: true, in: .page`. `pageScriptResource` vaut `nil` pour Instagram et `"youtube-ads"` pour YouTube. JS : garde `if (!hostAllowed(window.location.hostname)) return;` avec `/(^|\.)youtube\.com$/` (`page:host-guard`, `page:host-regex`). Une page de connexion `accounts.google.com` dans l'onglet YouTube n'exécute donc rien. |
| Une protection ReelFree dépend du monde `.page` | Aucune : la garde de route, le masque, les Shorts et le repli anti-pub sont natifs ou dans `youtube.js` (isolé). Si la page défait `youtube-ads.js`, seules les pubs reviennent. |
| Règles de blocage téléchargées ou détournées | Le JSON est embarqué. `AdBlocker` le lit dans le bundle et le compile avec `WKContentRuleListStore`, sans aucune API réseau (règles `net:*` Swift). `bin/verify` accepte seulement les actions `block` et `css-display-none` (ni `ignore-previous-rules`, ni `make-https`, ni action inconnue). Chaque règle doit avoir un `url-filter`. |
| Règle qui casse la connexion ou la lecture | `bin/verify` (`adblock:breaks-core`) refuse toute règle `block` qui correspond à une URL cœur : document Instagram ou YouTube, `/youtubei/v1/player`, `googlevideo.com/videoplayback`, `ytimg`, `cdninstagram`, `fbcdn`, `accounts.google.com`, `gstatic`. La compilation des règles est testée par XCTest (`AdBlockRulesTests`). |
| Ressource web non vérifiée embarquée | `project.yml` ne peut référencer que `web/instagram.js`, `web/youtube.js` et `web/youtube-ads.js` (`build:web-resource`). Tout autre script dans `web/` fait échouer `bin/verify`. La CI vérifie que l'`.app` contient ces trois scripts, identiques à `web/`, ainsi que `adblock-rules.json` et `PrivacyInfo.xcprivacy`. |

## 3. Contrôles automatiques — `bin/verify`

`bin/verify` sans argument vérifie tout et sort avec `OK instagram=… youtube=… youtube-ads=… swift=N` ou `FAIL <raison>`. `--js` et `--swift` restreignent le périmètre. `--selftest` vérifie que chaque règle attrape un échantillon fautif (142 cas). Le scan est brut : commentaires compris.

| Zone | Refusé |
|---|---|
| JS : réseau | `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, WebRTC, workers, `window.open`, formulaires, éléments chargeant une ressource, `src=`, `url(` en CSS, URL absolue hors domaine du script |
| JS : bridge | tout `postMessage` sauf `window.webkit.messageHandlers.reelfree.postMessage(` écrit en toutes lettres ; tout autre handler ; accès indexé `messageHandlers[` ou `webkit[` |
| JS : code | `eval`, `Function(`, `.constructor(`, timers avec une chaîne, `import`/`require`, sinks HTML, obfuscation (`atob`, `fromCharCode`, `\xNN`…), accès indexé aux globaux |
| JS : stockage | `localStorage`, IndexedDB, caches, cookies, `sessionStorage` en masse ou sous une clé non préfixée `reelfree:` |
| JS : texte | erreur de syntaxe (fail-open), caractères bidi ou invisibles, lignes de plus de 400 caractères |
| JS monde `.page` (`youtube-ads.js`, en plus des règles ci-dessus) | toute mention de `webkit`, `messageHandlers`, `RF_CONFIG`, `onNative` ou `reelfree.` dans le code (même sans `postMessage`) ; tout `sessionStorage` ; DOM (`document.`, `querySelector`, `getElement*`, `MutationObserver`, `.click(`) ; événements (`addEventListener`, `dispatchEvent`, `CustomEvent`, `MessageChannel`, `BroadcastChannel`) ; minuteries et rAF ; navigation (`location.* =`, `assign`, `replace`, `reload`, `history.`) ; `globalThis`, `window.x =` sauf `window.fetch = wrapped` ; `defineProperty` hors `(window, name, …)`, `__proto__`, `setPrototypeOf`, `prototype.x =` ; appel de `origFetch` autre que `.apply(this, arguments)` ; `new Request` ; toute URL littérale. Obligatoires : un seul IIFE en `'use strict'`, la garde d'hôte et la regex `youtube.com`. |
| Swift : réseau | `URLSession*`, `NSURLConnection`, CFNetwork, `NW*`, `contentsOf: URL(string:`, gestion de challenge TLS (`serverTrust`, `URLAuthenticationChallenge`) |
| Swift : WebView | `limitsNavigationsToAppBoundDomains = false` ou absence de `= true` ; monde `.page`, sauf le seul `WKUserScript` de `youtube-ads.js` décrit en T9 ; `pageScriptResource` autre que `nil` (Instagram) ou `"youtube-ads"` ; `WKUserScript`, `evaluateJavaScript` ou handler sans `.defaultClient` ; `forMainFrameOnly` absent ou `false` ; popups automatiques ; `allowsLinkPreview = true` |
| Swift : données | cookies, `UIPasteboard`, trousseau, IDFA/IDFV, SDK de tracking connus, `dlopen`, `NSClassFromString` |
| Swift : dépendances | `import` hors liste blanche, SPM, Pods, Carthage, frameworks binaires |
| Config | exceptions ATS (Info.plist ou `project.yml`), `WKAppBoundDomains` absent, vide, de plus de 10 entrées ou hors liste, `PrivacyInfo.xcprivacy` absent, avec tracking, ou avec données collectées |
| Bloqueur (`ios/**/*rules*.json`) | JSON invalide ou vide, action autre que `block` ou `css-display-none`, règle sans `url-filter`, règle `block` qui correspond à une URL cœur (T9) |
| Ressources | `project.yml` qui référence un fichier de `web/` autre que les trois scripts vérifiés ; tout autre script dans `web/` |
| Dépôt | clés, certificats, profils, blocs `PRIVATE KEY` |

Le scan est un filet, pas une preuve : il n'attrape pas toutes les formes d'obfuscation. La revue manuelle (§ 4) reste obligatoire.

## 4. Revue avant chaque build TestFlight publié

1. `bin/verify` sort en `OK` et la CI (`ci.yml`) est verte.
2. Relire le diff depuis le dernier tag : `git diff <tag> -- ios/ web/ .github/`. S'arrêter sur ce qui touche au réseau, aux mondes JS, au bridge, à la garde, aux domaines, aux entitlements et aux workflows.
3. Vérifier à la main ce que le grep ne voit pas : validation des messages du bridge (frame principale, regex), JSON natif vers JS sérialisé proprement, jeton DM en mémoire seulement, aucune journalisation d'URL complète ni de contenu, aucune action au nom de l'utilisateur dans le script.
4. Taguer `vX.Y.Z` : la CI construit et envoie.

## 5. État de la revue (B05)

La revue préliminaire (R1–R8) a été faite plus tôt le même jour, sur du code partiel. La revue finale est ci-dessous. Toute nouvelle version suit la procédure du § 4.

<!-- review:begin -->
**Revue finale du 2026-11-02 : aucun constat majeur. Le 1er build TestFlight (C03) n'est pas bloqué.**
Elle porte sur le code après les avenants 1 à 3 et les corrections de R1 à R6, avec deux relectures indépendantes : natif d'une part, scripts injectés et workflows d'autre part. `bin/verify` donne OK (self-test 98/98).

Suivi de la revue préliminaire :

| # | Statut |
|---|---|
| R1, R3 | Corrigés. Nouvelle fenêtre, `createWebViewWith` et shim `l.instagram.com` n'ouvrent Safari que si `navigationType == .linkActivated`, et seulement en http(s). |
| R2 | Corrigé. Les sous-frames sont limitées à `about:blank`, `about:srcdoc` et https sur les domaines du site. |
| R4, R5, R6 | Corrigés : `isInspectable = false`, réponse annulée si `!canShowMIMEType`, masquage synchrone dans le KVO. |
| R7 | Traité par l'avenant 1. `google.com` et `gstatic.com` sont app-bound, mais seuls `accounts.google.com` et `consent.google.com` s'affichent dans l'app. Le reste de `google.com` part dans Safari, donc pas de `/search`, `/amp` ou `/url?q=` dans l'app. Le bridge reste refusé depuis Google. |
| R8 | Rejeté à raison. `SWIFT_VERSION` désigne le mode de langage et n'accepte que 4, 4.2, 5 ou 6. Le compilateur reste Swift 5.10+ (Xcode 16). |

Constats mineurs (notés, non bloquants) :

| # | Où | Constat | Suite |
|---|---|---|---|
| F1 | `WebTab.swift`, `evaluateCurrentURL` | URL nulle : retour sans masquer, ce qui n'est pas strictement fail-closed. | rf-ios : masquer, sauf pour le `about:blank` initial. |
| F2 | `WebTab.swift`, KVO puis message `route` | Lors d'une traversée SPA, le KVO évalue la nouvelle URL avant l'arrivée de `via:"popstate"` : le jeton DM est encore valide à ce moment-là. | Accepté : jeton à usage unique, 10 s, consommé par le premier reel admis. |
| F3 | `WebTab.swift`, ouverture dans Safari | `.linkActivated` est aussi produit par un `a.click()` scripté, donc la page peut ouvrir Safari sans tap réel. `UIApplication.open` suit aussi les liens universels : un lien instagram.com ouvert depuis YouTube lance l'app Instagram. | Accepté : http(s) seulement, et l'app Instagram est bloquée par Temps d'écran (T7). |
| F4 | `Site.swift`, sous-frames | Une sous-frame peut charger n'importe quel chemin de `instagram.com` ou `google.com` (`/reel/<id>/embed`…). Seule la page peut la déclencher, et la frame principale reste gardée. | rf-ios, optionnel : limiter les sous-frames Google à `accounts.`, `consent.` et `www.google.com/recaptcha`. |
| F5 | `ios/ReelFreeTests` | Pas de test de `Site.host(isIn:)` (frontière de label, point final, `evilinstagram.com`), ni de `isAuxiliaryURL`. | rf-ios : environ 6 XCTests pour figer l'avenant 1. |
| F6 | `web/instagram.js` (`VARIANT_KEY`, `FEED_COUNT_KEY`, `FEED_SEEN_KEY`), `web/youtube.js` (`SHORTS_LOOP_KEY`) | En mode app, ces clés `reelfree:` sont encore écrites en `sessionStorage`, lisible par la page. Elles ne contiennent que des compteurs et des ids. | rf-web : les garder en mémoire quand le bridge est présent. |
| F7 | `testflight.yml` | `environment: testflight` sans relecteurs : toute personne ayant le droit d'écriture peut pousser un tag `v*` et utiliser la clé. | Accepté : le dépôt n'a qu'un mainteneur. Restriction aux branches et tags documentée (`docs/TESTFLIGHT.md` § 4). Des relecteurs obligatoires bloqueraient le cron. |
| F8 | workflows | Actions épinglées par version majeure, pas par SHA. | Accepté : actions officielles `actions/*` uniquement. |
| F9 | `ci.yml` | Un échec de `build-for-testing` était masqué par `\|\| true` et `PIPESTATUS`. | **Corrigé** (rf-ops) : `\|\| rc=$?`, puis `exit $rc`. |
| F10 | `testflight.yml` | Le filtre des logs publics était une liste d'exclusion. | **Corrigé** (rf-ops) : liste blanche (`** … **`, `error:`) et masquage des chaînes entre guillemets, des parenthèses et des noms d'identité ou d'équipe. |

Points vérifiés et conformes :
- **Garde native :** fail-closed. `decidePolicyFor`, KVO et `route` sont tous branchés. Correspondance d'hôte stricte (`h == d || hasSuffix("." + d)`, https). Jeton DM en mémoire, à usage unique, TTL de 10 s, invalidé sur `.backForward` et sur `popstate` (avenant 2).
- **Bridge :** type en liste blanche, regex de l'id, frame principale en https sur le site. JSON construit avec `JSONSerialization`. `onNative` gelé et exécuté dans `.defaultClient`. `RF_CONFIG` validé (liste blanche de clés, types, bornes).
- **Scripts :** no-op hors de leur hôte (`/(^|\.)instagram\.com$/`), vérifié avant tout effet. Aucun réseau, aucun clic synthétique, aucun sink HTML. Le message `error` ne contient que le nom de l'erreur. Dans `/direct/`, seuls `href`, `role` et `aria` sont lus.
- **Données et workflows :** aucun accès aux cookies, aucune journalisation, `UserDefaults` limité à 4 réglages. Pas de permission caméra ni micro. Pas d'interpolation `${{ github.event.* }}` dans les `run:`. Secrets limités aux étapes qui en ont besoin. `.p8` en `umask 077`, effacée en fin de job.
<!-- review:end -->

## 5 bis. Revue D06 — bloqueur natif (D04) et monde `.page` (D05), 2026-11-02

<!-- review-d06:begin -->
**Aucun constat majeur. L'exception du monde `.page` est acceptée dans les limites de T9.**
La revue porte sur le diff non poussé après les avenants 4 et 5 et D07 : `ios/` (WebTab, RouteVia, AdBlock, ContentView, project.yml), `web/youtube-ads.js`, et les diffs de `web/instagram.js` et `web/youtube.js`. Elle combine une relecture rf-ops (natif, règles, workflows) et une relecture indépendante des scripts par un sous-agent. Résultats : `bin/verify` OK (`swift=16`), self-test 142/142, `npm test` 394/394. Dernière CI poussée (0254087) verte, avec un artefact IPA de 122 Ko. Le diff local n'est pas encore passé en CI.

Points vérifiés et conformes :
- **Monde `.page`** : script injecté uniquement dans l'onglet YouTube, au document-start, dans la frame principale. Aucun handler ni `evaluateJavaScript` en `.page`. Le script `.page` est facultatif : s'il manque, l'app fonctionne sans lui, et `youtube.js` (isolé) reste obligatoire (fail-closed).
- **youtube-ads.js** : aucune requête propre, aucune URL, aucun stockage, aucun DOM, aucun global hors `fetch` et `JSON.parse`. Ses suppressions portent sur 3 clés fixes, en propriété propre, donc pas de pollution de prototype. Garde d'hôte correcte (`notyoutube.com` refusé).
- **Bloqueur** : 14 règles, toutes `block`, JSON embarqué, compilé hors du chemin de lancement. Aucune ne touche une URL cœur. Identifiant de store dérivé d'une empreinte FNV-1a, sans valeur de sécurité (cache seulement).
- **Avenant 4** : `onNative({type:"route"})` est envoyé par `evaluateJavaScript(…, in: .defaultClient)`, que la page ne peut pas forger. Le JS relit toujours `window.location`. `via:"popstate"` consomme le jeton DM sans admettre de média (fail-closed). Côté natif, `.backForward` et le bouton Précédent annulent le jeton. Plus de `setInterval` en mode app.
- **D07** : le mode immersif ne change ni la garde ni le masque. Le geste de retour passe par `decidePolicyFor`/KVO comme une traversée d'historique. `ReelFreeWebView` force des safe-area nulles (affichage seulement). Le tap observé sur la page ne fait que masquer les barres.

Constats mineurs (notés, non bloquants) :

| # | Où | Constat | Suite |
|---|---|---|---|
| G1 | `web/youtube-ads.js`, enveloppe `fetch` (`.then` de `json()`) | Une exception dans le callback de succès (`JSON.stringify` ou `new Response`) n'est pas rattrapée : la promesse rejette au lieu de rendre `res`, contrairement à l'avenant 5 (« la valeur d'origine est rendue telle quelle »). Effet possible : le lecteur ne charge pas. | rf-web : mettre le corps du callback dans un `try/catch` qui rend `res`, et ajouter un test. |
| G2 | `web/instagram.js` (`scanArticle`), `web/youtube.js` (`scanLabel`, `scanContainer`) | Depuis D01, le masquage des conteneurs dépend d'attributs `data-reelfree-*`. Les observers ne surveillent pas ces attributs : si la page les retire d'un nœud recyclé, le conteneur réapparaît jusqu'au prochain scan de ce nœud. Les liens directs vers un reel ou un Short restent masqués par leurs propres règles. | rf-web : ajouter `data-reelfree-reel`, `-shorts` et `-nav` à `attributeFilter` et remarquer le nœud quand ils sont retirés. Sinon, documenter ce risque comme accepté dans la spec. |
| G3 | `web/youtube.js`, `skipAd` | Le repli se fie à `.ad-showing` (contrôlé par la page). Une classe restée en place pourrait couper le son de la vraie vidéo et la mettre à sa fin, et le clic vise tout élément qui correspond à `SKIP_SEL`. Effet limité à la lecture : pas de sécurité ni de donnée en jeu. | rf-web : exiger en plus l'interface pub (`.ytp-ad-player-overlay`) ou une durée courte. |
| G4 | `web/youtube-ads.js`, `module.exports` | En monde `.page`, si la page définit un global `module`, le script y écrit ses fonctions. C'est improbable au document-start. | rf-web, optionnel : tester `typeof window === 'undefined'` avant d'exporter. |
| G5 | `web/*.js` | F6 toujours ouvert : 9 accès `sessionStorage` sans clé littérale (WARN de `bin/verify`). | rf-web (F6). |
| G6 | `ios/project.yml` | `youtube-ads.js` est `optional: true` : un oubli de bundle ne serait pas détecté au build. | **Corrigé** (rf-ops) : l'étape « Package .ipa » de `ci.yml` exige les trois scripts (identiques à `web/`), les règles et le manifeste de confidentialité. |
<!-- review-d06:end -->

## 6. Risques résiduels acceptés
- **Confiance dans WebKit, iOS et TestFlight.** Un composant compromis contourne nos contrôles.
- **La clé API est Admin** : c'est nécessaire pour la signature gérée dans le cloud. Atténué par l'environnement GitHub restreint et la révocation simple.
- **Le script partage le DOM avec la page** : la page peut modifier les éléments que le script masque. La garde native couvre les routes, pas le contenu inline (par exemple un reel dans le fil). Dans ce cas, c'est le JS qui sert de seconde ligne de défense.
- **Détection côté Instagram** : un masquage CSS reste détectable en théorie, mais il ne se distingue pas d'un bloqueur de contenu.
- **Monde `.page`** (avenant 5, T9) : YouTube peut lire, défaire ou détecter `youtube-ads.js` (enveloppes de `fetch` et `JSON.parse`). C'est accepté : il ne porte aucune protection ReelFree et n'a aucun pouvoir que la page n'ait déjà.
- **Bloqueur de pubs au mieux** : si la compilation des règles échoue, les onglets tournent sans bloqueur (pubs visibles, aucune protection perdue). La détection d'un bloqueur par YouTube reste possible.
