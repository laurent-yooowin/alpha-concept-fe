# Iteration 033 — Recherche dans les sélecteurs existants de Synthèse et de phase

STATUS: COMPLETED

## Roadmap reference
P21 du `ROADMAP.md`, approuvé par le GO du 23/10/2026 avec priorité exceptionnelle avant la reprise des itérations 025/026. Recherche locale limitée aux listes existantes.

## Objective
Retrouver rapidement une valeur dans les sélecteurs existants du module Web Synthèse, y compris ses modales, et dans la seule confirmation de phase mobile, sans changer le périmètre métier sélectionné.

## Existing state
Le premier incrément local a ajouté la recherche aux filtres Web et à la liste de phase mobile ; 46 tests ciblés et le typecheck Web ont réussi, et la revue indépendante a approuvé ce périmètre. La recherche de phase est encore placée au-dessus du `select` Web et de la liste de choix mobile, pas dans un menu déroulant. Dans les multisélecteurs, « Tout sélectionner » sélectionne encore toutes les options même lorsqu'une recherche est active. L'utilisateur demande un avenant sur ces deux comportements avant la clôture. L'itération 032 a stabilisé la hauteur de la modale Budget.

## Functional scope
- Ajouter un champ de recherche aux listes Web existantes : Chantier, Entreprise, Période, Catégorie et Gravité dans les cinq onglets de Synthèse ; Chantier, Entreprise, Période de départ, Catégorie et Gravité dans la modale de périmètre Budget ; catalogue de phases dans la confirmation de phase Web.
- Dans la confirmation de phase Web et mobile, placer la recherche **dans le menu déroulant de phase**, ouvert depuis le champ de sélection ; ne pas laisser un champ de recherche séparé au-dessus d'un autre sélecteur. Sur mobile, aucun nouveau filtre ni autre écran n'est ajouté.
- La recherche filtre seulement les options affichées, sans changer automatiquement les valeurs déjà sélectionnées, l'état « Tous », les plafonds, le périmètre des jobs, les dates personnalisées ni les permissions. Les choix déjà sélectionnés restent conservés même s'ils ne correspondent plus à la recherche.
- Dans les multisélecteurs, « Tout sélectionner » sans recherche garde son comportement actuel sur toutes les options. Avec une recherche non vide, il ajoute **uniquement les options visibles correspondantes** aux choix déjà cochés, sans retirer les choix masqués ; si cette union dépasse le plafond de 50, l'action est désactivée et ne fait aucune sélection partielle. Une recherche sans résultat ne sélectionne rien.
- Recherche insensible à la casse et aux accents, état vide clairement indiqué, retour à la liste complète après effacement. Le mode de calcul Budget, les champs de date et les autres contrôles non filtrants ne changent pas.

## Technical scope
Réutiliser le sélecteur multisélection commun pour la recherche Web et un contrôle mono-sélection accessible pour la période. Convertir le sélecteur de phase Web SweetAlert en menu déroulant avec recherche intégrée, sans changer la confirmation ni la création de phase personnalisée. Convertir les choix de phase mobile en menu déroulant avec recherche intégrée ; filtrer localement le catalogue déjà chargé. Pour la modale Budget, la recherche et ses résultats restent dans le menu à défilement interne sans augmenter la hauteur de la modale.

## Expected files/modules
`frontend/src/components/prevention/MultiSelect.tsx`, `PreventionPage.tsx`, `BudgetPage.tsx`, `offerGroupPhaseConfirmation.ts`, éventuellement un composant de sélection mono-valeur partagé et les tests ciblés `frontend/tests/`. `mobile/app/tabs/visite.tsx` et test ciblé éventuel. Ce plan et `ROADMAP.md` uniquement après approbation.

## Agents
Supervisor pour l'intégration ; aide Frontend ponctuelle si la séparation Web/mobile est utile. Reviewer indépendant après validation. Pas de Security spécialisé attendu si aucun contrat d'autorisation ou de données ne change.

## Execution plan
1. Après GO, inscrire P21 au roadmap, noter l'exception de priorité, puis passer ce plan à `APPROVED` et `IN_PROGRESS`.
2. Ajouter la recherche aux multisélecteurs Web, sans modifier automatiquement les sélections ni la hauteur de la modale Budget.
3. Ajouter la recherche aux sélecteurs Web mono-valeur existants de période et de phase en préservant le choix, le clavier et la validation.
4. Ajouter la recherche à la seule sélection de phase mobile.
5. Avenant demandé pendant la recette : après approbation explicite, intégrer la recherche dans les menus déroulants de phase Web/mobile et limiter « Tout sélectionner » aux résultats visibles si une recherche est active, avec conservation des autres sélections et du plafond.
6. Relancer les tests concernés, typecheck et vérifications visuelles Web/mobile localement ; nouvelle revue indépendante, corrections, clôture.

