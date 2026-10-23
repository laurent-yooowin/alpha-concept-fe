# Iteration 028 — Filtres multiples et libellés Synthèse

STATUS: COMPLETED

## Roadmap reference
P17, demande du 20/10/2026. P16 est terminé ; les itérations 025/026 restent ouvertes. La priorité de cette nouvelle itération avant leur reprise nécessite l'approbation de ce plan.

## Objective
Permettre des sélections multiples cohérentes sur les cinq pages Web Prévention et leurs traitements, avec Chantier puis Entreprise en tête des filtres, et présenter l'espace sous le nom « Synthèse ».

## Existing state
Période et Client sont déjà respectivement à sélection unique et multiple. Chantier, Catégorie et Gravité sont uniques dans l'UI et les API ; les scénarios Budget persistés stockent leurs valeurs scalaires. La reconstruction persistée stocke déjà les chantiers résolus, mais sa demande n'accepte qu'un chantier. L'espace garde les libellés « Prévention » et « Prévention des Risques SPS ».

## Functional scope
- Barre commune aux cinq pages : Chantier multisélection → Entreprise multisélection → Période unique → Catégorie multisélection → Gravité multisélection. Même comportement dans la modale de calcul Budget ; choix conservés lors de la navigation et du rechargement. « Entreprise » remplace « Client » uniquement comme libellé visible du filtre ; le contrat métier sous-jacent reste inchangé.
- Plusieurs valeurs d'une même dimension se combinent par union ; les dimensions se combinent par intersection. Aucune valeur sélectionnée signifie « tous ». Un client incompatible avec les chantiers choisis retire uniquement ces chantiers, sans élargir silencieusement les résultats.
- Appliquer ce périmètre aux compteurs, listes, graphiques, références, pagination, totaux et lecture Budget ; prévisualisation, calcul/recalcul, résultat et identité de scénario Budget doivent coïncider avec la sélection confirmée.
- Reconstruction manuelle : plusieurs clients et chantiers, rapports entiers de leur intersection. Période, Catégorie et Gravité restent uniquement des filtres d'affichage ; rattrapage Hyper Admin inchangé.
- Navigation latérale « Synthèse » ; titre de page « Synthèse des Risques SPS » ; filtre visible « Entreprise ». Garder la route `/prevention` et les noms techniques API pour compatibilité.

## Technical scope
Ajouter des listes bornées et canoniques `missionIds`, `categoryIds`, `severities` aux contrats et requêtes, avec prise en charge des paramètres scalaires existants. Propager les listes aux lectures, clés de scope Budget, jetons de confirmation, jobs/reprises et projections matérialisées. Préserver les scénarios et montants humains déjà enregistrés. Réutiliser ou généraliser le composant multisélection sans nouvelle dépendance.

## Expected files/modules
`frontend/src/components/Layout.tsx`, `frontend/src/components/prevention/{PreventionPage,BudgetPage,ClientMultiSelect,budgetUiContracts}.tsx/ts`, `frontend/src/lib/api.ts`, DTO/services/tests ciblés sous `backend/src/prevention/{api,budget,scheduler}`, une migration additive sous `backend/src/migrations`, et `ROADMAP.md`/ce plan. Liste finale à affiner après inspection ciblée.

## Agents
Supervisor pour l'intégration ; implémentation backend/frontend ciblée seulement si la séparation des fichiers le justifie. Revue Security indépendante pour les périmètres tenant/jobs, puis Reviewer indépendant.

## Execution plan
1. Figer les règles de normalisation, compatibilité scalaire et identité de scope.
2. Ajouter la migration additive et propager les listes aux lectures, prévisualisations, jobs Budget/Reconstruction et reprises.
3. Adapter les contrôles multisélection, l'ordre, la persistance et les deux libellés visibles.
4. Étendre les tests, valider en développement avec compte local et comparer affichage/prévisualisation, puis obtenir les revues indépendantes.

## Parallelization
API/contrats d'abord ; UI ensuite sur le contrat stabilisé. Écritures chevauchantes séquentielles ; revues après intégration.

