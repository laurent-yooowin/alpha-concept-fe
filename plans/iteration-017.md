# Iteration 017 — Reconstruire les groupes Prévention au rattrapage complet

STATUS: COMPLETED

## Roadmap reference

Correctif de P13 (rattrapage complet Hyper Admin) et de P9 (backfill idempotent). P13R reste la prochaine recette multi-tenant ; ce défaut doit être corrigé avant de considérer le rattrapage exhaustif en production. Aucun changement du périmètre mobile de P13R.

## Objective

Lors d'un rattrapage complet, relancer la construction Prévention de tous les groupes éligibles, y compris `READY`, pour recalculer les propositions IA de phase, risques et types d'actions avant la publication du budget global. Aucune donnée validée ou corrigée par un humain ne doit être remplacée.

## Existing state

`backfillOrganization()` parcourt les visites analysées puis `scheduleForVisit()` appelle `upsertGroup(..., onlyIfMissing=true)`. Dans `upsertGroup`, tout job existant est ignoré avant contrôle de la phase, des risques, des types d'actions et même du hash source. Le rattrapage P13 attend les jobs de groupes `PENDING/PROCESSING/RETRY`, puis lance le budget ; il n'impose donc pas la reconstruction des groupes `READY`.

## Functional scope

- Le rattrapage complet reconstruit tous les groupes éligibles de l'organisation, y compris ceux déjà `READY` et complets : nouvelle phase proposée, nouveaux risques d'observations/recommandations et nouveaux types d'actions, à partir des sources courantes.
- Une phase `VALIDATED` conserve sa valeur effective, son statut, son auteur et sa date de validation ; la nouvelle phase IA reste uniquement une proposition distincte.
- Les recommandations éditées par un humain et leurs overrides de risque/type/mesure restent inchangés et prioritaires ; aucune reconstruction IA ne les efface ni ne les remplace.
- Les postes budgétaires validés ou verrouillés manuellement conservent leurs montants, statuts et traces d'audit lors du nouveau budget global ; seules les estimations non verrouillées peuvent être recalculées.
- Les groupes sans source exploitable ou devenus obsolètes sont signalés explicitement ; aucune ancienne analyse ne doit être présentée silencieusement comme reconstruite.
- Le statut « terminé » du rattrapage complet et la publication du budget exigent la fin de toutes les reconstructions de groupes requises, ou un échec explicite ; aucun budget présenté comme complet avec des groupes encore en attente.
- Ce recalcul exhaustif s'applique à la commande explicite de rattrapage complet, pas aux lectures d'écran ni aux mises à jour ordinaires.

## Technical scope

Ajouter un mode explicite de reconstruction tenant-scoped aux jobs d'analyse de groupes existants, contournant seulement le court-circuit `onlyIfMissing`/hash identique pour ce run. Assurer la déduplication et la reprise par groupe/run ; séparer les champs IA recalculables des champs validés/édités par l'humain au moment de la persistance, et intégrer une barrière durable dans l'orchestration P13 avant le budget. Vérifier aussi la conservation des lignes budgétaires humaines verrouillées. Conserver les contrôles de version/hash source et les verrous actuels ; ne pas créer de chemin IA parallèle.

## Expected files/modules

`backend/src/prevention/worker/prevention-group-processing.service.ts` et tests ; `backend/src/prevention/api/prevention-hyper-admin-recovery.service.ts` et tests ; prévisualisation/DTO/API et modale `frontend/src/components/hyperAdmin/HyperAdminOrganizations.tsx` pour le volume à recalculer ; éventuellement scheduler/observabilité et migration ciblée si l'état durable existant est insuffisant. `plans/iteration-017.md` ; `ROADMAP.md` uniquement pour le statut du correctif après approbation/validation.

## Agents

Supervisor pour l'intégration ; Backend ciblé si utile ; Security indépendante si les changements touchent la séparation tenant ou les validations humaines ; Reviewer indépendant après validation.

## Execution plan

1. Définir le périmètre exact des groupes éligibles et le contrat de conservation des validations/overrides humains.
2. Ajouter la reconstruction explicite de tous les groupes de l'organisation, avec reprise idempotente par run et conservation des décisions humaines.
3. Faire attendre au rattrapage complet la fin de toutes les reconstructions avant le budget global ; exposer les échecs.
4. Tester les cas nouveau/`READY`/validé/édité/obsolète/inter-tenant, puis vérifier sur une organisation locale contrôlée.

## Parallelization

Analyse ciblée en parallèle possible ; un seul propriétaire des modifications du worker, puis intégration séquentielle dans l'orchestrateur.

## Database impact

