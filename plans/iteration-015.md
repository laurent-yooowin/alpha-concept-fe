# Iteration 015 — Généralisation locale Prévention multi-tenant

STATUS: COMPLETED

## Roadmap reference

P12 — Généralisation locale, avant l'adaptation mobile P13 et la recette commune Web/mobile multi-tenant.

## Objective

Activer progressivement Prévention pour les organisations locales actives, sans perdre les données du pilote ni exposer une organisation aux données d'une autre.

## Existing state

P11 est clos pour le pilote local. `preventionEnabled` et les traitements tenant-scoped existent. Le script `activate-prevention-pilot.sh` désactive les autres organisations et ne peut donc pas servir tel quel pour P12. La liste exacte des organisations actives et leurs volumes reste à inventorier en lecture seule.

## Functional scope

- Inventorier les organisations locales actives et leur éligibilité, volumes, historique Prévention et état de backfill.
- Activer les organisations une par une, sans désactiver les précédentes ; préserver les comptes, rapports et montants humains.
- Pour chacune : rattrapage/reconstruction nécessaire, contrôle de l'isolation, des résultats publiés, des files, de la santé et de la reprise/idempotence.
- Documenter et vérifier un retour arrière limité à une organisation. La recette métier et performance complète Web/mobile est réservée à P13, après adaptation mobile.

## Technical scope

Ajouter ou adapter une procédure d'activation additive et bornée, fondée sur l'identifiant explicite et l'état actif du tenant. Réutiliser les workers, checkpoints, files et backfills existants ; ne pas relancer globalement les données déjà à jour. Effectuer les contrôles et l'activation séquentiellement.

## Expected files/modules

`backend/scripts/activate-prevention-pilot.sh` comme référence à ne pas réutiliser pour plusieurs tenants ; nouveau script/procédure P12, tests ciblés d'activation et d'isolation, scripts de backfill/scheduler existants si une correction bornée est nécessaire, `plans/iteration-015.md`.

## Agents

Supervisor pour l'intégration ; spécialiste backend seulement si utile. Revue Security indépendante obligatoire pour l'isolation tenant ; Reviewer indépendant après validation.

## Execution plan

1. Inventaire local en lecture seule et présentation des cibles exactes, volumes et ordre de passage.
2. Implémentation de l'activation additive sûre et tests ciblés, sans toucher à la VM distante.
3. Validation manuelle des commandes par l'utilisateur, puis activation contrôlée tenant par tenant avec contrôle après chaque étape.
4. Revue Security et Reviewer ; consignation des résultats et du retour arrière.

## Parallelization

Pas d'activation simultanée de plusieurs organisations ; seule l'analyse indépendante peut être parallèle.

## Database impact

La migration additive `1830000034000` étend l'enum `prevention_scheduler_runs.workKind` à `ACTIVATION` ; retour arrière : convertir ces runs en `AUTOMATIC` avant de réduire l'enum. Mise à jour ciblée de `organizations.preventionEnabled` et données Prévention dérivées uniquement pour les tenants éligibles.

## API impact

Pas de nouveau contrat API attendu.

## Security impact

Frontière tenant critique : contrôle d'éligibilité avant admission et écriture, aucune lecture/écriture inter-organisation, aucun déclenchement pour tenant inactif, revue indépendante obligatoire.

## Validation

Build et tests backend ciblés, tests multi-tenant positifs/négatifs, inventaire/dry-run, vérification des compteurs de jobs et de résultats par organisation, reprise idempotente, vérification du retour arrière et santé API/worker. L'utilisateur exécute les commandes applicatives selon `AGENTS.md` ; les résultats sont consignés sans les inventer. Les mesures de performance et la recette métier Web/mobile finales sont reportées à P13.

## Acceptance criteria

Chaque organisation locale active ciblée est inventoriée et activée séparément ; le pilote reste actif. Aucun tenant inactif ou non autorisé n'est traité. Les backfills/rattrapages se terminent ou disposent d'une reprise sûre documentée, sans doublon ; l'isolation et le retour arrière sont vérifiés. Security retourne PASS et Reviewer APPROVED. Aucune action distante. La recette commune P13 reste explicitement à faire.

## Risks

Volumes et état historique variables selon tenant ; coûts et durée de rattrapage à mesurer avant admission. Le script pilote actuel est exclusif. Une anomalie d'isolation ou de publication suspend l'activation suivante.

## Expected result

Toutes les organisations locales actives sont techniquement prêtes pour la recette commune Web/mobile multi-tenant de P13, sans préjuger de son résultat métier ou performance.

## Execution record

07/10/2026 — `GO` utilisateur reçu ; P12 démarre. État du dépôt fortement modifié par P11, préservé. Inventaire local en lecture seule : Alpha Concept est l'unique organisation active et déjà activée pour Prévention (15 rapports). EDF et ENGIE ont chacune 2 rapports mais `isActive=0`, `preventionEnabled=0` ; Elm est inactive et sans rapport. Aucun deuxième tenant actif n'est éligible. Réactiver EDF/ENGIE ou choisir/créer d'autres organisations actives élargirait le périmètre et nécessite un choix explicite. Aucun script modifié, aucune organisation activée, aucune action distante. P12 est `BLOCKED` jusqu'à cette décision.

L'utilisateur indique avoir réactivé EDF. Vérification locale en lecture seule : EDF est maintenant `isActive=1` mais `preventionEnabled=0`. P12 reprend pour cette organisation active ; aucun traitement Prévention EDF ne démarre par ce seul changement d'état. Deux processus worker Prévention préexistants tournent localement ; leur démarrage n'est pas lié à l'activation EDF. Aucune écriture EDF effectuée par l'agent à ce stade.

