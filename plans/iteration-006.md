# Iteration 006 — Agrégats journaliers et priorité déterministe

STATUS: COMPLETED

## Roadmap reference

P5 — Agrégats : statistiques journalières et score de priorité.

## Objective

Matérialiser dans le worker les statistiques journalières tenant-scoped issues des findings P4 et un classement de priorité déterministe, explicable et vérifiable, sans appel IA. Une modification ou suppression de rapport ne recalcule que les partitions analytiques touchées.

## Existing state

P4 produit des snapshots et findings canoniques atomiques. `prevention_daily_statistics` existe mais n'est pas alimentée. `normalizedKey` distingue volontairement les groupes sources et ne permet donc pas de regrouper un même libellé entre rapports. Aucune table ne matérialise encore les scores ni leur configuration. La formule métier du score reste une décision ouverte dans `ROADMAP.md`; la formule par défaut configurable proposée ci-dessous fait partie de l'approbation explicite de cette itération. Le document `docs/PLAN_PREVENTION_ORGANISATIONS.md` précédemment cité n'est pas présent dans le dépôt actuel.

## Functional scope

- Calculer les comptes journaliers par organisation, date, type de chantier, catégorie, criticité et type de finding.
- Compter distinctement findings, rapports, visites et missions.
- Regrouper déterministement les formulations strictement identiques après normalisation textuelle, sans classification IA ni rapprochement sémantique.
- Produire pour chaque groupe d'observations un score 0–100, ses composantes, sa période de calcul, ses premières/dernières occurrences et ses compteurs sources.
- Permettre une configuration complète propre à chaque organisation, administrable uniquement par ses administrateurs dans les lots API/Web ultérieurs.
- Résoudre la configuration dans l'ordre : configuration active de l'organisation en base, sinon valeurs par défaut chargées depuis le `.env`.
- Conserver la provenance et la version de la configuration effective avec chaque score afin de pouvoir justifier son calcul.
- Recalculer uniquement les dates/groupes touchés après un upsert/delete P4; un rejeu inchangé ne déclenche rien.
- Conserver les références permettant à P7/P8 de retrouver les rapports sources.
- Ne créer ni scheduler P6, API P7, UI P8, budget P8B ou backfill P9.

### Formule de priorité par défaut proposée à approuver

Score entier borné à 0–100 :

- criticité, 35 points : faible 20 %, moyen 60 %, élevé 100 %;
- fréquence, 20 points : `min(nombre d'occurrences / 10, 1)`;
- couverture, 15 points : `min(nombre de missions distinctes / 5, 1)`;
- récence, 10 points : 100 % si ≤ 7 jours, 75 % si ≤ 30, 40 % si ≤ 90, sinon 10 %;
- récurrence, 10 points : `min((nombre de jours distincts - 1) / 4, 1)`;
- tendance, 5 points : comparaison des 30 derniers jours aux 30 précédents, 100 % en hausse, 50 % stable, 0 % en baisse;
- émergence, 5 points : 100 % si première occurrence ≤ 30 jours et au moins deux occurrences, sinon 0 %.

Les pondérations, coefficients et seuils par défaut sont fournis par des variables d'environnement documentées. Le worker valide au démarrage leur présence, leurs types, leurs bornes, leur cohérence et une somme des sept pondérations égale à 100. Une configuration `.env` invalide empêche son démarrage avec une erreur explicite; aucune valeur métier n'est silencieusement codée en dur.

L'administrateur d'organisation pourra configurer les sept pondérations, les coefficients de criticité et les seuils numériques de fréquence, couverture, récence, récurrence, tendance et émergence. Une configuration administrateur valide et active remplace entièrement les valeurs `.env` pour cette organisation. Aucun mélange implicite entre valeurs DB et `.env` n'est autorisé; une configuration incomplète ou invalide est rejetée.

Chaque modification crée une version immuable. Chaque score enregistre l'identifiant de la version administrateur utilisée ou la version/empreinte des valeurs `.env` effectives. P5 implémente le stockage versionné et la résolution `configuration organisation → .env`; les endpoints sécurisés relèvent de P7 et l'écran administrateur de P8.

L'écran P8 chargera via l'API la configuration réellement effective : version active en base si elle existe, sinon valeurs courantes du `.env` chargées par la plateforme. Il affichera la provenance (`Configuration personnalisée` ou `Valeurs par défaut de la plateforme`), la version et la date de dernière modification lorsqu'elle existe. Restaurer les valeurs par défaut désactivera la configuration personnalisée et réaffichera les valeurs `.env` effectives. Une modification du `.env` nécessite le redémarrage des processus concernés avant d'être effective.

Une approbation `GO` de ce plan valide cette formule par défaut et cette règle de résolution.

## Technical scope

- Ajouter une migration additive pour une signature analytique inter-rapports (`patternKey`), une table tenant-scoped de configurations versionnées et une table tenant-scoped de scores matérialisés avec composantes JSON ou colonnes documentées, contraintes, index et rollback.
- Ajouter un chargeur typé des valeurs `.env`, partagé par le worker, avec validation stricte au démarrage.
- Identifier une seule version active par organisation et appliquer cette configuration complète avant le fallback `.env`.
- Enregistrer sur chaque score la provenance et la version/empreinte de la configuration effective.
- Étendre P4 pour calculer `patternKey` depuis type + contenu canonique, indépendamment du groupe, sans modifier `normalizedKey` ni le hash P4.
- Ajouter les jobs BullMQ ciblés `prevention.statistics.refresh` avec identifiants déterministes, payload minimal et tentatives bornées.
- Recalculer chaque partition dans une transaction : agrégats et scores nouveaux sont publiés atomiquement; suppression des lignes devenues vides.
- Utiliser `UTC` et une date de référence explicite du job pour rendre récence/tendance/émergence rejouables.
- Conserver `UNCATEGORIZED` tant que la taxonomie n'est pas renseignée.
- Exclure photos, directives, prompts et contenus bruts des jobs/logs/tables d'agrégats.

