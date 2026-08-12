# Iteration 002 — Socle de données Prévention

STATUS: COMPLETED

## Roadmap reference

Phase: Plan de production et suivi — Prévention par organisation
Task: P1 — Données — Schéma et migrations des tables Prévention

## Objective

Créer le schéma analytique minimal, multi-tenant et réversible qui permettra aux workers futurs d'indexer les rapports, normaliser les constats et matérialiser les statistiques journalières.

## Existing state

- MySQL 8 et TypeORM sont utilisés avec `synchronize: false`.
- Les migrations sont écrites manuellement et les UUID sont stockés en `varchar(36)`.
- `reports`, `visits` et `missions` possèdent un `organizationId` nullable à cause des données historiques.
- La source structurée utile est `visits.photos[].analysis`.
- Aucun schéma ni module Prévention n'existe.
- P0 impose un tenant obligatoire sur toutes les données Prévention et exclut photos, directives, prompts et contenus intermédiaires.
- BullMQ, outbox, processing jobs, budget et API ne font pas partie de P1.

## Functional scope

Cette itération ne rend aucune fonctionnalité visible. Elle fournit uniquement les structures de persistance nécessaires aux lots P2 à P7.

Les tables créées sont vides après migration : aucun backfill de rapports existants n'est lancé.

## Technical scope

### Database

Créer une migration TypeORM réversible et les entités associées.

#### `prevention_categories`

Taxonomie propre à chaque organisation :

- `id varchar(36)` PK ;
- `organizationId varchar(36) NOT NULL`, FK organisation, cascade ;
- `code varchar(80) NOT NULL` ;
- `label varchar(150) NOT NULL` ;
- `description text NULL` ;
- `color varchar(16) NULL` ;
- `displayOrder int NOT NULL DEFAULT 0` ;
- `isActive tinyint NOT NULL DEFAULT 1` ;
- timestamps TypeORM ;
- unicité `(organizationId, code)` ;
- index `(organizationId, isActive, displayOrder)`.

Aucune catégorie globale et aucune donnée seedée dans P1.

#### `prevention_report_snapshots`

Une seule version analytique courante par rapport :

- `id varchar(36)` PK ;
- `organizationId varchar(36) NOT NULL`, FK organisation, cascade ;
- `reportId varchar(36) NOT NULL`, FK report, cascade ;
- `visitId varchar(36) NOT NULL`, FK visit, cascade ;
- `missionId varchar(36) NOT NULL`, FK mission, cascade ;
- `sourceHash char(64) NOT NULL` ;
- `sourceUpdatedAt datetime(6) NOT NULL` ;
- `businessDate date NOT NULL` ;
- `missionType varchar(32) NOT NULL` pour préserver les valeurs historiques sans enum bloquant ;
- `sourceStatus varchar(32) NULL` ;
- `findingCount int NOT NULL DEFAULT 0` ;
- `indexedAt datetime(6) NOT NULL` ;
- timestamps TypeORM ;
- unicité `(organizationId, reportId)` ;
- index `(organizationId, businessDate)` et `(organizationId, sourceUpdatedAt)`.

Aucun contenu intégral du rapport, photo, directive ou prompt n'est stocké.

#### `prevention_findings`

Constats normalisés et traçables :

- `id varchar(36)` PK ;
- `organizationId varchar(36) NOT NULL` ;
- `snapshotId varchar(36) NOT NULL` ;
- références dénormalisées obligatoires : `reportId`, `visitId`, `missionId` ;
- `sourceGroupId varchar(100) NULL` ;
- `sourceKind enum('PHOTO_GROUP','DIRECTIVE_ONLY') NOT NULL` ;
- `findingType enum('OBSERVATION','RECOMMENDATION') NOT NULL` ;
- `categoryId varchar(36) NULL`, FK catégorie, SET NULL ;
- `normalizedKey char(64) NOT NULL` ;
- `content text NOT NULL` ;
- `danger text NULL` ;
- `risk text NULL` ;
- `riskLevel enum('faible','moyen','eleve') NOT NULL` ;
- `confidence decimal(5,2) NULL` ;
- `regulatoryReferences json NULL` ;
- `businessDate date NOT NULL` ;
- `missionType varchar(32) NOT NULL` ;
- `createdAt datetime(6)` ;
- unicité `(snapshotId, normalizedKey, findingType)` ;
- index `(organizationId, businessDate, riskLevel)`, `(organizationId, categoryId, businessDate)`, `(organizationId, missionType, businessDate)` et `(organizationId, reportId)`.

