# Mission Visit Details and Report Modification Feature

## Overview
Added functionality to display visit details from the missions page when a visit exists for a mission. The button changes from "VISITE" to "DÉTAILS" when a visit has been completed. Users can view visit details and modify the associated report if it's not yet validated.

## Changes Made

### 1. Missions Screen Updates (`app/(tabs)/missions.tsx`)

#### New Imports
- `Eye`, `Image as ImageIcon` - Icons for details view
- `visitService` - For fetching visit data
- `reportService` - For fetching and updating reports

#### New State Variables
```typescript
const [showVisitDetailModal, setShowVisitDetailModal] = useState(false);
const [selectedVisit, setSelectedVisit] = useState<any>(null);
const [selectedReport, setSelectedReport] = useState<any>(null);
const [showEditReportModal, setShowEditReportModal] = useState(false);
const [editedReportContent, setEditedReportContent] = useState('');
const [isSavingReport, setIsSavingReport] = useState(false);
```

#### Updated `loadMissions()` Function
**New Feature**: Checks for visits and reports for each mission

**Flow**:
1. Fetch all missions from backend
2. For each mission:
   - Fetch all visits
   - Find visit for current mission by `missionId`
   - If visit found, set `hasVisit = true` and store `visitId`
   - Fetch all reports
   - Find report by `visitId`
   - If report found, store `reportId`
3. Add `hasVisit`, `visitId`, and `reportId` to mission data

**Mission Data Structure**:
```typescript
{
  id: string,
  title: string,
  client: string,
  ...
  hasVisit: boolean,      // NEW
  visitId: string | null, // NEW
  reportId: string | null // NEW
}
```

#### New Handler Functions

##### `openVisitDetails(mission)`
Opens the visit details modal for a mission

**Flow**:
1. Check if mission has `visitId`
2. Fetch visit details using `visitService.getVisit(visitId)`
3. If visit has a report, fetch report details using `reportService.getReport(reportId)`
4. Set selected visit and report in state
5. Open visit detail modal

##### `handleModifyReport()`
Opens the edit modal for the report

**Flow**:
1. Load current report content into state
2. Open edit report modal

##### `handleSaveReportModifications()`
Saves report modifications and updates related visit

**Flow**:
1. Update report content in database
2. If visit exists, append modification note to visit's notes
3. Refresh report data
4. Show success message
5. Reload missions to refresh data

### 2. UI Changes

#### Mission Card Button Logic
**Before**: Always showed "VISITE" button
**After**: Dynamic button based on visit status

```typescript
{mission.hasVisit ? (
  // Show "DÉTAILS" button (green gradient)
  <TouchableOpacity onPress={() => openVisitDetails(mission)}>
    <Eye icon />
    <Text>DÉTAILS</Text>
  </TouchableOpacity>
) : (
  // Show "VISITE" button (white gradient)
  <TouchableOpacity onPress={() => startVisitForMission(mission)}>
    <Camera icon />
    <Text>VISITE</Text>
  </TouchableOpacity>
)}
```

**Button States**:
- **No Visit**: White "VISITE" button with camera icon
- **Visit Exists**: Green "DÉTAILS" button with eye icon

### 3. Visit Detail Modal

#### Modal Header (Green Gradient)
- FileText icon
- Title: "Détails du Rapport"
- Subtitle: Visit date formatted in French
- Close button (X)

#### Modal Content (Scrollable)

**Section 1: Report Content**
- Title: "CONTENU DU RAPPORT"
- Displays full report content
- Dark background box with light text

**Section 2: Photos** (if available)
- Title: "PHOTOS ({count})"
- For each photo:
  - Photo placeholder with image icon
  - Photo index (e.g., "Photo 1")
  - Comment below photo (if available)

**Section 3: Notes** (if available)
- Title: "NOTES"
- Displays visit notes including all modifications
- Shows modification history with timestamps

#### Modal Footer (Conditional)
**Shown only if**: `selectedReport.status !== 'valide'`

- "Modifier le rapport" button (orange gradient)
- Edit3 icon
- Opens edit report modal

### 4. Edit Report Modal

#### Modal Header (Orange Gradient)
- Edit3 icon
- Title: "Modifier le Rapport"
- Subtitle: Report title
- Close button (X)

#### Modal Content
- Label: "Contenu du rapport"
- Multi-line text input
- Pre-filled with current report content
- Placeholder: "Saisissez le contenu du rapport..."

