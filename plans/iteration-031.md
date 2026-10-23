# Iteration 031 — Phases de chantier personnalisées globales

STATUS: COMPLETED

## Roadmap reference
P20, ajout approuvé le 22/10/2026 et préparé par priorité exceptionnelle avant la reprise des itérations 025/026, qui restent ouvertes.

## Objective
Permettre, lors de la confirmation d'une phase Prévention, de saisir une phase absente de la liste et de la rendre réutilisable dans un catalogue commun à toutes les organisations, sans changer l'isolation des groupes ni les propositions IA actuelles.

## Existing state
Sept phases standard sont codées dans le backend, le Web et le mobile. Les propositions et phases effectives sont limitées par des ENUM MySQL et la validation API par une liste fixe. Les attributions sont propres aux groupes et organisations ; les phases confirmées sont conservées après réanalyse. Il n'existe pas de catalogue de phases personnalisées. Les itérations 025/026 sont encore `IN_PROGRESS`.

## Functional scope
- Conserver les sept phases standard dans le catalogue global.
- Dans les confirmations Web et mobile, proposer « Autre phase… » avec un libellé libre validé ; après confirmation, le nouveau choix apparaît pour toutes les organisations.
- Autoriser la création seulement à l'administrateur d'organisation ou au coordonnateur qui possède la visite et dispose du droit d'écriture. Lecture du catalogue aux utilisateurs autorisés à consulter leurs visites.
- Créer ou réutiliser une phase personnalisée globale et confirmer le groupe dans une même transaction ; refuser les doublons de libellé après normalisation, y compris avec une phase standard.
- Garder l'attribution, l'auteur de validation et l'état de traitement dans le périmètre du groupe et de son organisation. Ne pas modifier le rapport SPS ni les phases déjà validées.
- L'IA continue de proposer uniquement les sept phases standard. Les phases personnalisées sont des choix humains, non des nouvelles classes IA.
- Pas d'édition, suppression, fusion ou modération du catalogue dans cette itération.

## Technical scope
- Stocker les seules phases personnalisées dans une table de catalogue global avec identifiant stable, libellé, clé de libellé normalisée unique, auteur et horodatage ; fusionner ces entrées avec les sept phases standard dans l'API de lecture.
- Migrer les colonnes `effectivePhase` des jobs et groupes analytiques de l'ENUM vers une référence texte stable ; garder `proposedPhase` limité aux sept valeurs IA. Préserver les valeurs existantes, index et contraintes de validation.
- Faire évoluer la validation de phase pour accepter soit une phase existante, soit un nouveau libellé, jamais les deux. Sérialiser la création concurrente via contrainte d'unicité et réutiliser l'entrée gagnante ; ne pas créer de phase si la validation du groupe échoue.
- Adapter le canonicalizer, l'extraction, les workers, les réponses de statut et la ventilation par phase afin que les choix humains personnalisés restent valides et lisibles après traitement.
- Faire du backend la source des options et libellés pour les écrans Web/mobile ; actualiser les deux confirmations et les affichages des phases.

## Expected files/modules
Migration et entité de catalogue dans `backend/src/migrations/` et `backend/src/prevention/entities/` ; `backend/src/prevention/prevention-phase.ts`, `api/prevention-phase-validation.*`, `api/prevention-api.service.ts`, `extraction/`, `worker/prevention-group-processing.service.ts` ; services et confirmations Web (`frontend/src/lib/api.ts`, `frontend/src/services/aiService.ts`, composants de visite) et mobile (`mobile/services/preventionPhaseService.ts`, `mobile/app/tabs/visite.tsx`) ; tests ciblés et ce plan. Ajuster la liste exacte après inspection ciblée.

## Agents
Supervisor pour intégration et arbitrages ; spécialistes backend/frontend seulement si les sous-ensembles sont indépendants et utiles. Security indépendant requis pour la création d'une entrée globale par un utilisateur d'organisation ; Reviewer indépendant requis avant clôture.

## Execution plan
1. Après approbation de cette itération, passer P20 à `[~]` et le plan à `IN_PROGRESS` ; figer les contrats catalogue/API et la clé de phase stable.
2. Écrire la migration compatible avec les données existantes et le service tenant-safe de confirmation atomique.
3. Adapter extraction, réanalyse, reconstruction, tableaux de bord et tests backend.
4. Adapter les confirmations et affichages Web/mobile, puis les tests UI pertinents.
5. Valider localement après autorisation explicite de l'utilisateur, mener la revue Security puis la revue Reviewer, corriger si nécessaire et clôturer P20. Aucune action en production dans cette itération sans accord distinct.

