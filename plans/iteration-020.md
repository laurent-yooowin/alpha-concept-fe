# Iteration 020 — Total Budget sans aléas et actualisation immédiate

STATUS: COMPLETED

## Roadmap reference

P8B — consultation de la dernière version budgétaire matérialisée et suivi des jobs. Modification métier demandée le 08/10/2026 : abandonner la provision pour aléas ; après approbation, mettre `ROADMAP.md` à jour pour que `total HT = somme des montants des postes retenus HT`.

## Objective

Afficher le total Budget comme la somme normale des montants des postes, sans aléas, et actualiser automatiquement le périmètre visible après recalcul/réconciliation.

## Existing state

La base EDF locale contient 32 550 € HT de postes dans les scénarios borné et `ALL` ; `ALL` enregistre encore 10 % d'aléas et 35 805 € HT de total. Le défaut backend est 10 % lorsqu'aucune variable d'environnement n'est définie ; plusieurs chemins de création, recalcul, édition et consolidation reprennent le taux stocké. Le front ne recharge pas systématiquement le périmètre visible à la fin d'un job et peut relire `ALL` avant sa réconciliation asynchrone. Les versions historiques sont auditables et ne doivent pas être effacées.

## Functional scope

- Tout nouveau calcul, recalcul, rapprochement, ajustement humain et scénario global produit `totalBudgetHt = retainedBudgetHt` et `contingencyAmountHt = 0`, sans ajout d'aléas. Le taux positif n'est plus accepté dans les commandes administratives ; les champs techniques existants restent compatibles mais valent zéro pour les nouvelles versions.
- Mettre à jour les derniers scénarios publiés qui ont encore des aléas par une nouvelle version à 0 %, sans relancer l'IA, changer les postes/prix/statuts humains ni réécrire les anciennes versions historiques.
- À la fin d'un job Budget, relire la sélection affichée et le total global sans modifier les filtres. Suivre de façon bornée la publication asynchrone de `ALL` pour éviter un total figé jusqu'à F5.
- Supprimer toute mention des aléas dans l'écran Budget ; le total global publié, filtré ou provisoire est la somme des montants retenus disponibles, selon les règles de déduplication existantes.

## Technical scope

Adapter le calculateur et tous les chemins de publication backend pour imposer un taux nul ; supprimer le défaut configurable positif et refuser les écritures API non nulles. Prévoir un rattrapage versionné, idempotent et tenant-scoped des derniers scénarios avec aléas, exécuté de façon contrôlée hors jobs actifs ; conserver les champs de schéma pour compatibilité et audit. Centraliser le rafraîchissement en lecture seule du périmètre visible dans `BudgetPage`, puis suivre de façon bornée une réconciliation tardive sans moteur de total côté front.

## Expected files/modules

`backend/src/prevention/budget/prevention-budget.calculator.ts`, `prevention-budget.service.ts`, `prevention-budget.config.ts`, `backend/src/prevention/api/prevention-budget-api.service.ts`, DTO et tests proches ; commande ou migration de rattrapage versionné ; `frontend/src/components/prevention/BudgetPage.tsx`, contrats/tests UI ; `ROADMAP.md` après GO.

## Agents

Supervisor pour l'intégration ; spécialistes backend/frontend si utiles ; Security indépendant pour le rattrapage multi-tenant ; Reviewer indépendant après validation.

## Execution plan

1. Amender la règle P8B dans `ROADMAP.md` et verrouiller le contrat total = somme des postes, sans aléas.
2. Corriger tous les chemins backend qui créent ou recalculent un total, ainsi que les entrées API encore capables d'introduire un taux positif.
3. Publier une version corrigée des derniers scénarios concernés, sans nouveau chiffrage IA et sans mutation des historiques ; valider d'abord le périmètre réel du rattrapage.
4. Corriger l'actualisation de l'écran et enlever les libellés liés aux aléas.
5. Faire exécuter validations backend/frontend et recette EDF locale, puis Security et Reviewer.

## Parallelization

Backend et frontend sur fichiers distincts après stabilisation du contrat de total ; rattrapage de données après les tests, puis revues indépendantes.

## Database impact

Pas de changement de schéma attendu. Rattrapage de données versionné et audité pour les derniers scénarios avec taux positif ; aucune suppression ni réécriture des anciennes versions. Exécution ciblée/contrôlée après inspection des volumes et des jobs actifs.

## API impact

Contrat de réponse conservé pour compatibilité (`contingencyRatePercent`, `contingencyAmountHt`), avec zéro dans les nouvelles versions. Les commandes créant ou modifiant un scénario refusent un taux positif. Pas de nouvel endpoint prévu.

## Security impact

Le rattrapage doit rester strictement tenant-scoped et conserver les montants/statuts humains. Revue Security indépendante requise avant clôture.

## Validation

Tests calculateur/API/worker sur total sans aléas, refus des taux positifs, statuts et montants humains préservés, rattrapage idempotent et isolation ; tests UI sur actualisation tardive et absence du libellé « aléas » ; build/typecheck backend et frontend. Recette EDF locale : sans nouveau chiffrage IA pour corriger l'ancien `ALL`, constater 32 550 € HT de total, puis relancer un calcul et vérifier l'actualisation sans F5.

## Acceptance criteria

Pour chaque version courante publiée, `totalBudgetHt = retainedBudgetHt` et les aléas valent zéro. Dans l'exemple EDF, `ALL` passe de 35 805 € à 32 550 € HT sans changer les 9 lignes à 32 550 € HT ; l'ancienne version reste consultable pour audit. Aucun montant/statut humain n'est modifié. Après un recalcul, le total visible se met à jour sans F5 et sans changer les filtres ; aucun libellé d'aléas n'apparaît dans la vue métier.

## Risks

Les anciennes versions conservent des taux non nuls pour audit ; ne pas les confondre avec la version courante. Éviter un rattrapage pendant un job actif ou une validation humaine concurrente. La réconciliation peut être retardée ou ne pas concerner le périmètre visible ; le suivi UI doit être borné et annulable.

## Expected result

L'utilisateur voit un total Budget égal à la somme normale des postes, sans aléas, actualisé sans F5 après publication.

## Execution record

Approved by user (`GO`) on 08/10/2026. Backend calculations, global reconciliation, admin cloning and DTO validation now enforce a zero contingency and a total equal to retained lines; historical schema fields remain for compatibility. The Budget UI removes aléas wording and polls the published visible/global scope for a bounded period after jobs. A tenant-scoped, versioned, idempotent recovery command copies items and sources, preserving human locks and prior versions, with a dry-run default and active-run guard. No schema or endpoint change.

Validation executed with user authorization: backend targeted tests 66/66, backend build passed; frontend tests 24/24, typecheck and production build passed. EDF local dry-run found 4 affected scenarios and no active global run; apply published 4 new versions; follow-up dry-run found 0. Read-only SQL verified all 5 current EDF scenarios have retained/total 32 550.00 HT and zero aléas; new and preceding versions each have 9 lines summing 32 550.00 HT. Cross-tenant inventory found no other current scenarios needing correction. Security independent review: PASS. Reviewer: CHANGES_REQUIRED for UI behavioral coverage and roadmap wording; both corrected and revalidated; final REVIEW_STATUS: APPROVED.

Known limitation: browser deployment/restart and live user interaction were not part of this local validation. Historical versions retain their original 10 % values for audit.
