# Iteration 001 — Cadrage Prévention et contrat de navigation

STATUS: COMPLETED

## Roadmap reference

Phase: Plan de production et suivi — Prévention par organisation
Task: P0 — Cadrage — Inventaire exact de la sidebar HTML et mapping des routes

## Objective

Établir le contrat fonctionnel et architectural des futures pages Prévention sans modifier l'application, la base, les API ou l'infrastructure.

## Existing state

- Aucun module, écran, endpoint, worker ou schéma Prévention n'est implémenté.
- Redis existe dans Docker Production, sans dépendance BullMQ directe.
- Les analyses structurées sont dans `Visit.photos[].analysis`; `Report.content` reste textuel.
- Les routes d'organisation sont sous `/:slug` et la sidebar actuelle est plate.
- Les gardes actuels autorisent généralement l'Hyperadmin : Prévention devra explicitement le refuser.
- Le HTML contient cinq pages ; « Suivi des actions » a été explicitement ajouté.
- `docs/PLAN_PREVENTION_ORGANISATIONS.md` duplique `ROADMAP.md`.

## Functional scope

### Navigation Prévention

| Page | Route cible |
|---|---|
| Tableau de bord prévention | `/:slug/prevention/dashboard` |
| Observations | `/:slug/prevention/observations` |
| Recommandations | `/:slug/prevention/recommendations` |
| Suivi des actions | `/:slug/prevention/suivi` |
| Budget prévisionnel | `/:slug/prevention/budget` |
| Références réglementaires | `/:slug/prevention/references` |

`/:slug/prevention` redirigera vers `/:slug/prevention/dashboard`.

### Groupes métier de la sidebar

1. **Pilotage des chantiers** : Tableau de bord, Chantiers, Visites, Rapports, Affectations.
2. **Prévention & sécurité** : les six pages Prévention.
3. **Administration** : Utilisateurs, Prompts IA, Liste de diffusion.
4. **Conformité & documents** : CGU, Politique de confidentialité.

Les groupes sont visibles et non repliables. Les droits hors Prévention restent inchangés.

### Défilement cible

- Masquer la scrollbar native.
- Afficher une flèche fixe en haut et une en bas seulement en cas de débordement.
- Désactiver ou masquer la flèche à la limite atteinte.
- Faire défiler environ 240 px par clic avec animation fluide.
- Assurer clavier et libellés ARIA.
- Appliquer ce comportement sur desktop et menu mobile web.

### Accès et isolation

- `ROLE_ADMIN` rattaché à une organisation : pages et API autorisées.
- `ROLE_USER` : contribue par ses rapports, sans accès Prévention.
- `ROLE_HYPER_ADMIN` : navigation absente et API `403`.
- Le tenant provient exclusivement de l'utilisateur authentifié.

### Données sources

Sources autorisées : analyses structurées avec et sans photo, observations, recommandations, risques, références, dates métier, missions, chantiers et types associés aux rapports des admins et coordonnateurs de l'organisation.

Contenus exclus des pages : photos brutes, directives, prompts personnalisés et contenus intermédiaires de génération.


### Prescriptions de sécurité pour l'implémentation future

- Protéger chaque contrôleur Prévention avec un garde dédié, en plus de l'authentification JWT.
- Le garde doit exiger exactement `ROLE_ADMIN` et un `organizationId` persistant non nul chargé depuis la base ; tout `ROLE_USER`, `ROLE_HYPER_ADMIN` ou admin orphelin reçoit `403`.
- Ne pas s'appuyer uniquement sur `OrganizationScopeGuard`, qui autorise l'Hyperadmin et peut appliquer une organisation par défaut.
- Ne pas s'appuyer uniquement sur `@Roles(UserRole.ADMIN)` : si `RolesGuard` est retenu, l'enregistrer explicitement sur le contrôleur ; l'approche recommandée reste un garde Prévention dédié.
- La visibilité frontend est ergonomique et ne constitue jamais une autorisation.
- Pour les jobs et l'outbox, dériver `organizationId` côté serveur depuis l'objet source en base. Un payload client ne fait jamais autorité.
- À l'exécution, le worker relit la source avec le couple `(id, organizationId)` et filtre toutes les écritures, lectures et agrégations par tenant.
- Pour un job manuel, l'organisation est dérivée de l'utilisateur authentifié.
- Vérifier la portée tenant de chaque jointure vers rapport, visite et mission. Répondre uniformément sans révéler l'existence d'un objet inter-tenant.
- Ne jamais persister ni journaliser dans Prévention les photos brutes, directives, prompts personnalisés ou contenus intermédiaires ; cette exclusion couvre tables, API, payloads de jobs et logs.

