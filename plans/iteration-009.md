# Iteration 009 — Pages Web Prévention

STATUS: COMPLETED

## Roadmap reference

P8 — Web : navigation et pages de prévention.

## Objective

Fournir aux seuls administrateurs d'organisation une interface React native exploitant l'API P7 pour consulter le tableau de bord, les observations, les recommandations, le suivi/tendances et les références sources, avec périodes et filtres communs, sans exposer ces pages aux coordinateurs ni à l'espace Hyperadmin.

## Existing state

L'API P7 expose les données tenant-scoped, les périodes, filtres, listes paginées, tendances, références et la reconstruction asynchrone. Le frontend organisation utilise React Router, un layout latéral, l'authentification JWT centralisée et dispose déjà de Recharts. Aucun client API ni écran Prévention n'existe. `prevention_rte.html` fournit la référence visuelle et les intitulés Tableau de bord, Observations, Recommandations, Budget prévisionnel et Références ; le Budget fonctionnel relève de P8B et n'est pas implémenté dans cette itération.

## Functional scope

- Ajouter une entrée « Prévention » visible uniquement pour `ROLE_ADMIN` d'une organisation, avec navigation interne vers Tableau de bord, Observations, Recommandations, Suivi et Références.
- Reprendre l'esprit visuel de `prevention_rte.html` dans des composants React/Tailwind cohérents avec l'application, sans intégrer le HTML statique ni ses données fictives.
- Ajouter un sélecteur de période partagé : 7 jours, 30 jours, trimestre, 6 mois, année, 12 mois et période personnalisée.
- Ajouter les filtres disponibles et pertinents : type de chantier, chantier/mission, catégorie, criticité et statut, avec état de chargement, absence de résultats et erreurs lisibles.
- Afficher les KPI, répartition par criticité, tendances, listes paginées et scores fournis par P7.
- Depuis les résultats et références, permettre d'ouvrir le rapport source dans la route existante.
- Permettre à l'administrateur de demander une reconstruction, afficher son acceptation/limitation de fréquence et suivre son état sans bloquer l'interface.
- Ne pas implémenter les calculs, scénarios ou écrans métier Budget P8B ; l'entrée Budget reste absente jusqu'à cette itération dédiée.

## Technical scope

- Créer des types et un client API Prévention basé sur l'utilitaire JWT existant, avec sérialisation sûre des query params.
- Créer un layout/onglets Prévention et des composants partagés de filtres, états de requête, pagination, cartes KPI et graphiques.
- Ajouter les routes organisation-scoped sous `/:slug/prevention/...` et des contrôles UI admin, tout en conservant le backend P7 comme frontière d'autorisation.
- Charger les données à l'entrée et lors des changements validés de filtres ; annuler ou ignorer les réponses obsolètes pour éviter les courses d'affichage.
- Utiliser Recharts déjà installé ; aucune nouvelle dépendance attendue.

## Expected files/modules

- `frontend/src/lib/api.ts` ou un client dédié `frontend/src/lib/prevention-api.ts`;
- `frontend/src/components/prevention/` pour pages et composants partagés;
- `frontend/src/components/Layout.tsx`;
- `frontend/src/router/index.tsx`;
- tests frontend ciblés si l'infrastructure existante le permet, sinon validation typecheck/build et recette fonctionnelle documentée.

## Agents

- Frontend : contrats TypeScript, navigation, composants, pages, filtres et intégration API.
- Security : revue indépendante de la visibilité admin, de l'exclusion Hyperadmin et des liens/erreurs.
- Reviewer : revue finale indépendante de conformité P8 et des régressions.
- Supervisor : intégration, validation et statuts.

## Execution plan

1. Mapper précisément les réponses P7 en types frontend et définir l'état partagé des périodes/filtres.
2. Implémenter le client Prévention et la gestion uniforme des erreurs, pagination et rebuild/job.
3. Ajouter les routes, l'entrée admin et le layout de navigation Prévention.
4. Implémenter Tableau de bord et Suivi avec KPI, criticités et tendances.
5. Implémenter Observations et Recommandations avec filtres, tri/pagination et liens sources.
6. Implémenter Références avec accès aux rapports existants.
7. Ajouter la reconstruction asynchrone et son suivi borné.
8. Valider responsive, chargements/erreurs, accès par rôle, typecheck/build, puis Security et Reviewer.

