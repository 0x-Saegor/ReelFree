# Tâches ReelFree — app iOS (TestFlight)
Légende : [ ] à faire · [~] en cours · [x] fait · [!] bloqué
Phase userscript Safari (T01–T20) : archivée, voir board/archive/.

## Phase A — Fondations (en parallèle)
- [x] A01 @rf-web — Corriger les 4 contournements majeurs relevés par rf-sec (board/archive/rf-sec.md l.35-55 : D3 via /p/, D2 via l'historique, S1 remis à zéro, overlay photo) + tests de non-régression
- [~] A02 @rf-web — Adapter web/instagram.js au bridge (SPEC-iOS) : RF_CONFIG, messages dmReelOpen/route/ready, window.reelfree.onNative ; retirer l'en-tête userscript ; mode autonome conservé sans window.webkit
- [x] A03 @rf-web — tests/vectors/policy.json généré depuis les cas unitaires (≥ 40 vecteurs) + test Node qui l'exécute
- [~] A04 @rf-ios — ios/project.yml (XcodeGen), squelette SwiftUI TabView Instagram/YouTube/Réglages, Info.plist (App-Bound Domains, sans ATS exception), PrivacyInfo.xcprivacy, icône placeholder
- [~] A05 @rf-ios — WebViewContainer : config sécurisée, UA Safari, injection des scripts dans .defaultClient, bridge reelfree, liens externes vers Safari
- [~] A06 @rf-ios — RoutePolicy.swift (port de decide()) + XCTest sur tests/vectors/policy.json (copié en ressource de test)
- [x] A07 @rf-ops — .github/workflows/ci.yml (ubuntu : npm test + bin/verify ; macos-15 : xcodegen + build + tests simulateur)
- [x] A08 @rf-ops — .github/workflows/testflight.yml (archive + upload via clé API ASC, build number = run_number, cron mensuel)
- [x] A09 @rf-ops — docs/TESTFLIGHT.md pour l'ami : bundle id, app ASC, clé API, secrets GitHub, ajout d'Arthur en testeur interne

## Phase B — Intégration
- [ ] B01 @rf-ios — Garde native : decidePolicyFor + KVO webView.url + jeton DM natif + écran masqué si hide
- [ ] B02 @rf-ios — Réglages (UserDefaults) poussés au JS via onNative ; barre retour/accueil/recharger ; pull-to-refresh
- [ ] B03 @rf-web — web/youtube.js adapté au bridge (Shorts masqués, /shorts/<id> → /watch?v=<id>)
- [x] B04 @rf-ops — bin/verify étendu : JS (règles existantes) + Swift (pas d'URLSession hors WebView, pas de SDK tiers, pas d'ATS exception, App-Bound activé)
- [~] B05 @rf-ops — Revue de sécurité complète app + scripts (docs/SECURITY.md mis à jour), bloquante avant le 1er TestFlight
- [ ] B06 @rf-ops — README.md : ce que fait l'app, architecture, comment lancer un build

## Phase C — Livraison
- [ ] C01 @orchestrateur — Repo GitHub + secrets (besoin d'Arthur et de son ami)
- [ ] C02 @rf-ops — Premier run CI vert (build + tests macOS)
- [ ] C03 @rf-ops — Premier build TestFlight, puis test par Arthur sur l'iPhone 11
