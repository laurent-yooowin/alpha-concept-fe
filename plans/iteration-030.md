# Iteration 030 — Largeur du filtre Chantier dans la modale Budget

STATUS: COMPLETED

## Roadmap reference
P19, correctif de présentation à la suite de P17/P18. L'utilisateur a approuvé le 20/10/2026 sa priorité avant la reprise des itérations 025/026.

## Objective
Donner au filtre « Chantier » de la modale « Périmètre du calcul budgétaire » la même largeur complète que le filtre « Entreprise ».

## Existing state
La modale utilise une grille de deux colonnes à partir du format `sm`. « Entreprise » porte `sm:col-span-2`, mais « Chantier » reste sur une seule colonne ; son contrôle n'occupe donc que la moitié de la largeur disponible.

## Functional scope
Élargir uniquement la ligne « Chantier » à toute la largeur de la grille, sur les tailles d'écran concernées. Préserver l'ordre des filtres, leurs valeurs et tous les comportements de prévisualisation/calcul.

## Technical scope
Aligner la classe de grille du conteneur « Chantier » sur celle d'« Entreprise », sans changer le composant multisélection ni les contrats.

## Expected files/modules
`frontend/src/components/prevention/BudgetPage.tsx`, `frontend/tests/budget-client-dropdown.test.mjs`, `ROADMAP.md` et ce plan.

## Agents
Supervisor pour ce changement UI ponctuel ; Reviewer indépendant si le contrôle de la régression le justifie.

## Execution plan
1. Après approbation, ajouter P19 au roadmap et passer ce plan à `IN_PROGRESS`.
2. Modifier la classe de grille de « Chantier » et ajuster le test de structure.
3. Exécuter les validations locales autorisées et vérifier la modale en largeur mobile et desktop ; clôturer après contrôle.

## Parallelization
Non nécessaire ; une revue indépendante intervient après intégration.

## Database impact
No expected database change.

## API impact
No expected API change.

## Security impact
Aucun changement de droit, de données ou de périmètre tenant ; revue Security non requise.

## Validation
Test frontend ciblé, typecheck et vérification visuelle locale de la modale sur deux tailles d'écran. Aucune production.

## Acceptance criteria
Dans la modale Budget, les contrôles « Chantier » et « Entreprise » occupent chacun toute la largeur de la grille ; les autres filtres et le calcul fonctionnent comme avant.

## Risks
Faible : éviter de modifier la grille générale ou de décaler les autres champs.

## Expected result
Une modale Budget visuellement alignée, sans changement fonctionnel.

## Execution record
Approuvée et terminée le 20/10/2026 ; P19 marqué terminé. Sur `V4.1`, « Chantier » reprend `sm:col-span-2` comme « Entreprise » dans la seule modale Budget ; assertion de contrat ajoutée. Validation locale exécutée par le Supervisor avec l'autorisation antérieure explicite de l'utilisateur : tests frontend 39/39 via `node --import tsx --test tests/budget-client-dropdown.test.mjs tests/budget-ui-contracts.test.mjs`, `npm run typecheck` réussi, `git diff --check` réussi. Recette navigateur authentifiée sur `csps_db_dev` sans confirmation de calcul : largeur des contrôles Chantier et Entreprise identique en desktop (457 px chacun) et mobile (318 px chacun). Reviewer indépendant : APPROVED. Security indépendant non requis : simple mise en page sans changement de données/droits. Aucune modification DB/API ni action en production. Aucune limitation ou dette technique nouvelle identifiée.
