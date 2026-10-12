# Iteration 025 — Première mise en production encadrée, puis recette multi-tenant

STATUS: IN_PROGRESS

## Roadmap reference
P14 — première mise en production limitée à l'unique organisation présente ; P13R — recette authentifiée Web/mobile multi-tenant après cette première livraison. Ordre explicitement modifié par l'utilisateur le 12/10/2026 ; P13 est terminé.

## Objective
Après correction du libellé du poste humain validé, préparer et effectuer avec l'utilisateur une première mise en production contrôlée pour l'unique organisation présente ; terminer ensuite les vérifications multi-tenant, les mesures de performance et la recette mobile Alpha Concept/EDF.

## Existing state
P13 est terminé. L'utilisateur confirme que la recette Web est déjà faite et que le nouveau libellé du poste validé est correct. Le rattrapage Alpha Concept a été observé jusqu'au budget publié, y compris après une erreur IA transitoire ; cela ne remplace pas les vérifications multi-tenant, les mesures comparatives ni la recette native/mobile. Une seule organisation existe actuellement en production. Les écrans et services mobiles existent, notamment visite, rapports et confirmation de phase ; EDF est activée localement. La composition de production prévoit API, worker partagé, MySQL et Redis, mais l'état réel de la VM et les sauvegardes restent à inventorier.

## Functional scope
- Corriger d'abord l'affichage d'un poste `VALIDE` et verrouillé : sous son montant, afficher « Montant validé » au lieu de « Estimation IA » et ne pas présenter la fourchette IA historique comme son montant courant. Conserver cette proposition initiale, explicitement distinguée, dans « Justifier ».
- Préparer la première livraison sur la VM : inventaire non destructif, version et configuration réellement en place, migrations nécessaires, capacité, secrets, sauvegarde vérifiable, procédure de déploiement, critères GO/NO-GO et retour arrière. Déploiement limité à l'unique organisation présente ; commandes distantes exécutées par l'utilisateur et supervision des résultats par le Supervisor.
- Après déploiement, effectuer immédiatement les contrôles minimaux de santé API/worker/Redis/MySQL, accès autorisé, isolation et absence d'échec terminal ; ne pas déclencher de rattrapage IA coûteux sans prévisualisation et décision explicite. Conserver la possibilité de désactiver Prévention sans supprimer les données.
- Sans refaire la recette Web complète, vérifier en priorité les refus d'accès par rôle, l'absence de données d'une autre organisation après changement de session/organisation, ainsi que la reprise et la visibilité des jobs Alpha Concept/EDF ; réutiliser les preuves Web existantes quand elles suffisent.
- Après la première mise en production, mesurer temps de réponse et durées de traitement sur scénarios comparables ; consigner environnement, volume, échantillons et limites de comparaison.
- Terminer la recette sous comptes autorisés Alpha Concept et EDF sur les écrans mobiles pertinents : visites, rapports, groupes/actions Prévention, confirmation de phase et budget selon les fonctions réellement présentes sur mobile.
- Corriger uniquement les défauts confirmés dans ce périmètre, puis refaire la recette concernée.

## Technical scope
Le correctif Web déjà implémenté distingue un montant validé/verrouillé de sa proposition IA historique sans changer `priceSource`, calcul ou verrouillage. Pour la livraison, examiner la composition Docker, l'image API/worker, les migrations, l'activation par organisation, les journaux et la supervision ; vérifier les écarts avec l'état de la VM avant de formuler toute commande d'écriture. Les contrôles complets des contrats API, journaux et états persistés pour isolation, jobs et performance, puis les tests sur appareil/émulateur, suivent la première livraison. Aucun refactoring préventif ni nouvelle recette Web générale.

## Expected files/modules
Plan et bilan de livraison/recette ; `ROADMAP.md`, `plans/iteration-025.md`, `docker-compose.prod.yml`, `backend/Dockerfile`, `backend/src/config/typeorm.config.ts`, documentation pilote et scripts opérationnels à inspecter ; `frontend/src/components/prevention/BudgetPage.tsx` et test ciblé déjà modifiés ; potentiellement modules mobiles ou backend ciblés seulement en cas de défaut confirmé. Aucune modification Docker/infra prévue sans nécessité démontrée par l'inventaire.

