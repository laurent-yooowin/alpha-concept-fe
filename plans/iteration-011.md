# Iteration 011 — API et interface Budget prévisionnel

STATUS: COMPLETED

## Roadmap reference

P8B — Budget métier : exposition sécurisée des scénarios matérialisés, catalogue de coûts et page Web Budget prévisionnel.

## Objective

Permettre aux administrateurs d'organisation de consulter, créer, justifier et piloter leurs budgets de prévention, tout en laissant les calculs lourds au worker et en conservant un historique complet des modifications manuelles.

## Existing state

L'itération 010 fournit les tables tenant-scoped, les versions immuables, les sources historiques, l'audit append-only, le calcul exact en centimes et les jobs BullMQ. L'API Prévention existante est réservée aux administrateurs d'organisation et la page Web possède déjà une navigation, des filtres et un suivi asynchrone de jobs. Aucun endpoint ni écran Budget n'existe encore.

## Functional scope

- Ajouter l'onglet `Budget prévisionnel` à l'espace Web Prévention des administrateurs d'organisation uniquement.
- Lister les scénarios et afficher leur dernière version valide, leurs totaux HT, provision, statut et état de mise à jour.
- Créer un scénario avec période budgétaire, taux d'aléas initial et filtres chantier/catégorie applicables.
- Afficher les postes : intitulé, catégorie, priorité, quantité, unité, coût unitaire HT, total, justification, source tarifaire, statut et rapports concernés.
- Permettre la modification manuelle d'un poste et du taux d'aléas par un administrateur, avec source de prix obligatoire dès qu'un montant est renseigné et audit systématique.
- Gérer le catalogue de coûts versionné de l'organisation : consultation, ajout d'une nouvelle version et désactivation sans réécriture de l'historique.
- Déclencher construction/recalcul dans BullMQ et suivre le job sans calcul lourd dans l'API.
- Ajouter la fenêtre `Justifier` avec contexte, observations, décomposition du coût et références aux rapports.
- Conserver la dernière version valide affichée pendant un recalcul.

## Technical scope

- Étendre le module API Prévention avec DTO stricts, service Budget tenant-scoped et endpoints du contrat Roadmap.
- Toutes les lectures et mutations incluent `organizationId`; rôle `ROLE_ADMIN` obligatoire, Hyperadmin et coordinateurs exclus.
- Toute modification manuelle crée une nouvelle version/audit et publie uniquement un job identifiant/version lorsque le recalcul est requis.
- Ajouter des endpoints de statut de job Budget bornés au tenant.
- Étendre `frontend/src/lib/api.ts` et `PreventionPage.tsx`, en extrayant des composants Budget ciblés si nécessaire.
- Réutiliser les composants/filtres et conventions visuelles actuels sans ajouter de dépendance.

## Expected files/modules

- `backend/src/prevention/api/` : contrôleur, DTO, service et tests Budget.
- `backend/src/prevention/budget/` : orchestration des mutations, audit et publication de jobs.
- `frontend/src/lib/api.ts`.
- `frontend/src/components/prevention/PreventionPage.tsx` et composants Budget dédiés éventuels.
- Tests backend/frontend ciblés.

## Agents

- Backend : contrats API, tenant/RBAC, mutations versionnées, audit et jobs.
- Frontend : page Budget, catalogue, formulaires, justification et polling.
- Security : revue indépendante RBAC, tenant, prix, audit et validation des entrées.
- Reviewer : revue finale indépendante du lot intégré.
- Supervisor : contrats, intégration et clôture P8B.

## Execution plan

1. Figer les DTO et réponses API à partir des tables et jobs déjà validés.
2. Implémenter les lectures tenant-scoped : scénarios, détail, lignes, sources et catalogue.
3. Implémenter création, modifications manuelles, versionnement/audit et mise en file des calculs.
4. Ajouter les tests RBAC, cross-tenant, validation monétaire, source obligatoire, concurrence et idempotence.
5. Intégrer l'onglet Budget et les écrans de consultation/édition/catalogue/justification.
6. Ajouter le suivi asynchrone avec maintien de la dernière version valide.
7. Valider backend et frontend, puis effectuer Security et Reviewer.

