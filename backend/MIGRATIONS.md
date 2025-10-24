# Database Migrations Guide

## Overview

This project uses TypeORM migrations to manage database schema changes. Migrations ensure that database changes are version-controlled and can be applied consistently across different environments.

## Prerequisites

1. Ensure your `.env` file has the correct database credentials:
```env
DATABASE_HOST=your-supabase-host
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your-password
DATABASE_NAME=postgres
```

**Note:** If using Supabase, you need the direct Postgres connection details, not the pooler URL.

## Migration Commands

### 1. Run Existing Migrations

To apply all pending migrations to your database:

```bash
cd backend
npm run migration:run
```

This will execute the `InitialSchema` migration which creates:
- `users` table with ROLE_USER and ROLE_ADMIN roles
- `missions` table
- `mission_assignments` table (for assigning missions to users)
- `visits` table
- `reports` table
- All necessary indexes and foreign keys

### 2. Generate New Migration

After modifying entity files, generate a migration to capture the changes:

```bash
npm run migration:generate -- src/migrations/DescriptiveName
```

Example:
```bash
npm run migration:generate -- src/migrations/AddUserProfile
```

### 3. Revert Last Migration

If you need to undo the last migration:

```bash
npm run migration:revert
```

## Migration Workflow

### Step-by-Step Process

1. **Initial Setup** (First time only)
   ```bash
   cd backend
   npm install
   ```

2. **Configure Database Connection**
   - Update `.env` file with your Supabase credentials
   - Get connection details from Supabase Dashboard → Project Settings → Database

3. **Run Migrations**
   ```bash
   npm run migration:run
   ```

4. **Verify Tables Created**
   - Check Supabase Dashboard → Table Editor
   - You should see: users, missions, mission_assignments, visits, reports

### Making Schema Changes

1. **Modify Entity Files**
   - Edit files in `src/*/entity.ts`
   - Add/remove columns, change types, etc.

2. **Generate Migration**
   ```bash
   npm run migration:generate -- src/migrations/YourChangeName
   ```

3. **Review Generated Migration**
   - Check `src/migrations/` for the new file
   - Review SQL statements
   - Ensure data safety

4. **Apply Migration**
   ```bash
   npm run migration:run
   ```

## Important Notes

### Supabase-Specific

- Use **direct Postgres connection**, not the pooler
- Connection string format:
  ```
  postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
  ```
- Enable SSL if required by Supabase

### Development vs Production

**Development:**
- Set `synchronize: true` in `database.config.ts` (entities auto-sync)
- Good for rapid prototyping
- **WARNING:** Can cause data loss

**Production:**
- Set `synchronize: false` (our current setting)
- Always use migrations
- Never lose data
- Version-controlled changes

### Migration Best Practices

1. **Always Review**: Check generated SQL before running
2. **Test First**: Run on development/staging before production
3. **Backup Data**: Always backup before migrations
4. **One Change**: Keep migrations focused and small
5. **Never Edit**: Don't modify migrations after they're run

## Troubleshooting

### Connection Issues

If you get connection errors:

1. Verify `.env` credentials
2. Check Supabase connection pooler settings
3. Ensure IP is whitelisted (if applicable)
4. Use direct connection, not pooler URL

### Migration Already Exists

If migration was partially run:

```bash
# Revert and try again
npm run migration:revert
npm run migration:run
```

### Reset Database (Development Only)

To start fresh (⚠️ **DELETES ALL DATA**):

```sql
-- In Supabase SQL Editor
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS visits CASCADE;
DROP TABLE IF EXISTS mission_assignments CASCADE;
DROP TABLE IF EXISTS missions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
```

Then run migrations again:
```bash
npm run migration:run
```

## Current Schema

### Users Table
- Roles: `ROLE_USER`, `ROLE_ADMIN`
- Default: `ROLE_USER`
- Fields: id, email, password, firstName, lastName, role, phone, company

### Missions Table
- Created by users
- Can be assigned to multiple users (via mission_assignments)
- Fields: id, userId, title, client, address, date, time, type, description, status

### Mission Assignments Table
- Links missions to assigned users
- Tracks who assigned the mission
- Email notification tracking

### Visits Table
- Linked to missions
- Stores photos with AI analysis (JSON)
- Fields: id, missionId, userId, visitDate, photos, photoCount, notes

### Reports Table
- Generated from visits
- Can be sent to clients
- Statuses: brouillon, envoye, archive
- Fields: id, missionId, visitId, userId, title, content, status, conformityPercentage

## Next Steps

After running migrations:

1. Create an admin user (via registration + manual role update)
2. Test role-based access control
3. Verify mission assignments work
4. Test visit and report creation

For more details, see `BACKEND_INFO.md`