## Database impact
Migration additive attendue pour persister les listes de périmètre Budget tout en conservant les champs/scénarios scalaires existants ; aucune suppression ni réécriture destructive de données. Reconstruction : réutiliser `scopeMissionIds` si suffisant.

## API impact
Paramètres optionnels multivalués pour chantier, catégorie et gravité ; compatibilité avec les paramètres singuliers actuels. Validation bornée, canonisation et rejet des demandes ambiguës ; jetons de confirmation liés au périmètre exact.

## Security impact
Validation de chaque chantier/catégorie dans l'organisation de l'administrateur, plafonds de sélection, isolation tenant des lectures/jobs/reprises ; aucune extension du périmètre en cas de sélection incompatible ou de jeton périmé. Revue Security requise.

## Validation
Tests API/worker sur union/intersection, volumes, pagination, scénarios et reprises ; tests frontend de persistance/ordre/libellés et des deux modales ; typecheck/build. Commandes utilisateur ciblées : `node -r ts-node/register --test` sur les cinq specs Prévention API/Budget/Rebuild/worker concernées, `npm run build` dans `backend`, `node --experimental-strip-types --test` sur les deux contrats frontend, puis `npm run typecheck` dans `frontend`. Migration et recette authentifiée uniquement sur `csps_db_dev` après sauvegarde vérifiée : comparer compteurs et rapports avec deux chantiers/entreprises/catégories/gravités, vérifier l'intersection vide et l'absence de job avant confirmation, puis reconstruire/calculer un périmètre local borné. Aucun test ni déploiement en production dans cette itération.

## Acceptance criteria
Quatre filtres multisélection et période unique sur les cinq pages ; ordre Chantier → Entreprise → Période → Catégorie → Gravité et libellés demandés, y compris « Entreprise » dans la modale Budget ; résultats et totaux exacts ; prévisualisation et traitement du même périmètre ; compatibilité des anciennes sélections/scénarios ; montants humains préservés ; tests, recette locale, Security et Reviewer approuvés.

## Risks
Clés de scénario et jobs existants avec champs scalaires ; doubles comptes entre chantiers/catégories ; filtres de gravité « critique » dérivés ; coexistence de montants humains et estimations IA ; limite de taille des listes. Ne pas transformer la reconstruction en filtre par catégorie/gravité.

## Expected result
Une « Synthèse des Risques SPS » dont filtres, calculs et reconstructions manuelles respectent exactement les sélections multiples confirmées, sans toucher à la production.

## Execution record
Approved by the user on 20/10/2026 and implemented on `V4.1`; no production action. Shared multiselect UI/order/labels, tenant-scoped read/Budget/manual-rebuild contracts, canonical scope identity, scalar compatibility and fail-closed targeted materialized writes are integrated. The additive migration `1830000040000` was applied only to `csps_db_dev` after a complete 600-permission backup (`../alpha-concept-fe-backups/pre-iteration-028-csps_db_dev-2026-10-20.sql`, SHA-256 `c1c240b9a690e7d789e53f05a5c77d5d287d917b766a01d2ccf56f83ece2117b`). Existing 1,493 budget scenarios remained present.

Supervisor-executed local validation under the user's explicit instruction: 106/106 targeted backend tests; backend build; 37/37 targeted frontend tests; frontend typecheck. Authenticated `alphaconcept` recipe: two missions 1+4=5 reports, incompatible mission/enterprise intersection 0, five read endpoints and both previews successful. A one-report scoped manual rebuild completed (1 processed, 0 failed); a one-report/two-category/two-severity filtered budget preview measured 11 recommendations and 7 estimation work units, then produced a CALCULATED scenario with 6 items and 7,560.00 HT. All 11 linked findings belong to the selected mission/categories; no pilot job failed. Local backend/worker processes stopped afterward. Independent Security: PASS; independent Reviewer: APPROVED. Known limitation: no separate visual browser walkthrough was available; UI order, labels, dropdown rendering and behavior were covered by frontend tests. Production migration/deployment is explicitly outside this iteration.