Le contenu correspond uniquement au résultat analytique produit. Les champs exclus par P0 sont interdits.

#### `prevention_daily_statistics`

Agrégats journaliers matérialisés :

- `id varchar(36)` PK ;
- `organizationId varchar(36) NOT NULL` ;
- `statDate date NOT NULL` ;
- `missionType varchar(32) NOT NULL` ;
- `categoryId varchar(36) NULL` ;
- `riskLevel enum('faible','moyen','eleve') NOT NULL` ;
- `findingType enum('OBSERVATION','RECOMMENDATION') NOT NULL` ;
- compteurs non négatifs : `findingCount`, `reportCount`, `visitCount`, `missionCount`, tous à zéro par défaut ;
- `calculatedAt datetime(6) NOT NULL` ;
- timestamps TypeORM ;
- index de lecture `(organizationId, statDate)` et `(organizationId, missionType, statDate)`.

Pour garantir une clé unique avec catégorie nullable, ajouter `categoryKey varchar(36) NOT NULL DEFAULT 'UNCATEGORIZED'`; sa valeur est l'identifiant de catégorie ou `UNCATEGORIZED`. Unicité sur `(organizationId, statDate, missionType, categoryKey, riskLevel, findingType)`. Le service futur maintiendra la cohérence `categoryId/categoryKey`.

#### Relations et suppression

- Toute ligne porte un `organizationId NOT NULL`.
- Les liens obligatoires utilisent des FK composites `(organizationId, sourceId)` afin d'empêcher physiquement les références inter-tenant.
- La migration ajoute les clés candidates `UNIQUE (organizationId, id)` sur `reports`, `visits` et `missions`; les métadonnées TypeORM correspondantes sont alignées.
- Les FK métier utilisent `ON DELETE CASCADE` pour retirer les données dérivées avec leur source.
- La suppression d'une catégorie utilise `SET NULL` sur les constats/statistiques, avec maintien futur de `categoryKey`; l'usage normal désactive plutôt la catégorie.
- La migration `down` supprime les tables dans l'ordre inverse des dépendances.

### Backend

- Ajouter un dossier `backend/src/prevention/entities` contenant uniquement les quatre entités.
- Ne pas enregistrer de module NestJS ni exposer de repository/service dans P1.
- Les entités sont découvertes automatiquement par la configuration TypeORM existante.
- Exporter les enums partagés depuis un fichier local au domaine Prévention.

### Frontend, AI, Infrastructure

Aucun changement.

## Expected files/modules

- une migration suivant `1830000008000-custom-prompts.ts` avec un timestamp supérieur ;
- `backend/src/prevention/entities/` ;
- tests de cohérence du schéma dans le dispositif de test disponible, ou script SQL de validation documenté si aucun runner DB n'existe.

## Agents

- Backend : migration et entités.
- Tester : build, validation migration et contraintes.
- Security : revue isolation tenant, FK et données sensibles.
- Reviewer : revue finale indépendante.
- Supervisor : intégration et statuts.

## Execution plan

1. Marquer P1 en cours et l'itération IN_PROGRESS après GO.
2. Implémenter enums, entités et migration dans le même contrat.
3. Valider compilation TypeScript.
4. Valider `up` puis `down` puis `up` sur une base MySQL de test isolée, sans toucher aux données de développement ou production.
5. Vérifier contraintes, index, cascades et absence de colonnes sensibles.
6. Lancer revue sécurité et reviewer.
7. Corriger, revalider, documenter et clore P1.

## Parallelization

La conception est déjà fixée. Backend possède les écritures. Tester prépare les scénarios en lecture seule pendant l'implémentation. Security et Reviewer interviennent après stabilisation.

## Database impact

Quatre nouvelles tables vides et trois index uniques composites ajoutés aux tables existantes `reports`, `visits` et `missions`. Aucun backfill. Le rollback supprime les triggers, tables et index ajoutés.

