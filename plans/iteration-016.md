# Iteration 016 — Adaptation mobile et pilotage Hyper Admin

STATUS: COMPLETED

## Roadmap reference

P13 — Adaptation mobile et pilotage Hyper Admin, après P12 terminé. La recette native/authentifiée et les mesures de performance passent à P13R, avant P14, sur décision utilisateur du 08/10/2026.

## Objective

Terminer la validation technique de l'adaptation mobile déjà implémentée et permettre à l'Hyper Admin, après réactivation d'une organisation, de commander et suivre un rattrapage complet ordonné, éventuellement immédiat sous plafonds de sécurité. Ne pas revendiquer la recette native/authentifiée reportée.

## Existing state

P12 est terminé ; Alpha Concept et EDF sont localement actives. L'adaptation mobile Visites/Rapports et confirmation de phase est implémentée, avec tests backend ciblés, export Expo Web, Security PASS et Reviewer APPROVED ; la recette native/authentifiée reste non exécutée faute d'appareil et de comptes. L'écran Hyper Admin modifie déjà `isActive`. La réactivation crée un checkpoint différentiel durable, mais son scan automatique attend la fenêtre 22 h–6 h. Les commandes existantes de reconstruction et de budget global sont distinctes ; aucun suivi de bout en bout du rattrapage n'est exposé à l'Hyper Admin.

## Functional scope

- Conserver la création, l'analyse et l'édition de visites sur mobile ; faire du backend la source autoritative pour l'analyse de groupe, son état, la confirmation de phase et le rapport/PDF.
- Présenter le statut de phase proposé/validé et permettre la confirmation par les utilisateurs autorisés, sans créer de page Prévention mobile.
- Ne pas exposer les prompts, directives, photos ou contenus intermédiaires dans les pages Prévention ; préserver les droits existants et l'isolation par organisation.
- Après transition inactive → active, afficher une modale Hyper Admin : reprendre le rattrapage automatique existant ou confirmer un rattrapage complet ordonné (rapports/index Prévention, groupes/actions, budget total non filtré), avec choix d'exécution immédiate sous les plafonds de sécurité. Une demande hors plafond reste planifiée ; jamais de promesse d'immédiat inconditionnel.
- Afficher sur chaque carte organisation une pastille d'état ; au clic, ouvrir le détail des étapes, compteurs, horaires, erreurs/reprises et santé du worker partagé. Ne pas suggérer l'existence d'un worker dédié à l'organisation.
- Permettre la reprise idempotente sans doublon ni recalcul concurrent ; ne pas créer de budget total tant que les étapes sources requises ne sont pas terminées. Préserver les droits Hyper Admin, l'isolation tenant et les travaux déjà validés. Ne pas activer ENGIE/Elm ni agir sur la VM distante.
- Reporter la recette Web/mobile authentifiée multi-tenant et les mesures de performance à P13R.

## Technical scope

Réutiliser le checkpoint de réactivation, le scheduler, les jobs de groupes, les contrats de budget global et les limites bulk existantes. Ajouter une orchestration backend durable et tenant-scoped des étapes de rattrapage complet, sa prévisualisation/confirmation et une lecture d'état agrégée. L'API Hyper Admin contrôle l'autorisation ; la modale n'exécute aucun calcul localement. Distinguer traitement différentiel déjà programmé, reconstruction complète demandée, phase de groupes et budget total. Valider statiquement l'adaptation mobile existante sans rouvrir la recette native.

## Expected files/modules

Backend : `organizations/organization.controller.ts`, `prevention/prevention-organization-activation.service.ts`, scheduler/admission, budget et worker, DTO/tests, migration de suivi durable si les tables existantes ne suffisent pas. Frontend : `components/hyperAdmin/HyperAdminOrganizations.tsx`, `lib/api.ts`, tests ciblés. Mobile : uniquement corrections de régression liées au code déjà implémenté. `plans/iteration-016.md`.

## Agents

Supervisor intégrateur ; Backend et Frontend ciblés si la taille le justifie ; Security indépendante obligatoire pour privilèges Hyper Admin/isolation ; Reviewer indépendant après validation.

## Execution plan

