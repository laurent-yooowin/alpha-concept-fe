# Iteration 003 — File BullMQ, producteurs et déduplication

STATUS: PROPOSED

## Roadmap reference

Phase: Plan de production et suivi — Prévention par organisation
Task: P2 — File — Redis/BullMQ, producteurs et déduplication

## Objective

Créer le canal fiable entre les mutations de rapports et les futurs workers Prévention. Chaque changement métier utile produit un événement durable tenant-scoped, publié dans BullMQ avec une clé de déduplication déterministe. Aucun traitement analytique n'est exécuté dans cette itération.

## Why this iteration is next

P0 a fixé le contrat et P1 fournit les tables analytiques. P2 est le prérequis direct de P3 : le futur conteneur worker doit disposer d'une file, de payloads et de producteurs stables avant d'être créé.

## Existing state

- Redis 7 existe uniquement dans `docker-compose.prod.yml`.
- Le backend n'a pas de dépendance directe BullMQ/ioredis ni de module de file.
- Les créations, mises à jour, régénérations et suppressions de rapports passent par `ReportService`, mais sans événement durable.
- Plusieurs réplicas API sont prévus en production.
- P0 impose que le tenant soit dérivé côté serveur et qu'aucun contenu sensible n'entre dans les jobs ou logs.
- Aucun consumer Prévention ne sera lancé avant P3.

## Functional scope

- Une création, mise à jour ou régénération utile d'un rapport génère un événement `REPORT_UPSERTED`.
- Une suppression génère `REPORT_DELETED`.
- Les mutations rapprochées d'une même version logique ne créent qu'un événement publiable grâce à une clé unique.
- Une indisponibilité Redis ne fait pas échouer la mutation métier : l'événement reste durablement en attente dans MySQL.
- L'API ne calcule aucune donnée Prévention et ne lit aucune photo pour construire le payload.
- Aucun endpoint utilisateur, écran ou consumer n'est ajouté.

## Technical scope

### Backend

- Ajouter `bullmq` et `ioredis` comme dépendances directes.
- Créer un module interne `PreventionQueueModule` fournissant la connexion Redis, la queue `prevention`, le repository outbox et le publisher.
- Configurer Redis uniquement via `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` et TLS optionnel; aucune valeur secrète codée.
- Fermer proprement Queue/Redis lors de l'arrêt NestJS.
- Ne créer aucun `Worker` BullMQ dans P2.

### Outbox transactionnelle

Créer `prevention_outbox_events` :

- `id varchar(36)` PK ;
- `organizationId varchar(36) NOT NULL`, FK organisation CASCADE ;
- `aggregateType enum('REPORT') NOT NULL` ;
- `aggregateId varchar(36) NOT NULL`, sans FK afin de conserver l'événement de suppression ;
- `eventType enum('REPORT_UPSERTED','REPORT_DELETED') NOT NULL` ;
- `aggregateVersion varchar(64) NOT NULL` ;
- `deduplicationKey varchar(190) NOT NULL UNIQUE` ;
- `payload json NOT NULL` limité au contrat ci-dessous ;
- `status enum('PENDING','PROCESSING','PUBLISHED','FAILED') NOT NULL DEFAULT 'PENDING'` ;
- `attempts int unsigned NOT NULL DEFAULT 0` ;
- `availableAt datetime(6) NOT NULL` ;
- `lockedAt datetime(6) NULL`, `lockedBy varchar(100) NULL` ;
- `publishedAt datetime(6) NULL`, `lastError varchar(1000) NULL` ;
- timestamps ;
- index `(status, availableAt)` et `(organizationId, aggregateId, createdAt)`.

Ajouter l'entité, la migration réversible et un service d'écriture utilisable avec l'`EntityManager` de la transaction métier.

### Contrat des événements

Queue : `prevention`.

Jobs BullMQ :

- `prevention.report.upsert`
- `prevention.report.delete`

Payload strict :

```ts
{
  eventId: string;
  organizationId: string;
  reportId: string;
  eventType: 'REPORT_UPSERTED' | 'REPORT_DELETED';
  aggregateVersion: string;
  occurredAt: string;
}
```

Interdire titre, contenu, observations, photos, directives, prompts, URL ou donnée personnelle.

La clé de déduplication est `report:{organizationId}:{reportId}:{eventType}:{aggregateVersion}`. Pour un upsert, `aggregateVersion` provient de l'`updatedAt` persisté. Pour une suppression, une version horodatée est capturée avant suppression. Le `jobId` BullMQ est une forme sûre et déterministe dérivée de cette clé.

### Intégration ReportService

- Encapsuler chaque écriture concernée et l'insertion outbox dans la même transaction MySQL.
- Recharger la ligne persistée afin d'utiliser son tenant et sa version réels.
- Refuser de produire un événement si le rapport n'a pas d'`organizationId`; la mutation existante conserve son comportement, mais l'absence est journalisée sans contenu sensible et sera traitée par le backfill.
- Pour la suppression, écrire l'événement dans la transaction avant de supprimer le rapport.
- Préserver les comportements actuels, notamment `createOrUpdateGeneratedReport`, statuts et relations.
- Ne pas produire d'événement pour une écriture qui n'a pas modifié les champs métier exploités; calculer une empreinte/version logique sur les champs analytiques autorisés si `updatedAt` change pour une modification technique sans impact.

### Publisher outbox

