## Multi-tenant Hyper-Admin — Backend + DB

Mise en place d'un modèle multi-tenant strict : **HYPER_ADMIN** supervise des **organizations** (Admins). Chaque Admin n'accède qu'à son scope (clients, chantiers, visites, rapports, coordinateurs, dashboard, CGU). Toutes les requêtes sont filtrées par `organizationId` au niveau service via un guard transverse.

---

### 1. Nouvelle entité `Organization`

Table `organizations` :
- `id` uuid PK
- `name` string
- `slug` string unique (URL `/login/:slug` — ex. `edf`)
- `logoS3Key` string nullable (clé S3 logo PDF rapport)
- `primaryColor` / `secondaryColor` nullable (branding portail login)
- `cguContent` text nullable (CGU propre à l'admin)
- `contactEmail` nullable
- `isActive` boolean default true
- `createdAt` / `updatedAt`

Pas de FK vers users : la relation se fait via `users.organizationId`.

### 2. Évolution `users`

- `role` étendu : enum `ROLE_HYPER_ADMIN | ROLE_ADMIN | ROLE_USER`
- `organizationId` uuid nullable (NULL pour HYPER_ADMIN, requis pour ADMIN/USER)
- HYPER_ADMIN : un seul (ou plusieurs) — créé via seed/script
- ADMIN : exactement un par organization (contrainte applicative)
- USER (coordinateur) : 1 admin par défaut (`organizationId`)

#### Mode multi-org pour coordinateurs (option .env)

`.env` : `MULTI_ORG_USERS_ENABLED=false` (défaut)
- Si `false` → on utilise la colonne `users.organizationId` directement (1 user → 1 admin)
- Si `true` → on utilise une table de liaison `user_organizations(userId, organizationId, role)` et on ignore `users.organizationId`. Le service `UserContextService` lit le flag et renvoie la (les) organizationId du user.

Les deux mécanismes coexistent en base mais le service ne lit qu'une source à la fois selon le flag.

### 3. Scoping des données métier

Ajout d'une colonne **`organizationId` uuid NOT NULL** + index sur :
- `missions`
- `visits`
- `reports`
- `clients` (table à créer si absente, sinon ajout colonne)
- `mission_assignments`
- `activity_logs`

À la création (services), on injecte `organizationId` depuis le contexte utilisateur. À la lecture, on filtre toujours par `organizationId` sauf si `HYPER_ADMIN`.

### 4. Couche transverse

- `OrganizationContextService` (request-scoped) : expose `getOrgId()` à partir du JWT (claim `organizationId`).
- JWT payload enrichi : `{ sub, email, role, organizationId }`.
- Décorateur `@CurrentOrg()` pour injecter l'org id.
- `OrganizationScopeGuard` global : refuse tout endpoint métier si pas d'`organizationId` (sauf si role=HYPER_ADMIN ou route taggée `@HyperAdminOnly()` / `@PublicOrg()`).
- Mise à jour systématique des services (`findAll`, `findOne`, `update`, `delete`) : injection du filtre `where: { organizationId: ctx.getOrgId() }` quand role ≠ HYPER_ADMIN. Pour HYPER_ADMIN : pas de filtre + possibilité de filtrer par query param `?organizationId=`.

### 5. Endpoints nouveaux

#### Hyper-admin (`/hyper-admin/*`, role HYPER_ADMIN uniquement)
- `GET /hyper-admin/organizations` — liste + métriques par org
- `POST /hyper-admin/organizations` — créer org + admin associé (email, password, firstName, lastName)
- `PATCH /hyper-admin/organizations/:id` — update (name, slug, branding, cgu, isActive)
- `DELETE /hyper-admin/organizations/:id`
- `POST /hyper-admin/organizations/:id/logo` — upload logo S3 → écrit `logoS3Key`
- `GET /hyper-admin/dashboard` — métriques globales agrégées par org (chantiers, visites, rapports, users, clients)
- `GET /hyper-admin/users` — tous users toutes orgs (filtre `?organizationId=`)
- Routes existantes (missions, reports, etc.) acceptent `?organizationId=` pour HYPER_ADMIN.

#### Public (portail login perso)
- `GET /public/organizations/by-slug/:slug` — renvoie `{ name, logoUrl, primaryColor, secondaryColor }` pour rendu portail. Aucun secret.

#### Auth modifié
- `POST /auth/login` accepte `organizationSlug` optionnel. Si fourni, on vérifie que `user.organizationId === organization.id` ou que c'est un HYPER_ADMIN. Sinon 401.

### 6. Stockage S3 logos

- `.env` backend : `AWS_S3_LOGOS_PREFIX=organizations/logos/` (clé de prefix S3 dédiée)
- Logo stocké à `${AWS_S3_LOGOS_PREFIX}{orgId}/{filename}`
- `UploadService` étendu d'une méthode `uploadOrgLogo(orgId, file)` qui écrit la clé dans `organizations.logoS3Key`.
- `generatePdfService` (backend si applicable) lit le logo de l'org du rapport au lieu d'un logo global.

### 7. Migration DB (TypeORM)

Une seule migration `XXXX-multi-tenant-organizations.ts` :
1. `CREATE TABLE organizations (...)`.
2. `ALTER TABLE users` : 
   - `ADD COLUMN organizationId uuid NULL`
   - modifier enum `role` pour inclure `ROLE_HYPER_ADMIN`
   - FK `organizationId → organizations(id) ON DELETE SET NULL`
3. `CREATE TABLE user_organizations (userId uuid, organizationId uuid, role enum, PK composite)` (pour mode multi-org).
4. Pour chaque table métier (`missions`, `visits`, `reports`, `mission_assignments`, `activity_logs`, `clients` si existe) :
   - `ADD COLUMN organizationId uuid NULL` + index + FK.
5. **Backfill** : 
   - Créer une organization "default" si users existants.
   - Tous les users existants `ROLE_ADMIN/ROLE_USER` → `organizationId = default.id`.
   - Tous missions/visits/reports/etc. → `organizationId = default.id`.
6. `ALTER COLUMN organizationId SET NOT NULL` sur les tables métier après backfill.

### 8. Seed Hyper Admin

Script `backend/src/scripts/create-hyper-admin.ts` :
- Lit `HYPER_ADMIN_EMAIL`, `HYPER_ADMIN_PASSWORD`, `HYPER_ADMIN_FIRSTNAME`, `HYPER_ADMIN_LASTNAME` depuis `.env`
- Crée user role `ROLE_HYPER_ADMIN`, `organizationId = NULL`
- Idempotent (skip si existe).

### 9. .env additions backend

```
HYPER_ADMIN_EMAIL=
HYPER_ADMIN_PASSWORD=
HYPER_ADMIN_FIRSTNAME=
HYPER_ADMIN_LASTNAME=
AWS_S3_LOGOS_PREFIX=organizations/logos/
MULTI_ORG_USERS_ENABLED=false
```

### 10. Étapes de livraison (cette itération — backend uniquement)

1. Entité `Organization` + module/service/controller + DTO.
2. Modif `User` entity : enum + `organizationId` + relation.
3. Migration TypeORM (création table + colonnes + backfill + FK + NOT NULL).
4. JWT payload + `JwtStrategy` enrichi avec `organizationId`.
5. `OrganizationContextService` (request-scoped) + `@CurrentOrg()` + `OrganizationScopeGuard` global.
6. Refacto des services existants (Mission/Visit/Report/Client/ActivityLog/Dashboard) : injection filtre `organizationId`.
7. `auth.service.login` : support `organizationSlug` + injection `organizationId` dans token.
8. Module `HyperAdminModule` : controller + service (CRUD orgs, dashboard agrégé, upload logo).
9. Route publique `/public/organizations/by-slug/:slug` (nouveau `PublicModule`).
10. `UploadService.uploadOrgLogo` + lecture `AWS_S3_LOGOS_PREFIX`.
11. Script `create-hyper-admin.ts` + entrée dans `package.json` (`npm run create:hyper-admin`).
12. Mise à jour des `.env.example` / docs backend.

Frontend / mobile / portail `/login/:slug` / dashboard hyper-admin → traités dans une étape suivante après validation backend.

---

### Points techniques importants

- **Aucun `findOne(id)` ne doit être laissé sans filtre `organizationId`** (sinon IDOR cross-tenant). Audit nécessaire fichier par fichier.
- L'`OrganizationScopeGuard` agit en **filet de sécurité** mais le filtrage métier reste dans les services (defense in depth).
- HYPER_ADMIN en lecture cross-org : autorisé. En écriture cross-org : autorisé uniquement via routes `/hyper-admin/*`. Les routes standard ignorent le scope si HYPER_ADMIN mais on log toute opération d'écriture cross-org dans `activity_logs`.
- `clients` : si la table n'existe pas en DB actuelle, on en profite pour la créer proprement (id, name, email, phone, address, organizationId, createdAt). Sinon on ajoute juste la colonne.
- Migration backfill : exécuter en transaction. Une "default organization" est créée avec slug `default`, name "Organisation par défaut".

Confirme-moi ce plan et je passe à l'implémentation.