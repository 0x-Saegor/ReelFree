A01 et A03 faits ; A02 (bridge) en cours.

## Livré
- **A03** `tests/vectors/policy.json` : 79 vecteurs, générés par `node tests/vectors/generate.cjs` (`--check` vérifie qu'il est à jour). Test Node : `tests/unit/vectors.test.js`.

## Notes pour @rf-ios (format de policy.json)
- `path` : chemin brut tel que vu dans l'URL, avec éventuellement `?query` ou `#fragment` (à ignorer pour la décision). Il n'est **pas** décodé : le décodage fait partie de la règle (`%2F`, `%5C`, `%2E%2E` donnent `hide`, `X3-path` ; un encodage invalide donne `hide`, `X3-decode`).
- `ctx` (toutes les clés sont optionnelles) :
  - `token: {id, ageMs}` : âge = now − issuedAt. Valide si `0 ≤ ageMs ≤ dmReelTtlMs` et si l'id est identique (casse comprise).
  - `lastThread` : chemin `/direct/t/<id>/`, ignoré s'il ne matche pas `^/direct/t/[A-Za-z0-9_-]{1,128}/?$`.
  - `activeReel` : id du reel déjà admis sur la page (réévaluation de la même URL et D3 vers `/p/<autre>`).
  - `config` : sous-ensemble de `{blockExplore, dmReelTtlMs, feedMode}`. Valeurs par défaut si absentes : `blockExplore: true`, `dmReelTtlMs: 10000`, `feedMode: "limited"`.
- `expect` : `action`, `to` (seulement si redirect), `consumeToken`, `reason`, `mode`, `reelId`. Les modes possibles sont `feed`, `feed-off`, `dm`, `dm-reel`, `post`, `search`, `explore`, `other` et `blocked`.

## Demandes
