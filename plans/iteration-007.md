# Iteration 007 — Scheduler de rattrapage et cohérence

STATUS: COMPLETED

## Roadmap reference

P6 — Scheduler : différentiel, consolidation, audit et nettoyage.

## Objective

Ajouter une planification BullMQ unique et rejouable qui rattrape les rapports manqués, consolide les partitions analytiques, contrôle leur cohérence et nettoie uniquement l'historique technique BullMQ selon une rétention configurée.

## Existing state

P2–P5 fournissent l'outbox, la file BullMQ, le worker indépendant, les snapshots/findings idempotents, les partitions durables, les agrégats et les scores atomiques. Aucun scheduler ni checkpoint de contrôle périodique n'existe. Les événements courants fonctionnent, mais une indisponibilité prolongée ou une donnée historique non publiée n'est pas encore détectée automatiquement.

## Functional scope

- Synchronisation différentielle quotidienne à 02:00 Europe/Paris pour détecter, par organisation et par lots bornés, les rapports absents ou dont la version analytique diffère du snapshot.
- Consolidation quotidienne à 03:00 des partitions encore en attente et des incohérences ciblées entre findings, agrégats et scores.
- Reconstruction de cohérence hebdomadaire, le dimanche à 04:00, organisation par organisation et avec reprise par curseur.
- Audit complet mensuel, le premier dimanche à 05:00, sans recalcul global simultané ni contenu brut dans les journaux.
- Nettoyage quotidien des jobs BullMQ terminés/échoués selon des durées de rétention configurées par `.env`.
- Garantir une seule occurrence logique de chaque planification malgré plusieurs processus, grâce aux Job Schedulers/identifiants déterministes BullMQ.
- Ne pas ajouter les endpoints P7, les pages P8, le backfill historique P9 ni la suppression des données analytiques métier dont la durée de rétention reste à valider.

## Technical scope

- Créer un bootstrap scheduler dédié au worker, avec fuseau explicite `Europe/Paris`, noms de jobs versionnés et identifiants déterministes.
- Ajouter des jobs parents bornés qui énumèrent les organisations puis déposent des jobs enfants tenant-scoped et paginés; aucun job ne transporte de contenu de rapport.
- Comparer les versions/hashes nécessaires en MySQL et réutiliser le pipeline P4/P5 plutôt que dupliquer extraction ou calcul.
- Persister les checkpoints, curseurs, états et résultats synthétiques des exécutions afin de reprendre après interruption et d'auditer les traitements.
- Mettre en place un verrouillage/claim transactionnel avec expiration et convergence en cas de concurrence.
- Configurer limites de lots, fréquence, fuseau et rétention BullMQ via variables d'environnement strictement validées.
- Conserver la dernière version analytique valide visible pendant tout rattrapage.

## Expected files/modules

- migration et entité de runs/checkpoints scheduler;
- `backend/src/prevention/scheduler/`;
- adaptations ciblées queue/worker et bootstrap du worker;
- configuration `.env.example` et Docker;
- tests unitaires des calendriers/payloads et harness MySQL/Redis de reprise/concurrence.

## Agents

- Backend : contrats de jobs, checkpoints, traitements différentiels et intégration worker.
- DevOps si nécessaire : configuration du processus sans nouveau service exposé.
- Tester : calendriers, concurrence, reprise, lots et nettoyage.
- Security : isolation tenant, payloads et données d'audit.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validations et statuts.

## Execution plan

1. Figer les contrats de jobs, calendriers, limites et règles de rétention technique.
2. Ajouter le stockage durable des runs/checkpoints et ses contraintes tenant/concurrence.
3. Enregistrer les planifications BullMQ de manière idempotente au démarrage du worker.
4. Implémenter le différentiel quotidien paginé et réutiliser les jobs d'indexation existants.
5. Implémenter consolidation, contrôle hebdomadaire et audit mensuel avec reprise.
6. Implémenter le nettoyage borné des jobs BullMQ, sans supprimer de donnée analytique métier.
7. Valider fuseau/changement d'heure, concurrence multi-instance, interruption/reprise, tenant et non-duplication.
8. Obtenir Security puis Reviewer.

## Parallelization

