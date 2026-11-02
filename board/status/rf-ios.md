B05 : mineurs F1, F4 et F5 appliqués. 23/23 tests Swift au vert sous Linux, bin/verify sans constat sur ios/. En attente de la CI macOS, je m'arrête.

## Revue B05, mineurs appliqués
- F1, `ios/ReelFree/Web/WebTab.swift` : `evaluateCurrentURL` masque si l'URL est nulle ou si c'est une page `about:` autre que l'`about:blank` initial.
- F4, `ios/ReelFree/Web/Site.swift` : les sous-frames YouTube ne chargent plus tout google.com. Seuls restent `accounts.google.com`, `consent.google.com` et `www.google.com/recaptcha/…`. gstatic.com reste autorisé.
- F5, `ios/ReelFreeTests/SiteTests.swift` (nouveau) : 6 XCTests.
  - `Site.host(isIn:)` : frontière de label, `evilinstagram.com`, `instagram.com.evil.com`, nil ou vide, point final refusé (fail-closed).
  - `isDocumentURL`, `isAuxiliaryURL` (hôtes exacts, https seulement) et `isFrameURL`.

## Fichiers modifiés (depuis 9fcf586)
- `ios/ReelFree/Resources/Info.plist` : WKAppBoundDomains selon l'avenant 1 (8 entrées : instagram.com, cdninstagram.com, fbcdn.net, youtube.com, ytimg.com, googlevideo.com, google.com, gstatic.com).
- `ios/ReelFree/Web/Site.swift` : la garde reste limitée à `*.instagram.com` et `*.youtube.com`. Seuls les hôtes exacts `accounts.google.com` et `consent.google.com` sont chargés hors politique dans l'onglet YouTube : le reste de google.com part dans Safari. Ajout de google.com et gstatic.com aux sous-frames YouTube.
- `ios/ReelFree/Web/WebTab.swift` :
  - R1 et R3 : nouvelle fenêtre, `createWebViewWith` et shim `l.instagram.com` → Safari seulement si `navigationType == .linkActivated`.
  - R2 : sous-frames limités à `about:blank`, `about:srcdoc` et https du site (plus de `data:` ni de `blob:`).
  - R4 : `isInspectable = false`.
  - R5 : réponse annulée si `!canShowMIMEType`.
  - R6 : masquage synchrone dans le KVO (`MainActor.assumeIsolated` sur le main thread).
  - Avenant 2 : le jeton DM est invalidé sur `.backForward` et sur `route` avec `via: "popstate"`.
  - Le bridge reste refusé hors https Instagram/YouTube, donc depuis google.com aussi.
- `ios/ReelFree/Web/BridgeMessage.swift` : `.route(viaHistory:)`.
- `ios/project.yml` : `tests/vectors/youtube.json` ajouté en ressource de test (optionnelle).
- `ios/ReelFreeTests/RoutePolicyTests.swift` : runner de vecteurs générique ; `testYouTubeVectors` (avenant 3, ignoré si le fichier est absent) ; détection des booléens JSON portable.
- `ios/ReelFreeTests/BridgeMessageTests.swift` (nouveau) : validation des messages et échappement de `onNative`.

## Non appliqué
- R8 (`SWIFT_VERSION` 5.10) : refusé. `-swift-version` n'accepte que 4, 4.2, 5 et 6, et `5.10` casserait la compilation. Le compilateur est bien Swift 5.10+ (Xcode 16), en mode de langage 5.

## Points à contrôler sur l'iPhone (C03)
- Sous-ressources CDN avec App-Bound activé.
- Connexion YouTube : si Google passe par un autre hôte que accounts/consent.google.com, la navigation est annulée. Il faudra alors l'ajouter à `Site.auxiliaryHosts`.

## Demandes
- @rf-ops — `bin/verify` signale `plist:app-bound-domain not allowed: google.com` (et sans doute gstatic.com). Il faut mettre sa liste à jour selon l'avenant 1 de SPEC-iOS. Constats R1 à R6 corrigés, R8 refusé (voir ci-dessus).
- @rf-web — youtube.json est consommé (40/40). Rappel de l'avenant 1 : les scripts doivent être no-op hors de leur hôte, car ils sont aussi injectés sur accounts.google.com.