1. Conserver les résultats déjà intégrés de l'adaptation mobile ; vérifier seulement les validations techniques utiles à sa clôture hors recette P13R.
2. Définir puis implémenter le contrat Hyper Admin de prévisualisation, confirmation/reprise immédiate bornée et lecture d'état ; orchestrer durablement extraction, groupes/actions et budget total après achèvement des sources.
3. Ajouter la modale post-réactivation, la pastille et le détail par organisation ; gérer attente, progression, erreur, reprise et rafraîchissement sans déclenchement par GET.
4. Exécuter tests backend/frontend ciblés, build/typecheck pertinents, tests manuels locaux avec Alpha Concept et EDF et cas de refus inter-tenant ; Security indépendante puis Reviewer indépendant ; corriger et consigner. La recette native/performance reste P13R.

## Parallelization

Backend orchestration et Frontend UI peuvent être préparés en parallèle après accord sur le contrat ; un seul propriétaire pour chaque fichier partagé. Security et Reviewer interviennent après stabilisation.

## Database impact

Migration possible pour une commande de rattrapage et ses étapes durables, identifiées par organisation avec contrainte de déduplication ; réutiliser les tables existantes seulement si elles permettent une reprise et une lecture d'état fiables. Aucun effacement de données historiques.

## API impact

Nouvelles API Hyper Admin ciblées pour prévisualiser/confirmer le rattrapage et lire l'état des jobs de l'organisation et la santé du worker partagé. Aucun client ne transmet d'identité tenant faisant autorité hors de l'URL validée côté serveur ; pas d'impersonation d'un Admin d'organisation pour lancer le budget.

## Security impact

Conserver les droits mobiles déjà validés. Restreindre les nouvelles commandes/lectures à `HYPER_ADMIN`, vérifier l'organisation cible active, isoler durablement chaque job/étape par tenant, empêcher les doublons et respecter les limites de charge. Aucun secret Redis ou donnée sensible dans la carte. Revue Security indépendante obligatoire.

## Validation

Tests backend d'activation/réactivation, séquencement, seuil immédiat/planifié, interruption/reprise, déduplication, refus inter-tenant et santé worker ; tests frontend de modale/pastille/détail ; build/typecheck ciblés ; parcours manuel local sur EDF sans toucher les autres tenants ; validation statique mobile déjà obtenue à recontrôler si nécessaire. Aucun résultat non exécuté ne sera présenté comme réussi. La recette native/authentifiée et la performance sont exclues de cette itération et requises en P13R.

## Acceptance criteria

L'adaptation mobile déjà intégrée conserve les contrats backend et droits validés statiquement. Après réactivation, l'Hyper Admin voit la modale ; il peut choisir un rattrapage complet et demander l'immédiat dans les plafonds, ou garder la planification. Une seule commande durable orchestre les étapes dans l'ordre et expose un état clair, sans double traitement ni total présenté comme complet avant fin de calcul. La carte montre l'état tenant et, séparément, la santé du worker partagé. Les refus d'accès non Hyper Admin et les isolations inter-organisations sont testés. Security PASS et Reviewer APPROVED. Aucun module Prévention mobile ni intervention distante ; recette native/performance reportée à P13R.

## Risks

La reconstruction complète peut être coûteuse ; les plafonds et l'admission partagée restent impératifs. Les étapes historiques Prévention/budget ont des contrats de sélection différents : « budget total » signifie l'ensemble non filtré de l'organisation et doit être prévisualisé avant confirmation. Concurrence avec le checkpoint d'activation déjà créé, reprise après panne et santé worker globale exigent des statuts distincts. La recette native nécessite toujours un appareil et des comptes en P13R.

## Expected result

Adaptation mobile stabilisée et parcours Hyper Admin de rattrapage complet opérationnel en local ; P13R reste nécessaire avant P14.

## Execution record

08/10/2026 — GO reçu pour l'avenant Hyper Admin. Statut passé de `PROPOSED` à `APPROVED`, puis `IN_PROGRESS`. Implémentation et validation du nouveau périmètre en cours.

