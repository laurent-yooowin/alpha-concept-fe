# Iteration 024 — Résilience du rattrapage Alpha Concept à une coupure IA

STATUS: COMPLETED

## Roadmap reference
P13 — pilotage Hyper Admin du rattrapage complet et visibilité des traitements. Contrôle de résilience demandé avant clôture de P13 ; P13R Web/mobile multi-tenant reste ultérieur.

## Objective
Simuler une perte temporaire d'accès au fournisseur IA pendant un rattrapage Alpha Concept, rétablir l'accès et vérifier de bout en bout les reprises, les échecs terminaux éventuels ainsi que la conservation d'un poste budgétaire validé par un humain.

## Existing state
L'itération 023 a établi le succès nominal du run Alpha Concept `e71168b4-fba9-4234-96fa-72426aaf9a59` : 32 groupes achevés, budget publié, total affiché 145 750,00 € HT, aucun montant humain validé. Le worker retente normalement les erreurs de groupe non terminales ; le délai maximal d'un appel IA est de 360 s et son expiration rend le groupe terminal. Le rattrapage échoue si un groupe de ce run est terminal. Le comportement opérationnel après une coupure réseau n'a pas été testé.

## Functional scope
- Relever avant essai le run, les groupes, le total publié et l'état API/worker d'Alpha Concept.
- Avant le rattrapage, faire valider par l'utilisateur un seul poste budgétaire Alpha Concept (`VALIDE` et verrouillé), puis relever sa clé, sa quantité, son prix, son statut, la version et le total affiché. Si l'utilisateur désigne plutôt la validation du scénario entier, clarifier avant toute action.
- Déclencher un rattrapage contrôlé sur Alpha Concept et provoquer, sur un groupe en traitement, une coupure temporaire de son seul accès IA sortant ; rétablir cet accès pendant la fenêtre de reprise prévue.
- Suivre les tentatives, le statut du groupe et du run, l'indexation des rapports et la publication budgétaire ; distinguer reprise automatique après erreur transitoire et échec terminal après expiration maximale.
- Si le run échoue terminalement, vérifier que l'échec est visible et que le budget déjà publié reste intact ; une nouvelle commande Hyper Admin sera explicitement décidée avant toute relance.
- En cas de réussite, vérifier que la nouvelle vue et le total publié intègrent exactement le poste humain sans réécrire son montant ; comparer les autres variations de total aux nouveaux montants IA, pas seulement au total précédent.
- Ne pas couper Internet pour tout l'hôte, bloquer DB/Redis, arrêter d'autres services, agir sur EDF/ENGIE/Elm ou intervenir sur la VM distante.

## Technical scope
Déterminer une méthode réversible et strictement bornée au processus worker et à l'endpoint IA, sans exposition de secrets ni modification persistante de la configuration réseau. Préparer le retour arrière avant l'injection. Corréler `recoveryRunId`, groupe, tentatives, horodatages, statuts Hyper Admin et journaux API/worker. N'exécuter l'injection qu'après confirmation du point de départ et d'un groupe effectivement actif. Si la méthode bornée n'est pas disponible, arrêter et demander une décision plutôt que couper le réseau global.

Méthode retenue : un hook Node local opt-in, chargé uniquement dans le worker par `WEB_PREVENTION_AI_OUTAGE_TEST=1`, simule une erreur de connexion sur la requête LLM d'analyse de groupe de l'organisation explicitement ciblée si un marqueur privé est présent. Il ne touche pas aux autres appels HTTP, consomme le marqueur avant un unique échec et l'ignore après deux minutes ; il ne journalise ni requête ni secret. Le marqueur sera créé pendant `GROUPS` ; le worker sera redémarré normalement après la recette pour enlever le hook. Il s'agit d'une simulation du chemin d'erreur réseau, pas d'une coupure physique d'Internet.

Mesurer à titre de référence locale les durées des étapes et des jobs de groupes du run nominal déjà publié, puis les comparer au run avec panne, avec nombre d'échantillons, médiane, p95 et échecs. Cette mesure backend Alpha Concept ne remplace pas la recette de performance Web/mobile multi-tenant P13R.

## Expected files/modules
Ce plan et le bilan de recette ; `scripts/start-web.sh` et le hook/test local `scripts/prevention-ai-outage-hook*.cjs`. Modules Prévention/worker et tests ciblés seulement en cas de défaut reproductible dans le périmètre. Aucune modification mobile ou de production prévue.

