# Iteration 032 — Menus des filtres Budget sans changement de hauteur de modale

STATUS: COMPLETED

## Roadmap reference
Correctif de présentation des filtres multisélection de P17 et de la modale Budget de P19. P17/P19 restent historiquement terminés ; cette itération corrige une régression constatée ensuite. Une correction visuelle mineure du sélecteur de phase Web de P20 est ajoutée à la demande explicite de l'utilisateur le 23/10/2026, sans changer le catalogue ni la validation. Priorité demandée par l'utilisateur alors que les itérations 025/026 restent ouvertes ; cette exception requiert l'approbation de ce plan.

## Objective
Ouvrir les listes des filtres dans « Périmètre du calcul budgétaire » sans modifier la hauteur de la modale ni pousser les autres champs ou boutons.

## Existing state
`MultiSelect` rend les listes du mode `form` avec `position: relative`, dans le flux de la grille Budget. Leur ouverture augmente donc la hauteur de la carte. La carte est plafonnée à `90vh` avec défilement vertical ; un menu simplement absolu pourrait être coupé, notamment pour Catégorie et Gravité.

## Functional scope
- Conserver la hauteur de la modale à contenu identique lors de l'ouverture/fermeture de chaque filtre Chantier, Entreprise, Catégorie et Gravité.
- Rendre la liste visible et utilisable dans la fenêtre, y compris sur petit écran et pour les filtres du bas ; limiter sa propre hauteur et la faire défiler si nécessaire.
- Préserver la multisélection, les libellés, les plafonds, l'ordre des filtres, la fermeture par clic extérieur/Échap et toutes les actions de mesure/calcul.
- Ne pas modifier les menus compacts des autres pages.
- Rendre visibles et identiques la bordure, la largeur et la hauteur du sélecteur et de l'entrée « Nouvelle phase » dans la confirmation Web ; espacer les libellés et champs, retirer la parenthèse explicative du libellé et afficher « Synthèse » comme titre de page. Ne pas modifier la confirmation mobile ni la portée globale du catalogue.

## Technical scope
Afficher le menu `form` hors du flux de la modale, ancré au bouton et repositionné selon l'espace disponible (au-dessus si nécessaire). Éviter le découpage par le conteneur défilant, suivre redimensionnement et défilement, et conserver un comportement accessible de fermeture et de focus. Utiliser une classe de champ commune pour le sélecteur et l'entrée de phase Web ; ajuster seulement le titre visuel de Synthèse. Aucun changement de contrat de filtre, de logique budgétaire ou de phase.

## Expected files/modules
`frontend/src/components/prevention/MultiSelect.tsx`, `frontend/src/components/prevention/offerGroupPhaseConfirmation.ts`, `frontend/src/components/prevention/PreventionPage.tsx`, éventuellement `BudgetPage.tsx` pour l'intégration de la modale, tests frontend ciblés dans `frontend/tests/`, ce plan et statut pertinent de `ROADMAP.md` après approbation.

## Agents
Supervisor pour le correctif ciblé ; Reviewer indépendant après validation si le changement de positionnement partagé le justifie. Pas de Security spécialisé attendu.

## Execution plan
1. Après approbation, passer le plan à `IN_PROGRESS` et signaler le correctif P17/P19 dans le roadmap sans modifier leurs critères métier.
2. Implémenter le menu hors flux pour le seul mode `form` et les bornes de placement dans la fenêtre.
3. Ajouter la régression : l'ouverture ne change pas la hauteur/position des champs ni des boutons, et la liste reste accessible en bas de modale.
4. Exécuter les tests/typecheck et contrôler visuellement la modale Web locale ; revue, corrections éventuelles, puis clôture. Aucune modification ni recette de l'application mobile.

## Parallelization
Non nécessaire : composant et tests étroitement liés.

## Database impact
No expected database change.

## API impact
No expected API change.

## Security impact
Aucun changement de droits ou de données. Les libellés restent rendus par React, sans insertion HTML non fiable.

## Validation
Tests frontend ciblés du composant, des contrats Budget et de la confirmation de phase, `npm run typecheck`, vérification visuelle de la modale Web Budget avec chacun des quatre menus ouvert et des deux champs de phase Web. Vérifier aussi le titre « Synthèse ». Aucune recette de l'application mobile. Commandes exécutées par l'utilisateur selon la politique du projet, sauf nouvelle autorisation explicite.

## Acceptance criteria
À contenu égal, ouvrir ou fermer chaque liste ne change pas la hauteur de la modale ni la position des autres filtres et boutons ; la liste reste entièrement exploitable dans l'espace visible, avec son propre défilement si nécessaire. Le sélecteur et l'entrée de phase Web ont une bordure visible, une largeur et une hauteur identiques ; les libellés sont espacés, sans parenthèse explicative, et le titre de page est « Synthèse ». Les sélections, confirmations et calculs restent inchangés.

## Risks
Découpage par `overflow-y-auto`, mauvais placement après défilement/redimensionnement, fermeture intempestive d'un menu rendu hors de son parent et régression des menus compacts. Limiter l'évolution au mode `form` et couvrir ces cas.

## Expected result
Une modale Budget de hauteur stable pendant l'utilisation des filtres et des champs de phase Web visuellement cohérents, avec un titre de page simplifié, sans régression fonctionnelle.

## Execution record
Les contrôles visuels de la hauteur stable de la modale Budget et des deux champs de phase Web sont confirmés par l'utilisateur. Revue indépendante finale : `REVIEW_STATUS: APPROVED` ; aucun défaut de code relevé. Itération clôturée sans changement de base de données, d'API ou de mobile. Les modifications préexistantes de l'arbre de travail restent conservées ; aucune action en production.
Approuvée par l'utilisateur ; correctif en cours sur V4.1. Le menu `form` est rendu dans la couche de dialogue via portail, avec position fixe, ouverture vers le haut si nécessaire et défilement interne. Le mode compact reste inchangé. L'utilisateur a explicitement autorisé l'exécution locale des commandes : 40 tests frontend ciblés réussis et `npm run typecheck` réussi. L'avertissement SSR initial de `useLayoutEffect` a été corrigé, puis les deux vérifications ont été relancées sans avertissement. Première revue indépendante : `CHANGES_REQUIRED` uniquement parce que le contrôle visuel réel du critère principal manque ; aucun défaut de code identifié. Le 23/10, à la demande explicite de l'utilisateur, le sélecteur de phase Web a reçu la même bordure explicite que les autres sélecteurs, avec un test de non-régression. Nouvelle autorisation explicite : 10/10 tests frontend ciblés, `npm run typecheck` et `git diff --check` réussis localement. Demande complémentaire explicite : même classe dimensionnelle et visuelle pour les deux champs de phase, espacement des libellés, retrait de la parenthèse et titre « Synthèse ». Après cette demande, l'utilisateur a autorisé la validation locale : 10/10 tests ciblés, typecheck et contrôle du diff réussis. Contrôle visuel et revue finale encore attendus. Les modifications préexistantes de l'arbre de travail sont conservées. Aucune action en production.