08/10/2026 — Parcours Hyper Admin intégré : prévisualisation et confirmation signée, orchestration durable et séquencée extraction → groupes → budget global non filtré, option immédiate sous plafonds, statut tenant et santé du worker partagé sur les cartes. Migration de l'état de rattrapage ajoutée ; déduplication, reprise et bail d'exécution traitent les commandes concurrentes. Correctifs ciblés apportés aux statuts groupés et à la détection des modifications de source pendant la construction. Tests, builds, migration locale et parcours manuel du nouveau périmètre restent à valider par l'utilisateur ; revues Security/Reviewer du nouveau périmètre non encore effectuées.

08/10/2026 — Autorisation explicite reçue pour l'exécution des commandes des itérations restantes. Validation technique de l'avenant : tests backend ciblés 45/45, tests frontend 7/7, build backend, typecheck et build frontend réussis après correction d'un utilitaire UUID manquant et de mocks de tests. `git diff --check` réussi. Revue Security indépendante demandée ; migration locale et parcours réel restent non exécutés.

08/10/2026 — Revue Security de l'avenant : deux corrections demandées (jeton de confirmation à usage unique et bail d'exécution clôturant toute écriture obsolète), intégrées puis revues `SECURITY_STATUS: PASS`. Validation finale du lot backend ciblé : 88/88 tests et build réussis. Reviewer : deux ajustements UI et la recette locale demandés. L'interface distingue maintenant statut tenant et santé du worker partagé ; la conservation du rattrapage automatique est explicite. Tests frontend 8/8, typecheck et build réussis. Migration `PreventionHyperAdminRecovery1830000035000` appliquée avec succès uniquement sur la base locale `csps_db_dev` ; aucune autre migration n'était en attente. Le parcours authentifié EDF reste à exécuter et à faire relire.

08/10/2026 — Relecture Reviewer : correction supplémentaire de l'objet d'organisation périmé après réactivation, qui empêchait la prévisualisation immédiate. Le helper construit un nouvel objet explicitement actif ; test comportemental ciblé ajouté. Tests frontend 8/8, typecheck et build toujours réussis ; `REVIEW_STATUS: APPROVED`. API locale sur `http://localhost:8096/api` démarrée et healthcheck 200 ; worker ancien arrêté proprement sans job actif puis worker du nouveau build démarré. Le test authentifié EDF a été demandé à l'utilisateur sans échange de secret ; aucune commande de rattrapage complet n'a été déclenchée par l'agent.

08/10/2026 — `STATUS: BLOCKED` uniquement pour la recette authentifiée locale du parcours EDF : EDF est active, l'API et le worker du nouveau build sont disponibles, mais aucun run de rattrapage Hyper Admin n'existe et l'agent ne dispose pas d'une session Hyper Admin. L'utilisateur doit ouvrir `http://localhost:5173`, choisir le rattrapage complet sur la carte EDF et transmettre le statut affiché ; l'agent vérifiera ensuite l'ordre des étapes et la publication du budget dans les données locales. Aucune itération suivante ne commence.

08/10/2026 — Retour utilisateur pendant la recette : le clic sur la case « Organisation active » n'ouvre pas immédiatement de modale, car il ne persiste pas la réactivation avant « Enregistrer ». Clarification intégrée dans le formulaire ; la pastille Actif/Inactif de la carte ouvre maintenant aussi le suivi Prévention. Tests frontend 8/8, typecheck et build réussis. Statut revenu à `IN_PROGRESS` pour poursuivre cette correction et la recette EDF.

08/10/2026 — EDF était déjà active localement ; enregistrer sa fiche avec `isActive=true` ne constitue pas une transition inactive→active, ce qui expliquait l'absence de modale après Save. Sur retour utilisateur, ouverture de la modale de choix après tout Save réussi d'une organisation existante active, sans déclencher de calcul sans confirmation. Indication explicite ajoutée au formulaire. Tests frontend 8/8, typecheck et build réussis ; relecture indépendante ciblée demandée. Recette EDF encore à confirmer dans le navigateur.

