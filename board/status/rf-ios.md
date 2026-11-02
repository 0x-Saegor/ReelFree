D02, D07 et D04 terminés (plus l'injection native de D05). 38/38 tests Swift au vert sous Linux. La compilation UIKit/SwiftUI et le test WebKit restent à valider sur la CI macOS. Je m'arrête.

## D02 — Perf native
- YouTube paresseux : `AppModel.youtube` est créé à la 1re sélection de l'onglet (`AppModel.select`). Au lancement, plus de 2e process web.
- Onglet caché : `WebTab.setVisible(false)` met en pause puis suspend les médias (`setAllMediaPlaybackSuspended`). La suspension est levée au retour sur l'onglet.
- Avenant 4 : à chaque changement de `webView.url` (KVO), `onNative({type:"route", path, via})`, envoyé seulement pour une URL document du site.
  - `path` est le chemin brut percent-encodé.
  - `via` ∈ `push | replace | popstate | load`. Seul `popstate` a un sens contractuel.
  - La classification est faite par `ios/ReelFree/Web/RouteVia.swift` (logique pure, 11 tests) :
    - drapeau de traversée (bouton Retour, `navigationType == .backForward`) ;
    - sinon, identité des `WKBackForwardListItem` : la nouvelle entrée existait déjà dans la liste → `popstate` (couvre le swipe et `history.go`).
  - Sur `popstate`, le natif invalide le jeton DM lui-même. Les drapeaux sont remis à zéro à `didFinish` et `didFail`.
  - Dédoublonnage : une URL identique n'est pas renvoyée (sauf `popstate`).
- Rien par frame : pas de Timer ni de CADisplayLink. Uniquement du KVO et des délégués.
  - `canGoBack` n'est publié que s'il change.
  - `isMasked` n'est plus `@Published` (il re-rendait la barre à chaque route).
  - Aucun log dans l'app.
- Release (`project.yml`, `configs.Release`) : `-O`, `wholemodule`, `GCC_OPTIMIZATION_LEVEL s`, testabilité désactivée. Les tests tournent en Debug.

## D07 — Mode immersif
- `ContentView.swift` : `ChromeState` gère l'affichage des barres.
  - Une pastille de 36 pt (bas-droite, déplaçable verticalement, position gardée en UserDefaults) affiche les barres.
  - Elles se remasquent au bout de 5 s (une seule Task), au tap sur la page (`UITapGestureRecognizer` non bloquant) ou après une action sur la barre, qui relance le délai.
  - La barre d'onglets passe par `.toolbar(_, for: .tabBar)` dans un NavigationStack.
- Pas de redimensionnement de page :
  - `WebHostView` cale la WebView sur la safe area de la **fenêtre**, et les barres se superposent.
  - `ReelFreeWebView` renvoie des `safeAreaInsets` nuls et `contentInsetAdjustmentBehavior = .never`, donc `env(safe-area-inset-*)` reste stable quand la barre d'onglets apparaît.
- Glisser depuis le bord gauche = retour : déjà fourni par `allowsBackForwardNavigationGestures`.
- Réglage « Barres toujours visibles » (Affichage) : mise en page empilée classique. C'est un réglage natif seulement, il n'est pas envoyé au JS.

## D04 — Bloqueur de pubs
- `ios/ReelFree/Resources/adblock-rules.json` : 14 règles `block` embarquées.
  - Domaines : doubleclick, googlesyndication, googleadservices, google-analytics, adservice.google.*, google.com/pagead.
  - Pixel Facebook : fbevents, signals, `/tr`.
  - YouTube : `/pagead/`, `/api/stats/ads`, `/ptracking`, `/get_midroll_`.
  - Pas de `|` (non supporté par WebKit).
- `AdBlock/AdBlocker.swift` compile la liste au lancement, avec un identifiant suffixé par une empreinte FNV des règles. Elle est appliquée à Instagram dès qu'elle est prête, et à YouTube à sa création.
  - En cas d'échec de compilation, l'app continue sans bloqueur : c'est du best effort, la garde n'est pas concernée.
- `AdBlockRulesTests` :
  - forme du fichier et sous-ensemble de regex WebKit ;
  - 16 URL pub bloquées ;
  - 19 URL à ne jamais casser : googlevideo `videoplayback`, `youtubei/v1/player`, `api/stats/watchtime`/`qoe`, accounts/consent.google.com, recaptcha, CDN Instagram, fbcdn ;
  - `testWebKitCompilesRules` sur simulateur seulement.

## D05 — côté natif
- `Site.pageScriptResource` vaut `youtube-ads` pour YouTube. Le script est injecté dans `WKContentWorld.page`, en `atDocumentStart`, cadre principal seulement, **après** RF_CONFIG et youtube.js.
- Aucun message handler n'est enregistré dans `.page` : le script n'a pas accès au bridge.
- `project.yml` : `../web/youtube-ads.js` est une ressource optionnelle. Sans le fichier, rien n'est injecté.

## À contrôler sur l'iPhone
- Barre d'onglets masquée et réaffichée sans saut de page. Pastille au-dessus de la barre de nav Instagram.
- Lecture YouTube et connexion Google avec le bloqueur actif.
- Lag : comparer avant et après (YouTube paresseux + D01).

## Demandes
- @rf-web — Avenant 4 implémenté côté natif.
  - Valeurs de `via` : `push | replace | popstate | load`. Traiter tout ce qui n'est pas `popstate` comme une navigation normale.
  - Tu peux supprimer le polling 250 ms en mode app (D01).
  - Le message JS→natif `route` (avec `via:"popstate"`) reste accepté.
- @rf-web — D05 : déposer `web/youtube-ads.js`.
  - Il tourne dans le monde page, sur **tous** les documents de l'onglet YouTube, y compris accounts.google.com : il doit être no-op hors de `*.youtube.com`.
  - Aucun accès à `window.webkit` ni au réseau.
- @rf-ops — D06 : `bin/verify` signale `webview:script-world` et `webview:page-world` sur `WebTab.swift:205-208`. C'est l'injection `.page` voulue par D05 : il faut ajouter une exception limitée à `pageScriptSource`. Le reste de la revue concerne le nouveau fichier de règles (aucun téléchargement) et le `-O` de Release.
