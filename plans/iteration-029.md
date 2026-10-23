# Iteration 029 — Effacer les filtres de la Synthèse

STATUS: COMPLETED

## Roadmap reference
P18, suivi ciblé de P17 à inscrire dans `ROADMAP.md`. L'itération 028 est terminée ; les itérations 025/026 restent ouvertes. L'utilisateur a approuvé le 20/10/2026 la priorité de ce correctif avant leur reprise.

## Objective
Ajouter un bouton « Effacer les filtres » commun aux cinq onglets de la Synthèse, qui réaffiche le périmètre complet de l'organisation.

## Existing state
Les filtres Chantier, Entreprise, Période, Catégorie et Gravité sont partagés entre les cinq onglets et mémorisés en session. Une sélection vide signifie déjà « tous » pour les quatre multisélections. La période accepte « Toute la période ». Chaque filtre peut être vidé séparément, mais aucun bouton ne remet l'ensemble à zéro.

## Functional scope
- Afficher « Effacer les filtres » dans la barre commune, accessible depuis les cinq onglets.
- En un clic, vider Chantier, Entreprise, Catégorie et Gravité ; choisir « Toute la période » ; supprimer les dates personnalisées et les anciens champs scalaires ; revenir à la première page.
- Mettre à jour la sélection mémorisée et recharger immédiatement les données de l'onglet actif. Les autres onglets doivent afficher le même périmètre complet à l'ouverture.
- Ne lancer ni reconstruction ni calcul/recalcul budgétaire. Conserver les jobs déjà lancés et les scénarios enregistrés ; invalider les prévisualisations ou réponses asynchrones attachées à l'ancien périmètre.

## Technical scope
Centraliser l'état initial « tous » et l'action de remise à zéro dans la page parente. Réutiliser les chargements existants et le contrôle de génération du Budget. Préserver le filtrage tenant côté API.

## Expected files/modules
`frontend/src/components/prevention/{PreventionPage.tsx,PreventionPage.css,preventionFilterState.ts}`, `frontend/tests/budget-client-dropdown.test.mjs`, `ROADMAP.md` et ce plan.

## Agents
Supervisor pour l'implémentation et l'intégration ; Reviewer indépendant après validation. Pas d'agent supplémentaire prévu pour ce changement UI ciblé.

## Execution plan
1. Après approbation, acter P18 et sa priorité dans `ROADMAP.md`, puis passer le plan à `IN_PROGRESS`.
2. Ajouter le bouton et la remise à zéro atomique du filtre partagé ; contrôler les états Budget et reconstruction en cours.
3. Ajouter les tests de remise à zéro et de persistance, faire valider localement, obtenir la revue indépendante.

## Parallelization
Non nécessaire : état et barre de filtres sont dans le même composant.

## Database impact
No expected database change.

## API impact
No expected API change.

## Security impact
Aucun changement de droits ou de périmètre tenant ; vérifier qu'un effacement ne réutilise pas un jeton de confirmation d'un ancien périmètre. Pas de revue Security indépendante prévue sauf découverte d'un changement d'autorisation.

## Validation
Tests frontend ciblés sur le bouton, les cinq dimensions, les anciens champs scalaires, la pagination, la session et les commandes inactives ; `npm run typecheck`. Recette locale authentifiée sur plusieurs onglets, notamment Budget, avec sélection active puis effacement. L'utilisateur a explicitement autorisé le Supervisor à exécuter ces contrôles locaux le 20/10/2026 ; aucune action en production.

## Acceptance criteria
Un clic remet tous les contrôles à « tous » et la période à « Toute la période » ; les cinq onglets affichent les données complètes de l'organisation, y compris après navigation et rechargement. Aucun job n'est créé par l'effacement, aucune ancienne réponse ne remplace les nouvelles données, aucun filtre obsolète ne réapparaît.

## Risks
Résultats asynchrones de l'ancien périmètre et prévisualisations déjà ouvertes ; sélection ancienne enregistrée en session ; Budget pouvant ne présenter qu'un scénario matérialisé existant sans lancer de nouveau calcul.

## Expected result
La Synthèse revient immédiatement et durablement à la vue complète de l'organisation depuis n'importe quel onglet.

## Execution record
Approuvée le 20/10/2026 et achevée sur `V4.1` ; P18 marqué terminé. Bouton partagé, remise à zéro atomique de la période/des sélections/des anciens champs scalaires/de la pagination, persistance immédiate en session et invalidation des prévisualisations de reconstruction en vol. Une revue initiale a trouvé qu'un `409` tardif d'une confirmation pouvait rouvrir l'ancien périmètre ; correction intégrée pour supprimer ce retour obsolète tout en continuant à suivre un job accepté. Tests de contrat ajoutés. Validation exécutée par le Supervisor avec autorisation explicite : `node --import tsx --test tests/budget-client-dropdown.test.mjs tests/budget-ui-contracts.test.mjs` 39/39, `npm run typecheck` réussi, `git diff --check` réussi ; premier lancement avec `--experimental-strip-types` inadapté aux fichiers `.tsx`, corrigé sans modifier le code. Recette navigateur authentifiée sur `csps_db_dev` : les cinq dimensions ont été sélectionnées puis effacées ; les cinq onglets conservent le périmètre complet ; aucun POST/PATCH/PUT/DELETE après effacement (seulement GET et prérequêtes CORS OPTIONS). API locale en `preset=ALL` : tableau de bord, tendances, observations, recommandations, références et périmètre Budget répondent 200 et retournent des données. Reviewer indépendant : APPROVED après correction. Security indépendant non requis : aucune modification d'authentification, d'autorisation, d'isolation tenant ou de secret. Aucune modification DB/API ni action en production. Limite : pas de recette visuelle manuelle sur tous les formats d'écran ; recette DOM locale et tests frontend effectués. Pas de dette technique nouvelle identifiée.