## Avenant proposé — traitement automatique après activation d'une organisation

Nouvelle règle demandée par l'utilisateur : une transition `isActive: false → true` doit rendre Prévention disponible et déclencher automatiquement le rattrapage de cette organisation, sans commande manuelle par tenant. La mise en œuvre proposée conserve un worker Prévention **partagé** démarré et supervisé indépendamment de l'API ; aucune création de processus par organisation ni travail lourd dans la requête HTTP. L'activation doit enregistrer durablement une demande tenant-scoped, idempotente et rejouable ; le worker existant la consomme sous les contrôles d'éligibilité, de version et de capacité P11. Désactivation : aucun nouveau travail ; la réactivation suivante reprend seulement le manquant. EDF déjà réactivée avant cet avenant exige un rattrapage initial distinct après mise en service du nouveau chemin. Les tests couvriront transition, répétition, échec puis reprise, tenant inactif, isolation et absence de doublon. Revue Security et Reviewer requises. Ce comportement étend la règle P12 initiale ; aucune implémentation de cet avenant ni activation Prévention EDF avant validation du choix « traitement automatique partagé » par l'utilisateur.

La demande littérale de démarrer un processus worker à chaque activation n'est pas retenue comme hypothèse : deux processus worker tournent déjà localement, et les workers existants sont conçus pour plusieurs tenants. Une supervision du processus partagé et une alerte s'il est absent restent nécessaires ; cela ne remplace pas la demande durable de rattrapage. P12 est `BLOCKED` en attente de la confirmation de ce comportement.

GO utilisateur reçu pour l'avenant. Implémentation en cours : une transition Hyperadmin `isActive=false → true` sauvegarde l'organisation et un checkpoint différentiel tenant-scoped dans une transaction sous verrou de ligne ; seul le premier requérant concurrent crée le checkpoint. Le worker partagé reçoit le job après commit, et la récupération scheduler peut reprendre le checkpoint si Redis est indisponible. Une CLI ciblée existe pour EDF, réactivée avant le nouveau code, avec dry-run par défaut. Build backend et 13/13 tests ciblés d'activation/isolation réussis localement. Le dry-run EDF confirme `isActive=true`, `preventionEnabled=false`, 2 rapports. Première revue Security a demandé la correction de concurrence ; celle-ci est intégrée et en contre-revue. Aucune activation Prévention EDF ni redémarrage API/worker n'ont encore été effectués.

Contre-revue Security `SECURITY_STATUS: PASS` après verrouillage transactionnel ; Reviewer indépendant `REVIEW_STATUS: APPROVED`. Le build backend et 13/13 tests ciblés sont réussis. Prochaine étape selon la politique de commandes du projet : l'utilisateur exécute l'activation ciblée EDF sur la base locale, puis l'agent vérifie en lecture seule le checkpoint, la file, les projections et l'absence d'effet sur Alpha Concept. La mise en service du nouveau parcours automatique pour les réactivations futures exige un redémarrage contrôlé de l'API sur ce build ; ne pas démarrer de worker supplémentaire (deux processus worker locaux observés).

GO explicite de l'utilisateur pour les commandes P12/P13 : exécution locale autorisée. La première tentative d'activation EDF a échoué sur le format MySQL `DATETIME(6)` et a été entièrement annulée ; format SQL corrigé. La seconde a créé un checkpoint durable. Le job avait été publié par la CLI sur Redis `6379` alors que les workers utilisaient `6380` : suppression du seul job EDF vérifié sur `6379`, republication ciblée sur `6380`, et exigence explicite `REDIS_HOST`/`REDIS_PORT` dans la CLI. Le checkpoint EDF s'est terminé avec 2 rapports et 25 constats.

Le contrôle a révélé 3 groupes historiques EDF non encore staged. Le parcours d'activation automatise désormais leur rattrapage idempotent et borné avant clôture du scan ; le rattrapage ponctuel EDF a créé les 3 jobs, tous `READY`. L'enum SQL a été étendu par migration `1830000034000`, appliquée localement et vérifiée. Un verrou de métadonnées provenait d'une ancienne transaction `READ ONLY` endormie ; seule cette connexion a été fermée pour libérer la migration. Les scans de reprise vérifient maintenant la propriété du checkpoint par organisation pour les runs explicites et les runs d'activation dérivés.

Build backend et 30 tests ciblés réussis après les corrections. Security indépendante : `SECURITY_STATUS: PASS`. Reviewer indépendant : `REVIEW_STATUS: APPROVED`. Mise en service locale contrôlée : anciens processus API/worker remplacés par une API et un worker partagé sur Redis `6380` ; API `/api/healthcheck` = HTTP 200 ; files sans job actif. État final : Alpha Concept 15/15 rapports indexés, 324 constats et 32 groupes prêts ; EDF 2/2 rapports, 25 constats et 3 groupes prêts ; ENGIE et Elm restent inactives sans projection Prévention. Aucune correspondance inter-tenant invalide trouvée pour les constats ou jobs de groupe. Aucun montant humain modifié.

Retour arrière ciblé documenté, non exécuté : désactiver `preventionEnabled` pour la seule organisation concernée via le flux administratif contrôlé ; le worker ignore alors ses nouveaux jobs, sans supprimer ses rapports, constats ou montants. Corriger puis réactiver crée un nouveau scan différentiel idempotent. La recette métier et performance Web/mobile multi-tenant demeure P13.
