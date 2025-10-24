# Database Seeding Guide

This document explains how to populate your database with sample data for development and testing.

## Prerequisites

1. **Database Connection**: Ensure your `.env` file has valid database credentials
2. **Migrations Run**: Database schema must be up to date (`npm run migration:run`)
3. **Admin User**: At least one user must exist (`npm run create-admins`)

## Available Seed Scripts

### 1. Seed Missions
Populates the database with 10 sample missions across different statuses.

```bash
npm run seed:missions
```

**Creates:**
- 3 missions "en cours" (today's missions)
- 2 missions "en attente" (overdue)
- 5 missions "planifiee" (scheduled)

**Mission Data Includes:**
- Title, client, address
- Date and time
- Mission type
- Description
- Contact information (name, email, phone)

### 2. Seed Visits
Creates sample visit records linked to existing missions.

```bash
npm run seed:visits
```

**Prerequisites:** Missions must exist (run `seed:missions` first)

**Creates:**
- 5 sample visits for the first 3 missions
- Photo analysis data with risk levels
- Notes and observations
- Report generation status

**Visit Data Includes:**
- Visit date and time
- Photo count and photo data
- AI analysis results (observations, recommendations, risk level)
- Comments and validation status
- Report generation flag

### 3. Seed Reports
Generates sample reports for missions and visits.

```bash
npm run seed:reports
```

**Prerequisites:** Missions and visits must exist

**Creates:**
- 5 sample reports with different statuses:
  - 3 sent reports
  - 1 draft report
  - 1 archived report

**Report Data Includes:**
- Title and content (formatted markdown)
- Status (draft, sent, archived)
- Conformity percentage
- Sent date and recipient email
- Link to mission and visit

### 4. Seed All Data
Runs all three seed scripts in sequence.

```bash
npm run seed:all
```

**Execution Order:**
1. Seeds missions
2. Seeds visits
3. Seeds reports

## Important Notes

### Data Cleanup
Each seed script **automatically removes existing data** for the current user before creating new records. This ensures a clean slate every time you run the scripts.

### User Association
All seeded data is associated with the first user in the database (typically the admin created by `create-admins` script).

### Idempotent
The scripts are idempotent - you can run them multiple times safely. Each execution will:
1. Delete existing data for the user
2. Create fresh sample data

## Typical Workflow

### First Time Setup
```bash
cd backend

# 1. Run migrations
npm run migration:run

# 2. Create admin user
npm run create-admins

# 3. Seed all data
npm run seed:all
```

### Refresh Data During Development
```bash
cd backend

# Reset all data
npm run seed:all

# Or reset specific data
npm run seed:missions   # Just missions
npm run seed:visits     # Just visits
npm run seed:reports    # Just reports
```

## Sample Data Overview

### Missions
| Title | Client | Status | Location |
|-------|--------|--------|----------|
| RÉSIDENCE LES JARDINS | Bouygues Construction | en_cours | Lyon 69003 |
| BUREAUX PART-DIEU | Eiffage Construction | en_cours | Lyon 69003 |
| CENTRE COMMERCIAL | Vinci Construction | en_cours | Villeurbanne 69100 |
| USINE PHARMACEUTIQUE | Eiffage Construction | en_attente | Lyon 69008 |
| COMPLEXE SPORTIF | GTM Bâtiment | en_attente | Villeurbanne 69100 |
| LYCÉE ÉCOLOGIQUE | GTM Bâtiment | planifiee | Villeurbanne 69100 |
| ÉCOLE PRIMAIRE | Vinci Construction | planifiee | Lyon 69004 |
| RÉSIDENCE ÉTUDIANTE | Eiffage Construction | planifiee | Lyon 69001 |
| STATION MÉTRO B | SYTRAL | planifiee | Lyon 69005 |
| HÔPITAL MODERNE | Bouygues Construction | planifiee | Lyon 69007 |

### Visits
- 5 visits linked to the first 3 missions
- Each with photo analysis and AI recommendations
- Mix of completed and pending reports

### Reports
- 3 sent reports (conformity: 92-98%)
- 1 draft report (in progress)
- 1 archived report (completed project)

## Verification

After seeding, verify the data:

```bash
# Check mission count
curl http://localhost:3000/missions

# Check visit count
curl http://localhost:3000/visits

# Check report count
curl http://localhost:3000/reports
```

Or use the frontend application to view the seeded data.

## Troubleshooting

### "No user found"
**Solution:** Run `npm run create-admins` first

### "No missions found" (when seeding visits)
**Solution:** Run `npm run seed:missions` first

### Database connection errors
**Solution:** Check your `.env` file and ensure the database is running

### TypeORM errors
**Solution:** Ensure migrations are up to date with `npm run migration:run`

## Development vs Production

**⚠️ WARNING**: These seed scripts are for **development and testing only**.

**DO NOT** run seed scripts on production databases as they will:
- Delete existing user data
- Replace it with sample data

For production, use proper data migration scripts or import real data.
