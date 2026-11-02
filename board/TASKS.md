# Tâches ReelFree — app iOS (TestFlight)
Légende : [ ] à faire · [~] en cours · [x] fait · [!] bloqué
Phase userscript Safari (T01–T20) : archivée, voir board/archive/.

## Phase A — Fondations (en parallèle)
- [x] A01 @rf-web — Corriger les 4 contournements majeurs relevés par rf-sec (board/archive/rf-sec.md l.35-55 : D3 via /p/, D2 via l'historique, S1 remis à zéro, overlay photo) + tests de non-régression
- [x] A02 @rf-web — Adapter web/instagram.js au bridge (SPEC-iOS) : RF_CONFIG, messages dmReelOpen/route/ready, window.reelfree.onNative ; retirer l'en-tête userscript ; mode autonome conservé sans window.webkit
- [x] A03 @rf-web — tests/vectors/policy.json généré depuis les cas unitaires (≥ 40 vecteurs) + test Node qui l'exécute
- [x] A04 @rf-ios — ios/project.yml (XcodeGen), squelette SwiftUI TabView Instagram/YouTube/Réglages, Info.plist (App-Bound Domains, sans ATS exception), PrivacyInfo.xcprivacy, icône placeholder
- [x] A05 @rf-ios — WebViewContainer : config sécurisée, UA Safari, injection des scripts dans .defaultClient, bridge reelfree, liens externes vers Safari
- [x] A06 @rf-ios — RoutePolicy.swift (port de decide()) + XCTest sur tests/vectors/policy.json (copié en ressource de test)
- [x] A07 @rf-ops — .github/workflows/ci.yml (ubuntu : npm test + bin/verify ; macos-15 : xcodegen + build + tests simulateur)
- [x] A08 @rf-ops — .github/workflows/testflight.yml (archive + upload via clé API ASC, build number = run_number, cron mensuel)
- [x] A09 @rf-ops — docs/TESTFLIGHT.md pour l'ami : bundle id, app ASC, clé API, secrets GitHub, ajout du propriétaire en testeur interne

## Phase B — Intégration
- [x] B01 @rf-ios — Garde native : decidePolicyFor + KVO webView.url + jeton DM natif + écran masqué si hide
- [x] B02 @rf-ios — Réglages (UserDefaults) poussés au JS via onNative ; barre retour/accueil/recharger ; pull-to-refresh
- [x] B03 @rf-web — web/youtube.js adapté au bridge (Shorts masqués, /shorts/<id> → /watch?v=<id>)
- [x] B04 @rf-ops — bin/verify étendu : JS (règles existantes) + Swift (pas d'URLSession hors WebView, pas de SDK tiers, pas d'ATS exception, App-Bound activé)
- [x] B05 @rf-ops — Revue de sécurité complète app + scripts (docs/SECURITY.md mis à jour), bloquante avant le 1er TestFlight
- [x] B06 @rf-ops — README.md : ce que fait l'app, architecture, comment lancer un build

## Phase C — Livraison
- [x] C01 @orchestrateur — Repo GitHub créé : github.com/0x-Saegor/ReelFree (public). Secrets ASC : en attente de l ami
- [x] C02 @rf-ops — Premier run CI vert (build + tests macOS)
- [ ] C03 @rf-ops — Premier build TestFlight, puis test par le propriétaire sur l'iPhone 11

## Phase D — Retour terrain (testé sur iPhone 11 via sideload : fonctionne, mais lag)
- [x] D01 @rf-web — Perf JS sur iPhone 11 : supprimer les sélecteurs CSS :has() (coûteux à chaque mutation sur le gros DOM d'Instagram) au profit d'attributs posés par JS ; MutationObserver : traiter seulement les nœuds ajoutés, avec un batch par rAF ou requestIdleCallback, sans re-scan global ; en mode app, supprimer le polling 250 ms (les routes arrivent du natif via onNative {type:"route"}) ; pas de querySelectorAll global dans le chemin chaud ; mesurer avant et après (Playwright, fixtures réelles, nombre de recalculs de style et temps de script) et noter les chiffres dans le statut
- [x] D02 @rf-ios — Perf native : chargement paresseux de l'onglet YouTube (WebView créée à la 1re sélection), mettre en pause les médias de l'onglet caché ; pousser chaque changement d'URL (KVO) au JS via onNative {type:"route", path, via} pour qu'il n'ait plus besoin de poller ; vérifier qu'aucun travail natif ne tourne à chaque frame ; Release : optimisation -O, pas de logs verbeux
- [x] D03 @rf-ops — Mettre à jour les vecteurs et la revue sécurité si le contrat change (message route natif → JS), puis vérifier la CI et l'artefact IPA — revue faite (SECURITY.md § 5 bis), ci.yml vérifie le contenu de l'IPA ; CI du diff local à confirmer après push ; vecteurs popstate demandés à rf-web
- [x] D04 @rf-ios — Bloqueur de pubs natif (équivalent uBlock, uBO ne peut pas tourner dans une WKWebView) : WKContentRuleList compilée au lancement depuis un JSON **embarqué** (ios/ReelFree/Resources/adblock-rules.json, aucun téléchargement à l'exécution), appliquée aux 2 WebViews ; règles = domaines pub et trackers (doubleclick, googlesyndication, googleadservices, google-analytics, adservice.google.*, facebook pixel) + URL YouTube (/pagead/, /api/stats/ads, /ptracking, /get_midroll_) ; ne doit PAS casser la lecture ni la connexion ; test XCTest de compilation des règles
- [x] D05 @rf-web — Pubs YouTube : web/youtube-ads.js injecté dans le monde .page (seule exception au monde isolé : pas de bridge, pas de réseau, pas de lecture de données utilisateur), qui supprime adPlacements, playerAds et adSlots de ytInitialPlayerResponse et des réponses /youtubei/v1/player (prune JSON) ; repli dans youtube.js (monde isolé) : clic auto sur « Ignorer », coupure du son et saut à la fin d'une pub détectée (.ad-showing) ; masquer les encarts sponsorisés du fil ; tests sur fixtures
- [x] D06 @rf-ops — Revue sécurité de D04 et D05 (exception du monde .page documentée dans SECURITY.md, bin/verify adapté) — aucun constat majeur, 5 mineurs (G1–G5)
- [x] D07 @rf-ios — Mode immersif : sur les onglets Instagram et YouTube, la barre d'outils native (retour/accueil/recharger) et la barre d'onglets sont MASQUÉES par défaut, et la WebView occupe tout l'écran (en respectant la safe area du haut et du bas, pour que la barre de nav d'Instagram reste utilisable). Pour réafficher : une petite poignée flottante semi-transparente (pastille d'environ 36 pt, coin bas-droit, déplaçable verticalement, au-dessus de la barre de nav web) ; un tap affiche les barres, qui se remasquent après 5 s sans interaction ou au tap sur la page. Ajouter aussi le geste « glisser depuis le bord gauche » = retour, si la WebView ne le fait pas déjà (allowsBackForwardNavigationGestures). Animation légère, sans saccade (cohérent avec D02). Réglage « Barres toujours visibles » dans Réglages. L'écran Réglages reste accessible par la barre d'onglets.
