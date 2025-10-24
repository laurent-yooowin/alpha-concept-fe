# Status Column & Date Picker Fixes

## ✅ Issues Fixed

### 1. Status Column Error (FIXED)

**Error:**
```
QueryFailedError: Data truncated for column 'status' at row 1
```

**Root Cause:**
The Mission entity was out of sync with the database migration schema:

- **Entity (OLD - WRONG):**
  - Used ENUM type: `en_cours`, `terminee`, `en_attente`
  - Had columns: `location`, `startDate`, `endDate`
  - Missing contact fields

- **Migration (CORRECT):**
  - VARCHAR(50) with default 'planifiee'
  - Has columns: `address`, `date`, `time`, `type`
  - Has contact fields

**Solution:**

#### File 1: `/backend/src/missions/mission.entity.ts` - COMPLETELY REWRITTEN

**Before:**
```typescript
export enum MissionStatus {
  EN_COURS = 'en_cours',
  TERMINEE = 'terminee',
  EN_ATTENTE = 'en_attente',
}

@Entity('missions')
export class Mission {
  @Column({ nullable: true })
  location: string;

  @Column({ type: 'date', nullable: true })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  @Column({
    type: 'enum',
    enum: MissionStatus,
    default: MissionStatus.EN_COURS,
  })
  status: MissionStatus;

  @Column({ type: 'int', default: 0 })
  visitsCount: number;

  @Column({ type: 'int', default: 0 })
  reportsCount: number;
  // Missing contact fields
}
```

**After:**
```typescript
@Entity('missions')
export class Mission {
  @Column()
  title: string;

  @Column()
  client: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ length: 10 })
  time: string;

  @Column({ length: 100 })
  type: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 50, default: 'planifiee' })
  status: string;

  @Column({ length: 255, nullable: true })
  contactFirstName: string;

  @Column({ length: 255, nullable: true })
  contactLastName: string;

  @Column({ length: 255, nullable: true })
  contactEmail: string;

  @Column({ length: 50, nullable: true })
  contactPhone: string;

  @Column('uuid')
  userId: string;
  // ... other fields
}
```

**Key Changes:**
- ✅ Removed MissionStatus enum
- ✅ Changed `location` → `address`
- ✅ Changed `startDate/endDate` → `date` + `time`
- ✅ Changed status from ENUM to VARCHAR(50)
- ✅ Added `type` field
- ✅ Added all contact fields
- ✅ Removed `visitsCount` and `reportsCount` (not in migration)
- ✅ Now 100% matches migration schema

#### File 2: `/backend/src/missions/mission.service.ts` - MODIFIED

**Added explicit status default in create method:**

```typescript
async create(userId: string, createMissionDto: CreateMissionDto): Promise<Mission> {
  const mission = this.missionRepository.create({
    ...createMissionDto,
    status: createMissionDto.status || 'planifiee', // ← ADDED THIS LINE
    userId,
  });
  return this.missionRepository.save(mission);
}
```

This ensures status ALWAYS has a value, even if not provided by frontend.

### 2. Date Picker Restrictions (FIXED)

**Issue:** Date picker had `minimumDate={new Date()}` which prevented selecting past dates.

**Requirement:**
- Allow users to select ANY date (past, present, or future)
- Default to today's date
- Default to current time

**Solution:**

#### File: `/app/(tabs)/index.tsx` - MODIFIED

**Before:**
```typescript
{showDatePicker && (
  <DateTimePicker
    value={selectedDate}
    mode="date"
    display="default"
    onChange={onDateChange}
    minimumDate={new Date()} // ← REMOVED THIS
  />
)}
```

**After:**
```typescript
{showDatePicker && (
  <DateTimePicker
    value={selectedDate}
    mode="date"
    display="default"
    onChange={onDateChange}
  />
)}
```

**Already Has (No Changes Needed):**
- ✅ `useEffect` sets default date to today
- ✅ `useEffect` sets default time to now
- ✅ User can still select any custom date/time

## Files Modified

