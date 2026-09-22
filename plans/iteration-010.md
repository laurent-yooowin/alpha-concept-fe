# Iteration 010 — Fondations Budget prévisionnel

STATUS: IN_PROGRESS

## Roadmap reference

P8B — Budget métier : catalogue de coûts, scénarios et postes budgétaires. Première itération technique du lot P8B ; l'API et l'interface seront livrées dans une itération suivante.

## Objective

Créer le modèle de données tenant-scoped et le moteur worker déterministe permettant de construire et recalculer des scénarios budgétaires versionnés à partir des recommandations Prévention, sans inventer de prix, sans calcul lourd dans l'API et sans écraser les montants validés manuellement.

## Existing state

P1–P7 fournissent catégories, findings, recommandations, scores, snapshots, BullMQ, worker autonome, scheduler durable et isolation par organisation. P8 expose les résultats dans le Web mais exclut volontairement le Budget. Aucune table, entité, job ni règle de calcul budgétaire n'existe encore.

## Functional scope

- Ajouter un catalogue de coûts propre à chaque organisation, avec catégorie, libellé, unité, coût unitaire HT, source du prix, dates de validité et version.
- Ajouter des scénarios budgétaires versionnés par organisation et période budgétaire, distincte de la période d'observation.
- Ajouter les postes : intitulé, catégorie, priorité, quantité, unité, coût unitaire HT, total HT, justification, source tarifaire et statut `À chiffrer`, `Estimé`, `Validé`, `Engagé` ou `Réalisé`.
- Relier chaque poste aux recommandations/findings et rapports sources qui le justifient.
- Construire et recalculer exclusivement dans le worker BullMQ : consolidation des recommandations similaires, quantité × prix, budget retenu, provision et total.
- Laisser tout poste sans tarif sourcé en `À chiffrer`, exclu du total validé.
- Préserver lors d'un recalcul les quantités/tarifs validés manuellement et les statuts verrouillés ; aucune donnée validée ne doit être remplacée silencieusement.
- Utiliser un taux d'aléas par scénario. Proposition soumise à ce GO : valeur initiale provenant de `PREVENTION_BUDGET_CONTINGENCY_RATE_PERCENT` et surcharge persistée par l'administrateur dans les futures API P8B.
- Réserver les futures mutations aux administrateurs d'organisation ; coordinateurs et Hyperadmin restent exclus conformément au module Prévention.

## Technical scope

- Migration additive des quatre tables prévues : `prevention_cost_catalog`, `prevention_budget_scenarios`, `prevention_budget_items`, `prevention_budget_item_sources`, plus une table/journal d'historique si nécessaire pour garantir l'audit des modifications futures.
- Contraintes tenant composites, clés étrangères, index de période/statut, unicité des versions et suppression en cascade uniquement aux frontières d'organisation/scénario appropriées.
- Stocker les montants en décimal fixe MySQL et effectuer les calculs via une représentation déterministe en centimes afin d'éviter les dérives flottantes.
- Définir les jobs `prevention.budget.build`, `prevention.budget.recalculate`, `prevention.budget.refresh-item` et `prevention.budget.reconcile` avec payloads identifiants/version uniquement.
- Ajouter un service de calcul pur testable et un service worker transactionnel publiant atomiquement une nouvelle version complète du scénario.
- Raccorder les créations/modifications/suppressions de recommandations et les changements de catalogue aux jobs ciblés, sans transporter de contenu métier dans Redis.
- Ajouter reprise, déduplication et idempotence compatibles avec l'infrastructure P2–P6.
- Ne pas créer les endpoints ni la page Budget dans cette itération.

## Expected files/modules

- nouvelle migration après `1830000012000-prevention-scheduler.ts`;
- `backend/src/prevention/entities/` pour catalogue, scénarios, postes, sources et historique éventuel;
- `backend/src/prevention/budget/` pour contrats, calculs, orchestration et tests;
- adaptations ciblées du consumer worker, des événements statistiques/extraction et du module worker;
- `.env.example` pour le taux d'aléas initial strictement borné;
- scripts de validation MySQL/Redis ciblés si nécessaires.

