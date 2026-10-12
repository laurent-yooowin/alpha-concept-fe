# Iteration 021 — Libellé du total Budget HT

STATUS: COMPLETED

## Roadmap reference

P8B — affichage du total Budget métier ; ajustement de libellé demandé après la clôture de l'itération 020.

## Objective

Afficher « TOTAL BUDGET HT » à la place de « TOTAL BUDGET RETENU HT » pour le total non filtré et publié.

## Existing state

`BudgetPage.tsx` utilise « TOTAL BUDGET RETENU HT » sur grand écran et « TOTAL RETENU HT » sur mobile pour le même total. Les libellés de total filtré, provisoire et global avec filtre sont distincts et déjà cohérents avec leur périmètre.

## Functional scope

Harmoniser le libellé du total non filtré et publié en « TOTAL BUDGET HT » sur toutes les tailles d'écran. Ne pas changer les montants, calculs, filtres ou autres libellés.

## Technical scope

Modifier uniquement les deux branches responsive du pied de tableau Budget ; adapter un test de présentation ciblé.

## Expected files/modules

`frontend/src/components/prevention/BudgetPage.tsx` et `frontend/tests/budget-ui-contracts.test.mjs`.

## Agents

Supervisor en direct ; revue indépendante légère si nécessaire après validation.

## Execution plan

1. Remplacer les deux libellés du total publié non filtré.
2. Ajouter/vérifier le test ciblé, puis faire passer typecheck et build frontend.
3. Revoir le diff et clôturer P8B sans changement métier.

## Parallelization

Aucune ; changement localisé.

## Database impact

No expected database change.

## API impact

No expected API change.

## Security impact

Aucun changement de sécurité attendu.

## Validation

Test Budget ciblé, typecheck et build frontend. Vérifier que les libellés filtré et provisoire restent inchangés.

## Acceptance criteria

Le total publié, sans filtre, affiche « TOTAL BUDGET HT » sur mobile et grand écran. Les montants et autres états d'affichage restent identiques.

## Risks

Le tableau est condensé en une seule ligne JSX ; limiter l'édition aux libellés exacts.

## Expected result

Un libellé court et uniforme pour le total Budget publié.

## Execution record

Approved by user (`GO`) on 08/10/2026. Replaced the published, unfiltered total label in both responsive branches of `BudgetPage.tsx`; added a targeted presentation assertion in `budget-ui-contracts.test.mjs`. No behavior, database or API changes. With user authorization, 25/25 frontend tests, TypeScript typecheck and production build passed. Build emitted only existing non-blocking Browserslist-age and bundle-size warnings. Final diff/text inspection passed. No Security review required for a label-only change; no independent Reviewer required for this narrow presentation edit.
