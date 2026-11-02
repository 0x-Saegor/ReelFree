# ReelFree — Guide TestFlight (pour le titulaire du compte Apple Developer)

Merci de prêter ton compte ! Ce guide liste tout ce qu'il faut faire **une seule fois** pour que la CI GitHub publie ReelFree sur TestFlight, puis l'installe sur l'iPhone du testeur.
Il faut compter environ 30 minutes. **Aucun Mac n'est nécessaire** : tout se fait sur le web (developer.apple.com et appstoreconnect.apple.com), et la compilation tourne sur GitHub Actions.

> L'app n'est **jamais** publiée sur l'App Store. Elle reste en **test interne TestFlight**, ce qui ne demande aucune revue Apple.
> Elle n'a ni serveur, ni analytics, ni SDK tiers. Le détail est dans `docs/SECURITY.md`.

## Ce que tu vas créer

| Élément | Où | Sert à |
|---|---|---|
| Identifiant d'app (bundle id) | developer.apple.com | identifier l'app, par exemple `com.tonnom.reelfree` |
| Fiche d'app | App Store Connect | recevoir les builds TestFlight |
| Clé API App Store Connect (`.p8`) | App Store Connect | permettre à la CI de signer et d'envoyer les builds |
| 5 secrets GitHub | dépôt GitHub du projet | transmettre ces informations à la CI |
| Le testeur, en testeur interne | App Store Connect | lui permettre d'installer l'app avec TestFlight |

Les certificats et les profils de provisionnement **ne sont pas à créer** : Xcode les gère tout seul dans la CI (signature automatique, certificat de distribution géré dans le cloud par Apple).

## 1. Enregistrer l'identifiant d'app

1. Va sur <https://developer.apple.com/account/resources/identifiers/list> et clique sur **+**.
2. Choisis **App IDs**, puis le type **App**.
3. Renseigne :
   - **Description** : `ReelFree`
   - **Bundle ID** : *Explicit*, par exemple `com.tonnom.reelfree`. Note-le, c'est le secret `RF_BUNDLE_ID`.
   - **Capabilities** : ne coche rien.
4. Clique sur **Continue**, puis **Register**.

Récupère aussi ton **Team ID** (10 caractères) dans <https://developer.apple.com/account>, rubrique **Membership details**. C'est le secret `APPLE_TEAM_ID`.

## 2. Créer la fiche d'app dans App Store Connect

1. Va sur <https://appstoreconnect.apple.com/apps>, clique sur **+**, puis **New App**.
2. Renseigne :
   - **Platforms** : iOS
   - **Name** : un nom unique sur tout l'App Store, par exemple `ReelFree A` (si le nom est déjà pris, ajoute un suffixe)
   - **Primary Language** : French
   - **Bundle ID** : celui de l'étape 1
   - **SKU** : `reelfree`
   - **User Access** : *Limited Access* si tu veux, la CI n'en a pas besoin
3. Clique sur **Create**. Pas besoin de captures d'écran ni de description : on ne passe pas par l'App Store.

## 3. Créer la clé API App Store Connect

1. Dans App Store Connect, ouvre **Users and Access**, onglet **Integrations**, puis **App Store Connect API**, section **Team Keys**.
   Si c'est la première fois, il faut d'abord cliquer sur **Request Access** (il faut être *Account Holder*).
2. Clique sur **Generate API Key** (ou **+**) :
   - **Name** : `ReelFree CI`
   - **Access** : **Admin**. C'est nécessaire pour que la CI puisse créer le certificat de distribution géré dans le cloud. Avec *App Manager* ou *Developer*, la signature échoue (« Cloud signing permission error »).
3. Télécharge le fichier `AuthKey_XXXXXXXXXX.p8`. **Apple ne permet de le télécharger qu'une seule fois.**
4. Note :
   - le **Key ID** (10 caractères, affiché sur la ligne de la clé) : c'est le secret `ASC_KEY_ID` ;
   - l'**Issuer ID** (un UUID, affiché en haut de la page) : c'est le secret `ASC_ISSUER_ID`.

> ⚠️ Cette clé donne un accès Admin à ton compte App Store Connect. Ne l'envoie **ni par mail, ni par messagerie, ni par un lien de partage**.
> Le plus sûr : tu saisis toi-même les secrets dans GitHub (étape 4). Le propriétaire du dépôt t'ajoute pour ça comme collaborateur du dépôt.
> Une fois les secrets enregistrés, supprime le fichier `.p8` de ton disque, ou range-le dans un gestionnaire de mots de passe.

## 4. Enregistrer les secrets GitHub

Encode d'abord la clé en base64, sur une seule ligne :

