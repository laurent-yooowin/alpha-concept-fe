# PDF Generation and Report-Visit Linking Feature

## Overview
Added PDF generation with embedded images for reports, and automatic linking of report modifications to related visits in the database.

## Changes Made

### 1. New Dependencies
Installed packages for PDF generation and file handling:
- `expo-file-system` - File system operations
- `expo-sharing` - Share functionality for native platforms

### 2. New Service: PDF Generation (`services/pdfService.ts`)

#### Features
- Generates professional HTML-based PDF reports
- Embeds photos directly in the PDF with comments
- Responsive design with proper page breaks
- Includes report metadata (mission, client, date, conformity)
- Visual conformity bar showing percentage
- Professional styling with gradient headers
- Timestamp footer

#### PDF Content Structure
```
1. Report Title (H1 with blue border)
2. Information Section (gray background box)
   - Mission name
   - Client
   - Date
   - Conformity percentage with visual bar
3. Report Content Section
   - Full report text with proper formatting
4. Photos Section (if available)
   - Each photo with its URI
   - Comment below each photo (if available)
5. Footer
   - Generation timestamp
   - Confidentiality notice
```

#### Key Methods
- `generateReportPDF(reportData)` - Main method to generate PDF
- `generateHTMLContent(reportData)` - Creates HTML structure
- `generateWebPDF(htmlContent, filename)` - Web platform PDF (opens print dialog)
- `generateNativePDF(htmlContent, filename)` - Native platform PDF (saves to file)
- `sharePDF(filePath)` - Shares PDF on native platforms
- `createMailtoLinkWithAttachment(email, subject, body, pdfPath)` - Creates mailto link with attachment note

### 3. Reports Screen Updates (`app/(tabs)/rapports.tsx`)

#### New Imports
- `pdfService` - For PDF generation
- `visitService` - For linking to visits

#### Modified Functions

##### `handleSaveModifications()`
**New Feature**: Links report modifications to related visit
- When a report is modified, the changes are appended to the related visit's notes
- Format: `[Modification du {timestamp}]\n{modified content}`
- Gracefully handles cases where visit doesn't exist
- Updates both report and visit in database

**Flow**:
1. Update report content in database
2. Check if report has a visitId
3. If yes, fetch the visit
4. Append modification note to visit's notes field
5. Save visit with updated notes
6. Show success message

##### `handleSendReport()`
**New Feature**: Generates PDF with photos before sending email
- Fetches photos from related visit
- Generates PDF with all report data and photos
- Opens mail app with PDF attachment note

**Flow**:
1. Show "Generating PDF" alert
2. If report has visitId, fetch visit photos
3. Create PDF data object with all report info and photos
4. Call `pdfService.generateReportPDF()` to create PDF
5. Update report status to "envoye" in database
6. Create email body with PDF attachment notice
7. Open mail app with pre-filled content

##### `loadReports()`
**Update**: Now includes `visitId` in report data
- Maps backend reports to include `visitId` field
- Enables linking between reports and visits

### 4. Visit Screen Updates (`app/(tabs)/visite.tsx`)

#### New Imports
- `pdfService` - For PDF generation
- `expo-linking` - For opening mail app

#### Modified Function

##### `sendReport()`
**New Feature**: Generates PDF with photos before sending email

**Flow**:
1. Validate conformity percentage from photo analyses
2. Save visit to backend with all photos and analyses
3. Create report in backend linked to the visit
4. Map photos with S3 URLs or local URIs
5. Create PDF data object with all information
6. Show "Generating PDF" alert
7. Call `pdfService.generateReportPDF()` to create PDF
8. Create email body with PDF attachment notice
9. Open mail app with pre-filled content
10. Show success alert

**Email Content**:
- To: Admin email or mission contact email
- Subject: "Rapport de visite - {Mission Title}"
- Body: Mission details, conformity %, photo count, and PDF attachment notice

### 5. Report-Visit Linking in Database

#### When Report is Modified
1. Report content is updated in the `reports` table
2. Modification is logged in the related visit's `notes` field
3. Visit record maintains complete history of report changes

#### Data Flow
```
User modifies report
    ↓
Update report.content in DB
    ↓
If report.visitId exists
    ↓
Fetch visit from DB
    ↓
Append modification to visit.notes
    ↓
Save updated visit to DB
```

#### Example Visit Note After Modification
```
Original notes: Visite effectuée pour Construction Centre Commercial

[Modification du 24/10/2025 14:30:00]
Rapport mis à jour avec les nouvelles observations concernant...
```

## Technical Details

### PDF Structure
- **Format**: HTML to PDF conversion
- **Styling**: Inline CSS with professional design
- **Images**: Embedded as base64 or direct URLs
- **Page Breaks**: Automatic with `page-break-inside: avoid`
- **Font**: Arial for cross-platform compatibility

### Email Integration
- Uses `mailto:` protocol
- Pre-fills recipient, subject, and body
- Includes note about PDF attachment
- Works with default mail app on all platforms

### Error Handling
- Graceful fallback if visit doesn't exist
- Console logging for debugging
- User-friendly alerts for all operations
- Non-blocking visit update (doesn't fail if visit can't be updated)

## Platform Compatibility

### Web
- Opens browser print dialog for PDF generation
- User can save as PDF or print directly

### iOS/Android
- Generates PDF file in app's document directory
- Can share PDF via native sharing dialog
- Opens default mail app with attachment capability

## User Experience Flow

### Scenario 1: Sending Report from Reports Page
1. User views report in modal
2. User clicks "Envoyer" button
3. System shows "Generating PDF" alert
4. System fetches related visit photos (if available)
5. PDF is generated with all content and images
6. Mail app opens with pre-filled email
7. User adds PDF attachment manually
8. User sends email

### Scenario 2: Modifying Report
1. User clicks "Modifier" button
2. Edit modal opens with current content
3. User edits report content
4. User clicks "Enregistrer"
5. Report is updated in database
6. If related visit exists, modification is logged in visit notes
7. Success message shown
8. Reports list refreshes

### Scenario 3: Sending Report from Visit Page
1. User completes visit with photos
2. User validates all photos
3. User clicks "Envoyer" button
4. System saves visit and creates report
5. System shows "Generating PDF" alert
6. PDF is generated with all photos and analyses
7. Mail app opens with pre-filled email
8. User adds PDF attachment manually
9. User sends email
10. Success message shown

## Benefits

1. **Professional Documentation**: PDF reports look professional with proper formatting and embedded images
2. **Complete Audit Trail**: All modifications are tracked in related visit records
3. **Offline Capability**: Reports can be generated and saved locally
4. **Easy Sharing**: One-click to open mail app with all details pre-filled
5. **Data Integrity**: Links between reports and visits are maintained
6. **User-Friendly**: Simple workflow with clear feedback at each step

## Future Enhancements

Potential improvements:
1. Automatic PDF attachment in email (requires native module)
2. PDF preview before sending
3. Custom PDF templates
4. Multiple photo layouts in PDF
5. Digital signatures on PDF reports
6. Cloud storage integration for PDFs