## Agents

- Backend : migration, entités, calcul déterministe, jobs et intégration worker.
- Security : revue indépendante tenant, audit, verrouillage des valeurs validées et payload Redis.
- Reviewer : revue finale indépendante des règles métier, transactions et idempotence.
- Supervisor : contrats, intégration, validations et statuts.

## Execution plan

1. Figer les invariants monétaires, les statuts, les sources de prix, les règles de verrouillage et la version d'un scénario.
2. Concevoir puis implémenter la migration additive avec contraintes tenant, audit et rollback.
3. Ajouter les entités et contrats de jobs minimaux.
4. Implémenter le calcul pur : lignes chiffrables, arrondis, budget retenu, provision et total.
5. Implémenter la consolidation/version atomique dans le worker, en conservant les valeurs manuelles verrouillées.
6. Raccorder les déclencheurs ciblés recommandation/tarif et la réconciliation idempotente.
7. Ajouter les tests unitaires et les scénarios MySQL/Redis : isolation, reprise, concurrence, absence de prix inventé et conservation des validations.
8. Obtenir Security et Reviewer avant de clôturer cette fondation P8B.

## Parallelization

La conception/migration et les tests du calcul pur peuvent avancer séparément après fixation des invariants. Un seul propriétaire intégrera le consumer worker afin d'éviter les conflits avec l'infrastructure BullMQ existante.

## Database impact

Migration additive importante avec quatre tables métier minimum, versionnage, historique/audit, index et contraintes tenant composites. Aucun changement destructif des données P1–P8.

## API impact

No expected API change in this iteration. Les endpoints Budget seront proposés après stabilisation du stockage et des workers.

## Security impact

Revue obligatoire. Risques : références cross-tenant, falsification de prix/source, écrasement de montants validés, élévation de privilèges, perte de traçabilité, overflow/arrondis monétaires, payload Redis sensible et concurrence de recalcul.

## Validation

- Build backend et tests unitaires du moteur budgétaire.
- Migration MySQL 8 aller/retour/aller et validation des contraintes tenant/composites.
- Tests sans catalogue : poste `À chiffrer`, aucun montant ajouté aux totaux validés.
- Tests avec tarif versionné : quantité, montant HT, provision et total exacts en centimes.
- Tests de recalcul : conservation des valeurs/statuts verrouillés et nouvelle version atomique.
- Tests de concurrence, déduplication, retry, reprise Redis et réconciliation idempotente.
- Régression ciblée P2–P7.

## Acceptance criteria

- Toutes les données budgétaires sont obligatoirement tenant-scoped, versionnées et auditables.
- Aucun montant n'est créé sans catalogue, devis, barème ou saisie administrateur sourcée.
- Les calculs worker sont déterministes, exacts au centime et publiés atomiquement.
- Un recalcul ne modifie jamais silencieusement une valeur validée/verrouillée.
- Les jobs ne contiennent que des identifiants et versions, sont idempotents et reprenables.
- Les liens vers recommandations et rapports sources sont conservés.
- Aucun calcul budgétaire lourd, endpoint ou UI Budget n'est introduit prématurément.
- Validation, Security et Reviewer sont approuvés.

## Risks

- Le rapprochement automatique recommandation → entrée de catalogue doit rester déterministe ; toute correspondance ambiguë doit produire `À chiffrer` plutôt qu'un prix supposé.
- Les décisions produit encore ouvertes sur le validateur des coûts et le circuit de statuts sont interprétées de façon minimale : seul l'administrateur d'organisation pourra les muter dans la future API. Toute extension à un autre rôle exigera une validation produit.
- Le taux d'aléas proposé doit être confirmé par l'approbation de cette itération ; sa valeur de déploiement restera explicite dans l'environnement et bornée.

## Expected result

Le backend possède une fondation budgétaire sûre et reproductible, prête à être exposée par une API puis une page Web P8B, sans jamais générer de prix non sourcé.

## Execution record

Not started.
