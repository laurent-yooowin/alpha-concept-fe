# Iteration 018 — Rendre le détail du worker partagé visible

STATUS: COMPLETED

## Roadmap reference

Affinement UX de P13, pilotage Hyper Admin et visibilité de l'état du worker partagé. P13R (recette mobile/multi-tenant) reste différée et hors de cette itération.

## Objective

Rendre évident que le badge « Worker partagé : opérationnel » est cliquable et ouvre la modale de détails déjà existante.

## Existing state

Dans `HyperAdminOrganizations.tsx`, le libellé est déjà un bouton qui appelle `openRecovery(org)`, comme le badge Prévention voisin. Il ne comporte toutefois aucun pictogramme d'information ni indice visuel explicite d'ouverture de détails. Le fichier contient des modifications antérieures à préserver.

## Functional scope

Ajouter un pictogramme d'information au bouton « Worker partagé », améliorer son intitulé accessible/infobulle et conserver exactement le même comportement d'ouverture de modale pour tous les états du worker.

## Technical scope

Réutiliser `lucide-react` déjà installé. Modification ciblée du JSX et des classes de focus/hover du bouton existant ; aucune nouvelle modale ni logique de données.

## Expected files/modules

`frontend/src/components/hyperAdmin/HyperAdminOrganizations.tsx` ; ce plan. `ROADMAP.md` seulement pour le statut P13 après approbation et validation.

## Agents

Supervisor en direct ; revue indépendante uniquement si la modification devient plus large que prévu.

## Execution plan

1. Ajouter l'icône et le libellé d'action accessibles au bouton existant.
2. Vérifier la lisibilité et que le clic ouvre toujours la modale actuelle.
3. Faire valider le typecheck frontend et contrôler le diff.

## Parallelization

Aucune ; modification localisée.

## Database impact

No expected database change.

## API impact

No expected API change.

## Security impact

Aucun changement de permission ou de données ; les contrôles Hyper Admin existants restent inchangés.

## Validation

`cd frontend && npm run typecheck` ; contrôle ciblé du rendu/clic dans l'écran Organisations ; `git diff --check`. Commandes à exécuter par l'utilisateur selon la politique du dépôt, sauf instruction explicite contraire.

## Acceptance criteria

Le bouton Worker partagé affiche un pictogramme indiquant la disponibilité de détails, est identifiable au clavier et au pointeur, et ouvre la même modale qu'aujourd'hui. Aucun autre comportement ni libellé métier n'est modifié.

## Risks

Ne pas confondre l'icône d'information avec un lien externe ; conserver la traduction française et les modifications déjà présentes dans le fichier.

## Expected result

L'utilisateur comprend immédiatement qu'il peut cliquer sur l'état du worker pour voir la modale détaillée.

## Execution record

08/10/2026 — GO explicite reçu. Plan passé de `PROPOSED` à `APPROVED`, puis `IN_PROGRESS`. Icône `Info`, infobulle/nom accessible et focus/hover renforcés ajoutés au bouton Worker partagé existant ; `openRecovery(org)` inchangé. `git diff --check` et `npm run typecheck` frontend réussis après autorisation explicite d'exécuter les commandes. L'utilisateur a confirmé que le clic sur le badge ouvre la modale et a relancé le rattrapage EDF depuis celle-ci. Revue indépendante non requise pour cette modification UX localisée ; aucune API, base ou règle métier modifiée. Itération terminée.
