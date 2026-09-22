# Iteration 004 — Processus et conteneur worker indépendants

STATUS: COMPLETED

## Roadmap reference

P3 — Worker : processus et conteneur worker indépendants.

## Objective

Créer un point d'entrée NestJS worker distinct de l'API et un service Docker `prevention-worker` utilisant la même image, sans port public. L'API et le worker doivent pouvoir démarrer, s'arrêter, redémarrer et évoluer séparément.

## Existing state

P2 fournit Redis/BullMQ, la queue `prevention`, l'outbox et son publisher. Le backend n'a qu'un bootstrap HTTP `src/main.ts`; aucun processus ou conteneur worker n'existe. P4 reste propriétaire de l'extraction et de la normalisation métier.

## Functional scope

- Ajouter une commande dédiée démarrant uniquement le contexte worker.
- Connecter le processus à MySQL et Redis avec les mêmes contrats sécurisés que l'API.
- Gérer proprement les signaux d'arrêt et la fermeture des connexions.
- Ajouter un conteneur worker sans port public dans les trois environnements Compose pertinents.
- Permettre un déploiement/redémarrage indépendant de l'API.
- Ne pas consommer ni acquitter les jobs rapports tant que le handler P4 n'existe pas, afin de ne perdre aucun travail publié par P2.

## Technical scope

- Créer un `PreventionWorkerModule` minimal, sans controllers HTTP et sans import de `AppModule`.
- Créer `src/workers/prevention.worker.ts` avec `NestFactory.createApplicationContext` et arrêt `SIGTERM`/`SIGINT` idempotent.
- Centraliser la configuration Redis partagée API/worker afin d'éviter deux implémentations divergentes.
- Ajouter les scripts build/start dédiés et vérifier que l'artefact compilé est présent dans l'image existante.
- Ajouter un contrôle de disponibilité interne MySQL/Redis au bootstrap, avec retry borné de démarrage et logs sans secrets.
- Préparer l'interface d'enregistrement des futurs handlers P4 sans créer de consumer métier actif, scheduler, extraction, agrégat ou budget.
- Configurer `prevention-worker` avec `restart`, dépendances réseau, variables DB/Redis, utilisateur non-root et aucune exposition de port.

## Expected files/modules

- `backend/src/workers/prevention.worker.ts`
- `backend/src/prevention/worker/`
- configuration Redis partagée sous `backend/src/prevention/`
- `backend/package.json` et lockfile si nécessaire
- `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`
- tests lifecycle/configuration worker.

## Agents

- Backend : bootstrap, module worker, lifecycle et configuration partagée.
- DevOps : services Compose indépendants et arrêt/redémarrage.
- Tester : validation du bootstrap sans HTTP et de l'indépendance des processus.
- Security : secrets Redis, absence de port, privilèges et séparation tenant.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validation et statuts.

## Execution plan

1. Extraire la configuration Redis P2 dans un provider partagé sans régression API.
2. Implémenter le module et le bootstrap worker sans consumer métier actif.
3. Ajouter scripts et tests de lifecycle/fermeture.
4. Ajouter le service worker aux Compose sans port ni volume applicatif privilégié.
5. Faire exécuter par l'utilisateur build, tests et validations Docker ciblées.
6. Obtenir les revues sécurité et reviewer, corriger puis clôturer P3.

## Parallelization

Backend puis DevOps sur fichiers distincts après gel des variables. Security et Reviewer interviennent uniquement sur le lot stabilisé.

## Database impact

No expected database change.

## API impact

No public API change. Le bootstrap worker ne démarre aucun serveur HTTP.

## Security impact

Revue obligatoire : authentification/TLS Redis, secrets non journalisés, absence de port public, exécution non-root, fermeture sûre et interdiction de charger les modules HTTP/admin dans le worker.

## Validation

- Build backend et tests ciblés worker/configuration.
- Vérifier que le point d'entrée worker compilé existe et démarre sans ouvrir de socket HTTP.
- Démarrer API et worker séparément, puis redémarrer chacun sans interrompre l'autre.
- Vérifier l'arrêt propre sur `SIGTERM` et l'absence de connexion résiduelle.
- Vérifier qu'aucun job `prevention.report.*` n'est consommé ou acquitté avant P4.
- Valider les trois configurations Compose et confirmer l'absence de `ports` sur le worker.
- Vérifier qu'une panne Redis ne rend pas l'API dépendante du lifecycle worker.

## Acceptance criteria

- [x] L'API et le worker ont deux points d'entrée et deux commandes distinctes.
- [x] Le worker démarre sans serveur HTTP et sans port publié.
- [x] API et worker se redémarrent indépendamment.
- [x] Les connexions DB/Redis et signaux d'arrêt sont gérés proprement.
- [x] Aucun secret n'est codé ou journalisé; Redis reste authentifié en production.
- [x] Aucun job métier P2 n'est consommé avant l'implémentation P4.
- [x] Aucun endpoint, scheduler, extraction ou agrégat P4+ n'est ajouté.
- [x] Les validations utilisateur passent.
- [x] `SECURITY_STATUS: APPROVED`.
- [x] `REVIEW_STATUS: APPROVED`.
- [x] P3 est marqué Terminé.

## Risks

- Import accidentel d'`AppModule` pouvant démarrer des providers HTTP ou le publisher API dans le worker.
- Double fermeture Redis lorsque plusieurs providers partagent une connexion.
- Compose peut créer un couplage de santé API/worker contraire à l'indépendance attendue.
- Activer prématurément un consumer no-op ferait perdre les jobs P2 avant P4.

## Expected result

Un squelette worker NestJS conteneurisé, sécurisé et exploitable séparément de l'API, prêt à recevoir les handlers d'extraction P4 sans consommer prématurément les événements existants.

## Execution record

Implémentation : bootstrap `createApplicationContext` et module worker minimal, configuration Redis partagée, contrôle borné MySQL/Redis, fermeture idempotente et commandes dédiées. Services worker indépendants ajoutés aux trois Compose, sans port et avec exécution non-root. Aucun consumer BullMQ n'est actif avant P4.

Fichiers principaux : `backend/src/workers/prevention.worker.ts`, `backend/src/prevention/redis/`, `backend/src/prevention/worker/`, scripts/tests P3, `backend/package.json`, `backend/Dockerfile.dev` et trois fichiers Compose.

Base de données : aucun changement.

API : aucun changement public.

Validation exécutée par le Supervisor avec autorisation explicite de l'utilisateur : build PASS; tests ciblés 13/13 PASS; validation des trois Compose PASS; runtime MySQL/Redis isolé PASS avec job P2 préservé et arrêt SIGTERM propre.

Sécurité : `SECURITY_STATUS: APPROVED`.

Reviewer : `REVIEW_STATUS: APPROVED`.

Limite connue : les handlers BullMQ et traitements d'extraction appartiennent à P4. Dette technique : l'attribut Compose historique `version` est obsolète mais non bloquant et hors périmètre.