## Parallelization
Web et mobile peuvent être vérifiés séparément ; éviter les écritures concurrentes dans un même composant.

## Database impact
No expected database change.

## API impact
No expected API change.

## Security impact
Recherche côté interface dans des options déjà autorisées ; aucun élargissement de visibilité, de droits ni d'appel réseau.

## Validation
Tests ciblés de recherche (casse/accents, zéro résultat, conservation des sélections masquées, sélection globale sans recherche, union limitée aux résultats visibles avec recherche, plafond de 50 sans sélection partielle, fermeture clavier), contrats Budget et phase, typecheck Web ; contrôle ciblé mobile et recette visuelle Expo sur SDK compatible. L'utilisateur exécutera les commandes applicatives selon la politique du projet, sauf autorisation explicite distincte. Aucun test ni déploiement en production.

## Acceptance criteria
Dans chaque liste Web visée et dans la confirmation de phase mobile, saisir un texte réduit les options visibles et l'effacer les restaure. La recherche de phase se trouve à l'intérieur du menu déroulant sur Web et mobile. Dans un multisélecteur, « Tout sélectionner » choisit toutes les options sans recherche, mais uniquement les correspondances visibles avec recherche, tout en conservant les choix masqués et le plafond de 50. Les valeurs choisies, la portée du calcul/recalcul/reconstruction et la confirmation de phase restent autrement identiques. La modale Budget garde une hauteur stable et ses listes restent utilisables. Aucun autre filtre mobile n'est ajouté.

## Risks
Régression d'accessibilité lors du remplacement des `select` natifs, perte d'une sélection masquée par la recherche, interactions avec la limite de 50 choix, menu coupé dans la modale Budget, ancien typecheck mobile global déjà en défaut sur des fichiers hors périmètre. Garder des tests ciblés et une recette visuelle.

## Expected result
Recherche locale cohérente dans les menus des filtres Web et de la phase Web/mobile, avec sélection globale adaptée à la recherche, sans changement de données, d'API ou de calcul métier.

## Avenant approuvé — recherche de l'écran Chantiers mobile
GO explicite reçu le 23/10/2026 après clarification que seul Chantiers mobile est en défaut ; la recherche Web et la confirmation de phase mobile restent inchangées. Dans Chantiers mobile, la saisie ne recalculait pas `filteredMissions` et le filtre « toutes » contournait `matchesSearch`. Rendre la liste réactive à la saisie, appliquer la recherche en intersection avec chaque filtre de statut, traiter les champs absents sans erreur et couvrir ces cas par des tests ciblés. Aucun changement de base de données, d'API, de droits ou de production.

## Execution record
Approuvée par GO le 23/10/2026, puis avenants explicitement approuvés pour la recherche dans les menus de phase, « Tout sélectionner » filtré et la correction de la recherche Chantiers mobile. Implémentation locale sur V4.1 : `MultiSelect`, `SearchableSelect`, `filterSearch`, `PreventionPage`, `BudgetPage` et `offerGroupPhaseConfirmation` pour le Web ; `mobile/app/tabs/visite.tsx` et `mobile/services/preventionPhaseSearch.ts` pour la phase ; `mobile/app/tabs/missions.tsx` et `mobile/services/missionSearch.ts` pour Chantiers, avec tests ciblés. La liste Chantiers est dérivée de `missions`, du statut et du texte ; recherche normalisée, champs absents sûrs, recherche et statut en intersection. Aucun changement de base de données, d'API ou de droits ; aucune action en production.

Validation locale autorisée et exécutée par l'agent : 48/48 tests Frontend ciblés, typecheck Web, 4/4 tests de recherche Chantiers mobile, contrôle syntaxique ciblé mobile (0 erreur) et `git diff --check` réussis. Recette Web authentifiée locale sur les cinq onglets Synthèse et la vraie modale Budget : recherche, sélection globale filtrée et hauteur stable confirmées, sans job lancé ; session de test temporaire supprimée. L'utilisateur a confirmé sur mobile le fonctionnement de la recherche de phase puis de la recherche Chantiers. Revues indépendantes de l'avenant initial et du correctif Chantiers : `REVIEW_STATUS: APPROVED`. Revue Security spécialisée non requise : aucune frontière d'autorisation ou donnée sensible modifiée.

Limitation connue : le typecheck mobile global conserve des erreurs antérieures hors périmètre ; les fichiers modifiés ont passé le contrôle syntaxique ciblé. Dette technique distincte : les comparaisons de dates des filtres de statut Chantiers gardent leur comportement antérieur.
