# Iteration 027 — Périmètres Client et Chantier dans Prévention

STATUS: COMPLETED

## Roadmap reference
P16, avenant approuvé le 19/10/2026. Exception explicite de priorité avant la clôture des itérations 025 et 026.

## Objective
Faire correspondre les données affichées et les traitements manuels Prévention au même périmètre Client × Chantier, sans toucher aux autres organisations ni présenter un total global comme un total filtré.

## Existing state
Le filtre client multisélection existe dans Budget. Les API de consultation acceptent `missionId` mais l'interface ne le propose pas ; elles n'acceptent pas le client. Le budget n'intègre pas le chantier dans la prévisualisation et la clé de scénario. La reconstruction manuelle parcourt tous les rapports de l'organisation.

## Functional scope
- Ajouter Client multisélection et Chantier unique sur Tableau de bord, Observations, Recommandations, Budget et Références réglementaires. Les sélections sont communes entre pages ; les deux filtres se combinent par intersection. Une sélection vide conserve le comportement existant.
- Appliquer les filtres côté serveur aux listes, compteurs, graphiques, sources et paginations ; un chantier n'appartenant pas au client choisi produit un résultat vide ou une sélection explicitement réinitialisée, jamais un élargissement implicite.
- Pour Budget, prévisualiser puis calculer/recalculer exactement le périmètre confirmé, avec identité de scénario, résultat et totaux propres à ce périmètre ; préserver les montants humains verrouillés et distinguer le total global.
- Pour la reconstruction manuelle, sélectionner des rapports entiers selon Client et Chantier seulement. Période, catégorie et gravité restent des filtres de consultation. La prévisualisation montre clairement le périmètre et le nombre de rapports ; le rattrapage Hyper Admin reste tenant-global.

## Technical scope
Contrat partagé `clientKeys` + `missionId` ; options tenant-scoped ; prédicats cohérents sur les API Prévention ; persistance/versionnement du périmètre de reconstruction dans les checkpoints et de Budget dans les scénarios/jobs ; validation de confirmation fraîche, déduplication et reprise sans élargissement ; adaptation des composants et contrats frontend.

## Expected files/modules
`frontend/src/components/prevention/{PreventionPage,BudgetPage,budgetUiContracts}.tsx/ts`, `frontend/src/lib/api.ts`, DTO/services API Prévention, scheduler et Budget, migrations si un périmètre durable supplémentaire est nécessaire, tests ciblés.

## Agents
Supervisor pour intégration ; Security indépendant pour tenant isolation et limites des jobs ; Reviewer indépendant après validation. Pas de délégation d'implémentation prévue par défaut.

## Execution plan
1. Inspecter les contrats existants et fixer les invariants du périmètre.
2. Implémenter les filtres de consultation et leurs tests.
3. Étendre Budget de la prévisualisation au résultat matérialisé et aux recalculs.
4. Étendre la reconstruction manuelle durable sans modifier Hyper Admin.
5. Intégrer l'interface, demander la validation manuelle, réaliser Security puis Reviewer, corriger et clôturer.

## Parallelization
Écritures séquentielles sur les contrats partagés ; revues indépendantes à la fin.

## Database impact
Migration minimale si la portée de reconstruction doit être enregistrée sur le checkpoint/run. Les scénarios Budget possèdent déjà `missionId` mais sa portée doit être reliée à la clé et au worker. Aucune suppression de données historiques.

## API impact
Ajout de `clientKeys` aux consultations, de `missionId` aux commandes Budget, et de `clientKeys`/`missionId` à la prévisualisation-confirmation de reconstruction. Les paramètres restent facultatifs pour compatibilité.

## Security impact
Tous les identifiants et clés client sont validés côté serveur dans l'organisation courante ; jamais de périmètre élargi lors d'un job repris ou d'un jeton périmé. Revue Security indépendante requise.

## Validation
Tests API/worker de filtres, tenant isolation, confirmation, reprise et total Budget ; tests de contrats UI ; typecheck/build backend et frontend ; recette authentifiée avec plusieurs clients et chantiers. L'utilisateur a autorisé l'exécution locale des commandes nécessaires pour ce plan.

## Acceptance criteria
Deux filtres communs aux cinq pages ; intersection exacte ; résultats et totaux cohérents avec leur périmètre ; prévisualisation et exécution du même périmètre ; reconstruction limitée aux rapports éligibles ; aucune régression des vues/job sans filtre ni du rattrapage Hyper Admin ; validations et revues approuvées.

## Risks
Montant maximal par client/action déjà consolidé sur plusieurs chantiers ; filtrer une ligne globale après consolidation donnerait un montant faux. Risque de jobs reconstruisant au-delà du périmètre en cas de reprise. Préserver le verrouillage humain et éviter la confusion entre total filtré et total global.

## Expected result
Les filtres Client et Chantier commandent de manière prévisible les lectures et les traitements manuels Prévention, avec traçabilité et isolation tenant.

## Execution record
Recette authentifiée terminée le 20/10/2026 sur l'API et le navigateur locaux, avec un administrateur de l'organisation de développement : les cinq pages conservent Client × Chantier ; « Cl1 → Ch1 » affiche 10 rapports, 124 observations et 106 recommandations, et le Budget matérialisé couvre 10 rapports, 106 recommandations et 26 estimations IA. Prévisualisation Reconstruction : 10 rapports/230 constats ; prévisualisation Budget : 10 rapports/106 recommandations/36 estimations à traiter. Un couple Client/Chantier incompatible donne 0 dans la prévisualisation Budget ; changer de client efface le chantier devenu incompatible et le filtre persiste après rechargement. Aucune confirmation de job, aucun appel ni déploiement en production. Les tests ciblés, les builds et les revues Security/Reviewer étant approuvés, P16 est clôturé. La recette n'inclut pas l'exécution réelle d'un calcul IA payant ; les chemins de commande et de worker ont été validés par tests.

Implémentation sur `V4.1` : API de consultation, Budget et reconstruction durable ciblés, filtres communs sur cinq pages et migration `1830000038000`. Tests backend 90/90 et 86/86, contrats frontend 27/27, builds et typecheck réussis ; répétition ciblée locale réussie. Migration appliquée uniquement à `csps_db_dev` après sauvegarde vérifiée (`/tmp/prevention-v4-1-backup-Iikypi/before-scoped-rebuild.sql`, SHA-256 `f2374a81118798b8f420dcc00507d4e4d1b058a4d6fa8f64f47c652f1ff214b7`). Security : PASS ; Reviewer : APPROVED. Dette préexistante hors périmètre : la reconstruction manuelle ne répare pas les agrégats dérivés si un événement de suppression de rapport est perdu. Aucun déploiement ni migration en production.