## Expected files/modules

- nouvelle migration P5, entités de configuration versionnée et de score;
- `backend/src/prevention/statistics/`;
- configuration backend et fichiers `.env.example` applicables, sans secret;
- adaptations ciblées extraction/worker/queue;
- tests unitaires de formule et harness MySQL/Redis P5;
- `backend/package.json` pour la validation ciblée.

## Agents

- Backend : migration, jobs, agrégateur et intégration worker.
- Tester : formule, partitions, concurrence, changement et suppression.
- Security : isolation tenant et payloads.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validations et statuts.

## Execution plan

1. Figer la formule par défaut, les variables `.env`, les contraintes administrateur et les contrats de partition/signature.
2. Ajouter la migration additive et les entités de configuration/score.
3. Implémenter la résolution DB puis `.env` et le calcul pur paramétré avec tests des valeurs par défaut, variantes et seuils.
4. Implémenter le recalcul transactionnel des statistiques et scores.
5. Chaîner les jobs ciblés après les changements P4 utiles.
6. Valider migration, idempotence, concurrence, suppression et isolation tenant.
7. Obtenir Security puis Reviewer.

## Parallelization

La formule pure et le harness peuvent être préparés indépendamment. Migration, service d'agrégation et intégration worker restent sous un propriétaire backend unique.

## Database impact

Migration additive attendue : `patternKey` indexé sur les findings, table tenant-scoped de configurations versionnées et table tenant-scoped de scores de priorité. Rollback sans modification des tables transactionnelles métier.

## API impact

No public API change. P7 exposera la configuration effective, sa provenance et sa gestion aux seuls administrateurs de l'organisation.

## Security impact

Revue obligatoire : isolation stricte `organizationId`, impossibilité d'utiliser la configuration d'une autre organisation, payload minimal, absence de contenu source interdit et publication atomique.

## Validation

- Build et tests unitaires de la formule, du parsing `.env`, des configurations DB valides/invalides, de la priorité DB sur `.env`, des bornes et des dates seuils.
- Migration `up/down/up` sur MySQL réel.
- Harness MySQL/Redis : premier calcul, rejeu, modification, suppression, concurrence et tenant croisé.
- Vérification SQL manuelle des compteurs distincts et composantes du score sur un jeu déterministe.
- Régression P2–P4.

## Acceptance criteria

- Les agrégats journaliers correspondent exactement aux findings P4.
- Les compteurs distincts ne doublent pas lors d'un rejeu.
- Le score suit exactement la formule approuvée et expose ses composantes.
- Une configuration administrateur active remplace entièrement le `.env` pour son organisation; sinon le `.env` est utilisé.
- Une configuration `.env` ou DB invalide n'est jamais appliquée silencieusement.
- Chaque score référence la provenance et la version/empreinte de sa configuration effective.
- P7/P8 pourront restituer exactement les valeurs effectives et leur provenance sans dupliquer la logique de résolution.
- Les formulations identiques inter-rapports partagent un `patternKey`; aucune similarité IA n'est inférée.
- Un changement ou delete recalcule seulement les partitions touchées et retire les lignes obsolètes.
- Deux jobs concurrents convergent vers le même état.
- Aucune donnée ne traverse les organisations.
- Aucun traitement P6+ n'est introduit.
- Migration, validations, Security et Reviewer sont approuvés.

## Risks

- Des réglages administrateur extrêmes peuvent réduire la pertinence métier; les validations empêchent les configurations incohérentes mais pas un mauvais choix métier.
- Le regroupement MVP est lexical strict; les synonymes restent séparés.
- Les catégories restent `UNCATEGORIZED` sans règles métier approuvées.
- Les changements de date/type peuvent toucher deux partitions et doivent recalculer l'ancienne comme la nouvelle.

## Expected result

Le worker maintient des agrégats journaliers et un classement de priorité déterministes, tenant-scoped et explicables, prêts pour les APIs P7.

## Execution record

- Implémentation des agrégats journaliers, signatures lexicales inter-rapports, partitions ciblées et scores 0–100 avec composantes et provenance.
- Configuration complète et versionnée par organisation, fallback strict vers les valeurs `.env`, validation des clés/types/bornes et empreinte déterministe.
- Publication atomique des statistiques et scores dans une transaction MySQL; date de référence issue de l'événement, persistée et fusionnée de façon monotone.
- Migration additive `1830000011000-prevention-statistics.ts` validée en `up/down/up`; unicité de la configuration active et immutabilité des versions garanties en base.
- Validation exécutée : `npm run build` réussi; `npm run test:prevention-queue` réussi (24/24); harness MySQL/Redis P4/P5 réussi, incluant rejeu, concurrence, remplacement, suppression, isolation tenant, configuration admin, rollback injecté et reprise.
- Security : `SECURITY_STATUS: APPROVED`.
- Reviewer : `REVIEW_STATUS: APPROVED`.
- Limite connue : regroupement lexical strict et catégories `UNCATEGORIZED` jusqu'aux lots ultérieurs prévus.