Une migration de suivi par run/groupe peut être nécessaire pour garantir la reprise et la barrière durable ; décision après inspection du modèle existant. Seuls les champs de proposition IA non validés pourront être réécrits. Aucune donnée validée ou corrigée par un humain ne sera écrasée.

## API impact

Pas de nouvel endpoint attendu. La prévisualisation/confirmation existante devra compter les groupes à réanalyser et tenir compte de ce volume dans les plafonds immédiats ; le statut P13 devra refléter leur avancement et leurs échecs.

## Security impact

Conserver le périmètre strict de l'organisation, les droits Hyper Admin et la priorité des validations/overrides humains. Aucune lecture ou écriture inter-tenant.

## Validation

Tests backend ciblés sur la reconstruction exhaustive, la reprise, la barrière budget et la conservation des phases validées, overrides humains et montants budgétaires verrouillés ; build backend ; test de rattrapage local sur données contrôlées avec comparaison avant/après des validations humaines ; `git diff --check` ; revue Security si nécessaire, puis Reviewer indépendant. Résultats uniquement après exécution réelle.

## Acceptance criteria

Chaque groupe éligible, même déjà `READY` avec un hash inchangé, reçoit une nouvelle analyse de phase/risque/type pour ce rattrapage complet. La phase effective validée, les recommandations/overrides humains et les montants budgétaires manuels validés ou verrouillés restent strictement identiques avant/après. Le rattrapage ne publie le budget qu'après la fin vérifiée de tous les groupes du run ; les échecs sont visibles. Aucun nouveau calcul n'est déclenché par simple consultation. Tests et revue indépendante approuvés.

## Risks

Coût IA nettement supérieur pour les groupes déjà calculés, concurrence avec l'édition d'une visite et risque d'écraser les décisions humaines ; contrôler volume, version source, provenance des overrides et reprise pour éviter les doublons. La commande doit exposer ce coût/périmètre avant confirmation.

## Expected result

Rattrapage réellement complet de la construction Prévention (phase proposée, risques, types) puis du budget, sans écrasement des décisions humaines ni publication prématurée.

## Execution record

08/10/2026 — GO explicite reçu. Plan passé de `PROPOSED` à `APPROVED`, puis `IN_PROGRESS`. Reconstruction exhaustive par run des groupes analysés, barrière durable avant budget, suivi du volume dans la prévisualisation et statut par run. La phase effective validée et les overrides humains restent prioritaires ; la proposition IA est rafraîchie séparément. Migration `1830000036000` ajoutée. Validation exécutée après GO pour les commandes : 105 tests backend ciblés réussis après correction de deux mocks, `npm run build` backend réussi, `npm run typecheck` frontend réussi, `git diff --check` réussi. Revue Security : PASS ; revue indépendante : APPROVED. Migration `1830000036000` appliquée avec succès sur la seule base locale `csps_db_dev`. EDF locale active : 2 rapports, 3 groupes `READY`, aucune validation humaine ni ligne budgétaire verrouillée à comparer en recette réelle. Recette bloquée avant lancement : deux API et deux workers Prévention encore actifs ont démarré avant la nouvelle compilation ; redémarrage coordonné requis pour garantir l'exécution du nouveau code. Aucun rattrapage EDF n'a été déclenché.

08/10/2026 — L'utilisateur demande de continuer la recette locale EDF. Blocage levé ; redémarrage coordonné des processus locaux concernés en cours, sans toucher l'API locale en mode production sur le port 8090.

08/10/2026 — Recette locale EDF terminée sur `csps_db_dev` : run `b74996e2-36d2-4b89-a3c2-fddc06db20b7` `COMPLETED`, 3/3 groupes reconstruits `READY`, 13/13 recommandations typées ; budget global `PUBLISHED`, scénario calculé à 10 340,00 € HT. Deux défauts de reprise révélés et corrigés pendant la recette : job de balayage déjà terminé bloquant une nouvelle reprise, et lease calculé avec l'heure applicative locale plutôt que l'heure UTC MySQL. Un lease orphelin du seul run EDF a été libéré après vérification que son ancien processus n'existait plus. Correction finale : jobId stable pour un run futur, une fenêtre d'une minute pour un run dû, exclusion des leases actifs. 108/108 tests ciblés, build backend, typecheck frontend et `git diff --check` réussis. Revue Security finale : PASS ; Reviewer final : APPROVED. API locale 8096 et worker redémarrés sur le build final ; API locale en mode production 8090 laissée intacte. EDF ne contenait aucune phase validée ni ligne budgétaire verrouillée : cette conservation est vérifiée par tests, pas par comparaison de données EDF réelles. Aucun changement de schéma supplémentaire après la migration `1830000036000`.