08/10/2026 — L'utilisateur a approuvé le changement de roadmap : ajout du pilotage Hyper Admin, maintien des plafonds de sécurité et report de la recette native/authentifiée et des performances à P13R. Ancien statut `BLOCKED` levé pour proposer cet avenant sur la même itération 016. Avenant non commencé : aucun code, migration ou API de ce nouveau périmètre n'a été implémenté ; attente d'un GO sur ce plan révisé. Les validations et revues ci-dessous concernent uniquement le périmètre mobile antérieur.

08/10/2026 — GO explicite reçu. Contrats backend de statut/confirmation de phase et PDF réutilisés sans changement API/DB. L'écran Visite lit le statut de groupe, permet la confirmation USER/ADMIN et son rafraîchissement ; les réponses tardives de confirmation ne réécrivent pas un autre contexte. Les réponses IA simulées ont été retirées. L'écran Rapports dépend désormais du serveur, sans repli sur un cache local potentiellement partagé entre organisations ; chargements obsolètes et rapport sélectionné sont invalidés au changement de session ou en cas d'erreur. Fichiers : `mobile/app/tabs/visite.tsx`, `mobile/app/tabs/rapports.tsx`, `mobile/services/aiService.ts`, `mobile/services/preventionPhaseService.ts`.

Validation effectuée : `git diff --check` sans erreur ; `npm run build:web` dans `mobile` réussi. Typecheck global mobile en échec sur un ensemble de diagnostics hérités (écrans mobiles et import Web, notamment) ; aucun succès TypeScript n'est revendiqué. Recette native, Web authentifié et mesures de performance restent à réaliser.

Revue Security initiale : CHANGES_REQUIRED. Deux corrections nécessaires pour la recette multi-tenant sont intégrées au périmètre P13 : remonter l'écran Visite sur changement d'identité et refuser les images IA étrangères/non liées même quand le registre des fichiers est en mode observation ; limiter les lots IA pour éviter une consommation disproportionnée. La correction mobile est intégrée, le backend et sa validation sont en cours. Aucun changement de politique générale des fichiers n'est prévu.

Après correction : tests backend ciblés 36/36 et build backend réussis ; build Expo Web réussi. La seconde revue Security confirme ces corrections mais relève que `/upload/download`, utilisé par les photos/PDF mobiles, reste permissif en mode observation. Correction ciblée de ce téléchargement en cours ; aucune recette multi-tenant n'est déclarée validée avant ce verrouillage et les essais authentifiés.

