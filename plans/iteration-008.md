# Iteration 008 — API Prévention tenant-scoped

STATUS: COMPLETED

## Roadmap reference

P7 — API : endpoints filtrés par organisation et rôle.

## Objective

Exposer les résultats P4–P6 aux seuls administrateurs d'organisation via une API de consultation filtrable, ainsi qu'un déclenchement asynchrone de reconstruction et la consultation sécurisée de son job, sans ouvrir d'accès Hyperadmin ni réaliser de calcul analytique lourd dans les requêtes HTTP.

## Existing state

Les snapshots, constats, agrégats, scores, configurations et états scheduler sont matérialisés dans MySQL. BullMQ et le worker autonome traitent déjà les reconstructions. Aucun module HTTP Prévention n'existe encore. Le backend possède `JwtAuthGuard`, `RolesGuard`, le contexte utilisateur/organisation et des guards globaux, mais certains utilitaires existants autorisent volontairement Hyperadmin : P7 devra donc appliquer une interdiction explicite et dériver le tenant exclusivement de l'utilisateur authentifié.

## Functional scope

- Ajouter `GET /prevention/dashboard`, `/findings`, `/recommendations`, `/trends` et `/references`.
- Accepter les périodes prévues et les filtres type de chantier, chantier, mission, catégorie, criticité et statut, avec pagination/tri bornés et granularité jour/semaine/mois conforme à la roadmap.
- Retourner les scores et liens vers rapports sources nécessaires à la vérification, sans contenu de prompt/directive ni données d'une autre organisation.
- Ajouter `POST /prevention/rebuild`, limité en fréquence, qui dépose une reconstruction tenant-scoped et répond `202` avec un `jobId`.
- Ajouter `GET /prevention/jobs/:id`, uniquement pour un job appartenant à l'organisation courante.
- Réserver tous ces endpoints à `ROLE_ADMIN` avec une organisation; refuser explicitement `ROLE_USER`, Hyperadmin et utilisateurs sans organisation.
- Exclure les endpoints Budget P8B, les pages Web P8, le backfill P9 et tout calcul IA à l'ouverture d'une page.

## Technical scope

- Créer un module/controller/service Prévention et des DTO stricts pour périodes, filtres, pagination et regroupement.
- Construire toutes les requêtes depuis `user.organizationId`; ignorer/refuser tout tenant fourni par le client.
- Lire les tables agrégées/scores pour dashboard/tendances et les findings tenant-scoped pour les listes/références, avec requêtes/index existants et limites défensives.
- Définir des réponses stables contenant métadonnées de période, granularité et pagination.
- Publier la reconstruction via BullMQ avec payload minimal, identifiant déterministe tenant/version et protection anti-abus; ne pas exécuter la reconstruction dans l'API.
- Vérifier l'appartenance du job à partir de son payload validé avant de révéler état, progression ou erreur synthétique.

## Expected files/modules

- `backend/src/prevention/api/` ou module Prévention HTTP conforme aux conventions du dépôt;
- `backend/src/app.module.ts`;
- adaptations ciblées du module queue/scheduler pour publication et lecture d'état;
- DTO et tests API/service/autorisation;
- éventuellement index additifs seulement si les requêtes P7 démontrent un besoin absent du schéma actuel.

## Agents

- Backend : contrats, requêtes, endpoints et intégration BullMQ.
- Security : revue indépendante RBAC, exclusion Hyperadmin, tenant et exposition des jobs.
- Tester : filtres, bornes, agrégations, statuts HTTP et régressions cross-tenant.
- Reviewer : revue finale indépendante.
- Supervisor : intégration, validations et statuts.

## Execution plan

1. Figer les contrats de requête/réponse, règles de granularité et erreurs HTTP.
2. Implémenter le garde d'accès administrateur d'organisation, explicitement incompatible Hyperadmin.
3. Implémenter les lectures dashboard, constats, recommandations, tendances et références avec tenant obligatoire.
4. Implémenter la demande de reconstruction asynchrone, la limitation de fréquence et la déduplication.
5. Implémenter la lecture sécurisée de l'état d'un job appartenant au tenant.
6. Ajouter les tests unitaires/API d'autorisation, filtres, pagination, bornes et isolation inter-organisations.
7. Valider build/tests et scénario MySQL/Redis ciblé, puis obtenir Security et Reviewer.

## Parallelization

