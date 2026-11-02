# Fixtures (rf-recon)

**Synthétiques.** Elles ont été construites d'après les sources publiques résumées dans `docs/recon.md`. Elles n'ont **pas** été capturées sur instagram.com, parce qu'aucune session n'était disponible le 2026-11-02.
Elles ne contiennent aucun nom réel, aucun message et aucun token : `user_N`, `FAKE…`, `Lorem`, `Message A`.
Les images ont `src="data:,"`, donc aucune requête réseau.
La seule exception est l'illustration « Vous êtes à jour », qui a un chemin relatif. Elle fera un 404 en local, et ça n'a pas d'importance.

| Fichier | URL à simuler (rf-qa : servir/naviguer à ce chemin) | Points clés |
|---|---|---|
| `home-feed.html` | `/` | 20 `main article` (reel toutes les 5 positions à partir de 3, vidéo non-reel tous les 7), marqueur « à jour », 3 suggérés, loader `progressbar` |
| `reels-feed.html` | `/reels/`, `/reels/FAKEREEL1/` | Doit être masqué et redirigé (R2/R3) |
| `explore.html` | `/explore/` | Grille + champ `Rechercher` (R5) |
| `dm-thread.html` | `/direct/t/FAKETHREAD/` | Reel partagé `a[href="/reel/FAKEDMREEL1/"]` (D1/D2) — **hypothèse** |
| `reel-from-dm.html` | `/reel/FAKEDMREEL1/` | Lecteur en `[role="dialog"]` avec un « reel suivant » (D3/D4) — **hypothèse** |

Chaque page contient la barre de nav du bas (`a[href="/reels/"]`, `a[href="/explore/"]`…, libellés FR).
Les attributs `data-fixture-kind` servent aux assertions de test. **Ils n'existent pas sur le vrai site**, et le userscript ne doit pas s'en servir.
Les classes de type `x78zum5` sont des leurres, pour vérifier qu'aucun sélecteur ne dépend des classes obfusquées (X2).
À remplacer par des captures anonymisées après T17.
