# Sécurité — ReelFree

Document maintenu par `rf-sec`. Il couvre `src/reelfree.user.js` (et plus tard `src/reelfree-youtube.user.js`),
exécuté sur iPhone 11 par l'app iOS **Userscripts** (quoid/userscripts) dans Safari, sur `https://www.instagram.com`.
Règles de référence : `CLAUDE.md` § « Règles de sécurité ». En cas de conflit, `CLAUDE.md` prévaut.

## 1. Périmètre et actifs

| Actif | Pourquoi il compte | Exposition au script |
|---|---|---|
| Session Instagram (cookies `sessionid`, `csrftoken`, tokens en mémoire) | Qui la détient contrôle le compte | Le script tourne dans l'origine `www.instagram.com` : il **pourrait** lire tout ce que la page lit. Le cookie `sessionid` est `HttpOnly`, mais `csrftoken` et les tokens JS sont accessibles. |
| Contenu des DM (messages, médias, correspondants) | Données personnelles de tiers | Visible dans le DOM de `/direct/` où le script agit (jeton D2, bouton D4). |
| Compte Instagram d'Arthur | Ban ou restriction en cas de comportement automatisé | Toute action faite au nom de l'utilisateur engage le compte. |
| iPhone / Safari | Autres onglets, autres sites | Limité par `@match` et le modèle d'extension Safari. |
| Intégrité du script | Un script altéré hérite de tous les accès ci-dessus | Chaîne : dépôt → poste d'Arthur → transfert → dossier Userscripts sur l'iPhone. |

**Hors périmètre** : la sécurité d'Instagram lui-même, celle d'iOS/Safari, et la volonté d'Arthur de contourner son propre blocage (voir T7).

## 2. Modèle de menace

Échelle : probabilité et impact en **Faible / Moyen / Élevé**.

### T1 — Supply chain
| Sous-menace | Scénario | Impact | Proba. | Contrôles |
|---|---|---|---|---|
| T1.a Script altéré en transit | Le fichier est modifié entre le poste et l'iPhone (partage tiers, cloud compromis, mauvais fichier). | Élevé (vol de session) | Faible | SHA-256 publié dans le README, recalculé sur l'iPhone ou avant transfert ; transfert par câble ou iCloud Drive privé ; relecture du diff (§ 4). |
| T1.b Dépendances | Une lib chargée via `@require` ou CDN est compromise. | Élevé | Nulle si règle respectée | Zéro dépendance : `@require` et `@resource` interdits, fichier unique non minifié (`bin/verify`). Les dépendances npm (`package.json`) ne servent qu'aux tests et ne sont jamais embarquées. |
| T1.c Auto-update | Une URL de mise à jour sert une version malveillante sans action d'Arthur. | Élevé | Nulle si règle respectée | `@updateURL`/`@downloadURL` interdits ; installation manuelle uniquement. |
| T1.d Compromission du dépôt | Un agent, un outil ou un tiers injecte du code dans `src/`. | Élevé | Faible | Pas de commit par les agents : Arthur relit et commite ; `bin/verify` bloquant ; revue T16 avant toute release. |
| T1.e App Userscripts | L'app (ou une mise à jour App Store) est malveillante ou boguée. | Élevé | Faible | App open source, éditeur connu, aucun compte requis. Risque accepté (§ 5). Ne donner à l'extension Safari l'accès qu'à `instagram.com` (et `youtube.com` si besoin), pas « Tous les sites ». |

### T2 — Exfiltration
**Scénario** : le script (par bug, malveillance ou altération) envoie cookies, tokens ou contenu de DM vers un tiers.
Vecteurs : `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, balises `<img>`/`<script>`/`<link>`/`<iframe>`
avec `src`/`href` externe, soumission de `<form>`, `window.open`, affectation de `location` vers un autre domaine, `postMessage` vers une autre fenêtre, import dynamique.
**Impact** : Élevé. **Probabilité** : Faible (code relu, aucun besoin fonctionnel de réseau).
**Contrôles** :
- règle « zéro réseau » : aucune de ces API dans le source (`bin/verify`) ;
- la seule navigation autorisée est interne (`location`/`history` vers un chemin relatif ou `https://www.instagram.com/...`) ; toute URL absolue hors `instagram.com` fait échouer `bin/verify` ;
- aucune lecture de contenu : le script ne lit ni `document.cookie`, ni le texte des messages, ni les tokens. Il agit sur `location.pathname` et sur des sélecteurs structurels (`href`, `role`, `aria-label`) ;
- le jeton D2 ne contient que l'id du reel, déjà présent dans l'URL.