## Agents
Supervisor pour intégration et supervision ; spécialistes devops/backend/frontend si un défaut avéré le justifie ; Security indépendante pour toute correction de permissions/isolation ou de configuration sensible ; Reviewer indépendant avant clôture.

## Execution plan
1. Conserver le correctif et la confirmation utilisateur du libellé du poste humain, sans changer montant ni verrouillage.
2. Faire l'inventaire en lecture seule de la VM et de la configuration réellement déployée ; établir la procédure exacte de sauvegarde, migration, mise en service API/worker/Web, vérifications et retour arrière. Arrêter si un prérequis manque ou si l'écart avec la composition locale est significatif.
3. Faire approuver le point de contrôle GO/NO-GO opérationnel ; l'utilisateur exécute les commandes de sauvegarde et de déploiement une par une, le Supervisor analyse chaque résultat avant l'étape suivante. Ne couvrir que l'organisation existante.
4. Contrôler immédiatement santé, erreurs, accès administrateur, worker, file et intégrité des données ; déclencher un rattrapage uniquement après prévisualisation et décision explicite sur volume/coût. En cas d'échec, appliquer le retour arrière préparé sans rollback aveugle des migrations.
5. Terminer ensuite P13R : permissions, isolation locale Alpha Concept/EDF, reprise des jobs, mesures comparatives et recette mobile authentifiée ; corriger puis retester les défauts confirmés.
6. Faire exécuter les validations ciblées nécessaires, obtenir Security si requise et Reviewer, puis consigner le résultat.

## Parallelization
Déploiement et mutations d'une même organisation séquentiels, avec arrêt explicite à chaque point GO/NO-GO. Les vérifications complètes P13R suivent la première livraison ; analyse en parallèle seulement sur des preuves et modules indépendants.

## Database impact
Les migrations déjà présentes dans le code peuvent être nécessaires sur la base de production : inventaire et sauvegarde/restauration vérifiable avant application ; aucune migration nouvelle ni suppression de données prévue. Les actions de recette peuvent créer des données de test locales explicitement identifiées.

## API impact
No expected API contract change. Toute correction d'un défaut de contrat sera documentée et validée dans le périmètre approuvé.

## Security impact
L'inversion de l'ordre expose temporairement la première livraison à une recette multi-tenant/mobile/performance non terminée. L'unique organisation actuelle réduit la surface inter-tenant en production mais ne supprime pas l'obligation de contrôler l'authentification, les rôles et la confidentialité. Secrets jamais affichés dans les sorties partagées. Revue Security indépendante obligatoire si une correction touche à ces contrôles, à la configuration sensible ou aux données sensibles.

## Validation
Commandes ciblées de tests/typecheck/build et commandes de VM proposées après inventaire ; l'utilisateur les exécute selon AGENTS.md, sans divulguer de secrets. Vérification de sauvegarde avant déploiement, puis santé API/worker/Redis/MySQL et absence d'erreur terminale immédiatement après. La recette Web déjà effectuée n'est pas répétée ; les contrôles multi-tenant manquants et la recette mobile authentifiée suivent la première livraison. Résultats de performance présentés avec conditions et incertitude.

## Acceptance criteria
Sur un poste humain `VALIDE` et verrouillé, la liste indique « Montant validé », sa description accessible ne présente pas la fourchette IA comme courante et « Justifier » distingue la proposition IA initiale ; montant et verrouillage inchangés. Avant première mise en production : inventaire réel, sauvegarde vérifiée, procédure et retour arrière approuvés, exigences minimales d'accès et de santé satisfaites. Après livraison : API et worker opérationnels, absence d'échec terminal inexpliqué, données antérieures intactes ; aucun autre tenant activé. Enfin, preuves Web réutilisées ; permissions, isolation et reprise des jobs Alpha Concept/EDF complétées ; performances mesurées et interprétées sans extrapolation ; parcours mobiles exécutés/documentés ; défauts bloquants corrigés ou itération marquée BLOCKED ; Security si requise et Reviewer approuvés.

## Risks
Inventaire VM et sauvegardes non encore vérifiés ; migration potentiellement non réversible ; interruption de service ; disponibilité de l'appareil/émulateur et des comptes ; comparabilité des volumes entre organisations ; coûts IA et perturbation possible de jobs réels. Aucune extension à d'autres organisations avant P13R terminé. Aucune commande distante n'est exécutée par l'agent.