## Parallelization
Backend et interfaces peuvent avancer en parallèle après accord sur le contrat API. Les écritures dans les mêmes fichiers restent séquentielles. Revues après stabilisation et validation.

## Database impact
Nouvelle table de phases personnalisées globales et migration non destructive des deux colonnes `effectivePhase` ENUM. Sauvegarde et contrôle de migration/retour arrière requis avant toute application hors environnement local ; une rétrogradation vers l'ENUM initial ne peut pas conserver des choix personnalisés sans procédure explicite.

## API impact
Nouvelle lecture authentifiée du catalogue commun (phases standard et personnalisées) ; extension compatible de la confirmation de groupe pour accepter un nouveau libellé. Le serveur détermine toujours l'organisation de la visite depuis le contexte authentifié.

## Security impact
Écriture dans un catalogue visible inter-organisations : contrôler rôle, permission, propriété de visite, activation Prévention, longueur et contenu du libellé, doublons, cadence et audit. Ne jamais exposer l'organisation ou l'identité du créateur dans le catalogue public. Les mises à jour de groupe restent strictement tenant-scoped. Revue Security indépendante obligatoire.

## Validation
Tests backend ciblés phase/API/extraction/worker et build ; tests frontend ciblés, typecheck et build ; typecheck mobile selon l'état connu du projet ; migration et recette authentifiée uniquement locales ; contrôles de concurrence, d'isolation et de conservation après réanalyse/rattrapage. Revue Security puis Reviewer.

## Acceptance criteria
Une phase créée depuis une visite autorisée apparaît dans les confirmations des autres organisations, sans partager aucune attribution ou métadonnée de groupe. Une création concurrente du même libellé produit une seule entrée. Les phases existantes, les propositions IA et les validations humaines antérieures restent intactes ; les choix personnalisés survivent à la réanalyse et à la reconstruction. Aucun rapport SPS n'est modifié par cette confirmation.

## Risks
Migration d'ENUM en production ; concurrence sur l'unicité globale ; pollution du catalogue par une saisie malveillante ; propagation des libellés dans tous les écrans ; régression d'extraction si la phase effective personnalisée est traitée comme une proposition IA. Limiter les libellés, auditer et garder la séparation proposition/validation.

## Expected result
Catalogue global extensible par confirmation humaine, utilisable sur Web/mobile, avec attribution de groupe isolée par organisation et propositions IA inchangées.

## Execution record
Approuvée et réalisée le 22/10/2026 sur V4.1. L'autorisation explicite de l'utilisateur a permis l'exécution des tests et commandes sur l'environnement local uniquement. Les modifications préexistantes des autres itérations dans l'arbre de travail ont été préservées. Sept codes IA inchangés ; seules les phases personnalisées sont stockées dans le catalogue global. `effectivePhase` devient `varchar(43)` dans deux tables, `proposedPhase` reste un ENUM. Création et attribution transactionnelles, libellés normalisés et audités, quota de 20 créations/utilisateur/24 h sérialisé par verrou utilisateur ; la lecture du catalogue n'expose pas la provenance. API et confirmations Web/mobile mises à jour, ainsi que l'extraction, le worker et la ventilation statistique. Aucune modification de rapport SPS par la confirmation.

Validation exécutée : tests backend ciblés 84/84, API 23/23, phase après correction 12/12, worker 45/45 ; build backend ; test Web 2/2, typecheck et build Web ; `git diff --check`. Migration 050 appliquée seulement sur `csps_db_dev`/`toufik-pc` avec 33 groupes analytiques et 37 jobs conservés. Recette HTTP authentifiée locale sur deux organisations : propriétaire autorisé, autre coordonnateur 403, catalogue commun visible, accès inter-organisation au groupe 404, libellé dédoublonné, rapport SPS inchangé. Données de recette restaurées et phase temporaire supprimée ; serveur de recette arrêté. Le typecheck mobile complet reste en échec sur les erreurs préexistantes de l'application, sans erreur remontée dans le nouveau service de phases. Pas de recette visuelle sur appareil dans cette itération. Security : PASS après correction de la course au quota. Reviewer : APPROVED. Aucune action en production.