Les tests de calendrier et l'analyse Docker peuvent être préparés indépendamment. Les contrats de jobs et le modèle de checkpoint doivent être stabilisés avant les écritures worker.

## Database impact

Migration additive attendue pour les exécutions/checkpoints du scheduler, avec index de claim, curseur de reprise, statut, dates et résumé sans contenu métier brut. Rollback prévu.

## API impact

No public API change. Les statuts et déclenchements manuels seront exposés par P7.

## Security impact

Revue obligatoire : isolation de chaque job enfant par `organizationId`, payload minimal, absence de contenu source, concurrence sûre et audit sans données sensibles.

## Validation

- Build et tests unitaires des expressions de répétition, fuseau, validation `.env`, identifiants et payloads.
- Migration MySQL `up/down/up`.
- Harness MySQL/Redis : enregistrement concurrent du scheduler, rapport manqué, version divergente, pagination, interruption/reprise et absence de doublon.
- Vérification d'un audit hebdomadaire/mensuel simulé et du nettoyage borné des seuls jobs techniques.
- Régression P2–P5.

## Acceptance criteria

- Chaque calendrier correspond aux horaires P6 en `Europe/Paris`, y compris après redémarrage et changement d'heure.
- Plusieurs workers ne créent qu'une occurrence logique par échéance.
- Un rapport manqué ou divergent est automatiquement redéposé puis converge vers les données P4/P5 attendues.
- Les lots reprennent depuis un checkpoint durable après interruption sans saut ni doublon utile.
- Consolidation et audit détectent les incohérences ciblées sans exposer d'état analytique partiellement publié.
- Les traitements restent bornés, tenant-scoped et sans contenu brut dans Redis/logs/checkpoints.
- Le nettoyage respecte la configuration et ne supprime aucune donnée analytique métier.
- Migration, validations, Security et Reviewer sont approuvés.

## Risks

- Les scans différentiels peuvent charger MySQL : pagination, index, cadence et concurrence doivent rester configurables et bornés.
- Les changements d'heure Europe/Paris exigent une planification avec fuseau explicite et des tests dédiés.
- La rétention des constats/journaux métier reste une décision produit ouverte; cette itération nettoie uniquement BullMQ.
- P9 reste nécessaire pour une reconstruction historique exhaustive; P6 assure le rattrapage opérationnel, pas un backfill complet non borné.

## Expected result

Le pipeline Prévention se surveille et se rattrape automatiquement selon les échéances approuvées, avec reprise durable, convergence et charge maîtrisée.

## Execution record

- Implémentation d'un scheduler BullMQ unique dans le worker avec cinq calendriers configurables en `Europe/Paris` : différentiel, consolidation, audit hebdomadaire, audit mensuel et nettoyage.
- Ajout de la migration `1830000012000-prevention-scheduler.ts` pour les runs, checkpoints tenant-scoped et tâches d'audit durables, avec rollback et contraintes composites d'isolation.
- Pagination bornée des organisations, rapports et reprises de backlog par curseurs et continuations déterministes; claims avec leases, vérification du propriétaire et complétion dérivée des tâches.
- Réutilisation forcée du pipeline P4/P5 pour les consolidations/audits; les échecs terminaux sont quarantainés en `FAILED` sans boucle de republication.
- Nettoyage borné aux jobs techniques scheduler, y compris les jobs d'audit, sans toucher aux jobs métier ni aux données analytiques.
- Configuration `.env` strictement validée et intégration au worker/conteneurs existants; aucun endpoint public ajouté.
- Validation exécutée le 2026-09-15 : `npm run build` réussi; `npm run test:prevention-queue` réussi (30/30); `git diff --check` réussi; harnais MySQL 8/Redis 7 réussi avec migration `up/down/up`, scheduler, consolidation, isolation tenant et tâches complétées.
- Security : `SECURITY_STATUS: PASS` après correction de la quarantaine terminale et de la FK tenant composite.
- Reviewer : `REVIEW_STATUS: APPROVED` après correction de la rétention audit et de la reprise paginée.
- Limitation connue : l'exposition des statuts et une reprise administrative explicite restent dans P7; le backfill historique exhaustif reste dans P9.