## Parallelization

Le client/types et la structure visuelle peuvent être préparés indépendamment après fixation des contrats. Les pages réutilisent ensuite les mêmes filtres et composants pour éviter les divergences.

## Database impact

No expected database change.

## API impact

No expected API change. L'itération consomme les sept endpoints P7 existants ; toute insuffisance fonctionnelle du contrat nécessitant une évolution produit sera signalée avant modification.

## Security impact

Revue obligatoire. La navigation doit être absente pour les coordinateurs et l'espace Hyperadmin, les routes doivent rediriger/refuser les utilisateurs non autorisés, aucun tenant ne doit être fourni par le client et les erreurs ne doivent pas révéler de contenu sensible. Le backend P7 reste l'autorité finale.

## Validation

- `npm run typecheck` et `npm run build` dans `frontend`.
- Vérification admin organisation : toutes les pages et données du tenant sont accessibles.
- Vérification coordinateur et Hyperadmin : entrée et routes Prévention inaccessibles.
- Vérification des présélections/périodes personnalisées, filtres, pagination, graphiques, états vide/erreur et navigation source.
- Vérification rebuild : réponse acceptée, suivi du job, état final et message `429`.
- Vérification responsive desktop/mobile et absence de régression sur la navigation existante.

## Acceptance criteria

- Les pages P8 prévues sont des routes React natives, cohérentes avec la référence HTML et alimentées uniquement par P7.
- Seuls les administrateurs d'organisation voient et utilisent la navigation Prévention ; coordinateurs et Hyperadmin sont exclus.
- Périodes, filtres, pagination, KPI, tendances et liens vers rapports sources fonctionnent sans données fictives.
- Les chargements, erreurs, résultats vides et réponses obsolètes sont gérés proprement.
- La reconstruction est asynchrone, suivie sans boucle non bornée et sa limitation est compréhensible.
- Aucun écran ou calcul Budget P8B n'est implémenté.
- Validation, Security et Reviewer sont approuvés.

## Risks

- Les filtres détaillés peuvent déclencher plusieurs appels ; leur orchestration doit éviter les requêtes en cascade et les courses réseau.
- Le modèle de route du rapport existant devra être confirmé pour garantir un lien source réellement fonctionnel.
- L'absence actuelle d'une infrastructure de tests UI peut imposer une recette manuelle ciblée en complément du typecheck/build.

## Expected result

Les administrateurs d'organisation disposent d'un espace Prévention lisible, responsive et vérifiable, fondé sur les agrégats P7 et intégré à la navigation existante, tandis que le Budget reste réservé à P8B.

## Execution record

- Ajout de l'espace React Prévention sous `/:slug/prevention/*` avec Tableau de bord, Observations, Recommandations, Suivi/tendances et Références.
- Navigation et routes visibles uniquement pour `ROLE_ADMIN` rattaché à une organisation ; le backend P7 reste la frontière d'autorisation tenant-scoped.
- Ajout du client P7 typé, des périodes prédéfinies/personnalisées, des filtres type/chantier/criticité/statut, de la pagination et des états chargement/vide/erreur.
- Ajout des KPI, répartition des risques, tendances Recharts, listes de constats/recommandations et références ouvrant le rapport source existant via son identifiant.
- Ajout de la reconstruction asynchrone avec polling borné, nettoyage au démontage, gestion `429` et rafraîchissement avec les filtres courants. Les réponses obsolètes sont ignorées et les changements de filtres reviennent à la page 1.
- Aucun changement de base ou d'API et aucune dépendance ajoutée. Le Budget reste exclu et réservé à P8B.
- Validation utilisateur du 17/09/2026 : `npm run build` réussi après corrections Reviewer. `npm run typecheck` reste en échec sur 68 erreurs historiques dans dix fichiers existants ; aucune erreur n'est signalée dans le nouvel écran Prévention ou ses nouvelles lignes client/route.
- Security review indépendante : `SECURITY_STATUS: PASS`.
- Reviewer indépendant : `REVIEW_STATUS: APPROVED` après correction des races de rafraîchissement/polling et de la pagination des filtres.
- Limitations connues : aucun filtre catégorie affiché faute de catalogue P7 ; bundle Vite principal supérieur à 500 kB et base TypeScript globale non propre, dettes préexistantes à traiter séparément.
