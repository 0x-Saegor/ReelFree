# Installer ReelFree sur iPhone (sans Mac)

Guide pour Arthur : iPhone 11, PC Linux, pas de Mac ni de compte Apple Developer.
Le script `src/reelfree.user.js` est exécuté dans Safari par l'app gratuite et open source **Userscripts** (quoid/userscripts).

> Libellés iOS : depuis iOS 18, les réglages des apps sont regroupés sous **Réglages > Apps**. Sur une version plus ancienne,
> remplace « Réglages > Apps > Safari » par « Réglages > Safari ». Les libellés peuvent légèrement varier selon la version.

---

## 1. Prérequis

1. iPhone 11 sous **iOS 15 ou plus récent** : l'App Store indique « Nécessite iOS 15.0 ou version ultérieure » pour Userscripts
   (le README du dépôt GitHub parle d'iOS 15.1). ReelFree exige en plus **iOS 15.4 ou plus**, car son CSS utilise le sélecteur `:has()` (Safari 15.4). Vérifier dans Réglages > Général > Informations > Version d'iOS. L'iPhone 11 reçoit les versions récentes d'iOS, il n'y a donc pas de problème en pratique.
   Pour vérifier ta version : **Réglages > Général > Informations > Version d'iOS**.
2. Safari comme navigateur pour Instagram. Les extensions de l'app Userscripts ne fonctionnent pas dans les autres navigateurs iOS.
3. Un compte iCloud n'est utile que pour la méthode de transfert recommandée (§3). Il ne sert pas à faire tourner le script.
4. Sur le PC Linux : le dépôt ReelFree et `bin/verify`.

## 2. Installer et configurer Userscripts

### 2.1 Installer l'app
1. Ouvre l'App Store et cherche **Userscripts**. Le développeur doit être **Justin Wasack** et l'app est gratuite.
   Méfie-toi des imitations. Le code source se trouve sur `github.com/quoid/userscripts`.
2. Installe l'app puis ouvre-la une fois.

### 2.2 Choisir le dossier des scripts
Depuis la v1.5.0, l'app crée automatiquement un dossier local par défaut. Le bouton **Set Userscripts Directory** permet de le changer.

| Option | Où | Avantages | Inconvénients |
|---|---|---|---|
| **Recommandé : local** | app Fichiers > **Sur mon iPhone** > `Userscripts` | Rien n'est synchronisé et aucun autre appareil ne peut modifier le script | Le transfert depuis le PC demande une étape de plus |
| iCloud Drive | app Fichiers > **iCloud Drive** > un dossier | On dépose le fichier depuis icloud.com, il apparaît directement | Tout appareil ou toute session iCloud compromise peut **remplacer le script en silence**. La synchro peut prendre du retard et iCloud peut décharger le fichier (« Optimiser le stockage ») : il faut alors activer « Garder téléchargé » sur le dossier |

Choisis le **dossier local**. iCloud Drive sert seulement de zone de transit (§3). Le script actif ne doit jamais se trouver dans un dossier iCloud.

### 2.3 Activer l'extension dans Safari
1. Va dans **Réglages > Apps > Safari > Extensions > Userscripts** et active l'extension.
2. Laisse **Navigation privée** désactivée pour l'extension, sauf si tu utilises Instagram en navigation privée (voir §7).
   L'app Userscripts ne sait pas détecter si son extension est activée : vérifie-le toi-même.

### 2.4 Autoriser l'extension seulement sur Instagram
Le README de Userscripts conseille « Toujours autoriser » sur « Tous les sites web ». **Ne le fais pas** : ReelFree n'a besoin que d'Instagram.

1. Dans **Réglages > Apps > Safari > Extensions > Userscripts**, règle **Tous les sites web** (ou « Autres sites web ») sur **Refuser**, ou à défaut sur **Demander**.
2. Ouvre `https://www.instagram.com` dans Safari.
3. Appuie sur le bouton de menu de la barre d'adresse (icône « AA » ou icône de page selon la version d'iOS), puis sur **Gérer les extensions** ou directement sur **Userscripts**.
4. Choisis **Toujours autoriser…** puis **Toujours autoriser sur ce site web**. N'appuie pas sur « … sur tous les sites web ».
5. Retourne dans **Réglages > Apps > Safari > Extensions > Userscripts**. La liste ne doit contenir que `www.instagram.com` avec **Autoriser**.
6. Bonus YouTube (plus tard) : refais les étapes 2 à 4 sur `m.youtube.com` (et `www.youtube.com` si besoin), mais seulement une fois `reelfree-youtube.user.js` installé.

