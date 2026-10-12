# Iteration 012 — Backfill historique paginé et reprenable

STATUS: COMPLETED

## Roadmap reference

P9 — Backfill : reconstruction historique paginée, avec reprise après interruption sans doublon.

## Objective

Achever et valider le parcours de reconstruction historique par organisation en réutilisant le scheduler, les checkpoints et les jobs idempotents existants, afin qu'un traitement interrompu reprenne au bon curseur sans perdre ni dupliquer de rapports.

## Existing state

P6 fournit déjà les runs, checkpoints et tâches durables, la pagination par organisation et par rapport, les leases, reprises, quarantaines et limites configurables de 1 à 500 rapports. P7 expose la reconstruction manuelle tenant-scoped avec cooldown et suivi. Le worker sait rejouer l'extraction et les agrégats de manière idempotente. P9 doit consolider ce socle en parcours de backfill explicitement complet et validé sur interruption/reprise.

## Functional scope

- Reconstruire l'historique d'une organisation par pages configurées de 100 à 500 rapports.
- Persister le curseur et l'état après chaque page avant de poursuivre.
- Reprendre automatiquement un checkpoint ou une tâche dont le lease a expiré.
- Garantir qu'un rapport rejoué ne double ni snapshots, constats, statistiques ni postes budgétaires dérivés.
- Exposer dans le statut existant les compteurs utiles, la fin du scan et l'échec terminal, sans ajouter de nouvelle page Web.

## Technical scope

- Auditer et compléter le flux `MANUAL_REBUILD → ORGANIZATION_SCAN → AUDIT_REPORT` existant.
- Durcir la progression atomique du checkpoint, les continuations déterministes et la reprise après expiration de lease.
- Vérifier que chaque job reconstruit ses entrées depuis des identifiants tenant-scoped et que les payloads restent minimaux.
- Ajouter des tests d'intégration ciblés couvrant plusieurs pages, interruption, reprise, rejeu et absence de doublons.
- Étendre le script runtime Prévention existant uniquement si nécessaire pour valider le parcours complet.

## Expected files/modules

- `backend/src/prevention/scheduler/` : orchestration, checkpoints et tests.
- `backend/src/prevention/worker/` : intégration du traitement historique si un raccord manque.
- `backend/src/prevention/api/prevention-rebuild-queue.service.ts` et tests de statut, si nécessaire.
- `backend/scripts/validate-prevention-extraction-runtime.sh` ou script de validation P9 ciblé.
- Migration uniquement si le schéma de checkpoint existant ne peut pas porter un invariant indispensable.

## Agents

- Backend : propriétaire du flux de backfill et de la persistance de reprise.
- Tester : analyse indépendante des cas d'interruption, rejeu et doublons.
- Security : revue uniquement si les raccords modifient les frontières tenant ou les payloads de jobs.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validation et clôture P9.

## Execution plan

1. Cartographier précisément le flux existant et identifier les seuls écarts avec le critère P9.
2. Ajouter les invariants manquants de pagination, checkpoint, lease et continuation.
3. Relier, si nécessaire, le backfill au rejeu complet extraction/agrégats/Budget sans élargir les payloads.
4. Couvrir plusieurs pages, interruption au milieu d'une page, reprise, rejeu et échec terminal.
5. Faire exécuter les validations backend et runtime ciblées par l'utilisateur.
6. Effectuer les revues requises puis clôturer P9.

## Parallelization

L'analyse des cas de test peut être parallèle à l'inspection backend. Un seul propriétaire modifie le scheduler et les checkpoints pour éviter les conflits.

## Database impact

Aucune migration attendue : les tables de runs, checkpoints et tâches existent. Toute modification de schéma éventuellement indispensable resterait additive, tenant-scoped et réversible.

## API impact

Pas de nouvel endpoint attendu. Le statut de reconstruction existant pourra être complété avec des champs déjà persistés, sans rompre le contrat actuel.

## Security impact

Le backfill doit rester strictement borné à l'organisation autorisée. Les jobs ne transportent que des identifiants, curseurs et versions validés ; aucune donnée analytique sensible n'est placée dans Redis.

## Validation

- Build backend et suite Prévention ciblée.
- Tests : pagination multi-pages, curseur monotone, lease expiré, continuation déterministe, reprise sans doublon, rejeu idempotent et quarantaine terminale.
- Validation runtime MySQL/Redis du backfill interrompu puis repris, si l'environnement disponible le permet.
- Régression de la reconstruction manuelle et du statut tenant-scoped.

## Acceptance criteria

- Une organisation volumineuse est parcourue par lots bornés de 100 à 500 rapports.
- Une interruption reprend depuis le dernier checkpoint durable sans recommencer inutilement tout le lot.
- Un rapport peut être rejoué sans doublonner les données analytiques ou budgétaires.
- Deux reprises concurrentes ne progressent pas simultanément sur le même checkpoint.
- Le statut final et les compteurs reflètent exactement succès, échecs et fin du scan.
- Reviewer approuve l'implémentation ; Security approuve si une frontière d'autorisation ou de tenant est modifiée.

## Risks

- Le socle P6 est déjà avancé : le risque principal est de dupliquer ou déstabiliser une orchestration fonctionnelle au lieu de ne combler que les écarts P9.
- Les tests runtime peuvent être coûteux ; ils devront utiliser un jeu borné couvrant au moins deux pages et une reprise réelle.
- La concurrence des leases doit être validée sans affaiblir la récupération automatique existante.

## Expected result

P9 fournit un backfill historique borné, observable, idempotent et reprenable après interruption, construit sur l'orchestration durable existante.

## Execution record

- Implémentation achevée dans le scheduler Prévention : lots strictement bornés de 100 à 500 rapports, progression du curseur et création des tâches atomiques, continuations déterministes et contrôle des leases.
- Reprise durable complétée pour les niveaux run, checkpoint et tâche, en respectant `availableAt` et sans réactiver les runs parents en échec.
- Compteurs de tâches en attente décrémentés de manière idempotente ; `pendingJobs` ajouté au statut de reconstruction existant.
- Validation runtime étendue au parcours P4/P5/P6 et aux migrations Budget nécessaires au worker courant, sans nouvelle migration P9.
- Fichiers principaux modifiés : `prevention-scheduler.service.ts`, `prevention-scheduler.config.ts`, `prevention-scheduler.types.ts`, `prevention-scheduler.spec.ts`, `prevention-api.service.ts` et `validate-prevention-extraction-runtime.sh`.
- Validations exécutées par l'utilisateur : build backend réussi ; suite Prévention 62/62 ; validation runtime MySQL/Redis réussie avec reprise, isolation et idempotence.
- Revue sécurité indépendante : PASS. Revue finale indépendante : APPROVED.
- Limitation connue hors périmètre P9 : 68 erreurs TypeScript historiques du frontend restent volontairement reportées jusqu'à la fin des lots fonctionnels, conformément à la décision utilisateur.
