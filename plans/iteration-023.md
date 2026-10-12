# Iteration 023 — Réactivation et supervision Alpha Concept

STATUS: COMPLETED

## Roadmap reference
Vérification opérationnelle ciblée P12/P13 après le correctif de journaux P10 (itération 022). La recette Web/mobile multi-tenant P13R reste à faire ultérieurement, sans être incluse ici.

## Objective
Réactiver Alpha Concept si nécessaire, déclencher ou suivre son rattrapage complet et superviser de bout en bout les traitements jusqu'au résultat vérifié, à l'aide des nouveaux journaux API/worker.

## Existing state
Le code de journalisation est implémenté, compilé et testé, mais son fonctionnement dans les processus actuellement en service et sa persistance après redémarrage ne sont pas encore vérifiés. Un précédent rattrapage Alpha Concept a échoué à l'étape GROUPS sans cause exploitable dans les anciens logs. L'état actuel de l'organisation et du run doit être relevé avant toute action.

## Functional scope
- Vérifier que l'API et le worker exécutent la version comprenant les nouveaux logs ; redémarrer/déployer localement les services concernés seulement si nécessaire, sans toucher à la VM distante.
- Relever l'état Alpha Concept, du worker partagé, des runs et des jobs avant action ; ne pas désactiver une organisation déjà active uniquement pour simuler une réactivation.
- Si Alpha Concept est inactive, la réactiver via le parcours Hyper Admin ; demander le rattrapage complet (rapports/extraction, groupes et actions Prévention, budget) en mode immédiat seulement dans les plafonds existants. Si elle est déjà active, utiliser le déclenchement de rattrapage prévu sans bascule artificielle.
- Suivre chaque étape et les files/journaux jusqu'à succès ou erreur terminale ; vérifier phases, risques, types d'action/métriques et total budget publié, sans écraser les validations ni montants humains.
- Ne pas lancer EDF, ENGIE, Elm, la recette mobile/multi-tenant ou des travaux de production distante dans cette itération.

## Technical scope
Corréler organisation, recoveryRunId, groupJobId, étapes, erreurs sûres et heartbeats entre UI, base, files et journaux. Établir un relevé avant/après et corriger uniquement un défaut confirmé du rattrapage Alpha Concept déjà approuvé ; toute modification de règle métier ou expansion de périmètre nécessite un nouvel accord.

Avenant précisé le 09/10/2026 : pour l'évaluation IA Prévention d'un groupe, une seule requête LLM. Si elle reste en cours après 120 s, attendre jusqu'à 240 s supplémentaires (360 s maximum au total), puis l'interrompre. Toute erreur reçue remonte immédiatement, sans nouvel appel LLM. Ajuster le bail technique du groupe pour couvrir ce maximum sans double exécution. Aucun changement de publication budgétaire partielle.

Ajustement opérationnel demandé : les scripts locaux `start-web.sh` et `stop-web.sh` pilotent aussi le worker Prévention, évitent de créer un doublon d'un worker manuel déjà actif et laissent au worker un délai d'arrêt gracieux compatible avec l'analyse prolongée.

Précision demandée ensuite : `start-web.sh` effectue un redémarrage propre, et `stop-web.sh` libère aussi les ports réellement utilisés par l'API et Vite ainsi que les autres processus locaux de ce projet (notamment le worker sans port). Un port occupé par un autre utilisateur doit être signalé, sans tentative de signal privilégié. Vite doit garder un port strict au démarrage, sans décalage silencieux.

## Expected files/modules
Plan et relevé de supervision ici ; journaux `backend/logs` ou volume Docker ; modules de récupération/worker uniquement si un défaut reproductible impose un correctif ciblé. Aucun fichier mobile prévu.

## Agents
Supervisor pour supervision et intégration ; Backend/DevOps seulement si un défaut technique ciblé le justifie ; Security et Reviewer indépendants si un correctif important est nécessaire.

## Execution plan
1. Vérifier les processus/API/worker, les fichiers de logs et l'état initial Alpha Concept/run/jobs.
2. Vérifier l'environnement et les plafonds, puis réactiver si inactive et déclencher le rattrapage complet autorisé.
3. Suivre extraction, groupes/actions, budget et publier un bilan chiffré avec les éventuels échecs corrélés.
4. Corriger et revalider tout défaut confirmé dans le périmètre ; clôturer seulement après résultat vérifié ou blocage explicite.

