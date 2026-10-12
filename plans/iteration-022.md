# Iteration 022 — Journaux persistants complets de l'API et des workers

STATUS: COMPLETED

## Roadmap reference
Correctif d'observabilité P10, incluant le diagnostic du rattrapage Hyper Admin P13 ; ces deux périmètres sont déjà marqués terminés. Ne change pas leurs règles métier.

## Objective
Conserver dans des fichiers exploitables les journaux de l'API backend et des workers, y compris leurs erreurs et les échecs de jobs, afin de diagnostiquer un incident après coup sans dépendre du défilement d'un terminal.

## Existing state
Winston écrit déjà des fichiers JSON tournants dans `backend/logs` en local et dans le volume `backend_logs` en production, mais l'API et le worker partagent les mêmes noms de fichiers. Les Compose local/dev ne montent pas de volume de logs durable. Certaines sorties vont directement en console. Le worker journalise les débuts/fins/échecs des files principales et bulk, mais pas les événements de la file groupes ; ses événements d'échec n'incluent pas la cause. Le rattrapage persiste `lastError` et `failedStage` en base, mais ne les journalise pas de façon corrélable. Le run Alpha Concept du 08/10/2026 a échoué à l'étape GROUPS ; les logs existants ne suffisent pas à déterminer la cause exacte.

## Functional scope
- Conserver tous les événements applicatifs émis par l'API backend et le worker Prévention dans des fichiers persistants distincts par processus. En Docker, les sorties standard/erreur brutes restent dans les fichiers tournants du daemon, sans duplication non filtrée dans le volume applicatif.
- Garder les journaux console utiles en parallèle, avec rotation, rétention et plafond de taille pour les fichiers.
- Journaliser les tentatives et échecs des jobs de groupes, avec identifiants de corrélation non sensibles, statut tentative/terminal et cause technique bornée.
- Journaliser les transitions et l'échec terminal du rattrapage avec organisation, run, étape et code d'erreur.
- Aucun prompt, photo, contenu de recommandation, secret ou charge utile complète dans les événements structurés ; restreindre l'accès aux sorties brutes potentiellement émises par des dépendances.
- Aucun changement des règles de reprise, des validations humaines ni du calcul du budget.

## Technical scope
- Distinguer clairement les transports API/worker dans la configuration Winston et garantir leur persistance en exécution locale, Docker dev et Docker prod ; conserver stdout/stderr dans les journaux Docker tournants et traiter les erreurs de démarrage dans les fichiers applicatifs.
- Enrichir la journalisation structurée dans le consommateur BullMQ et le service de rattrapage, avec bornage et assainissement des champs d'erreur.
- Ajouter des tests ciblés de persistance/séparation, corrélation, cause et non-divulgation ; documenter le chemin de consultation et la rétention.

## Expected files/modules
`backend/src/config/winston-logger.ts`, démarrages API/worker, `backend/src/prevention/worker/prevention-report-consumer.service.ts`, `backend/src/prevention/api/prevention-hyper-admin-recovery.service.ts`, tests ciblés associés, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml` si nécessaire, documentation d'exploitation ciblée.

## Agents
Implémentation directe par le Supervisor ; relecture indépendante après validation. Pas de délégation parallèle nécessaire.

## Execution plan
1. Examiner les sorties actuelles API/worker, le montage des volumes et les contrats des événements BullMQ.
2. Rendre les fichiers persistants et distincts, avec rotation/rétention sûres et capture des sorties manquantes.
3. Ajouter les événements structurés minimaux, corrélables et sûrs pour les groupes/rattrapages.
4. Tester les scénarios de journaux API/worker, retry, échec terminal et progression du rattrapage.
5. Fournir les commandes de validation à l'utilisateur, puis faire les revues indépendantes.

## Parallelization
Aucune : les changements sont concentrés dans le même flux worker/rattrapage.

## Database impact
No expected database change.

## API impact
No expected API change.

## Security impact
Revue Sécurité indépendante requise : les sorties brutes peuvent contenir des données métier ou secrets. Vérifier assainissement, permissions des fichiers/volumes, rétention, absence de prompts/photos et absence d'exposition HTTP des logs.

## Validation
Tests ciblés du logger, des démarrages, du consommateur et du rattrapage ; typecheck/build backend ; contrôle manuel des fichiers API/worker et de la rotation en local puis Docker selon l'environnement disponible. Commandes exécutées par l'utilisateur conformément à AGENTS.md.

## Acceptance criteria
- Les logs applicatifs de l'API et du worker sont dans des fichiers distincts, persistants après redémarrage, en local et dans les configurations Docker ; les sorties standard/erreur des conteneurs restent dans les fichiers Docker tournants.
- La rotation/rétention borne l'occupation disque ; les fichiers ne sont pas servis publiquement et ne divulguent pas de secrets ou données métier brutes.
- Un échec de groupe indique dans le journal du worker le run/organisation et une cause exploitable, sans contenu sensible.
- L'échec terminal du rattrapage indique l'étape et la raison persistée ; les succès ne sont pas présentés comme des échecs.
- Aucune modification des traitements ou des montants humains.

## Risks
Messages d'erreur provenant d'entrées externes : appliquer une classification/allowlist et des limites de taille. Éviter les logs répétitifs sur les jobs à forte volumétrie. Éviter les collisions de rotation entre processus et la duplication incontrôlée des sorties brutes.

## Expected result
Les incidents de l'API, du worker et du rattrapage restent diagnostiquables depuis des fichiers persistants, même après fermeture du terminal ou redémarrage.

## Execution record
Approved by the user on 08/10/2026. Completed: separate API/worker Winston files, persistent Docker volumes and rotating daemon stdout/stderr, safe group/recovery failure events including retry/terminal state, central file/console sanitization, bounded retention (including legacy and rotation-audit files), heartbeat-protected active segments, transport/retention tests and operations documentation. Raw stdout/stderr duplication into the application volume was removed after Security review because it could persist arbitrary sensitive content. No database or API change. Validation executed on user GO: backend `npm run build` passed; 63 targeted tests passed; Compose local/dev/prod configuration passed (prod used placeholder values for mandatory secrets); targeted `git diff --check` clean. Independent Reviewer: APPROVED after correction of group failure state, audit retention and test coverage. Independent Security: APPROVED after final audit-file change. Runtime restart/persistence in a deployed stack remains an operational verification. Pre-existing raw `lastError` storage and Hyper Admin exposure are security debt outside this logging-only iteration; changing that status contract requires separate product approval.
