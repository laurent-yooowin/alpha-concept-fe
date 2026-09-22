# Iteration 005 — Extraction, snapshots et normalisation

STATUS: COMPLETED

## Roadmap reference

P4 — Extraction : snapshots, hashes et normalisation.

## Objective

Activer dans le worker P3 les consumers des événements rapports P2 afin de matérialiser, de manière tenant-scoped et idempotente, le dernier snapshot exploitable et les constats/recommandations structurés. Rejouer un rapport inchangé ne doit créer aucun doublon.

## Existing state

P1 fournit `prevention_report_snapshots` et `prevention_findings`. P2 publie les jobs dédupliqués `prevention.report.upsert` et `prevention.report.delete` avec un payload minimal. P3 fournit un processus worker autonome mais n'instancie volontairement aucun consumer. Les analyses structurées existent dans `Visit.photos[].analysis`, y compris pour les groupes sans photo via `isDirectiveOnly`.

## Functional scope

- Consommer les deux types de jobs rapports existants dans le worker uniquement.
- Relire systématiquement rapport, visite et mission par `(id, organizationId)` depuis MySQL; ne jamais faire autorité du payload au-delà des identifiants de routage.
- Extraire exclusivement les résultats d'analyse déjà produits : observations, recommandations, risque, confiance et références.
- Produire un constat par observation et une ligne recommandation par recommandation, reliés au groupe source.
- Traiter les groupes photo et les analyses sans photo; ignorer les entrées sans analyse exploitable.
- Calculer un `sourceHash` canonique sur les seuls champs analytiques exploités.
- Si le hash du snapshot est inchangé, terminer sans réécriture.
- En cas de changement, remplacer snapshot et findings dans une transaction atomique.
- Sur suppression, retirer idempotemment la contribution analytique résiduelle du rapport.
- Ne déclencher aucun agrégat, budget, scheduler, backfill ou API P5+.

## Technical scope

- Ajouter un consumer BullMQ dans le module worker avec concurrence configurable, valeur initiale 2.
- Valider strictement le payload et refuser les types, champs ou identifiants invalides sans journaliser son contenu.
- Charger le rapport avec visite et mission en exigeant la cohérence tenant sur chaque relation; une incohérence est une erreur non retraitable.
- Construire un DTO interne canonique trié par groupe/type/position avant hash SHA-256.
- Accepter les formes historiques chaîne/tableau des observations, recommandations et références; nettoyer les libellés sans inventer de contenu.
- Conserver `danger` et `risk` lorsqu'ils sont explicitement présents dans une observation; ne jamais les inférer.
- Normaliser `riskLevel` vers les enums P1 et borner `confidence`; rejeter ou omettre proprement les valeurs non exploitables.
- Générer `normalizedKey` par hash déterministe du type, groupe et texte canonique.
- Laisser `categoryId` à `NULL` tant qu'aucune classification déterministe approuvée n'existe; aucune nouvelle analyse IA n'est introduite.
- Utiliser un verrou transactionnel tenant-scoped sur rapport/snapshot pour sérialiser deux versions concurrentes d'un même rapport.
- Pour un rapport absent, vérifier l'événement delete; un upsert orphelin est ignoré de façon traçable sans fuite inter-tenant.
- Configurer tentatives/backoff BullMQ, événements de job et fermeture propre du consumer.
- Ne jamais persister ou journaliser photos, URL, directives, prompts personnalisés, notes ou contenu brut de rapport.

## Expected files/modules

- `backend/src/prevention/worker/` : consumer et enregistrement.
- `backend/src/prevention/extraction/` : chargement tenant, canonisation, hash et écriture transactionnelle.
- entités P1 existantes, sans changement de schéma attendu.
- tests unitaires extraction/normalisation et harness MySQL/Redis P4.
- configuration worker/concurrence dans les Compose si nécessaire.

## Agents

- Backend : consumer, extraction et transactions.
- Tester : jeux de formes historiques, idempotence, concurrence et suppression.
- Security : isolation tenant et exclusion des contenus sources.
- Reviewer : revue finale indépendante.
- Supervisor : contrat, intégration, validation et statuts.

## Execution plan