Le script est de toute façon limité à Instagram par `@match https://www.instagram.com/*`. Restreindre la permission ajoute une seconde barrière : si un script indésirable se retrouve dans le dossier, il ne pourra pas s'exécuter ailleurs.

## 3. Transférer le fichier depuis le PC Linux

AirDrop n'existe pas sous Linux. Apple ne fournit ni iTunes ni Finder pour Linux, donc pas de partage de fichiers par câble.
Il existe des outils non officiels (libimobiledevice/ifuse), mais ils sont fragiles et ne donnent pas forcément accès au dossier de l'app : on les écarte.

| Méthode | Verdict | Risques |
|---|---|---|
| **icloud.com > iCloud Drive** dans le navigateur du PC, puis déplacement dans Fichiers | **Recommandée** | Passe par ton compte Apple, en HTTPS et authentifié. Le fichier transite sur iCloud : on le supprime après l'avoir déplacé |
| Serveur HTTP local sur le LAN, ouvert dans Safari, puis **Télécharger** | Bonne alternative, sans cloud | HTTP en clair sur le Wi-Fi : un appareil malveillant du réseau pourrait modifier le fichier. À faire seulement sur ton Wi-Fi domestique, puis vérifier le SHA-256 (§4) |
| E-mail à soi-même, ou note à soi-même dans Signal | Possible | Le fichier passe par un serveur tiers (e-mail). Certaines apps renomment le fichier ou modifient son encodage. Revérifie toujours le SHA-256 |
| AirDrop, câble USB avec Finder/iTunes | Impossible sous Linux | — |

### 3.1 Méthode recommandée : iCloud Drive comme zone de transit
1. Sur le PC, vérifie le fichier (§4.1).
2. Ouvre `https://www.icloud.com`, puis **Drive**, et téléverse `reelfree.user.js`.
3. Sur l'iPhone, ouvre **Fichiers > iCloud Drive** et attends que le fichier soit téléchargé (le nuage disparaît).
4. Fais un appui long sur le fichier, choisis **Déplacer**, puis **Sur mon iPhone > Userscripts** (le dossier choisi au §2.2).
5. Vérifie le fichier sur l'iPhone (§4.2).
6. Supprime la copie restée dans iCloud Drive.

### 3.2 Alternative : serveur HTTP local
1. Sur le PC, dans le dépôt : `python3 -m http.server 8000 --bind <IP-LAN-du-PC> --directory src`.
2. Sur l'iPhone, connecté au **même Wi-Fi domestique**, ouvre dans Safari `http://<IP-LAN-du-PC>:8000/reelfree.user.js`.
3. Partage puis **Enregistrer dans Fichiers**, ou utilise le menu **Télécharger**. Choisis le dossier **Sur mon iPhone > Userscripts**.
   (Userscripts peut aussi proposer d'installer un `.user.js` ouvert dans Safari, mais il faudrait autoriser l'extension sur cette adresse : on ne le fait pas.)
4. Arrête le serveur (Ctrl+C) dès que le téléchargement est fini.
5. Vérifie le fichier (§4.2). L'extension doit être `.user.js` : si Safari a ajouté `.txt`, renomme le fichier.

## 4. Vérifier l'intégrité AVANT d'activer

### 4.1 Sur le PC (obligatoire)
1. `bin/verify src/reelfree.user.js` : la commande doit se terminer par `OK sha256=<12 premiers caractères>`.
   Si elle affiche autre chose, **arrête-toi** : le script contient une API interdite ou il est corrompu.
2. `sha256sum src/reelfree.user.js` : compare l'empreinte complète avec celle publiée dans le `README.md` pour cette version. Elle doit être **identique, caractère pour caractère**.

### 4.2 Sur l'iPhone
L'app Userscripts pour iOS **n'a pas d'éditeur intégré** (d'après son README). Pour lire le fichier, utilise l'aperçu de l'app Fichiers ou un éditeur de code tiers.

1. **Contrôle de l'en-tête** : dans Fichiers, appuie sur le fichier pour ouvrir l'aperçu et vérifie :
   - `@version` correspond à la version annoncée dans le README ;
   - `@match https://www.instagram.com/*`, `@run-at document-start`, `@noframes` ;
   - `@grant none` ;
   - **aucune** ligne `@require`, `@connect`, `@updateURL` ou `@downloadURL`.