## Expected result
Première version livrée de manière contrôlée à l'unique organisation de production, puis recette multi-tenant/mobile/performance achevée ; sinon arrêt au point GO/NO-GO ou blocage explicite avec défaut reproductible.

## Execution record
Approved by the user with `GO`. Implementation started; no application commands have been run by the agent in this iteration. The Web budget list now derives its amount caption and accessible AI-range text from validation/lock state: a `VALIDE` and locked item shows « Montant validé » without presenting the historical AI range as current. The initial AI proposal remains in « Justifier »; no amount, source or API persistence was changed. Added a focused UI contract test. The user confirmed the displayed label is correct on 12/10/2026; user-run frontend test and typecheck results remain pending.
Targeted read-only inspection: the Prevention controller requires JWT, organization ADMIN, activation and `reports:read`/`reports:write` by operation; service queries and job lookups bind the authenticated organization. Existing focused tests cover foreign scenarios/jobs, role denial, recovery confirmation/lease/resume and disabled tenants. User-run API/budget/recovery tests requested; results pending. Alpha Concept's last 32-group recovery took 14 min 09 s (group median 10.164 s, p95 22.264 s). A sample of 138 HTTP responses has p95 15 ms, but path and tenant are anonymized/mixed, so this is not an Alpha/EDF comparison. Authenticated per-tenant Web timings requested from the user before mobile testing; no new job triggered.
On 12/10/2026 the user approved moving the first production deployment before completion of P13R, confirmed only one organization currently exists in production, and approved the limited first-release scope with `GO`. The same in-progress iteration was revised rather than opening a new one. Read-only code inspection found production Compose services for MySQL, Redis, API and a separate worker, plus existing migration and pilot documentation. Actual VM state, backup/restoration and release version are unverified; no remote command or deployment has been run.
The repository's `docker-compose.prod.yml` references root-level `nginx/`, `mysql/conf.d/` and `init.sql`, which are absent in this checkout; it also has no frontend service, while `docker-compose.yml` does. Therefore it cannot be assumed to be the VM's actual release descriptor. The real VM deployment layout and frontend delivery method must be established before choosing deployment commands.
The user then replaced `docker-compose.prod.yml` with the current production descriptor and supplied a local `.env.prod`. This descriptor includes frontend/certbot/MySQL/API but no Redis or Prevention worker; it still mounts a root `init.sql` absent from this checkout. Its backend `env_file` references `.env`, not `.env.prod`, so deployment interpolation and container environment need explicit reconciliation. `.env.prod` was untracked and readable beyond its owner; added it to `.gitignore` without opening values, and asked for restrictive file permissions. No assumption is made yet about whether Redis already runs separately on the VM.
User-provided read-only VM inventory on 12/10/2026: working directory `/usr/src/alpha-concept/mobile_backend/alpha-concept-fe`; `init.sql` exists there. Running containers are `csps-certbot`, `csps-frontend`, `csps-backend` (healthy), `csps-mysql` (healthy), and unrelated `ollama-qwen`; no Redis or Prevention worker appears. Docker volumes include `alpha-concept-fe_mysql_data` plus many unrelated/anonymous volumes; exact MySQL mount must be verified with `docker inspect` before any backup or Compose change. Current `.env.prod` key inventory lacks `REDIS_PASSWORD` and `PREVENTION_OBSERVABILITY_TOKEN`, both required by the new backend in production. No secret values were read or logged.
Second VM inventory confirms `csps-mysql` mounts `alpha-concept-fe_mysql_data` and the running backend was created from `/usr/src/alpha-concept/mobile_backend/alpha-concept-fe/docker-compose.yml`, not `docker-compose.prod.yml`. Docker Compose is v2.39.2; root filesystem has 249 GiB available (44% used). Local `docker-compose.yml` already declares Redis and a worker but uses unauthenticated Redis and an insecure default observability token, so it is not ready to be copied to production as-is. Preserve the named MySQL volume and existing Compose project; never use `down -v` or orphan/volume cleanup. Deployment source/release transfer method and VM working-tree state remain to verify.
