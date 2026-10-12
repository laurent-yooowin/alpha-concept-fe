# Pilote Prévention P11

## Préconditions

- migrations déployées, API et worker sur la même version ;
- build et validations P11 réussis ;
- identifiant UUID de l'organisation pilote explicitement confirmé ;
- administrateur métier disponible pour la recette ;
- endpoints P10 supervisés avec un token technique et une allowlist valides.

Le flag `organizations.preventionEnabled` vaut `false` par défaut. L'activation ne remplace ni le RBAC ni l'isolation par `organizationId`. Les données analytiques existantes ne sont pas supprimées lors d'une désactivation.

## Activation contrôlée

Depuis `backend/`, fournir les paramètres MySQL via l'environnement puis exécuter :

```bash
MYSQL_DATABASE=<database> bash scripts/activate-prevention-pilot.sh <organization-uuid>
```

Le script vérifie que l'organisation existe et est active, désactive tout ancien pilote, active la cible dans une transaction puis exige exactement une organisation activée.

Après activation, un administrateur de cette organisation déclenche une unique reconstruction depuis l'interface Prévention ou via `POST /api/prevention/rebuild`. Le cooldown et l'identifiant durable du run empêchent les reconstructions concurrentes. Les rapports modifiés pendant la désactivation sont repris par ce backfill ; les événements outbox déjà persistés restent différés et redeviennent publiables.

Cette reconstruction concerne les projections des rapports, pas les évaluations IA des groupes de visite antérieurs au module Prévention. Leur rattrapage est une opération distincte, à exécuter une fois après le premier déploiement et l'activation du tenant.

## Rattrapage initial des phases historiques

Le script `backfill:prevention-groups` inspecte les organisations l'une après l'autre. Sans `PREVENTION_GROUP_BACKFILL_APPLY=true`, il ne fait que l'inventaire, y compris pour les organisations locales désactivées, signalées non éligibles. En mode écriture, il exige soit un UUID `PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID`, soit `PREVENTION_GROUP_BACKFILL_ALL_ENABLED=true` ; seules les organisations actives avec Prévention activé sont traitées. Il utilise le service de rattrapage idempotent existant, par pages de 100 visites : une évaluation Prévention déjà présente n'est pas remplacée et aucune analyse SPS n'est relancée. Le worker Prévention doit être opérationnel pour traiter les nouveaux jobs et les appels IA associés ; sa configuration Docker transmet désormais la clé OpenAI et les paramètres S3 requis, sans les inscrire en clair dans le dépôt.

Après le build et les migrations, depuis le conteneur backend de production, simuler puis appliquer explicitement au tenant pilote :

```bash
docker compose -f docker-compose.prod.yml exec -T backend env \
  PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID=<organization-uuid> \
  npm run backfill:prevention-groups

docker compose -f docker-compose.prod.yml exec -T backend env \
  PREVENTION_GROUP_BACKFILL_APPLY=true \
  PREVENTION_GROUP_BACKFILL_ORGANIZATION_ID=<organization-uuid> \
  npm run backfill:prevention-groups
```

Le script écrit un audit JSONL sans texte SPS, URL S3 ni secret dans `/app/logs/prevention-group-backfill.jsonl`, sur le volume Docker `backend_logs` ; en local, le chemin est `backend/logs/prevention-group-backfill.jsonl`. Le fichier doit être régulier, non lié et privé (`0600`). Sa taille est limitée à 10 Mio : archiver puis retirer ce fichier avant un nouveau lancement si cette limite est atteinte. Les entrées `PAGE_STARTED`/`PAGE_COMPLETED` et `ORGANIZATION_COMPLETED` permettent de contrôler une reprise après interruption. Une nouvelle simulation doit alors afficher moins de groupes manquants ; relancer l'application est sûr grâce à l'idempotence. Ne pas lancer ce script automatiquement au démarrage ou à chaque déploiement. Avant une exécution couvrant plusieurs tenants, inventorier les groupes et confirmer le coût IA ; `PREVENTION_GROUP_BACKFILL_ALL_ENABLED=true` est une décision distincte.
Un identifiant de groupe historique trop long produit `PAGE_REJECTED` avec l'identifiant de visite et le numéro d'entrée, sans texte source ; corriger ce groupe avant de relancer. Si l'organisation est désactivée pendant l'application, `ORGANIZATION_INTERRUPTED` arrête le run au lieu de le déclarer complet. Les pages déjà traitées restent acquises et une reprise est idempotente.

## Contrôles techniques

Pendant le backfill puis sur une période d'observation représentative, relever depuis les endpoints internes P10 :

- nombre de rapports, snapshots, constats, recommandations et budgets ;
- profondeur et âge maximal de l'outbox, des runs, checkpoints et tâches ;
- jobs terminés, retries et échecs terminaux ;
- durée moyenne et P95 des jobs ;
- latence P95 des endpoints Prévention.

Les critères P11 sont : aucun doublon, aucun échec terminal non traité, retard non durablement supérieur à 15 minutes et latence API P95 inférieure à 500 ms. Tout dépassement doit être analysé avant un go.

## Recette métier

L'administrateur pilote confirme explicitement :

- cohérence du dashboard et des tendances avec les rapports sources ;
- pertinence des observations, recommandations, risques et références ;
- traçabilité des rapports ;
- cohérence des scénarios et montants Budget ;
- absence d'accès au module depuis une organisation témoin désactivée.

Consigner les volumes, mesures, anomalies, corrections et la décision `GO` ou `NO-GO` dans l'exécution de l'itération 014.

## Désactivation et retour arrière

Pour arrêter le pilote sans supprimer son historique :

```bash
MYSQL_DATABASE=<database> bash scripts/deactivate-prevention-pilot.sh <organization-uuid>
```

Les nouvelles lectures et traitements Prévention sont alors bloqués, les jobs déjà en file deviennent des no-op sûrs et les événements persistés restent reprenables. Une réactivation suivie d'un backfill réconcilie l'état courant de façon idempotente.

Le rollback de la migration de colonne est réservé à un environnement isolé de validation. Il ne doit pas servir de rollback fonctionnel en production.