#### Modal Footer
- "Enregistrer" button (green gradient)
- Save icon
- Shows loading spinner when saving
- Disabled while saving

### 5. Modification Tracking

When a report is modified from the missions page:
1. Report content is updated in `reports` table
2. Modification is logged in related visit's `notes` field
3. Format: `\n\n[Modification du {timestamp}]\n{new content}`
4. Complete audit trail is maintained

## User Workflows

### Scenario 1: Starting a New Visit
1. User opens missions page
2. User sees mission card with white "VISITE" button
3. User clicks "VISITE"
4. Visit page opens with mission data
5. User completes visit and generates report
6. User returns to missions page
7. Button now shows green "DÉTAILS"

### Scenario 2: Viewing Visit Details
1. User opens missions page
2. User sees mission card with green "DÉTAILS" button
3. User clicks "DÉTAILS"
4. Visit detail modal opens showing:
   - Report content
   - Photos with comments
   - Visit notes
5. If report not validated, "Modifier le rapport" button is visible

### Scenario 3: Modifying Report from Missions
1. User clicks "DÉTAILS" on mission card
2. Visit detail modal opens
3. User sees "Modifier le rapport" button (if not validated)
4. User clicks "Modifier le rapport"
5. Edit modal opens with current content
6. User modifies content
7. User clicks "Enregistrer"
8. Report and visit are updated in database
9. Success message shown
10. Modals close and missions refresh

### Scenario 4: Validated Report
1. User clicks "DÉTAILS" on mission card
2. Visit detail modal opens
3. No "Modifier le rapport" button shown
4. Report is read-only (validated by admin)

## Technical Implementation

### Data Flow
```
Mission Card
    ↓
loadMissions() checks for visits/reports
    ↓
Mission data includes hasVisit, visitId, reportId
    ↓
Button shows "DÉTAILS" if hasVisit is true
    ↓
Click "DÉTAILS" → openVisitDetails()
    ↓
Fetch visit and report data
    ↓
Display in Visit Detail Modal
    ↓
If not validated, show "Modifier" button
    ↓
Click "Modifier" → handleModifyReport()
    ↓
Edit Report Modal opens
    ↓
Save → handleSaveReportModifications()
    ↓
Update report and visit in database
```

### Database Operations

#### When Loading Missions
```sql
-- For each mission
SELECT * FROM visits WHERE missionId = {mission.id}
-- If visit found
SELECT * FROM reports WHERE visitId = {visit.id}
```

#### When Viewing Details
```sql
SELECT * FROM visits WHERE id = {visitId}
SELECT * FROM reports WHERE id = {reportId}
```

#### When Modifying Report
```sql
UPDATE reports SET content = {newContent} WHERE id = {reportId}
UPDATE visits SET notes = CONCAT(notes, {modificationNote}) WHERE id = {visitId}
```

## Styling

### Button Colors
- **VISITE Button**: White gradient (`#FFFFFF`, `#F8FAFC`) with dark text
- **DÉTAILS Button**: Green gradient (`#10B981`, `#059669`) with white text

### Modal Themes
- **Visit Detail Modal**: Green gradient header
- **Edit Report Modal**: Orange gradient header
- **Background**: Dark theme (`#1E293B`, `#0F172A`)
- **Text**: Light colors for readability

### Components
- Cards with rounded corners (12px)
- Gradient backgrounds for buttons and headers
- Consistent spacing (16-20px)
- Icons sized at 14-24px depending on context

## Benefits

1. **Clear Visual Feedback**: Users immediately see which missions have completed visits (green DÉTAILS button)
2. **Quick Access**: One-click access to visit details from missions page
3. **Contextual Actions**: Modify button only shown when modification is allowed
4. **Complete Information**: All visit data (report, photos, notes) in one place
5. **Audit Trail**: All modifications are tracked in visit notes
6. **Consistent UX**: Matches design patterns from other modals in the app

## Validation Rules

- Modify button is hidden when `report.status === 'valide'`
- Visit must exist to show DÉTAILS button (`mission.hasVisit === true`)
- Report modifications require both reportId and visitId
- All database operations are wrapped in try-catch for error handling

## Future Enhancements

Potential improvements:
1. Display actual photo images instead of placeholders
2. Add photo zoom functionality
3. Export visit details as PDF from this modal
4. Add filtering/sorting of visits by date
5. Show visit history timeline
6. Add visit status indicators