## Parallelization
Aucune action concurrente sur les mêmes runs ou files. Lecture diagnostique parallèle possible sans duplication.

## Database impact
No expected database schema change. Le rattrapage peut écrire les données Prévention d'Alpha Concept selon les règles existantes ; les validations et montants humains restent protégés.

## API impact
No expected API contract change.

## Security impact
Accès Hyper Admin/tenant borné à Alpha Concept ; aucune exposition de secrets ou contenus métier dans les journaux ; contrôle indépendant si un correctif touche l'autorisation ou les données sensibles.

## Validation
Contrôles d'état et fichiers de logs avant/après, suivi des étapes et erreurs, comptages des groupes attendus/traités, vérification de publication du budget et d'absence d'altération humaine. Toute commande applicative ou Docker sera annoncée et exécutée selon l'autorisation de cette itération.

## Acceptance criteria
La version de logs est réellement active et les fichiers API/worker persistent ; Alpha Concept est active ; un rattrapage complet est suivi jusqu'à un statut final cohérent ; les groupes éligibles sont traités ou chaque exception est explicitement expliquée ; le budget global suit les montants publiés ; les données humaines restent inchangées. Aucun autre tenant ni recette mobile n'est traité.

## Risks
Organisation déjà active ; volume de jobs et coûts IA ; rattrapage précédent en échec ; services en cours d'usage ; droits/accès aux logs et à Hyper Admin. Préserver les données et vérifier l'état exact avant toute relance.

## Expected result
Bilan Alpha Concept de bout en bout, avec preuve de la journalisation et des traitements, avant de décider séparément de la suite.

## Execution record
Approved by the user on 08/10/2026. The user built and restarted API/worker; separate private logs (mode `0600`) now contain readable startup, HTTP and worker events after a narrow sanitizer correction. Independent Security review of that logging diff: PASS. Alpha Concept recovery run `11824b30-69d6-4565-9c35-5f5ccb82c55f` failed at GROUPS after 31/32 groups; one group returned `AI_INVALID_RECOMMENDATION_RISK_VECTOR` on all five attempts. A targeted correction states exact expected vector counts and records only safe structural diagnostics, preserving strict validation and human overrides. Initial targeted tests and build passed; independent Security PASS and Reviewer APPROVED. Relaunched run `cafafc4e-f9b6-490b-b68d-303a5bf332fe` completed 32/32 group jobs but failed before budget with `PREVENTION_SOURCE_CHANGED_RECONFIRM`: its own asynchronous reindexing changed derived findings. Corrected the raw SPS source fingerprint to exclude derived findings while retaining report/visit/mission/photo/catalog changes, and gated budget publication on report snapshot updates after the latest report outbox event, with explicit failure for a terminal latest event. Live SQL confirmed 0 lagging and 0 failed report events for the completed group run. With user authorization, 56/56 targeted tests and `npm run build` passed; independent Security PASS and Reviewer APPROVED. API and worker were restarted once at 23:35 with one process each. A fresh authenticated Hyper Admin recovery and final budget verification remain pending. Pre-existing `AiService.console.error`/raw parse-response exposure remains separate confidentiality debt.
Run `e52706c9-dea4-4dbd-bf4b-7b868b589768` was relaunched from Hyper Admin: extraction completed 15/15, groups reached 31/32 READY, then the last PHOTO group failed after five `UPSTREAM_REQUEST_ABORTED` attempts under the default 60-second LLM timeout. Budget was not started. On 09/10, duplicate local API/worker processes were detected and reduced to one each; the sole worker was restarted with the existing supported `PREVENTION_LLM_TIMEOUT_MS=120000` setting, confirmed in its process environment. A new authenticated recovery and final budget verification remain pending; no direct database reset or human-value mutation was performed.

Avenant timeout en cours : l'analyse IA d'un groupe utilise désormais un seul appel HTTP, avec fenêtre initiale de 120 s et prolongation de 240 s maximum avant interruption terminale. Le bail du groupe passe à 600 s pour couvrir téléchargement des photos et réponse IA sans reprise concurrente. Tests ciblés ajoutés ; nouveau suivi Alpha Concept encore à faire.

