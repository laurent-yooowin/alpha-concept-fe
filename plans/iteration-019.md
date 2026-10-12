# Iteration 019 — Synchroniser les estimations budgétaires entre périmètres

STATUS: COMPLETED

## Roadmap reference

P8B — Budget métier : recalcul asynchrone, prix IA par action et rapport, total global versionné et préservation des montants humains verrouillés. Correctif de cohérence demandé lors de la recette EDF ; P13R reste différée.

## Objective

Un recalcul explicite peut produire une nouvelle estimation IA. Une fois validement calculée, cette estimation devient la référence pour les mêmes sources dans les autres périmètres, notamment `ALL`, afin que le total global suive les nouveaux montants sans nouvel appel IA divergent.

## Existing state

EDF : les scénarios `ALL` et borné couvrent les mêmes 18 recommandations et 9 postes. Le borné récemment recalculé vaut 28 950 € HT avec 0 % d'aléas ; `ALL` retient 27 550 € HT de postes plus 10 % d'aléas. `rebuildScenario` réestime séparément les mêmes postes dans chaque scénario, puis la réconciliation automatique peut de nouveau produire des prix différents. Les lignes humaines verrouillées sont déjà préservées dans un scénario. Le dépôt est fortement modifié : préserver toutes les modifications existantes.

## Functional scope

- Une demande explicite de recalcul renouvelle uniquement les estimations IA visées ; une variation de prix reste possible.
- Les estimations terminées et valides pour une même organisation, un même client, un même type d'action et un même rapport/source deviennent réutilisables par les scénarios qui recouvrent ces sources. Le montant d'un poste multi-rapports demeure le maximum des estimations par rapport, jamais leur somme.
- La mise à jour déclenche une nouvelle version atomique des scénarios concernés, dont `ALL`, et leur total est recalculé avec leur propre taux d'aléas. Les autres postes ne sont pas réestimés pour cette seule synchronisation.
- Une ligne ou une phase validée manuellement n'est jamais écrasée. Les scénarios dont les sources ou le taux d'aléas diffèrent peuvent légitimement conserver des totaux différents ; à sources et taux identiques, aucun écart de prix IA ne subsiste après synchronisation.
- Les lectures Budget restent sans travail IA ni mutation.

## Technical scope

Créer une référence durable et versionnée d'estimation par rapport/action, tenant-scoped et liée à une empreinte des recommandations/métriques sources. Adapter la construction et la réconciliation des scénarios pour réutiliser la dernière référence compatible, publier les nouvelles estimations seulement après validation du résultat IA et propager les changements aux périmètres affectés. Conserver la protection contre les jobs concurrents/anciens, les reprises et les montants humains. Réutiliser les regroupements et calculs serveur existants ; pas de nouveau moteur de total côté frontend.

## Expected files/modules

`backend/src/prevention/budget/prevention-budget.service.ts`, services/types/tests budgétaires proches, nouvelle migration et entité si nécessaires ; `backend/src/prevention/api/prevention-budget-api.service.ts` seulement si la sélection de la dernière version doit être ajustée ; `ROADMAP.md` pour enregistrer le critère P8B approuvé et son statut. Frontend uniquement si un rafraîchissement d'écran s'avère nécessaire.

## Agents

Supervisor pour l'intégration ; spécialiste backend si l'implémentation indépendante est utile ; Security pour l'isolation tenant et les écritures de prix ; Reviewer indépendant après validation.

## Execution plan

1. Finaliser le contrat d'identité/empreinte des sources et le chemin de propagation sans changer les règles de maximum par rapport ni d'aléas.
2. Ajouter le stockage/migration éventuels, adapter estimation explicite, réconciliation et publication atomique.
3. Ajouter les tests de divergence inter-périmètres, re-chiffrage autorisé, verrouillage humain, source modifiée, concurrence, reprise et isolation.
4. Faire exécuter la validation ciblée, puis Security et Reviewer ; corriger avant de clore P8B.

## Parallelization

Implémentation backend séquentielle sur les fichiers budgétaires ; revues indépendantes ensuite. Pas d'écritures parallèles dans les mêmes modules.

## Database impact

Migration additive probable pour conserver les estimations par source et leur version ; aucune réécriture destructive des scénarios historiques. Vérifier index, unicité tenant/source et rollback.

## API impact

Aucun changement de contrat public attendu. Les endpoints de lecture continuent de renvoyer le dernier scénario matérialisé.

## Security impact

Prix et sources doivent rester strictement isolés par `organizationId` ; contrôles d'accès et verrouillages humains inchangés. Revue Security indépendante requise.

## Validation

Tests unitaires/intégration budgétaires ciblés, typecheck backend, validation de migration et recette EDF : recalcul borné puis vérification des montants des mêmes postes et du total `ALL` ; vérifier taux d'aléas et absence de mutation des lignes humaines. L'utilisateur exécute les commandes selon la politique du dépôt, sauf autorisation explicite contraire.

## Acceptance criteria

Un nouveau prix IA obtenu par recalcul peut différer du précédent, mais devient le prix des mêmes sources dans les scénarios concernés ; le total `ALL` suit automatiquement après succès de la propagation. À sources et taux d'aléas identiques, les totaux coïncident. Aucun prix humain verrouillé, autre organisation, poste non concerné ou ancienne version historique n'est modifié ; un échec laisse le dernier scénario valide consultable.

## Risks

Chevauchement partiel des périodes, rapports multiples avec règle du maximum, réindexation qui remplace les identifiants de constats, calculs concurrents, dérive des anciens scénarios et coût IA. Ne pas assimiler des sources différentes sous une même clé de poste.

## Expected result

EDF peut relancer un chiffrage ciblé et obtenir une nouvelle estimation, puis consulter un total global cohérent avec ces nouveaux prix et son propre taux d'aléas.

## Execution record

08/10/2026 — GO explicite reçu. Plan passé de `PROPOSED` à `APPROVED`, puis `IN_PROGRESS`. Implémentation en cours.

Référence additive par organisation/action/rapport et empreinte des sources ; le prompt influe sur un recalcul explicite mais ne sépare pas la source partagée. Publication transactionnelle des prix avec protection contre un job ancien, réutilisation en réconciliation et propagation vers les autres scénarios. Reprise prudente des anciennes estimations par rapport quand les clés de recommandations sont inchangées ; les montants humains verrouillés restent exclus. Migration, service et tests ciblés ajoutés.

Validation exécutée après GO autorisant les commandes : `npm run build` réussi ; 69 tests Budget/API réussis ; migration additive exécutée uniquement sur `csps_db_dev` et confirmée `[X]`. Revue Security : PASS après ajout d'un ordre de requête monotone par organisation et compaction des seules références de cache obsolètes. Aucun déploiement ni recalcul EDF réel à ce stade.

Revue indépendante : `REVIEW_STATUS: APPROVED`. Aucun déploiement distant : le worktree contient de nombreuses modifications préexistantes hors itération et un déploiement global ne serait pas isolé. La recette a donc été limitée à l'organisation EDF de la base locale.

Recette EDF locale après redémarrage des processus backend et worker : scénario borné version 6 publié par `RECALCULATE` à 32 550 € HT ; scénario `ALL` version 13 publié automatiquement par `RECONCILE` avec les mêmes 9 postes à 32 550 € HT, zéro écart poste par poste, aléas `ALL` 10 % soit total 35 805 € HT. Aucune ligne humaine verrouillée dans ces deux scénarios ; conservation couverte par tests et revues. La migration est appliquée uniquement sur `csps_db_dev` ; aucun déploiement distant effectué. Itération clôturée pour la recette locale.