- Un poller interne à l'API publie de petits lots de lignes disponibles.
- Plusieurs réplicas sont supportés via claim transactionnel atomique et verrouillage `FOR UPDATE SKIP LOCKED` ou mécanisme MySQL 8 équivalent.
- Après claim, publier avec le `jobId` déterministe, délai de stabilisation de 2 minutes, conservation limitée des jobs terminés/échoués.
- Marquer `PUBLISHED` si le job est ajouté ou existe déjà avec le même identifiant.
- En cas d'erreur, incrémenter `attempts`, remettre `PENDING` avec backoff 1 min, 5 min puis 30 min; passer `FAILED` après le maximum configuré.
- Récupérer automatiquement les lignes `PROCESSING` dont le verrou est expiré.
- Ne jamais journaliser le payload complet ni les contenus du rapport.
- Le démarrage de l'API reste possible lorsque Redis est indisponible.

### Frontend, AI, mobile et infrastructure

Aucun changement fonctionnel. Redis existe déjà en production; P2 ajoute seulement les variables du backend/compose nécessaires à sa connexion. Le conteneur worker appartient à P3.

## Expected files/modules

- `backend/src/prevention/queue/`
- `backend/src/prevention/outbox/`
- une migration postérieure à P1 ;
- intégration ciblée dans `ReportService` et `ReportModule` ;
- dépendances et variables Docker/backend ;
- tests unitaires et intégration queue/outbox.

## Agents

- Explorer : tracer toutes les écritures ReportService avant modification.
- Backend : outbox, queue, publisher et transactions rapport.
- DevOps : configuration Redis API sans worker.
- Tester : tests MySQL/Redis isolés et régressions rapports.
- Security : payload, tenant, secrets et concurrence.
- Reviewer : revue finale indépendante.
- Supervisor : contrat, intégration, corrections et statuts.

## Execution order

1. Inspecter et figer tous les chemins d'écriture de rapport.
2. Définir migration, entité, payload et clé de déduplication.
3. Implémenter module queue/outbox et tests unitaires.
4. Intégrer les transactions ReportService.
5. Ajouter configuration Redis et arrêt propre.
6. Tester MySQL et Redis éphémères, panne Redis et concurrence.
7. Réaliser revues sécurité et reviewer, corriger puis clore P2.

Backend possède les fichiers métier. DevOps peut préparer la configuration en parallèle après gel des variables. Tester prépare les harness isolés sans toucher aux mêmes fichiers. Security et Reviewer interviennent après stabilisation.

## Database impact

Une table outbox tenant-scoped et indexée. Les écritures de rapports deviennent transactionnelles avec leur événement. Aucun changement des tables analytiques P1 et aucun backfill.

## API impact

Aucun nouvel endpoint public et aucun changement de payload HTTP. Les mutations existantes conservent leurs réponses.

## Security impact

Revue obligatoire : isolation tenant, payloads BullMQ, concurrence multi-réplicas, secrets Redis, logs et suppression de rapports. L'organizationId est toujours dérivé de la ligne persistée ou de l'utilisateur serveur, jamais d'un payload client.

## Tests

- Build backend et tests unitaires du calcul de version/déduplication/backoff.
- Migration outbox `up → down → up` sur MySQL 8 isolé.
- Redis isolé : un changement logique produit une seule ligne outbox et un seul job.
- Deux changements de versions différentes produisent deux clés distinctes.
- Rejeu d'un événement déjà publié sans duplication BullMQ.
- Création, génération, mise à jour, régénération et suppression de rapport.
- Rollback métier : aucune ligne outbox si la transaction rapport échoue.
- Redis indisponible : mutation rapport réussie, outbox reste PENDING, publication après reprise.
- Deux publishers concurrents ne publient pas deux jobs utiles.
- Verrou expiré récupéré et backoff 1/5/30 min vérifié.
- Payload/logs exempts de photos, directives, prompts, contenu et données personnelles.
- Non-régression des tests/build existants.

## Acceptance criteria

- [ ] Toute mutation analytique utile d'un rapport crée atomiquement un événement outbox tenant-scoped.
- [ ] Une même organisation, rapport, type et version ne produit qu'un événement/job utile.
- [ ] Redis indisponible ne perd aucun événement et ne bloque pas la mutation métier.
- [ ] Le publisher fonctionne avec plusieurs réplicas sans double traitement utile.
- [ ] Les jobs ont un délai de stabilisation de deux minutes et un backoff documenté.
- [ ] Aucun contenu sensible ou source brute n'est présent dans outbox, jobs ou logs.
- [ ] Les suppressions sont publiables après disparition du rapport.
- [ ] La migration est réversible et les tests MySQL/Redis isolés passent.
- [ ] Le backend compile et les mutations de rapports ne régressent pas.
- [ ] La revue sécurité est approuvée.
- [ ] Le reviewer retourne `REVIEW_STATUS: APPROVED`.
- [ ] P2 est marqué Terminé.

## Risks

- Refactor transactionnel de `ReportService` sur plusieurs chemins d'écriture.
- DDL MySQL et verrous outbox sous plusieurs réplicas.
- BullMQ interdit certains caractères dans `jobId`; la transformation sera déterministe et testée.
- Accumulation de lignes si Redis reste indisponible; métriques/alertes complètes appartiennent à P10, mais logs agrégés et seuils de lot sont requis.
- Les rapports historiques sans tenant ne peuvent pas produire un événement normal et restent du ressort du backfill P9.

## Expected result

Les rapports alimentent une outbox fiable et une queue BullMQ dédupliquée, prête à être consommée par le worker séparé de P3, sans traitement analytique prématuré.

# EXECUTION RECORD

## Actual implementation

Not started.

## Files changed

Not started.

## Architecture decisions

None yet.

## Database changes

Not started.

## API changes

Not started.

## Tests executed

Not started.

## Reviewer result

Not started.

## Security result

Not started.

## Technical debt discovered

None yet.
