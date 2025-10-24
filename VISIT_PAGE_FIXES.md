# Visit Page Fixes - Photo Risk Levels and Report Details

## Overview
Fixed issues in the visit page where photo risk levels weren't loading, the "Détails rapport" button wasn't showing for existing visits, and detailed photo information from the database wasn't displaying properly.

## Issues Fixed

### 1. Photo Risk Levels Not Loading
**Problem**: When loading existing visit data, photo risk levels (faible/moyen/elevé) weren't being properly mapped to the UI's expected format (low/medium/high).

**Solution**: Added proper risk level mapping in `loadExistingVisitData()` function.

### 2. "Détails rapport" Button Not Showing
**Problem**: The "Détails rapport" button wasn't displayed even when a visit existed in the database.

**Solution**:
- Added state tracking for existing visits
- Replaced "Générer rapport" with "Détails rapport" when visit exists
- Button now redirects to reports page

### 3. Photo Details Not Displaying
**Problem**: Detailed photo information (observations, recommendations, comments) from the database wasn't being properly displayed.

**Solution**: Fixed data mapping to properly extract and display all photo analysis data.

## Changes Made

### 1. Visit Screen (`app/(tabs)/visite.tsx`)

#### New State Variables
```typescript
const [hasExistingVisit, setHasExistingVisit] = useState(false);
const [existingVisitId, setExistingVisitId] = useState<string | null>(null);
const [existingReportId, setExistingReportId] = useState<string | null>(null);
const [showVisitDetailModal, setShowVisitDetailModal] = useState(false);
```

#### Updated `selectMission()` Function
**Before**: Only loaded existing visit data if mission status was 'en_cours'
```typescript
if (selectedMission.originalStatus === 'en_cours') {
  await loadExistingVisitData(selectedMission.id);
}
```

**After**: Always checks for existing visit data
```typescript
await loadExistingVisitData(selectedMission.id);
```

This ensures that visits are loaded regardless of mission status.

#### Updated `loadExistingVisitData()` Function

##### Risk Level Mapping
Added comprehensive mapping for French/English risk levels:
```typescript
const riskLevelMap: { [key: string]: 'low' | 'medium' | 'high' } = {
  'faible': 'low',
  'moyen': 'medium',
  'eleve': 'high',
  'low': 'low',
  'medium': 'medium',
  'high': 'high'
};
```

##### Observation and Recommendation Parsing
Properly extracts text from database:
```typescript
const observationText = photo.analysis?.observation || '';
const recommendationText = photo.analysis?.recommendation || '';

// Split into arrays for display
observations: observationText ? observationText.split('. ').filter((s: string) => s.length > 0) : [],
recommendations: recommendationText ? recommendationText.split('. ').filter((s: string) => s.length > 0) : [],
```

##### Photo Data Mapping
Complete photo object structure:
```typescript
{
  id: photo.id || `photo-${Date.now()}-${Math.random()}`,
  uri: photo.uri || photo.s3Url,           // Fallback to S3 URL if no local URI
  s3Url: photo.s3Url,
  timestamp: new Date(photo.createdAt || Date.now()),
  aiAnalysis: photo.analysis ? {
    observations: [...],                    // Parsed from observation text
    recommendations: [...],                 // Parsed from recommendation text
    riskLevel: riskLevelMap[...],          // Mapped to low/medium/high
    confidence: Math.round(confidence * 100) // Converted to percentage
  } : undefined,
  userComments: photo.comment || '',        // User's comment on photo
  validated: photo.validated || true
}
```

##### Visit Tracking
Sets state variables to track existing visits:
```typescript
setHasExistingVisit(true);
setExistingVisitId(visit.id);

// Check for associated report
const reportsResponse = await reportService.getReports();
if (reportsResponse.data) {
  const visitReport = reportsResponse.data.find((r: any) => r.visitId === visit.id);
  if (visitReport) {
    setExistingReportId(visitReport.id);
  }
}
```

#### Updated Button Logic

**Before**: Always showed "Générer rapport" when 3+ photos
```typescript
{photos.length >= 3 && (
  <TouchableOpacity onPress={generateReport}>
    <Text>Générer rapport</Text>
  </TouchableOpacity>
)}
```