- macOS : `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy` (le résultat est copié dans le presse-papiers)
- Linux : `base64 -w0 AuthKey_XXXXXXXXXX.p8`
- Windows (PowerShell) : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard`

Ensuite, dans le dépôt GitHub : **Settings**, **Environments**, **New environment**, nom **`testflight`** (exactement ce nom, le workflow l'utilise).

1. Dans **Deployment branches and tags**, choisis *Selected branches and tags* et ajoute `main` (ou `master`, selon la branche du dépôt) ainsi que le motif de tag `v*`. Ainsi, une autre branche ou une PR ne peut pas utiliser la clé.
2. Ne coche **pas** *Required reviewers* : le build mensuel automatique resterait bloqué en attente d'approbation.
3. Dans **Environment secrets**, ajoute :

| Nom | Valeur |
|---|---|
| `ASC_KEY_ID` | Key ID (étape 3) |
| `ASC_ISSUER_ID` | Issuer ID (étape 3) |
| `ASC_KEY_P8_BASE64` | contenu du `.p8` encodé en base64 (ci-dessus) |
| `APPLE_TEAM_ID` | Team ID (étape 1) |
| `RF_BUNDLE_ID` | bundle id (étape 1), par exemple `com.tonnom.reelfree` |

Ces secrets ne sont jamais affichés dans les logs, GitHub les masque. Le workflow écrit la clé dans un fichier temporaire du runner et l'efface à la fin du job.

## 5. Ajouter le testeur interne

1. **Users and Access**, onglet **People**, bouton **+** : invite le testeur avec son adresse Apple ID.
   - Rôle : le plus restreint possible (par exemple **Developer** ou **Marketing**). Tous les rôles peuvent être testeurs internes.
   - **Apps** : limite l'accès à ReelFree seulement.
2. Le testeur accepte l'invitation qu'il reçoit par mail.
3. Dans **Apps**, **ReelFree**, onglet **TestFlight**, section **Internal Testing**, clique sur **+** pour créer un groupe, par exemple `Testeurs` :
   - coche **Enable automatic distribution**, pour que chaque nouveau build lui arrive sans intervention ;
   - ajoute le testeur au groupe.
4. Sur son iPhone, le testeur installe l'app **TestFlight** depuis l'App Store, puis accepte l'invitation ReelFree.

## 6. Premier build

1. Dans GitHub : **Actions**, workflow **testflight**, **Run workflow** (branche `main`).
2. Le workflow lance d'abord les tests (`ci.yml`), puis l'archive et l'envoi. Compte 15 à 25 minutes.
3. Apple traite ensuite le build pendant 10 à 30 minutes. Il apparaît alors dans l'onglet TestFlight, puis chez le testeur.
4. Le build porte le numéro `run_number` du workflow. Le numéro de version vient de `ios/project.yml`, ou du tag `vX.Y.Z` s'il y en a un.

**Conformité export** : l'app n'utilise que le HTTPS du système. L'`Info.plist` déclare donc `ITSAppUsesNonExemptEncryption = NO`, et TestFlight ne pose pas la question. Si TestFlight affiche quand même « Missing Compliance », réponds *None of the algorithms mentioned above*.

## 7. Ensuite : rien à faire

- Un build TestFlight **expire au bout de 90 jours**. Le workflow se relance automatiquement **le 1er de chaque mois** : le testeur a toujours un build valide.
- Un tag `vX.Y.Z` poussé sur le dépôt déclenche aussi un build.
- ⚠️ Le dépôt est **public**. GitHub y désactive les workflows planifiés après 60 jours sans commit, et prévient par mail. Il suffit alors d'aller dans **Actions**, **testflight**, puis **Enable workflow**, ou de pousser un commit. Sinon, le build expire 90 jours après le dernier envoi.
- Dépôt public, donc logs publics : la CI n'affiche que les lignes d'erreur filtrées (pas le nom de l'identité de signature) et ne publie aucun artefact de l'archive. Les secrets restent masqués par GitHub, et les PR venant de forks n'y ont pas accès.
- L'abonnement Apple Developer (99 $/an) doit rester actif. S'il expire, les builds TestFlight cessent de fonctionner.

## 8. Arrêter ou révoquer

- **Révoquer la clé** : Users and Access, Integrations, App Store Connect API, **Revoke** sur `ReelFree CI`. La CI ne peut alors plus rien envoyer.
- Supprime ensuite l'environnement `testflight` dans GitHub.
- Pour retirer l'app au testeur : TestFlight, groupe interne, retire-le du groupe, ou fais **Expire Build**.

## Dépannage

| Message dans les logs | Cause probable | Correction |
|---|---|---|
| `missing secrets: ...` | Un secret manque ou n'est pas dans l'environnement `testflight` | Étape 4 |
| `ASC_KEY_P8_BASE64 does not decode to a .p8 key` | Base64 mal copié (retours à la ligne, espaces) | Réencoder sur une seule ligne |
| `Cloud signing permission error` | Clé API sans rôle Admin | Recréer la clé avec l'accès **Admin** |
| `No profiles for '<bundle id>' were found` / `No Account for Team` | `APPLE_TEAM_ID` ou `RF_BUNDLE_ID` faux, ou App ID non enregistré | Étapes 1 et 4 |
| `Error Downloading App Information` / `No suitable application records were found` | Pas de fiche d'app pour ce bundle id dans App Store Connect | Étape 2 |
| `The bundle version must be higher than the previously uploaded version` | Numéro de build déjà utilisé (dépôt recréé, `run_number` repart à 1) | Prévenir le mainteneur : il ajoute un décalage au numéro de build dans `testflight.yml` |
| Le build n'apparaît pas chez le testeur | Il n'est pas dans le groupe interne, ou la distribution automatique est désactivée | Étape 5 |