Les contrats DTO/réponses et l'analyse des requêtes peuvent être préparés séparément. L'implémentation du contrôleur et des tests d'autorisation suivra un contrat unique afin d'éviter les divergences.

## Database impact

No expected database change. Un index additif ne sera proposé que si une requête approuvée ne peut pas exploiter les index P4/P5 existants.

## API impact

Ajout des sept endpoints `/prevention` prévus par la roadmap. Réponses JSON versionnées par contrat, erreurs `400/401/403/404/429` selon validation, authentification, rôle, appartenance et limitation de fréquence; `POST /rebuild` retourne `202 Accepted`.

## Security impact

Revue obligatoire. Risques principaux : IDOR/cross-tenant, héritage involontaire de l'accès global Hyperadmin, injection via filtres/tri, énumération de jobs, fuite d'erreurs ou de contenu source, et abus du rebuild.

## Validation

- Build TypeScript et tests ciblés du module Prévention.
- Tests controller/service : admin de l'organisation autorisé; coordinateur, Hyperadmin et sans-organisation refusés.
- Tests cross-tenant pour findings, références et jobId, y compris identifiants valides mais étrangers.
- Tests périodes/granularités, filtres combinés, pagination/tri bornés et payloads inattendus.
- Scénario MySQL/Redis : consultation de données matérialisées, dépôt dédupliqué d'un rebuild, réponse `202`, suivi du job et limitation de fréquence.
- Régression ciblée P2–P6.

## Acceptance criteria

- Les sept endpoints P7 existent avec des contrats validés et documentés par tests.
- Chaque lecture est obligatoirement limitée à `user.organizationId`; aucune donnée cross-tenant n'est retournée.
- Seul un `ROLE_ADMIN` rattaché à une organisation accède à l'API; Hyperadmin est explicitement refusé.
- Les périodes, granularités et filtres respectent la roadmap et les requêtes restent bornées.
- Le rebuild ne bloque pas l'API, est dédupliqué/limité et ne transporte aucun contenu de rapport dans Redis.
- L'état d'un job n'est visible que par son organisation et ne divulgue pas de détail sensible.
- Aucune logique Budget, Web ou backfill historique n'est introduite.
- Validation, Security et Reviewer sont approuvés.

## Risks

- Les combinaisons de filtres peuvent nécessiter une optimisation SQL ciblée après mesure, sans dénormalisation prématurée.
- BullMQ ne constitue pas seul une preuve d'appartenance durable après nettoyage; le contrat de suivi doit conserver une vérification tenant fiable ou retourner `404` une fois l'historique expiré.
- La reconstruction manuelle P7 doit rester une reconstruction opérationnelle bornée; le backfill exhaustif demeure P9.

## Expected result

Le futur Web Prévention dispose d'une API admin d'organisation sûre, bornée et fondée sur les données matérialisées, avec reconstruction asynchrone observable sans accès inter-tenant.

## Execution record

- Implémentation des sept endpoints `/prevention` avec DTO bornés, périodes prédéfinies/personnalisées, pagination, tri et réponses tenant-scoped.
- Accès limité aux administrateurs rattachés à une organisation ; coordinateurs, Hyperadmin et comptes sans organisation sont refusés. Renforcement partagé de la configuration JWT et rejet des comptes inactifs.
- Dashboard et tendances lisent les données matérialisées. Les constats restent additifs ; rapports et visites sont comptés distinctement par bucket depuis les snapshots afin d'éviter les doubles comptes multidimensionnels. Les filtres détaillés utilisent les findings avec comptes distincts.
- Reconstruction manuelle asynchrone et dédupliquée, cooldown configurable, suivi durable tenant-scoped et payload BullMQ minimal.
- Aucun changement de schéma P7. Les migrations et tables P1–P6 existantes sont réutilisées.
- Validation utilisateur du 16/09/2026 : `npm run build` réussi ; `npm run test:prevention-queue` réussi, 41 tests sur 41.
- Validation runtime MySQL 8/Redis 7 P2–P6 fournie précédemment : migration aller/retour, concurrence, reprise Redis et pipeline worker réussis.
- Security review indépendante : PASS.
- Reviewer indépendant : `REVIEW_STATUS: APPROVED` après correction du double comptage des tendances.
- Limitation connue : les filtres détaillés absents des agrégats matériels utilisent une lecture bornée des findings ; une optimisation ne sera envisagée qu'après mesure réelle.