### T3 — Injection / XSS
**Scénario** : le script insère du HTML construit à partir de contenu de la page (légende, nom, message). Un contenu piégé
s'exécute alors avec les droits du script, ou le script casse la CSP d'Instagram.
**Impact** : Élevé. **Probabilité** : Moyenne si `innerHTML` était utilisé, nulle sinon.
**Contrôles** : DOM construit avec `createElement` + `textContent` ; `innerHTML`, `outerHTML`, `insertAdjacentHTML` et `document.write` sont interdits (`bin/verify`).
Le CSS injecté (`<style>`) est une **constante** du script, jamais concaténée avec des données de la page.

### T4 — Code dynamique
**Scénario** : `eval`, `new Function`, `setTimeout("...")`/`setInterval("...")`, `import()` exécutent une chaîne
qui pourrait provenir de la page ou d'un tiers. Cela rend aussi la revue statique inopérante.
**Impact** : Élevé. **Probabilité** : Faible.
**Contrôles** : interdits par `bin/verify` ; `setTimeout`/`setInterval` n'acceptent qu'une fonction.

### T5 — Ban ou restriction du compte Instagram
**Scénario** : Instagram détecte un comportement automatisé (requêtes forgées, clics simulés, scroll programmatique,
appels à ses API internes) et restreint ou bannit le compte.
**Impact** : Élevé (perte du compte). **Probabilité** : Faible si les contrôles tiennent.
**Contrôles** :
- le script **n'agit jamais au nom de l'utilisateur** : aucune requête, aucun `click()` / `dispatchEvent` synthétique sur un élément d'Instagram, aucun like, follow, envoi ou marquage « vu » ;
- il se limite à **masquer** (CSS, `hidden`, `display:none`), **bloquer** des événements de l'utilisateur (`preventDefault` sur wheel/touchmove/touches, D3) et **rediriger** (navigation interne vers `/` ou vers la conversation) ;
- pas d'appel aux API internes d'Instagram ni aux objets JS de la page (pas de lecture de `window.__additionalData`, `require(...)`, etc.) ;
- le hook `history.pushState`/`replaceState` (X1) observe et redirige : il ne modifie pas les arguments passés par Instagram et rappelle toujours la fonction d'origine.
Un masquage CSS reste détectable côté client en théorie, mais il ne se distingue pas d'un bloqueur de contenu classique (risque résiduel, § 5).