## Parallelization

Le frontend démarre après fixation du contrat API. Les tests backend et la structure UI peuvent ensuite avancer en parallèle sur des fichiers distincts ; l'intégration finale reste séquentielle.

## Database impact

Aucune nouvelle table attendue. Une migration additive ciblée ne sera créée que si un champ de filtre de scénario ou une contrainte indispensable manque au modèle validé ; aucun historique existant ne sera réécrit.

## API impact

- `GET/POST /prevention/budgets`
- `GET/PATCH /prevention/budgets/:id`
- endpoints ciblés pour recalcul, lignes, justification/sources, catalogue et statut des jobs Budget.
- Réponses paginées/bornées et strictement tenant-scoped.

## Security impact

Revue obligatoire : nouvelles mutations administratives, isolation tenant, validation des montants et sources, protection contre les références cross-tenant, concurrence de versions, audit immuable et absence de contenu sensible dans Redis.

## Validation

- Build et tests backend ciblés API/worker Budget.
- Tests d'autorisation : admin organisation accepté ; coordinateur, Hyperadmin, utilisateur sans organisation et cross-tenant rejetés.
- Tests des DTO et bornes monétaires, source tarifaire obligatoire, version obsolète/concurrence et audit.
- Typecheck/build frontend.
- Vérification fonctionnelle : création, catalogue, poste à chiffrer, poste sourcé, recalcul asynchrone, dernière version visible, justification et liens rapports.
- Régression ciblée de l'espace Prévention existant.

## Acceptance criteria

- Seul un administrateur de l'organisation peut lire ou modifier ses budgets et son catalogue.
- Aucun montant ne peut être saisi ou comptabilisé sans source tarifaire.
- L'API ne réalise aucun calcul budgétaire lourd et retourne un job lors des recalculs.
- Les modifications manuelles sont versionnées, auditables et ne sont jamais écrasées silencieusement.
- L'interface expose les totaux, lignes, statuts, sources et justifications prévus par la Roadmap.
- La dernière version valide reste disponible pendant toute mise à jour.
- Security et Reviewer approuvent l'implémentation intégrée.

## Risks

- Les mutations concurrentes doivent utiliser une version attendue et retourner un conflit explicite plutôt que perdre une saisie.
- Le catalogue étant versionné, une correction de prix crée une nouvelle entrée/version et ne modifie jamais une source historique.
- Les décisions produit encore ouvertes sur les rôles de validation restent interprétées minimalement : seul `ROLE_ADMIN` peut saisir et changer les statuts dans cette itération.

## Expected result

P8B est utilisable de bout en bout par les administrateurs d'organisation : budgets consultables et justifiables, coûts sourcés, édition auditée et recalculs asynchrones fiables.

## Execution record

Implémentation terminée le 2026-09-23.

- API Budget tenant-scoped et réservée aux administrateurs d'organisation : scénarios, détails, postes, catalogue, mutations versionnées et jobs.
- Interface Budget : création et filtres, totaux, postes, verrouillage manuel, catalogue, justification analytique et suivi asynchrone.
- Migrations additives pour filtres mission/catégorie et audit append-only des changements de statut du catalogue.
- Les versions matérialisées conservent leurs filtres ; les lignes manuelles verrouillées survivent au recalcul ; activation et désactivation tarifaires publient les rafraîchissements requis.
- Validation utilisateur : build backend réussi ; 55/55 tests Prévention réussis ; migration MySQL aller/retour/aller et contrôles d'intégrité réussis ; build frontend réussi.
- Le typecheck frontend global reste en échec sur 68 erreurs historiques dans 10 fichiers hors Budget ; aucune erreur ne concerne les composants de cette itération.
- SECURITY_STATUS: PASS.
- REVIEW_STATUS: APPROVED.
- Limitation connue : absence d'infrastructure de tests de composants frontend ; le rendu Budget est couvert par compilation/build et revue ciblée.