## Agents
Supervisor pour orchestration et analyse ; DevOps/Backend seulement si une méthode d'injection bornée ou un correctif ciblé l'exige. Reviewer indépendant pour un correctif important ; Security indépendant si la coupure ou le correctif touche aux contrôles d'accès, aux données sensibles ou au réseau partagé.

## Execution plan
1. Confirmer le mécanisme d'injection réversible, ses cibles exactes et le retour arrière ; relever l'état nominal.
2. Avec l'autorisation explicite de l'utilisateur pour les commandes, exécuter les contrôles et le redémarrage local ; l'utilisateur déclenche le rattrapage authentifié depuis l'Hyper Admin.
3. Superviser en direct la coupure, le rétablissement, les tentatives, le run et le budget jusqu'à un résultat final explicite.
4. Corriger uniquement un défaut confirmé, faire exécuter les validations nécessaires, demander les revues requises et consigner le résultat.

## Parallelization
Aucune injection ou relance concurrente ; supervision séquentielle d'un seul run Alpha Concept.

## Database impact
No expected database schema change. Un rattrapage écrit les résultats dérivés habituels d'Alpha Concept ; aucune suppression ou réinitialisation directe de données.

## API impact
No expected API contract change.

## Security impact
La panne doit rester bornée au flux IA du worker. Préserver les autres locataires, DB/Redis et la connectivité de l'hôte ; ne pas divulguer clé IA, requêtes ou réponses métier dans les traces.

## Validation
L'agent exécute les commandes locales couvertes par l'autorisation explicite de l'utilisateur ; celui-ci déclenche le rattrapage authentifié. L'agent vérifie les logs et statuts ciblés, le total publié avant/après, la visibilité d'un éventuel échec et la remise en état du worker. Tests/build ciblés du hook et du backend.
Les mesures de durée sont extraites en lecture seule des journaux du worker et présentées avec leur périmètre exact ; aucune comparaison non équivalente n'est présentée comme amélioration ou régression.

## Acceptance criteria
Coupure et rétablissement contrôlés sans impact sur les autres services ; résultat du groupe et du run explicitement observé ; reprise automatique seulement dans les limites réellement prévues ; échec terminal correctement signalé si atteint ; poste humain inchangé et total cohérent après réussite, ancien budget publié préservé en cas d'échec jusqu'à une nouvelle publication ; aucun effet sur un autre tenant. Le bilan distingue clairement ce qui a été testé de ce qui ne l'a pas été.

## Risks
Coût IA d'un nouveau rattrapage ; durée pouvant atteindre 360 s par appel et backoff ; disponibilité d'une méthode d'injection locale bornée ; risque d'interrompre d'autres travaux si la coupure est globale. Arrêt du test si la cible ou le retour arrière sont incertains.

## Expected result
Preuve opérationnelle du comportement de rattrapage Alpha Concept face à une panne IA temporaire, avec état final et budget cohérents, avant clôture P13.

