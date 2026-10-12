# Observabilité Prévention

## Endpoints

- `GET /api/healthcheck/live` est une probe publique de vie. Elle ne teste aucune dépendance et ne divulgue aucun détail interne.
- `GET /api/internal/prevention/health` retourne l'état agrégé de MySQL, Redis, du heartbeat worker et les alertes actives.
- `GET /api/internal/prevention/metrics` expose le contrat texte Prometheus.

Les deux endpoints internes exigent l'en-tête `x-prevention-observability-token`. La valeur provient de `PREVENTION_OBSERVABILITY_TOKEN`, doit contenir entre 32 et 512 caractères et ne doit jamais être placée dans une URL ou un journal.

Ils refusent également toute adresse absente de `PREVENTION_OBSERVABILITY_ALLOWED_IPS`. En production, cette liste doit contenir uniquement les adresses directes des collecteurs ou du proxy de supervision. Une limitation de fréquence par adresse et endpoint, un cache court et un timeout borné protègent MySQL et Redis des scrapes excessifs.

## Signaux et seuils

Le seuil de retard est configuré par `PREVENTION_ALERT_DELAY_SECONDS` et vaut 900 secondes par défaut. Les alertes possibles sont :

- `PREVENTION_DEPENDENCY_DOWN` : MySQL ou Redis indisponible ;
- `PREVENTION_WORKER_HEARTBEAT_MISSING` : aucun heartbeat worker observé ;
- `PREVENTION_WORKER_HEARTBEAT_STALE` : heartbeat plus ancien que le seuil configuré ;
- `PREVENTION_OUTBOX_DELAYED` : événement outbox en attente au-delà du seuil ;
- `PREVENTION_SCHEDULER_DELAYED` : run en attente au-delà du seuil ;
- `PREVENTION_CHECKPOINT_DELAYED` : checkpoint en attente au-delà du seuil ;
- `PREVENTION_TERMINAL_FAILURE` : au moins un échec terminal persistant.

Les métriques n'utilisent que des labels à valeurs finies (`state`, `status`, `source`, `outcome`, `statistic`, `counter`, `dependency`, `alert`). Aucun tenant, utilisateur, rapport, job ou message libre ne doit devenir un label.

## Diagnostic minimal

1. Vérifier `prevention_dependency_up` et le heartbeat worker.
2. Comparer `prevention_oldest_pending_age_seconds` au seuil de retard.
3. Examiner les profondeurs BullMQ, outbox, runs, checkpoints et tâches.
4. Corréler les événements structurés `PREVENTION_*` dans les journaux via leur identifiant technique haché.
5. Pour un échec terminal, traiter la cause avant toute relance manuelle afin de préserver le backoff et l'idempotence.

Les paramètres de requête HTTP, payloads métier, secrets et messages d'erreur bruts sont exclus des nouveaux journaux d'observabilité.

## Fichiers de logs API et worker

- Exécution locale directe : `backend/logs/` (ou `LOG_DIR` si défini). Les fichiers `api-<hôte>-<pid>-app-YYYY-MM-DD.log`, `api-<hôte>-<pid>-error-YYYY-MM-DD.log`, `api-<hôte>-<pid>-http-YYYY-MM-DD.log` et les équivalents `prevention-worker-*` sont séparés par processus afin que deux réplicas ne se disputent pas la rotation.
- Docker local/dev/prod : les deux services utilisent `/app/logs` sur un volume nommé commun ; les préfixes distincts restent valables. Le volume est conservé lors d'un redémarrage des conteneurs. Ne pas publier ce répertoire par Nginx ni l'exposer à un utilisateur métier.
- `*-app-*` contient les événements applicatifs structurés ; `*-error-*` contient les événements de niveau erreur. En conteneur, les sorties brutes stdout/stderr, y compris celles des dépendances, sont conservées séparément par Docker avec rotation (`10 Mo × 5 fichiers`) ; elles ne sont pas dupliquées dans le volume applicatif pour éviter d'y copier des données métier non filtrées.
- Les fichiers applicatifs tournent à 20 Mo et sont conservés 14 jours (`error` : 30 jours). Une purge périodique vise un plafond de 512 Mo pour les fichiers reconnus du volume, anciens journaux et fichiers d'audit de rotation compris, en supprimant d'abord les plus anciens segments tournés, après deux minutes de grâce. Un marqueur d'activité `0600`, actualisé chaque minute, protège le dernier segment et le fichier d'audit de chaque processus/transport tant que son heartbeat a moins de trois minutes ; les marqueurs abandonnés sont nettoyés après un jour. Plusieurs processus très actifs peuvent dépasser temporairement le plafond. Les nouveaux journaux et fichiers d'audit sont ouverts en mode `0600` et aucune nouvelle archive compressée n'est créée. Les anciens fichiers `app-*`, `error-*`, `http-*` ne sont pas renommés ; leurs permissions sont resserrées au démarrage lorsque le processus en est propriétaire. Les fichiers legacy modifiés depuis moins de 24 h restent protégés pendant un déploiement progressif.
- Les transports applicatifs fichier et console n'enregistrent que les événements, codes, identifiants techniques et compteurs autorisés. Les messages libres, URL, piles d'erreur et métadonnées arbitraires y sont remplacés par des empreintes ou omis. Les sorties directes de dépendances dans les journaux Docker restent potentiellement plus détaillées et exigent un accès d'exploitation restreint.
- Un répertoire de logs non inscriptible empêche volontairement le démarrage, même sans `LOG_DIR`, au lieu de perdre silencieusement les journaux dans `/tmp` ou de passer en console seule. Corriger la propriété du volume pour l'utilisateur du conteneur ; ne pas ouvrir les permissions à tous.
- Pour un rattrapage, filtrer `PREVENTION_RECOVERY_FAILED` par `recoveryRunId`, puis `PREVENTION_GROUP_EVALUATION_FAILED` par le même identifiant. Les codes (`errorCode`) et empreintes (`errorFingerprint`) sont techniques ; aucun contenu de prompt ou recommandation n'est journalisé dans ces événements.

Les journaux Docker peuvent contenir des sorties brutes de dépendances : réserver leur accès à l'exploitation et ne pas les joindre à un ticket sans relecture. Hors conteneur, l'API et le worker écrivent leurs événements applicatifs dans `backend/logs` ; une capture de stdout/stderr d'un processus tiers doit être configurée séparément par le superviseur local si nécessaire.

Le conteneur worker vérifie également la fraîcheur du même heartbeat par une sonde locale. Cette sonde lit les paramètres Redis depuis l'environnement sans placer le mot de passe dans sa ligne de commande.