## API impact

No expected API change.

## Security impact

Revue obligatoire pour confirmer `organizationId NOT NULL` partout, contraintes tenant, cascades et absence des photos/directives/prompts dans le schéma.

## Tests

- `npm run build` backend.
- Migration `up → down → up` sur MySQL temporaire dédié.
- Vérification des quatre tables, colonnes, FK, index et contraintes uniques via `information_schema`.
- Test d'échec pour doublon catégorie et doublon snapshot par rapport/tenant.
- Tests d'échec pour ligne sans organisation, références inter-tenant et mutation du tenant d'une catégorie.
- Test des cascades report/snapshot/findings.
- Vérification qu'aucune table/colonne ne stocke photos, directives ou prompts.
- Vérification du cycle de vie des trois index ajoutés aux tables sources.

## Acceptance criteria

- [x] Les quatre tables et entités correspondent au contrat.
- [x] Chaque ligne analytique possède un tenant obligatoire et indexé.
- [x] Un seul snapshot courant existe par rapport et organisation.
- [x] Les constats restent traçables vers snapshot, rapport, visite et mission.
- [x] Les agrégats disposent d'une clé unique déterministe, y compris sans catégorie.
- [x] Aucun contenu exclu n'est persistable dans ce schéma.
- [x] La migration réussit en `up → down → up` sur MySQL isolé.
- [x] Le backend compile.
- [x] La revue sécurité est approuvée.
- [x] Le reviewer retourne `REVIEW_STATUS: APPROVED`.
- [x] P1 est marqué Terminé.

## Risks

- MySQL ne permet pas une unicité fiable sur une colonne nullable : `categoryKey` résout ce cas.
- Les contraintes DB empêchent les références inter-tenant; les futurs workers conserveront la lecture par `(id, organizationId)` comme défense en profondeur.
- Les reports historiques avec tenant ou visite manquants ne sont pas migrés dans P1 et seront traités par la stratégie de backfill P9.
- La suppression en cascade peut retirer de gros volumes dérivés ; les index de FK et les traitements asynchrones futurs limiteront l'impact.
- Les trois index composites devront être évalués sur les volumes réels avant déploiement production.

## Expected result

Un schéma analytique vide, compilable, réversible et prêt à recevoir la file, les workers et le backfill des itérations suivantes.

# EXECUTION RECORD

## Actual implementation

Socle P1 créé avec quatre entités, enums, migration réversible et script MySQL isolé. Le schéma utilise des FK composites tenant-aware et cinq triggers de protection des catégories.

## Files changed

- `backend/src/migrations/1830000009000-prevention-data-foundation.ts`
- `backend/src/prevention/entities/*`
- `backend/src/reports/report.entity.ts`
- `backend/src/visits/visit.entity.ts`
- `backend/src/missions/mission.entity.ts`
- `backend/scripts/validate-prevention-migration-mysql.sh`
- `plans/iteration-002.md`
- `ROADMAP.md`

## Architecture decisions

Les références obligatoires sont protégées par FK composites. Les catégories nullable conservent `SET NULL`; des triggers contrôlent leur affectation et rendent leur tenant immuable. Les métadonnées des entités sources reflètent les index créés.

## Database changes

Quatre tables Prévention, trois index candidats sur les tables sources, sept FK composites tenant-aware et cinq triggers. Aucun backfill ni seed.

## API changes

Aucun changement.

## Tests executed

- `npm run build` backend : réussi.
- `bash scripts/validate-prevention-migration-mysql.sh` : réussi.
- MySQL 8 éphémère sans volume : `up → down → up`, métadonnées, isolation tenant, triggers, cascades, `SET NULL`, compteurs et exclusions validés.
- `git diff --check` : réussi.

## Reviewer result

REVIEW_STATUS: APPROVED

## Security result

SECURITY_STATUS: APPROVED

## Known limitations

Baseline MySQL minimale; chaîne historique complète et compatibilité des données de production non testées.

## Technical debt discovered

`backend/MIGRATIONS.md` est ancien et orienté PostgreSQL alors que l'exécution utilise MySQL.