1. Figer le schéma réel des analyses de visite et les variantes historiques utiles.
2. Implémenter la canonisation pure, les clés normalisées et le `sourceHash` avec tests.
3. Implémenter le service tenant-scoped de remplacement atomique snapshot/findings.
4. Activer les consumers upsert/delete dans le worker P3 avec lifecycle propre.
5. Ajouter le harness MySQL/Redis : premier traitement, rejeu, changement, concurrence et suppression.
6. Faire exécuter les validations puis obtenir Security et Reviewer.

## Parallelization

La canonisation pure et le harness peuvent être préparés séparément. Le consumer et le service transactionnel ont un propriétaire backend unique pour éviter les conflits.

## Database impact

Aucune migration attendue. P4 écrit dans les tables analytiques P1 existantes. Toute incompatibilité de schéma découverte doit être documentée et rester purement technique; un changement fonctionnel exige une nouvelle approbation.

## API impact

No public API change.

## Security impact

Revue obligatoire : tenant dérivé des lignes DB, jointures inter-tenant impossibles, payload non fiable, absence de fuite dans les logs et exclusion stricte des photos/directives/prompts/contenus bruts.

## Validation

- Build et tests unitaires de canonisation/hash/normalisation.
- Un rapport valide crée exactement un snapshot et les findings attendus.
- Un rejeu identique ne modifie ni snapshot ni findings.
- Une analyse modifiée remplace atomiquement l'ancienne contribution.
- Deux jobs concurrents du même rapport ne doublent aucune ligne.
- Un job cross-tenant ou aux relations incohérentes n'écrit rien.
- Un rapport supprimé ne laisse aucune contribution analytique.
- Une erreur au milieu du traitement conserve la dernière version valide.
- Chaînes/tableaux, groupe photo et analyse sans photo sont couverts.
- Les tables, jobs et logs restent exempts de photos, URL, directives, prompts et contenu brut.
- Le worker s'arrête proprement et l'API reste indépendante.

## Acceptance criteria

- [x] Les jobs upsert/delete P2 sont consommés uniquement par le worker.
- [x] Rapport, visite et mission sont relus et validés dans le tenant du job.
- [x] Le `sourceHash` ne dépend que des champs analytiques canoniques exploités.
- [x] Un rejeu inchangé ne crée ni doublon ni réécriture.
- [x] Un changement remplace snapshot et findings atomiquement.
- [x] Groupes photo et analyses sans photo produisent le même modèle de findings.
- [x] La suppression est idempotente et retire toute contribution résiduelle.
- [x] Aucun contenu source interdit n'est persisté ou journalisé.
- [x] Aucun traitement P5+ n'est introduit.
- [x] Les validations passent.
- [x] `SECURITY_STATUS: APPROVED`.
- [x] `REVIEW_STATUS: APPROVED`.
- [x] P4 est marqué Terminé.

## Risks

- Variantes historiques des structures JSON d'analyse.
- Concurrence entre versions retardées du même rapport.
- Texte ancien contenant des sous-sections `Danger`/`Risque` non uniformes.
- FK cascade pouvant avoir déjà supprimé le snapshot avant le job delete.
- Catégorisation métier non encore définie; elle reste volontairement nulle dans P4.

## Expected result

Le worker transforme les analyses existantes en snapshots et findings tenant-scoped, déterministes et rejouables, sans nouvelle IA ni calcul d'agrégats.

## Execution record

Consumer BullMQ worker-only, canonisation déterministe et service transactionnel tenant-scoped implémentés. Les sources sont bornées avant parsing et les structures invalides sont non-retryables. Le hash ne contient que les findings analytiques; les photos, URL, directives, prompts et contenus bruts sont exclus.

Validation exécutée le 2026-08-21 : `npm run build` réussi; `npm run test:prevention-queue` réussi (20/20); `bash scripts/validate-prevention-extraction-runtime.sh` réussi, incluant rejeu, remplacement, concurrence, isolation tenant, incohérence relationnelle, rollback et suppression.

`SECURITY_STATUS: APPROVED` et `REVIEW_STATUS: APPROVED`. Aucune migration ni API publique ajoutée. Les niveaux de risque inconnus sont volontairement omis; les confiances non numériques restent nulles.