Le téléchargement utilisateur est désormais vérifié strictement par tenant, propriétaire et relation visite/rapport (avec logos d'organisation), et la suppression utilisateur a reçu le même traitement sans élargir les commandes de migration. Troisième revue Security : téléchargement validé mais suppression générique et anciens contrats mobiles à corriger. Les appels mobiles de groupe/photo et la confirmation de rapport sont en adaptation. Derniers tests backend ciblés : 51/51 ; build backend et export Expo Web réussis. Un redémarrage intermédiaire de l'API locale a confirmé `/healthcheck/live` et le refus 401 d'un téléchargement anonyme ; le dernier build devra être rechargé avant la recette. La recette mobile native reste non exécutée faute d'appareil connecté.

Les flux mobiles Visite utilisent désormais les commandes `analysis-groups` et les reçus signés pour création, rattachement, clarification, réanalyse, édition et suppression ; `saveVisit` ne transmet plus `photos`. Les rapports ne transmettent plus `reportFileUrl` en mise à jour, le PDF étant déjà persisté par sa génération serveur ; les éditions groupées utilisent le PATCH des groupes. La suppression générique côté serveur exige provenance et droits stricts, indépendante d'`OBSERVE`. Après ces changements : 51/51 tests backend ciblés, build backend et export Expo Web passent ; le typecheck mobile global reste en échec sur des erreurs préexistantes. Quatrième revue Security demandée. Recette authentifiée/native, mesures de performance et Reviewer restent à obtenir.

La quatrième revue Security a relevé une réanalyse interne pouvant suivre une ancienne référence de photo malgré une provenance vérifiée étrangère/révoquée, ainsi qu'un nettoyage S3 empêché par le détachement préalable. Les chemins création/clarification/réanalyse vérifient désormais l'accès IA strict avant tout téléchargement, et le nettoyage interne post-détachement contrôle la provenance avant suppression physique. Tests ciblés concernés : 33/33 ; build backend, export Expo Web et `git diff --check` réussis. Nouvelle revue Security en cours ; recette authentifiée/native et mesures de performance non encore effectuées.

La revue suivante a identifié les lectures IA du worker Prévention, le rendu PDF, les destinataires mobiles après changement de tenant et des entrées IA directes non bornées. Corrections intégrées : accès worker strict même en `OBSERVE`, validation des images et PDF avant lecture S3, effacement/invalidation des destinataires au changement d'identité, limites de taille/profondeur des requêtes IA. Tests ciblés concernés : 82/82 ; build backend et export Expo Web réussis. Relecture Security finale demandée. Le typecheck mobile global reste en échec sur de nombreuses erreurs héritées ; aucune recette authentifiée/native ni mesure de performance n'est encore revendiquée.

Relecture Security finale : PASS après effacement supplémentaire du zoom photo au changement d'identité. Export Expo Web à nouveau réussi. L'API locale a été relancée sur le dernier build et `/api/healthcheck/live` répond `ok`. Reviewer indépendant sollicité ; recette authentifiée/native Alpha Concept + EDF et métriques de performance restent à exécuter avant clôture.

Le reviewer a demandé puis approuvé le nettoyage des uploads signés orphelins sur les trois parcours mobiles de clarification/rattachement après échec de commande ; export Expo Web réussi. `REVIEW_STATUS: APPROVED` et `SECURITY_STATUS: PASS`. Aucun appareil n'apparaît dans `adb devices` et aucun compte/session de recette authentifiée n'est disponible à l'agent : la recette native/Web à deux tenants, les tests de permissions en situation et les mesures de performance ne peuvent pas être revendiqués. Itération bloquée sur la disponibilité d'un appareil Expo Go/émulateur et de comptes de test Alpha Concept + EDF ; P14 n'est pas préparée.

Matrice de recette à consigner pour Alpha Concept puis EDF : connexion et organisation active ; ouverture Visite, analyse/sauvegarde d'un groupe et état Prévention jusqu'à READY ; confirmation puis relecture de phase ; ouverture Rapport, édition et PDF serveur ; comparaison Web/mobile des mêmes groupe/rapport ; refus d'un rôle sans `visits:write`, d'un identifiant de visite de l'autre organisation et d'un accès après désactivation ; reprise d'un job pertinent ; temps de chargement liste/rapport, analyse de groupe, passage à READY et génération PDF, relevés sur le même environnement et avec heure/volume de données. Ne pas activer ENGIE/Elm pour ces tests.

08/10/2026 — Recette authentifiée Hyper Admin EDF déclenchée par l'utilisateur en mode immédiat. Un premier échec d'extraction venait du type de job SQL de l'activation adoptée (`prevention.scheduler.manual-rebuild` au lieu de `MANUAL_REBUILD`) ; correctif et régression ciblée ajoutés, ligne locale EDF réparée précisément et job retardé promu. Extraction terminée pour 2 rapports/25 constats ; groupes construits. Le budget global immédiat a ensuite révélé une application indue de la fenêtre nocturne pendant l'estimation annuelle ; correction pour n'imposer cette fenêtre qu'au mode planifié, puis reprise du même checkpoint EDF. Run de rattrapage `8d6aec6f-2639-4307-8bf4-d79e0d88ca52` terminé ; budget global `af02fe43-28e9-4aeb-811d-bf4c711aff39` publié : 7 postes, 19 085,00 € HT. États du worker, `SUSPENDED` et erreurs connues présentés en français dans la modale.

Validation finale : tests backend ciblés 47/47, build backend, typecheck et build frontend, `git diff --check` réussis ; API et worker locaux redémarrés sur le build corrigé. Revue indépendante finale du correctif : `REVIEW_STATUS: APPROVED`. Revue Security antérieure de l'avenant : `SECURITY_STATUS: PASS` ; les correctifs finaux n'ont pas modifié les frontières d'autorisation. Aucun changement supplémentaire de schéma/API ; migration P13 appliquée uniquement en local. La recette mobile native/authentifiée multi-tenant et les mesures de performance demeurent explicitement P13R ; aucune validation de ces points n'est revendiquée.