## Execution record
Approuvée par l'utilisateur avec `GO` ; commandes locales également autorisées explicitement.
Référence de performance locale extraite en lecture seule des journaux du run nominal `e71168b4-fba9-4234-96fa-72426aaf9a59` (09/10/2026) : EXTRACTION 12:02:11.127 → GROUPS 12:05:36.136 (3 min 25 s), GROUPS → BUDGET 12:17:14.592 (11 min 38 s), BUDGET → COMPLETED 12:17:36.104 (21,5 s), total environ 15 min 25 s. Pour 32 jobs de groupes terminés : durée médiane 13,94 s, p95 47,87 s, maximum 49,20 s ; un échec IA non terminal suivi d'une réussite au deuxième essai. Les durées d'étape incluent attente, reprises et indexation ; elles ne sont pas la somme des durées individuelles. Aucune mesure Web/mobile ou comparative multi-tenant effectuée.
L'utilisateur a validé le poste Alpha Concept/Cl1 « Contrôle et mise en conformité des installations électriques » à 3 000,00 € HT. L'écran affiche `Validé` tout en conservant la fourchette historique IA 1 800–6 000 € et l'étiquette `Estimation IA`. Lecture du code : la ligne visible affiche cette étiquette dès que `aiEstimateDetails` existe ; le formulaire réutilise également `priceSource` initial par défaut. L'API exige `lockedManual` pour le statut `VALIDE`.
Autorisation explicite ultérieure de l'utilisateur pour exécuter toutes les commandes de cette itération. Validations effectuées : `bash -n scripts/start-web.sh`, `node --check scripts/prevention-ai-outage-hook.cjs`, `node --test scripts/prevention-ai-outage-hook.test.cjs` (2/2), `npm run build` backend et 40/40 tests du traitement des groupes, tous réussis. Lecture seule de la base locale `csps_db_dev` : le poste validé a pour `itemKey` `295f3f69f4c4458082f25ea8e22305f3366e583ff09734d0de68ecae6b2f7a22`, montant 3 000,00 € HT, statut `VALIDE`, `lockedManual=1`; sa `priceSource` demeure « Estimation IA — indicative, à valider ». Un autre poste homonyme existe : comparer par clé, pas par titre. Le dernier run budgétaire global est `PUBLISHED` à 145 750,00 € HT, antérieur à la validation, qui n'a pas modifié le montant de ce poste. Revue corrective indépendante : `REVIEW_STATUS: APPROVED` ; revue sécurité : `SECURITY_STATUS: PASS`. Lecture seule du 09/10/2026 16:02 : aucun run de rattrapage, groupe ou job planifié actif, tous locataires confondus. Aucun nouveau rattrapage ni panne injectée à ce stade.
Le 09/10/2026 à 16:03, redémarrage contrôlé par `WEB_PREVENTION_AI_OUTAGE_TEST=1 WEB_PREVENTION_AI_FAULT_ORGANIZATION_ID=49f872f3-3584-432c-9818-7b271b5ee6e7 ./scripts/start-web.sh` : trois services démarrés, `PREVENTION_WORKER_READY` et `BACKEND_API_STARTED` présents, frontend HTTP 200. Le endpoint API essayé sans authentification répond 401, conforme au contrôle d'accès. Variables du hook confirmées dans le seul processus worker.
L'utilisateur a déclenché le rattrapage authentifié Alpha Concept `55e68bb3-ac6b-4117-a3dc-aa73b5e0de59` à 16:15:18. Étape GROUPS observée à 16:18:41. Un marqueur privé 0600 créé à 16:19:06 a été consommé une fois ; le job `30690a56-587e-4484-a878-e018fe23aabe` a produit `fetch failed` à 16:19:33 puis est devenu `READY` au deuxième essai à 16:24:56. Un autre job avait rencontré `AI_INVALID_JSON` avant l'injection et a aussi repris. Les 32 jobs sont `READY`, sans échec terminal. Étape BUDGET à 16:28:11, run `COMPLETED` et budget global `PUBLISHED` à 16:29:26. Durée totale 14 min 09 s ; extraction 3 min 24 s, groupes/indexation 9 min 30 s, budget 1 min 15 s. Les 32 durées de jobs terminés ont une médiane de 10,164 s, p95 de 22,264 s et maximum de 31,094 s ; comparaison indicative au nominal seulement, sans inférer de gain de performance.
Le scénario publié `8d70cb48-1e4e-46a8-ab4b-b42d14a7bc13` a un total de 180 850,00 € HT, exactement la somme de ses 43 postes, dont 177 850,00 € estimés et 3 000,00 € validés ; aléas 0,00 €. Le poste humain de clé `295f3f69f4c4458082f25ea8e22305f3366e583ff09734d0de68ecae6b2f7a22` y reste `VALIDE`, `lockedManual=1`, quantité 1, coût et total 3 000,00 € HT. Le précédent total publié était de 145 750,00 € HT : écart +35 100,00 € lié aux autres postes recalculés (2 ajoutés, 5 retirés, 27 montants modifiés), pas à la ligne humaine. Aucun autre rattrapage locataire observé pendant l'essai. Après terminaison et vérification de l'absence de jobs actifs, `./scripts/start-web.sh` a restauré le démarrage normal à 16:30 ; API et worker prêts, frontend HTTP 200, marqueur absent et variables d'injection absentes du worker. Revue opérationnelle finale : `REVIEW_STATUS: APPROVED` ; sécurité déjà `PASS`. L'utilisateur a confirmé visuellement sur l'écran Budget le total 180 850,00 € HT et la ligne électrique `Validé` à 3 000,00 € HT.
Dette constatée hors correctif de cette itération : le `priceSource` historique « Estimation IA — indicative, à valider » et l'étiquette UI « Estimation IA » restent affichables sur un poste désormais `VALIDE` et verrouillé ; le montant/statut persistés sont corrects, mais le libellé est trompeur.
