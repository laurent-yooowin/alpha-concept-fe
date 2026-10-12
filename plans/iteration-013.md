# Iteration 013 — Observabilité opérationnelle Prévention

STATUS: COMPLETED

## Roadmap reference

P10 — Observabilité : logs, métriques et alertes permettant de détecter les échecs et retards du pipeline Prévention.

## Objective

Rendre l'API, le worker, les files et le scheduler Prévention supervisables avec des signaux bornés et exploitables : état des dépendances, profondeur et retard des files, durée et résultat des traitements, retries, quarantaines et progression des backfills.

## Existing state

L'API et le worker utilisent déjà le logger Nest/Winston, les conteneurs de production ont une rotation JSON et l'API expose un healthcheck élémentaire. BullMQ, l'outbox et le scheduler conservent déjà les états et horodatages nécessaires à plusieurs indicateurs. Il n'existe pas encore de contrat de métriques Prévention, d'état de santé spécifique au worker ni de règles d'alerte opérationnelles documentées. Aucune dépendance Prometheus n'est installée.

## Functional scope

- Produire des logs structurés et corrélables pour les cycles outbox, jobs worker, runs, checkpoints et erreurs terminales, sans contenu métier sensible.
- Exposer des métriques Prévention couvrant au minimum profondeur par état, âge du plus ancien travail en attente, succès/échecs/retries, durée des traitements et progression/échec des runs.
- Fournir un état de santé exploitable de l'API et du worker incluant MySQL et Redis.
- Définir des seuils d'alerte configurables, notamment retard durable supérieur à 15 minutes, échecs terminaux et indisponibilité des dépendances.
- Documenter les signaux, seuils et actions de diagnostic minimales avant le pilote P11.

## Technical scope

- Ajouter un collecteur borné reposant sur les compteurs BullMQ et des requêtes agrégées/indexées sur l'outbox et le scheduler.
- Exposer les métriques dans un format stable compatible avec un collecteur standard, sans introduire une plateforme de supervision complète dans ce lot.
- Ajouter un endpoint interne de métriques et renforcer les probes de santé ; protéger les données opérationnelles détaillées par un mécanisme adapté au déploiement.
- Instrumenter les principaux chemins du publisher, du consumer et du scheduler avec identifiants techniques hachés ou non sensibles.
- Ajouter des tests des contrats, bornes, états dégradés et absence de données sensibles.

## Expected files/modules

- `backend/src/prevention/observability/` : collecte, contrats, contrôleur et tests.
- `backend/src/prevention/queue/`, `worker/` et `scheduler/` : instrumentation ciblée.
- `backend/src/healthcheck/` : probes API enrichies.
- `backend/src/workers/prevention.worker.ts` ou module worker : probe dédiée si nécessaire.
- `docker-compose.yml`, `docker-compose.prod.yml` : healthchecks et variables bornées si requis.
- Documentation opérationnelle ciblée dans la documentation existante ou un runbook dédié, sans créer de roadmap concurrente.

## Agents

- Backend : collecte, instrumentation et contrats de santé/métriques.
- DevOps : vérification ciblée des probes, seuils et raccords de déploiement.
- Security : revue indépendante de l'exposition des métriques et des journaux.
- Tester : cas dégradés, retards, échecs et non-régression.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validation et clôture P10.

## Execution plan

1. Définir le contrat minimal de métriques, les labels bornés et les seuils configurables à partir des indicateurs du roadmap.
2. Implémenter la collecte sans cardinalité non bornée ni requêtes coûteuses.
3. Instrumenter publisher, worker et scheduler avec une corrélation technique sûre.
4. Renforcer les probes API/worker et les healthchecks de conteneurs.
5. Ajouter les tests et le runbook d'alerte/diagnostic.
6. Faire exécuter les validations par l'utilisateur, puis réaliser les revues Security et Reviewer.

## Parallelization

Le contrat et l'analyse DevOps peuvent être étudiés en parallèle. Un seul propriétaire implémente le collecteur et ses endpoints ; l'instrumentation des modules ne commence qu'après stabilisation des noms et labels.

## Database impact

Aucune migration attendue. Les métriques doivent être dérivées des tables et index existants ; une évolution de schéma indispensable serait soumise à une révision du même plan avant implémentation.

## API impact

Ajout attendu d'un endpoint technique de santé/métriques, séparé des API métier. Son exposition devra être restreinte au réseau ou à une authentification technique selon l'architecture existante. Aucun changement fonctionnel des endpoints Prévention métier.

## Security impact

Revue Security obligatoire : les métriques et logs ne doivent exposer ni contenu de rapport, ni secret, ni jeton, ni identifiant personnel. Les labels doivent rester bornés et les détails tenant-scoped ne doivent pas être publics.

## Validation

- Build backend et suite Prévention ciblée.
- Tests du format des métriques, des états sain/dégradé, des seuils et de la cardinalité bornée.
- Tests d'absence de données sensibles dans logs et métriques.
- Validation manuelle avec Redis/MySQL disponibles puis indisponibles, et simulation d'un retard supérieur au seuil.
- Vérification des healthchecks des conteneurs concernés.

## Acceptance criteria

- Un opérateur détecte un job terminalement échoué et un retard durable supérieur à 15 minutes sans consulter directement la base.
- Profondeur, plus ancien travail en attente, taux/résultat et durée des traitements sont disponibles sous un contrat stable.
- API et worker distinguent état sain, dépendance indisponible et arrêt en cours.
- Les logs permettent de corréler un run et ses tâches sans exposer de contenu métier sensible.
- Les requêtes et labels restent bornés et adaptés à la volumétrie du pilote.
- Security retourne PASS et Reviewer retourne APPROVED.

## Risks

- Une métrique étiquetée par organisation, rapport ou job créerait une cardinalité excessive ; ces dimensions seront exclues ou agrégées.
- Un endpoint public trop détaillé pourrait divulguer l'état interne ; l'exposition sera strictement limitée.
- Les percentiles fiables nécessitent un histogramme ou un backend de métriques ; le lot doit définir un contrat exploitable sans prétendre fournir une plateforme complète.
- Les probes ne doivent pas provoquer de charge significative ni redémarrer le worker sur une simple saturation transitoire.

## Expected result

P10 fournit les signaux et procédures nécessaires pour détecter rapidement indisponibilités, échecs, retries anormaux et retards du pipeline Prévention avant l'activation pilote.

## Execution record

- Collecteur opérationnel ajouté pour BullMQ, outbox, runs, checkpoints et tâches, avec profondeurs, ancienneté, durées récentes, retries, progression et échecs terminaux.
- Endpoints internes `/api/internal/prevention/metrics` et `/api/internal/prevention/health` protégés par token constant-time, allowlist IP, rate limit, cache et timeout bornés.
- Heartbeat worker Redis et healthcheck Compose ajoutés ; liveness API corrigée sur `/api/healthcheck/live`.
- Logs HTTP assainis et événements structurés corrélables ajoutés au publisher, worker et scheduler sans identifiants métier ni messages libres.
- Configuration documentée dans `backend/.env.example` et runbook ajouté dans `docs/prevention-observability.md`.
- Aucune migration de base de données.
- Validations exécutées par l'utilisateur : build backend réussi ; suite Prévention 71/71 ; validation runtime MySQL/Redis réussie.
- Revue Security finale : PASS. Revue indépendante finale : APPROVED.
- Limitation connue : les durées reposent sur une fenêtre bornée aux 1 000 jobs BullMQ terminés/échoués encore retenus ; la plateforme externe de collecte et notification sera raccordée par l'exploitation.
