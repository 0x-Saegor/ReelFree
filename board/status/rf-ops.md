D03 et D06 terminés : bin/verify accepte youtube-ads.js avec un profil strict pour le monde .page, la revue D06 ne trouve aucun constat majeur (5 mineurs), docs/SECURITY.md est à jour. Je m'arrête.

## Fait (D03, D06 — 2026-11-02)
- `bin/verify` :
  - `web/youtube-ads.js` est maintenant un script connu, vérifié avec un profil **monde page** (`PAGE=1`) :
    - les règles JS habituelles, sans exemption pour le bridge ;
    - aucune URL littérale ;
    - interdits : `webkit`, `messageHandlers`, `RF_CONFIG`, `onNative`, `sessionStorage`, DOM, événements, minuteries, navigation, globaux (sauf `window.fetch = wrapped`), `defineProperty` hors `(window, name, …)`, prototypes, `origFetch` autrement que par `.apply(this, arguments)`, `new Request` ;
    - obligatoires : un seul IIFE en strict, la garde d'hôte et la regex `youtube.com`.
  - Swift :
    - un seul `WKUserScript` en `.page` est toléré, dans `WebTab.swift` et sous la forme exacte (`source: page`, `.atDocumentStart`, `forMainFrameOnly: true`) ;
    - `pageScriptResource` doit valoir `nil` pour Instagram et `"youtube-ads"` pour YouTube ;
    - les handlers et `evaluateJavaScript` restent interdits en `.page`.
  - Bloqueur (`ios/**/*rules*.json`) : actions `block` ou `css-display-none` seulement, `url-filter` obligatoire, aucune règle `block` sur une URL cœur (documents IG et YT, `/youtubei/v1/player`, `videoplayback`, `ytimg`, CDN IG, `accounts.google.com`, `gstatic`).
  - `project.yml` ne peut embarquer que les 3 scripts de `web/`.
  - Self-test : **142/142** (44 nouveaux cas). `bin/verify` : `OK instagram=3cbabb1e0141 youtube=077da5ffed74 youtube-ads=7e5a2ab2eeed swift=16`. `npm test` : 394/394.
- `ci.yml`, job `unsigned-ipa` : l'étape « Package .ipa » échoue s'il manque à l'`.app` `instagram.js`, `youtube.js`, `youtube-ads.js`, `adblock-rules.json` ou `PrivacyInfo.xcprivacy`, ou si un des scripts embarqués diffère de `web/`. Corrige G6 (`youtube-ads.js` est `optional: true`).
- `docs/SECURITY.md` :
  - périmètre élargi ;
  - nouvelle menace **T9** (monde `.page` et bloqueur) ;
  - tableau `bin/verify` complété ;
  - **§ 5 bis** : revue D06 (G1–G6) ;
  - § 6 : 2 risques acceptés de plus.
- CI : dernier run poussé (41457499437, commit 0254087) vert sur les 3 jobs, artefact `ReelFree-unsigned-ipa` de 122 Ko. **Le diff local (D01–D07 + ce travail) n'est pas encore passé en CI.**

## Demandes
**Constat majeur : aucun.** Rien ne bloque le prochain build.
- @rf-web — G1 (`youtube-ads.js`, enveloppe `fetch`) : une exception dans le `.then` de succès (`JSON.stringify` ou `new Response`) rejette la promesse au lieu de rendre `res`. Mettre un `try/catch` qui rend `res` et ajouter un test. C'est le plus important des mineurs, car il peut casser le lecteur.
- @rf-web — G2 : ajouter `data-reelfree-reel`, `-shorts` et `-nav` à `attributeFilter` et remarquer le nœud quand ces attributs sont retirés. Sinon, documenter le risque comme accepté.
- @rf-web — G3 (`youtube.js`, `skipAd`) : n'agir que si l'interface pub est présente (`.ytp-ad-player-overlay`) ou si la durée est courte, pas sur `.ad-showing` seul.
- @rf-web — G4, optionnel : ne pas écrire `module.exports` dans le monde page (n'exporter que si `typeof window === 'undefined'`).
- @rf-web — G5 / F6 toujours ouvert (`sessionStorage` en mode app).
- @rf-web — D03, vecteurs : `tests/vectors/policy.json` n'a aucun cas `via: "popstate"`. Ajouter au moins « reel avec jeton valide + popstate → pas d'admission », pour que l'XCTest et le JS figent l'avenant 4. Je n'y touche pas, le fichier est à toi.
- @orchestrateur :
  - pousser, puis vérifier les 3 jobs de `ci.yml`, surtout la nouvelle vérification du contenu de l'IPA (job « Unsigned IPA (sideload) », étape « Package .ipa ») ;
  - valider les 2 nouveaux risques acceptés (SECURITY.md § 6 : monde `.page` défaisable par YouTube, bloqueur au mieux) ;
  - rappels toujours ouverts : C01 (environnement `testflight` et ses secrets), données personnelles encore présentes dans `CLAUDE.md`, `bin/launch`, `board/TASKS.md` (« d'le propriétaire » l. 14), `board/archive/*`, `archive/safari-userscript/INSTALL-iOS.md`.

## Historique
- A07–A09, B04–B06, C02 : faits (voir `docs/SECURITY.md` § 5, revue B05 F1–F10 ; demandes F1, F4, F5 à rf-ios et F6 à rf-web encore ouvertes).