2. **Empreinte SHA-256 (recommandé)** : l'app Raccourcis propose une action **« Générer le hachage »** (Generate Hash) avec le choix SHA256.
   Crée un raccourci « SHA-256 ReelFree » :
   1. action **Sélectionner un fichier** ;
   2. action **Générer le hachage**, avec le type **SHA256** ;
   3. action **Afficher le résultat** (ou **Copier dans le presse-papiers**).
   Lance-le sur `reelfree.user.js` et compare le résultat avec le README. Si l'action n'apparaît pas sur ta version d'iOS,
   fie-toi à la vérification faite sur le PC et au contrôle de l'en-tête.
3. Si quelque chose ne correspond pas, supprime le fichier et recommence le transfert.

## 5. Bloquer l'app Instagram avec Temps d'écran

1. **Réglages > Temps d'écran** : active Temps d'écran si ce n'est pas déjà fait.
2. Choisis **Utiliser un code Temps d'écran** (ou « Verrouiller les réglages de Temps d'écran »). Deux options :
   - le faire saisir par **quelqu'un d'autre**, qui le garde ;
   - ou choisir un code **aléatoire** que tu ne mémorises pas : note-le sur papier et range-le hors de portée.
   Le code Temps d'écran doit être **différent** du code de déverrouillage de l'iPhone.
3. **Limites d'app > Ajouter une limite** : catégorie **Réseaux sociaux** > coche **Instagram** > **Suivant**, puis **1 min** par jour.
   Active **Bloquer à la fin de la limite**, sans quoi un simple « Ignorer la limite » suffit à contourner le blocage.
4. Variante plus stricte : **Contenu et confidentialité** (active-le), puis **Achats sur l'App Store / iTunes**. Interdire les **suppressions d'apps** et les **installations d'apps** empêche de contourner la limite en réinstallant l'app.
   Tu peux aussi simplement **supprimer l'app Instagram** et interdire les installations.
5. **Ne bloque pas `instagram.com` dans Safari** : sous **Contenu et confidentialité > Contenu de l'App Store, web, etc. > Contenu web**, le site doit rester accessible.
   Bloquer les Reels dans Safari, c'est précisément le rôle du script.
6. Évite d'ajouter Safari aux limites d'app, sinon ReelFree devient inutilisable.

## 6. Mises à jour

Il n'y a **aucune mise à jour automatique** : le script n'a pas de `@updateURL` ni de `@downloadURL`, et la fonction de mise à jour de Userscripts n'est de toute façon pas fiable.

1. Récupère la nouvelle version sur le PC et lis le changelog ou le diff.
2. Refais la §4.1 avec le **nouveau** SHA-256 du README.
3. Transfère le fichier (§3) et **remplace** `reelfree.user.js` dans le dossier Userscripts, sans garder de doublon (`reelfree 2.user.js`, etc.).
4. Refais la §4.2 (vérifier `@version` et le SHA-256), puis recharge Instagram dans Safari.

## 7. Dépannage

| Symptôme | Vérifications |
|---|---|
| Le script ne fait rien | 1) Extension activée (§2.3). 2) Permission **Autoriser** pour `www.instagram.com` (§2.4). 3) Fichier bien rangé dans le dossier choisi dans l'app, avec l'extension `.user.js`. 4) Recharge la page, ou ferme l'onglet et rouvre-le. 5) Dans l'app Userscripts, vérifie que le script est listé et activé |
| Fonctionne en navigation normale, pas en navigation privée | Autorise l'extension en **Navigation privée** dans **Réglages > Apps > Safari > Extensions > Userscripts**, ou n'utilise pas la navigation privée |
| Le script a cessé de marcher après une mise à jour d'iOS | Revérifie l'activation et les permissions (§2.3 et §2.4) : une mise à jour d'iOS peut les réinitialiser |
| Instagram affiche « Ouvrir dans l'app » ou une bannière d'app | **Refuse** (« Pas maintenant » ou la croix) et reste dans Safari. Si un lien te bascule vers l'App Store, reviens à Safari : l'app est bloquée de toute façon |
| `instagram.com` ouvert sur `m.` ou sur une autre URL | Le script ne cible que `www.instagram.com`. Utilise cette adresse et ajoute-la à l'écran d'accueil si tu veux |
| Le fichier a disparu ou est grisé (dossier iCloud) | C'est pour ça qu'on utilise le dossier **Sur mon iPhone** (§2.2). Remets le fichier en local |
| Une page interdite (Reels) reste masquée par erreur | C'est voulu (fail-closed) : le contenu reste masqué quand la détection échoue. Signale le cas pour qu'on corrige la détection |