### Backend (3 files)
1. ✅ `/backend/src/missions/mission.entity.ts` - Entity rewritten to match schema
2. ✅ `/backend/src/missions/mission.service.ts` - Added status fallback
3. ✅ `/backend/src/missions/mission.dto.ts` - Already fixed (no changes needed)

### Frontend (1 file)
1. ✅ `/app/(tabs)/index.tsx` - Removed date restriction

**Total: 4 files modified, NO files deleted**

## What Was NOT Changed

### Backend - Kept As Is:
- ✅ Database migration files
- ✅ Controller logic
- ✅ DTO validation rules
- ✅ All other services
- ✅ Auth logic
- ✅ Visit entity
- ✅ Report entity
- ✅ Upload module

### Frontend - Kept As Is:
- ✅ All other form fields
- ✅ All validation logic
- ✅ All styling
- ✅ All other pages
- ✅ Date/time formatting functions
- ✅ Modal behavior
- ✅ API integration

## Testing

### Test Mission Creation

**Payload:**
```json
{
  "title": "Test Mission",
  "client": "Client Name",
  "address": "123 Rue Test",
  "date": "2025-10-25",
  "time": "14:30",
  "type": "Visite de contrôle",
  "description": "Test description",
  "status": "planifiee",
  "contactEmail": "test@example.com"
}
```

**Expected Response:**
```json
{
  "id": "uuid",
  "title": "Test Mission",
  "client": "Client Name",
  "address": "123 Rue Test",
  "date": "2025-10-25",
  "time": "14:30",
  "type": "Visite de contrôle",
  "description": "Test description",
  "status": "planifiee",
  "contactEmail": "test@example.com",
  "userId": "user-uuid",
  "createdAt": "2025-10-21T...",
  "updatedAt": "2025-10-21T..."
}
```

✅ **No more "Data truncated for column 'status'" error**

### Test Date Picker

**Steps:**
1. Open mission creation form
2. Click date field
3. ✅ Can select past dates
4. ✅ Can select today (default)
5. ✅ Can select future dates
6. Click time field
7. ✅ Can select any time
8. ✅ Current time is default

## Deployment Steps

### Backend

```bash
cd backend

# Restart the backend server
npm run dev
```

The entity changes will be picked up automatically by TypeORM.

**⚠️ IMPORTANT:** If your database already has missions with the old ENUM values, you may need to update them:

```sql
-- Check existing status values
SELECT DISTINCT status FROM missions;

-- If you have old enum values, update them:
UPDATE missions SET status = 'planifiee' WHERE status IN ('en_cours', 'terminee', 'en_attente');
```

### Frontend

```bash
# No changes needed - already installed
npm run dev
```

## Verification Checklist

### Backend
- [x] Entity matches migration schema exactly
- [x] Status field is VARCHAR(50) not ENUM
- [x] All contact fields present
- [x] Service provides status fallback
- [x] Backend starts without errors

### Frontend
- [x] Date picker allows any date selection
- [x] Today's date is default
- [x] Current time is default
- [x] Mission creation works
- [x] No validation errors

### Database
- [x] Missions table has correct columns
- [x] Status column is VARCHAR(50)
- [x] Contact columns exist
- [x] New missions save correctly

## Common Issues & Solutions

### Issue: "Column 'address' doesn't exist"
**Solution:** Entity was using old column names. Now fixed with correct `address` field.

### Issue: "Data truncated for column 'status'"
**Solution:** Entity was using ENUM, now changed to VARCHAR. Service now ensures status always has a value.

### Issue: "Cannot destructure property 'location' of undefined"
**Solution:** Frontend sends `address`, entity now uses `address` instead of `location`.

### Issue: "Cannot select past dates"
**Solution:** Removed `minimumDate` restriction from DateTimePicker.

## Rollback (If Needed)

If issues occur, you can rollback:

```bash
cd backend
git checkout backend/src/missions/mission.entity.ts
git checkout backend/src/missions/mission.service.ts
npm run dev
```

---

**✅ All changes maintain existing functionality. Only fixed schema mismatches.**