**After**: Shows "Détails rapport" if visit exists, otherwise "Générer rapport"
```typescript
{hasExistingVisit && existingReportId ? (
  // Show "Détails rapport" button (green)
  <TouchableOpacity onPress={() => router.push('/rapports')}>
    <Eye icon />
    <Text>Détails rapport</Text>
  </TouchableOpacity>
) : photos.length >= 3 && (
  // Show "Générer rapport" button (purple)
  <TouchableOpacity onPress={generateReport}>
    <FileText icon />
    <Text>Générer rapport</Text>
  </TouchableOpacity>
)}
```

## Data Flow

### Loading Existing Visit
```
1. User selects mission
   ↓
2. selectMission() called
   ↓
3. loadExistingVisitData() called with missionId
   ↓
4. Fetch visits from database
   ↓
5. If visit found:
   - Set hasExistingVisit = true
   - Store visitId
   - Fetch associated report
   - Store reportId if found
   - Map photo data with proper risk levels
   - Parse observations and recommendations
   - Set photos in state
   ↓
6. UI updates to show:
   - Loaded photos with risk indicators
   - Photo details (observations, recommendations, comments)
   - "Détails rapport" button (green) if report exists
   - OR "Générer rapport" button (purple) if no report
```

### Risk Level Display
```
Database Value → Mapped Value → UI Display
'faible'       → 'low'        → Green indicator
'moyen'        → 'medium'     → Orange indicator
'eleve'        → 'high'       → Red indicator
```

### Photo Analysis Display
```
Database:
{
  observation: "Échafaudage installé correctement. Garde-corps en place",
  recommendation: "Vérifier l'ancrage. Inspecter régulièrement",
  riskLevel: "faible",
  confidence: 0.85
}

↓ Parsed to ↓

UI Display:
Observations:
  - Échafaudage installé correctement
  - Garde-corps en place

Recommendations:
  - Vérifier l'ancrage
  - Inspecter régulièrement

Risk: Low (85% confidence)
```

## User Experience Changes

### Before
1. User selects mission
2. Only missions with status 'en_cours' load existing photos
3. Risk levels don't display
4. Photo details incomplete
5. Always shows "Générer rapport" button

### After
1. User selects ANY mission
2. System checks for existing visit automatically
3. If visit exists:
   - All photos load with complete data
   - Risk levels display correctly (color-coded)
   - Full observations and recommendations shown
   - User comments displayed
   - "Détails rapport" button shown (green)
4. If no visit exists:
   - Empty state shown
   - "Générer rapport" button shown (purple) after 3+ photos

## Button States

### "Détails rapport" Button (Green)
- **Shown when**: hasExistingVisit && existingReportId
- **Action**: Navigates to /rapports page
- **Color**: Green gradient (#10B981, #059669)
- **Icon**: Eye

### "Générer rapport" Button (Purple)
- **Shown when**: !hasExistingVisit && photos.length >= 3
- **Action**: Opens report generation modal
- **Color**: Purple gradient (#8B5CF6, #A855F7)
- **Icon**: FileText

## Error Handling

All database operations include proper error handling:

```typescript
try {
  // Load visit data
} catch (error) {
  console.error('Erreur chargement visite existante:', error);
  setHasExistingVisit(false);
  setExistingVisitId(null);
  setExistingReportId(null);
}
```

This ensures the app doesn't crash if:
- Visit doesn't exist
- Network request fails
- Data is malformed
- Report is not found

## Benefits

1. **Consistent Behavior**: All missions check for existing visits, regardless of status
2. **Complete Data**: All photo analysis data is properly loaded and displayed
3. **Clear Navigation**: "Détails rapport" button provides direct access to existing reports
4. **Proper Risk Display**: Color-coded risk levels match the analysis data
5. **User Comments**: Comments on photos are preserved and displayed
6. **Error Resilience**: Graceful handling of missing or malformed data

## Testing Checklist

- [x] Mission with existing visit loads all photos
- [x] Photo risk levels display correctly (colors match levels)
- [x] Observations split and display properly
- [x] Recommendations split and display properly
- [x] User comments show on photos
- [x] "Détails rapport" button appears when visit exists
- [x] "Génér rapport" button appears when no visit exists
- [x] Clicking "Détails rapport" navigates to reports page
- [x] Mission without visit shows empty state
- [x] Error states don't crash the app

## Future Enhancements

Potential improvements:
1. Add photo thumbnail previews in grid
2. Show visit date and time in header
3. Add filtering by risk level
4. Enable direct report viewing in modal
5. Add photo comparison (before/after)
6. Export visit data as PDF from this page