## Technical scope

Aucun code, endpoint, schéma, migration, worker, appel IA ou changement d'infrastructure dans P0.

## Expected files/modules

- `ROADMAP.md`
- `plans/iteration-001.md`
- suppression de `docs/PLAN_PREVENTION_ORGANISATIONS.md` après comparaison finale

## Agents

- Supervisor : cadrage, intégration documentaire et clôture.
- Security : revue indépendante des droits et de l'isolation.
- Reviewer : revue indépendante de la couverture du cadrage.

## Execution plan

1. Confirmer l'absence d'information unique dans le document concurrent.
2. Formaliser navigation, défilement, droits et sources.
3. Supprimer le doublon documentaire.
4. Réaliser les revues Security et Reviewer.
5. Corriger les écarts, compléter le compte rendu et clore P0.

## Parallelization

Security et Reviewer peuvent intervenir en parallèle une fois le contrat stabilisé.

## Database impact

No expected database change.

## API impact

No API change. Future contracts only.

## Security impact

Revue obligatoire : garde Prévention dédié, rôle exactement ADMIN, organisation persistante obligatoire, isolation tenant de bout en bout et refus explicite de l'Hyperadmin.

## Tests

- Comparaison documentaire.
- Contrôle des cinq entrées HTML et de la page Suivi approuvée.
- Vérification des routes et de la matrice des rôles.
- Vérification Git des seuls artefacts documentaires attendus.
- Aucun build applicatif requis.

## Acceptance criteria

- [x] Six pages et routes recensées.
- [x] Quatre groupes métier définis.
- [x] Comportement des flèches défini.
- [x] Accès réservé aux admins d'organisation.
- [x] Hyperadmin explicitement refusé.
- [x] Sources autorisées et contenus exclus définis.
- [x] Document concurrent supprimé sans perte.
- [x] Revue sécurité approuvée.
- [x] Reviewer : `REVIEW_STATUS: APPROVED`.
- [x] P0 marqué `Terminé`.

## Risks

- Les futurs endpoints devront déroger explicitement aux gardes Hyperadmin existants.
- La future réorganisation de la sidebar devra préserver les droits des entrées existantes.

## Expected result

Un cadrage décision-complet permettant de préparer P1 sans commencer son implémentation.

# EXECUTION RECORD

## Actual implementation

Le cadrage P0 a été consolidé : six pages et routes, quatre groupes métier, défilement par flèches, matrice d'accès, sources autorisées, contenus exclus et prescriptions multi-tenant. Le document concurrent a été comparé puis supprimé sans perte d'information.

## Files changed

- `ROADMAP.md`
- `plans/iteration-001.md`
- suppression de `docs/PLAN_PREVENTION_ORGANISATIONS.md`

## Architecture decisions

- Six routes Prévention sous `/:slug/prevention`.
- Quatre groupes métier non repliables dans la future sidebar.
- Accès strictement réservé à `ROLE_ADMIN` avec organisation persistante.
- Garde Prévention dédié requis ; refus explicite USER, HYPER_ADMIN et admin orphelin.
- Tenant dérivé côté serveur et revalidé dans chaque traitement asynchrone.
- Aucun contenu sensible dans tables analytiques, API, jobs ou logs.

## Database changes

Aucun changement.

## API changes

Aucun changement.

## Tests executed

- Comparaison de `ROADMAP.md` avec le document concurrent : aucune exigence unique perdue.
- Inventaire des cinq liens de `prevention_rte.html` et ajout confirmé de Suivi.
- Contrôle des six routes cibles et de leur unicité.
- Inspection des rôles, guards, routes, entités et sources d'analyse existants.
- Vérification de la suppression du doublon et de l'état Git.
- Aucun build applicatif requis : aucun code applicatif modifié.

## Reviewer result

REVIEW_STATUS: APPROVED

## Security result

SECURITY_STATUS: APPROVED

## Known limitations

Le contrat n'est pas encore implémenté ; cela relève des itérations P1 et suivantes.

## Technical debt discovered

Les guards globaux actuels autorisent l'Hyperadmin et peuvent appliquer une organisation par défaut. Les futurs endpoints Prévention devront utiliser le garde dédié prévu.