Validation du 09/10 : 40/40 tests ciblés réussis et `npm run build` réussi. Revue indépendante : `REVIEW_STATUS: APPROVED` ; revue sécurité : `SECURITY_STATUS: PASS`. L'ancien worker unique a été arrêté par SIGTERM ; le nouveau binaire compilé a démarré dans une session surveillée (`PREVENTION_WORKER_READY`, PID 1831785), un seul worker constaté. Rattrapage authentifié Alpha Concept et vérification du budget encore attendus ; itération maintenue IN_PROGRESS.

À la demande de l'utilisateur, les scripts Web locaux ont été ajustés pour démarrer/arrêter le worker en plus de l'API et du front, détecter un worker démarré hors script et attendre jusqu'à 480 s avant un éventuel arrêt forcé. L'arrêt surveille tout le groupe de processus, pas seulement `npm`. Un fichier d'empreinte PID/PGID/heure de création, répertoire et commande protège contre la réutilisation de PID ; les chemins symboliques sont refusés, les répertoires runtime sont en `0700` et les logs en `0600`. Le worker manuel en service n'est pas adopté par le nouveau fichier PID. `bash -n`, `git diff --check` et une vérification ciblée de l'empreinte `/proc` passent ; revue indépendante `REVIEW_STATUS: APPROVED`, revue sécurité `SECURITY_STATUS: PASS`. Scripts non exécutés sur les services actifs afin de préserver la supervision Alpha Concept ; aucun redémarrage métier implicite.

Précision opérationnelle ultérieure : `start-web.sh` appelle d'abord `stop-web.sh`, qui arrête les processus locaux du projet (dont un worker manuel), libère les écouteurs sur les ports API/Vite puis vérifie leur disparition ; l'API utilise le port configuré (`8096` actuellement) et Vite un port strict (`5173` par défaut). Les processus d'un autre utilisateur ne sont pas signalés. Avant chaque signal, le PID/PGID/heure de création/UID et le périmètre projet ou port sont revérifiés. Si un groupe géré épuise sa période de grâce, le repli individuel n'ouvre pas un second délai. Validation non destructive : `bash -n`, `git diff --check`, lecture du port `8096` et détection du worker manuel `1831785` ; revue indépendante `REVIEW_STATUS: APPROVED`, revue sécurité `SECURITY_STATUS: PASS`. Aucun script de redémarrage n'a été exécuté pendant un traitement Alpha Concept ; la validation opérationnelle de l'arrêt/démarrage reste à effectuer lors du prochain redémarrage autorisé.

Supervision de la réactivation du 09/10 : le nouveau run Alpha Concept `e71168b4-fba9-4234-96fa-72426aaf9a59` a atteint `GROUPS` à 12:05:36, puis `BUDGET` à 12:17:14 et `COMPLETED` à 12:17:36 dans les logs du worker. Les 32 jobs de groupes se sont terminés ; un groupe ayant d'abord reçu `AI_INVALID_JSON` a réussi à la deuxième tentative. Les jobs d'indexation des rapports ont présenté des erreurs non terminales suivies de reprises. Le passage à `COMPLETED` exige dans le code un run budgétaire `PUBLISHED` et la concordance des groupes attendus/READY. Le montant global publié et l'absence de modification des valeurs humaines restent à confirmer dans les données/UI ; l'itération reste `IN_PROGRESS`.
Confirmation utilisateur : l'écran affiche `TOTAL BUDGET HT 145 750,00 €` après la publication et aucun montant n'est validé par un humain dans cette sélection. Les 32 groupes READY garantissent la persistance des résultats phase/risque par le traitement du groupe ; l'indexation des rapports a achevé ses reprises avant la publication. Aucun changement de schéma ni de contrat API. Revue des correctifs : Reviewer APPROVED et Security PASS ; 40/40 tests ciblés et build backend réussis sur autorisation antérieure de l'utilisateur. La recette Web/mobile multi-tenant et les mesures de performance restent hors périmètre, à traiter en P13R. Les scripts d'arrêt/démarrage ont été validés statiquement ; leur scénario d'arrêt complet des processus/ports n'a pas été testé de façon destructive pendant le rattrapage.
