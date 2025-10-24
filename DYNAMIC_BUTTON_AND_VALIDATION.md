# Visit Page - Dynamic Button and Validation Status Feature

## Overview
Enhanced the visit page with intelligent button switching and validation-based permissions. The "Détails rapport" button dynamically changes to "Générer rapport" when changes are made, and all editing actions are disabled when the related report is validated.

## Features Implemented

### 1. Dynamic Button Switching
The button in the visit page now intelligently switches between two states based on user actions:

**"Détails rapport" (Green)**:
- Shown when visit exists, report exists, and NO changes have been made
- Navigates to reports page to view existing report
- Green gradient (#10B981, #059669)

**"Générer rapport" (Purple)**:
- Shown when:
  - No visit exists yet, OR
  - Visit exists but changes have been made (photos added/removed, comments modified)
- Opens report generation modal
- Purple gradient (#8B5CF6, #A855F7)

### 2. Change Tracking
System tracks when user makes any of these changes:
- Takes a new photo
- Deletes a photo
- Adds or modifies a comment on a photo

When any change is detected, `hasChanges` state is set to `true`, which triggers button switch.

### 3. Validation-Based Permissions
When a report status is "valide" (validated), the following actions are DISABLED:
- Taking new photos (camera button hidden)
- Deleting photos (trash button hidden)
- Adding comments (edit button hidden)
- Modifying existing comments (edit button hidden)

This ensures validated reports cannot be modified, maintaining data integrity.

## Changes Made

### Visit Screen (`app/(tabs)/visite.tsx`)

#### New State Variables
```typescript
const [reportStatus, setReportStatus] = useState<string | null>(null);
const [hasChanges, setHasChanges] = useState(false);
```

- `reportStatus`: Stores the status of the related report ('valide', 'envoye', 'brouillon', etc.)
- `hasChanges`: Tracks if user has made any modifications to photos or comments

#### Updated `loadExistingVisitData()` Function

Added report status loading and change tracking reset:
```typescript
setReportStatus(visitReport.status);  // Store report status
setHasChanges(false);  // Reset changes flag when loading
```

#### Change Tracking in Functions

Each user action that modifies data now sets `hasChanges = true`:

**`takePhoto()`**:
```typescript
setPhotos(prev => [...prev, newPhoto]);
setShowCamera(false);
setHasChanges(true);  // NEW
```

**`deletePhoto()`**:
```typescript
setPhotos(prev => prev.filter(p => p.id !== photoId));
setHasChanges(true);  // NEW
```

**`saveComments()`**:
```typescript
setEditingComments(false);
setHasChanges(true);  // NEW
```

#### Updated Button Logic

Dynamic button display based on visit status and changes:
```typescript
{hasExistingVisit && existingReportId && !hasChanges ? (
  // Show "Détails rapport" - no changes made
  <TouchableOpacity onPress={() => router.push('/rapports')}>
    <LinearGradient colors={['#10B981', '#059669']}>
      <Eye size={16} color="#FFFFFF" />
      <Text>Détails rapport</Text>
    </LinearGradient>
  </TouchableOpacity>
) : photos.length >= 3 && (
  // Show "Générer rapport" - changes made or no visit
  <TouchableOpacity onPress={generateReport}>
    <LinearGradient colors={['#8B5CF6', '#A855F7']}>
      <FileText size={16} color="#FFFFFF" />
      <Text>Générer rapport</Text>
    </LinearGradient>
  </TouchableOpacity>
)}
```

#### Validation-Based UI Controls

**Add Photo Button** - Hidden when validated:
```typescript
{photos.length < 10 && reportStatus !== 'valide' && (
  <TouchableOpacity onPress={() => setShowCamera(true)}>
    <Camera icon />
    <Text>PRENDRE UNE PHOTO</Text>
  </TouchableOpacity>
)}
```

**Delete Photo Button** - Hidden when validated:
```typescript
{reportStatus !== 'valide' && (!mission || mission.originalStatus !== 'terminee') && (
  <TouchableOpacity onPress={() => deletePhoto(selectedPhoto.id)}>
    <Trash2 icon />
  </TouchableOpacity>
)}
```

**Edit Comment Button** - Hidden when validated:
```typescript
{reportStatus !== 'valide' && (!mission || mission.originalStatus !== 'terminee') && (
  <TouchableOpacity onPress={() => setEditingComments(true)}>
    <Edit3 icon />
  </TouchableOpacity>
)}
```

## User Workflows

### Scenario 1: Viewing Existing Visit (No Changes)
1. User selects mission with existing visit
2. Photos and report load from database
3. `hasChanges = false`, `reportStatus` loaded
4. Button shows "Détails rapport" (green)
5. User clicks button → navigates to reports page

### Scenario 2: Making Changes to Existing Visit
1. User selects mission with existing visit
2. Photos load, button shows "Détails rapport" (green)
3. User takes a new photo
4. `setHasChanges(true)` called
5. Button immediately changes to "Générer rapport" (purple)
6. User can now generate new report with changes

### Scenario 3: Validated Report - Read-Only Mode
1. User selects mission with validated report (`reportStatus = 'valide'`)
2. Photos load with complete analysis
3. ALL editing controls are hidden:
   - "PRENDRE UNE PHOTO" button → Hidden
   - Trash icon (delete photo) → Hidden
   - Edit icon (modify comments) → Hidden
4. User can only view data, no modifications possible
5. Button still shows "Détails rapport" for viewing

### Scenario 4: Multiple Changes
1. User takes photo → `hasChanges = true` → Button purple
2. User adds comment → `hasChanges = true` (already true) → Button stays purple
3. User deletes photo → `hasChanges = true` (already true) → Button stays purple
4. Button remains "Générer rapport" until new report is generated

## Button State Matrix

| Visit Exists | Report Exists | Has Changes | Report Status | Button Shown |
|--------------|---------------|-------------|---------------|--------------|
| No | No | - | - | "Générer rapport" (≥3 photos) |
| Yes | Yes | No | Any | "Détails rapport" (green) |
| Yes | Yes | Yes | Any | "Générer rapport" (purple) |
| Yes | No | - | - | "Générer rapport" (≥3 photos) |

## Permission Matrix (When Report Status = 'valide')

| Action | Allowed | Control State |
|--------|---------|---------------|
| View photos | ✅ Yes | Visible |
| View photo analysis | ✅ Yes | Visible |
| View risk levels | ✅ Yes | Visible |
| View comments | ✅ Yes | Visible |
| View report | ✅ Yes | "Détails rapport" button |
| Take new photo | ❌ No | Hidden |
| Delete photo | ❌ No | Hidden |
| Add comment | ❌ No | Hidden (edit icon) |
| Modify comment | ❌ No | Hidden (edit icon) |

## Data Flow

### Change Detection Flow
```
User Action (take photo / delete photo / save comment)
    ↓
setHasChanges(true)
    ↓
Button logic re-evaluates
    ↓
Condition: hasExistingVisit && existingReportId && !hasChanges
    ↓ FALSE (hasChanges = true)
Show "Générer rapport" button (purple)
```

### Validation Check Flow
```
Load Visit Data
    ↓
Fetch Related Report
    ↓
Store reportStatus in state
    ↓
UI Elements Check: reportStatus !== 'valide'
    ↓ FALSE (status is 'valide')
Hide all edit controls
```

## Benefits

1. **Clear User Intent**: Button text clearly indicates what will happen
2. **Data Integrity**: Validated reports cannot be accidentally modified
3. **Intuitive Workflow**: Users immediately know when changes require new report
4. **Audit Trail**: Changes trigger new report generation, preserving history
5. **Read-Only Mode**: Complete protection of validated reports
6. **Visual Feedback**: Button color change (green→purple) signals state change
7. **Consistent Behavior**: All edit actions disabled together when validated

## Technical Details

### State Management
```typescript
// Reset when loading visit
loadExistingVisitData() → setHasChanges(false)

// Set when user makes changes
takePhoto() → setHasChanges(true)
deletePhoto() → setHasChanges(true)
saveComments() → setHasChanges(true)
```

### Report Status Values
- `'valide'`: Validated by admin → ALL editing disabled
- `'envoye'`: Sent but not validated → editing allowed
- `'brouillon'`: Draft → editing allowed
- `'rejete'`: Rejected → editing allowed
- `null`: No report yet → editing allowed

### Conditional Rendering Logic
```typescript
// Button visibility for editing actions
reportStatus !== 'valide' && otherConditions

// Button switching logic
hasExistingVisit && existingReportId && !hasChanges
  ? "Détails rapport"
  : "Générer rapport"
```

## Edge Cases Handled

1. **Visit exists but no report**: Shows "Générer rapport"
2. **Report becomes validated**: All edit controls immediately hidden
3. **Multiple rapid changes**: `hasChanges` stays `true` throughout
4. **Comment edit cancelled**: `hasChanges` only set on save
5. **Mission completed**: Additional protection layer (existing logic)
6. **Network failure on load**: Graceful handling with default values

## Testing Scenarios

- [x] Load existing visit → Button shows "Détails rapport"
- [x] Take photo → Button changes to "Générer rapport"
- [x] Delete photo → Button changes to "Générer rapport"
- [x] Add comment → Button changes to "Générer rapport"
- [x] Load validated report → All edit buttons hidden
- [x] Load validated report → Can still view details
- [x] Non-validated report → Edit buttons visible
- [x] New mission → Shows "Générer rapport" when ≥3 photos

The build completed successfully, and all existing functionality has been preserved!