### T6 — Pistage et vie privée
**Scénario** : le script conserve des traces (historique, ids, contenu) lisibles par Instagram, par un autre script ou après la session.
**Impact** : Moyen. **Probabilité** : Faible.
**Contrôles** : pas de `localStorage`, `indexedDB`, `document.cookie`. Seul `sessionStorage` est autorisé, sous des clés préfixées `reelfree:`,
avec des drapeaux sans contenu utilisateur (ex. `reelfree:dm-allow` = id du reel + horodatage, consommé une fois, TTL court).
Pas de journalisation de contenu dans `console`. Note : `sessionStorage` est lisible par le JS d'Instagram ; il ne doit donc contenir que ce qu'Instagram connaît déjà (l'URL visitée).

### T7 — Contournement du blocage
| Scénario | Contrôle |
|---|---|
| Instagram change son DOM, les sélecteurs ne trouvent plus rien. | **Fail-closed** : sur une route interdite (`/reels/`, `/reel/<id>` hors DM, `/explore/`), le CSS masque le contenu dès `document-start`, avant toute détection. Une détection en échec laisse le contenu masqué. |
| Navigation SPA non détectée. | Triple détection (hook `history`, `popstate`, polling 250 ms) ; le CSS par route reste appliqué tant que la route n'est pas reconnue comme autorisée. |
| Jeton DM réutilisé ou forgé pour enchaîner les reels. | Jeton one-shot, lié à l'id, TTL court, consommé à l'arrivée ; tests `decide()` (T08). Forger un jeton demande la console, absente de Safari iOS sans Mac. |
| Ouverture de l'app Instagram. | Hors script : Temps d'écran bloque l'app (`docs/INSTALL-iOS.md`). |
| Arthur désactive l'extension, l'app Userscripts ou utilise un autre navigateur. | **Hors périmètre technique.** Mitigation organisationnelle : code Temps d'écran confié à un tiers, blocage des autres navigateurs, restriction « Contenu web » si besoin. |

### T8 — Privilèges de l'extension Userscripts
**Scénario** : le script reçoit plus de droits que nécessaire (API `GM_*`, accès cross-origin, exécution dans les iframes ou sur d'autres sites).
**Impact** : Élevé. **Probabilité** : Faible.
**Contrôles** : `@grant none` (aucune API privilégiée, pas de `GM_xmlhttpRequest`), `@noframes`, `@match https://www.instagram.com/*` strict
(pas de joker de domaine, pas de `http://`, pas de `@include`), aucun `@connect`. Côté iOS, l'extension Safari n'est autorisée que sur les domaines nécessaires.
Décision rf-sec (2026-11-02) : seul `@inject-into content` est accepté. L'absence de la clé l'est aussi, puisque Userscripts injecte alors par défaut dans le monde isolé. `page` et `auto` sont refusés par `bin/verify`. Dans le monde isolé, le hook `history.pushState` ne voit pas les appels de la page. La détection de route repose donc sur `popstate` et sur le polling à 250 ms (X1), ce qui est accepté.

## 3. Contrôles et vérification

| Règle (`CLAUDE.md`) | Vérification |
|---|---|
| Zéro réseau | `bin/verify` (grep) + revue T16 + test rf-qa : aucune requête hors `instagram.com` pendant les E2E |
| Pas de code dynamique | `bin/verify` + revue T16 |
| Pas d'`innerHTML` avec contenu de page | `bin/verify` (interdiction totale) + revue T16 |
| Pas de persistance | `bin/verify` + revue T16 (clés `sessionStorage` toutes préfixées `reelfree:`) |
| Pas de lecture de contenu | Revue T16 (non vérifiable par grep) |
| Aucune action au nom de l'utilisateur | Revue T16 (pas de `click()`/`dispatchEvent` sur des éléments d'Instagram) |
| Pas d'auto-update | `bin/verify` (metadata) |
| Fail-closed | Tests rf-qa (T08, T15) : route interdite + sélecteurs absents → contenu masqué |
| Fichier unique, lisible, metadata obligatoires | `bin/verify` + revue T16 |
| Intégrité du livrable | `bin/verify` affiche le SHA-256, comparé au README (§ 4) |

### Ce que `bin/verify` interdit
`bin/verify <fichier>` calcule le SHA-256 puis cherche les motifs suivants. **Toute occurrence fait sortir le script avec un code non nul** (y compris dans les commentaires : on ne les écrit pas, on les décrit autrement).

| Catégorie | Motifs interdits |
|---|---|
| Réseau | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection`, `Worker`/`serviceWorker`/`importScripts`, `postMessage`, `window.open`, `submit()`/`requestSubmit`/`formAction`/`.action =` |
| Éléments chargeant une ressource | `createElement` de `script`, `img`, `iframe`, `frame`, `link`, `object`, `embed`, `audio`, `video`, `source`, `track`, `form`, `base`, `meta`, `svg`, `use`, `picture` (`style` est autorisé pour le CSS fail-closed) ; affectation de `.src`, `.srcset`, `.data`, `.poster` ; `setAttribute('src'|'href'|'action'|'style'|…)` ; `url(` et `@import` dans le CSS |
| URL | toute URL `http(s)://`, `ws(s)://` ou `//hôte` dont l'hôte n'est pas `www.instagram.com` (`m.youtube.com`/`www.youtube.com` pour le script YouTube) |
| Code dynamique | `eval`, `Function(`, `.constructor(`, `setTimeout`/`setInterval`/`setImmediate` avec une chaîne, `import(`/`import x`/`require(` |
| HTML brut | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `DOMParser`, `srcdoc`, `setHTML` |
| Obfuscation | `atob`, `btoa`, `fromCharCode`, `fromCodePoint`, échappements `\xNN`, `unescape`, accès indexé `window[`/`globalThis[`/`self[`/`document[`/`navigator[` |
| API d'extension | `GM_*`, `GM.*`, `unsafeWindow`, `browser.runtime`/`chrome.runtime` et assimilés |
| Persistance | `localStorage`, `indexedDB`, `openDatabase`, `caches`, `.cookie`, `cookieStore` ; `sessionStorage[…]`, `.clear()`, `.key()`, `.length` ; clé littérale `sessionStorage.*Item('…')` non préfixée `reelfree:` (clé non littérale = avertissement `WARN`, à vérifier en revue) |
| Lecture | `clipboard`, `execCommand` |
| Texte | caractères invisibles ou bidi (Trojan Source), ligne de plus de 400 caractères (minification) |
| Metadata interdites | `@require`, `@connect`, `@updateURL`, `@downloadURL`, `@installURL`, `@resource`, `@include`, `@exclude`, `@inject-into` autre que `content`, `@run-at` autre que `document-start`, `@grant` absent, multiple ou différent de `none`, `@match` hors liste |

`bin/verify --selftest` contrôle que chacune de ces règles attrape un échantillon fautif (59 cas) et qu'un script propre passe.

**Metadata obligatoires** (absence = échec) : `@match https://www.instagram.com/*`, `@run-at document-start`, `@noframes`, `@grant none`.

Le scan est un filet, pas une preuve : il attrape les formes courantes d'obfuscation, pas toutes (ex. `Reflect.get(this, nom)`, chaînes découpées).
La revue manuelle T16 rejette donc aussi tout accès dynamique à des propriétés globales, tout `atob`/encodage inexpliqué et tout code illisible.

## 4. Procédure de vérification avant installation

À faire à **chaque** nouvelle version, avant de copier le fichier sur l'iPhone.

1. **Relire le diff** depuis la dernière version installée : `git diff <tag-précédent> -- src/reelfree.user.js`.
   S'arrêter sur tout ce qui touche au réseau, au stockage, aux metadata ou à des objets globaux.
2. **Lancer la vérification** : `bin/verify src/reelfree.user.js`. Elle doit sortir avec le code 0. Noter le SHA-256 affiché.
3. **Comparer** ce SHA-256 avec celui publié dans le README pour cette version. Ils doivent être identiques caractère pour caractère.
   S'ils diffèrent, on n'installe pas.
4. **Vérifier que les tests sont verts** : `board/last-test.txt` doit indiquer `PASS` à une date postérieure à la dernière modification de `src/`.
5. **Transférer** par un canal privé uniquement : câble USB (Finder/iTunes sous Windows, ou partage de fichiers de l'app Fichiers)
   ou iCloud Drive personnel, dans le dossier configuré dans l'app Userscripts. Pas de messagerie, pas de lien public, pas de raccourcisseur, pas de gist.
6. **Contrôler sur l'iPhone** : ouvrir le fichier dans l'éditeur de l'app Userscripts, vérifier l'en-tête (version, `@match`, `@grant none`, `@noframes`, absence de `@require`/`@updateURL`).
   Si possible, recalculer le SHA-256 (par exemple avec un raccourci iOS local « Générer un hash ») et le comparer au README.
7. **Supprimer** les anciennes versions du dossier Userscripts pour éviter deux scripts actifs.

## 5. Risques résiduels acceptés

- **Délai de détection de 150 à 250 ms** : dans le monde isolé, une navigation SPA d'Instagram n'est vue que par le polling ou par le MutationObserver. Un média interdit peut donc s'afficher pendant une fraction de seconde avant le masque.
- **Reels reçus en message** : ils restent ouvrables un par un, comme prévu par D1, y compris si Arthur s'envoie des liens à lui-même. Il n'y a pas d'enchaînement possible (D3, revue T16).
- **Plafond du fil** : il compte pour la durée de l'onglet (`sessionStorage`). Ouvrir un nouvel onglet le remet à zéro.
- **Confiance dans l'app Userscripts et dans Safari** : un composant compromis côté iOS contourne tous nos contrôles. Accepté (open source, pas d'alternative sans Mac ni compte développeur).
- **Le script a techniquement accès à la session** : c'est inhérent à un userscript sur l'origine `instagram.com`. Réduit par la revue, `bin/verify` et le SHA-256, pas supprimé.
- **Limites du grep** : une exfiltration obfusquée peut échapper à `bin/verify`. Compensé par la revue humaine T16 et la règle « lisible, non minifié ».
- **Détection par Instagram** : le JS de la page peut voir les éléments masqués, le `<style>` injecté et les clés `reelfree:` en `sessionStorage`. Comme le script n'effectue aucune action automatisée, le risque de ban est jugé faible.
- **Fuite partielle du blocage** : après un changement de DOM d'Instagram, un reel du fil ou un bloc suggéré peut s'afficher brièvement avant correction. Le fail-closed couvre les routes interdites, pas chaque élément du fil.
- **Contournement volontaire par Arthur** : hors périmètre technique, traité par Temps d'écran et un code tenu par un tiers.
- **Pas de mise à jour automatique** : un correctif (DOM cassé, faille) n'arrive que lorsqu'Arthur réinstalle. C'est le prix de T1.c.
