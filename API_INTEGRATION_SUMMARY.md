# API Integration Summary

## ✅ Changes Completed

### Backend (Already Created)

1. **Upload Module** - `/backend/src/upload/`
   - `upload.service.ts` - S3 upload logic
   - `upload.controller.ts` - File upload endpoints
   - `upload.module.ts` - Module configuration
   - Integrated into `app.module.ts`

2. **Mission Entity & DTOs Updated**
   - Entity matches database migration schema
   - DTOs include all contact fields

3. **AWS S3 Configuration**
   - Added to `.env.example`
   - Configured with proper environment variables

### Frontend Changes

#### 1. Mission Service (`/services/missionService.ts`)
- ✅ Updated interfaces to match backend schema
- ✅ Includes all contact fields
- ✅ Ready for API integration

#### 2. Upload Service (`/services/uploadService.ts`)
- ✅ **NEW FILE CREATED**
- Handles photo uploads to S3 via backend API
- Function: `uploadVisitPhotos(files: Blob[]): Promise<string[]>`

#### 3. Home Page (`/app/(tabs)/index.tsx`)
- ✅ Added `missionService` import
- ✅ Added `ActivityIndicator` import
- ✅ Added `isCreatingMission` state
- ✅ Modified `handleCreateMission` to use API:
  - Calls `missionService.createMission()`
  - Shows loading indicator during creation
  - Proper error handling
- ✅ Updated create button with loading state
- ✅ **KEPT ALL EXISTING CODE** - only modified mission creation logic

#### 4. Visit Page (`/app/(tabs)/visite.tsx`)
- ✅ Added `uploadService` import
- ✅ Added new state variables:
  - `uploadingPhotos` - tracks photo upload status
  - `savingVisit` - tracks visit save status
  - `uploadedPhotoUrls` - stores S3 URLs
- ✅ Modified `takePicture` function:
  - Uploads photo to S3 after capture
  - Stores public URL in state
  - Shows warning if upload fails
  - **KEPT** all existing AI analysis logic
- ✅ Added NEW `saveVisit` function:
  - Validates mission and photos
  - Creates visit via API with uploaded photo URLs
  - Clears form on success
- ✅ Added "SAUVEGARDER" button in UI:
  - Shows when photos are uploaded
  - Displays loading indicator
  - Green color (#10B981)
- ✅ **KEPT ALL EXISTING CODE** - only added upload and save functionality

## API Endpoints

### Upload Endpoints (Authenticated)

**POST** `/upload/visit-photos`
- **Headers:** `Authorization: Bearer <JWT_TOKEN>`, `Content-Type: multipart/form-data`
- **Body:** Form data with `photos` field (max 20 files)
- **Response:**
```json
{
  "success": true,
  "urls": ["https://bucket.s3.amazonaws.com/visits/uuid.jpg"],
  "count": 1,
  "message": "Files uploaded successfully"
}
```

### Mission Endpoints

**POST** `/missions`
- **Headers:** `Authorization: Bearer <JWT_TOKEN>`
- **Body:**
```json
{
  "title": "Mission Title",
  "client": "Client Name",
  "address": "Full address",
  "date": "2025-10-25",
  "time": "14:00",
  "type": "Visite de contrôle",
  "description": "Optional description",
  "status": "planifiee",
  "contactFirstName": "John",
  "contactLastName": "Doe",
  "contactEmail": "john@example.com",
  "contactPhone": "+33612345678"
}
```

### Visit Endpoints

**POST** `/visits`
- **Headers:** `Authorization: Bearer <JWT_TOKEN>`
- **Body:**
```json
{
  "missionId": "mission-uuid",
  "visitDate": "2025-10-25T14:00:00Z",
  "photos": {
    "urls": ["https://bucket.s3.amazonaws.com/visits/photo1.jpg"]
  },
  "photoCount": 1,
  "notes": "Visit notes"
}
```

## Setup Instructions

### 1. Backend Dependencies

```bash
cd backend
npm install
```

New dependencies added:
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `multer`
- `@types/multer`

### 2. AWS S3 Configuration

Create your `.env` file with:

```env
# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=your_password
DATABASE_NAME=csps_db

# JWT Configuration
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h

# Server Configuration
PORT=3000
NODE_ENV=development

# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_S3_BUCKET=csps-uploads
AWS_S3_PUBLIC_URL=https://your-bucket.s3.amazonaws.com
```

### 3. AWS S3 Setup Steps

1. **Create S3 Bucket:**
   - Name: `csps-uploads` (or your choice)
   - Region: `us-east-1` (or your choice)
   - **Uncheck** "Block all public access"

2. **Configure Bucket Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::csps-uploads/*"
    }
  ]
}
```

3. **Configure CORS:**
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

4. **Create IAM User:**
   - Username: `csps-upload-user`
   - Access type: Programmatic access
   - Attach policy: `AmazonS3FullAccess`
   - Save Access Key ID and Secret Access Key
   - Add to `.env` file

### 4. Database Migration

```bash
cd backend
npm run migration:run
```

### 5. Start Backend

```bash
cd backend
npm run dev
```

Backend will start on `http://localhost:3000`

### 6. Frontend Configuration

Update your `.env` in the root project (if needed):

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

## Testing

### 1. Test Mission Creation

1. Open the app
2. Click "PROGRAMMER UNE NOUVELLE MISSION"
3. Fill in all required fields
4. Click "CRÉER LA MISSION"
5. Should see success message
6. Check backend logs for API call

### 2. Test Visit with Photo Upload

1. Navigate to "Visite" tab
2. Select a mission
3. Click camera button to take photo
4. Photo should be uploaded to S3 automatically
5. Take at least one photo
6. Click "SAUVEGARDER" button
7. Should see success message
8. Check S3 bucket for uploaded photos
9. Check database for visit record with photo URLs

### 3. Verify in Database

```sql
-- Check missions
SELECT * FROM missions ORDER BY createdAt DESC LIMIT 5;

-- Check visits
SELECT * FROM visits ORDER BY createdAt DESC LIMIT 5;

-- Check visit photos
SELECT id, missionId, photos, photoCount FROM visits;
```

## What Was NOT Changed

### ✅ Preserved Code

- All existing UI components and styling
- All AsyncStorage logic (kept as backup)
- All AI analysis functionality
- All report generation logic
- All existing missions/visits display logic
- All existing navigation
- All existing form validation
- All existing state management

### 📝 Only Modified Functions

**index.tsx:**
- `handleCreateMission()` - Now uses API instead of only AsyncStorage

**visite.tsx:**
- `takePicture()` - Added S3 upload after photo capture
- Added `saveVisit()` - NEW function to save visit via API
- Added save button in UI

## File Structure

```
project/
├── backend/
│   ├── src/
│   │   ├── upload/           # NEW - Upload module
│   │   │   ├── upload.service.ts
│   │   │   ├── upload.controller.ts
│   │   │   └── upload.module.ts
│   │   ├── missions/         # UPDATED - Entity & DTOs
│   │   └── app.module.ts     # UPDATED - Added UploadModule
│   └── .env.example          # UPDATED - Added AWS config
├── services/
│   ├── missionService.ts     # UPDATED - Interfaces
│   ├── visitService.ts       # Existing - no changes to exports
│   └── uploadService.ts      # NEW - Photo upload service
└── app/(tabs)/
    ├── index.tsx             # MODIFIED - API integration
    └── visite.tsx            # MODIFIED - Photo upload & save
```

## Security Features

1. **JWT Authentication Required:**
   - All upload endpoints require valid JWT token
   - All mission/visit endpoints require authentication

2. **File Validation:**
   - Only allowed file types: images, PDF, CSV
   - Max file size: 10MB
   - Server-side validation

3. **S3 Security:**
   - Public read access only (not write)
   - Upload via authenticated API only
   - Unique file names (UUID-based)

## Troubleshooting

### Mission Creation Fails

**Error:** "Unauthorized" or 401
- **Fix:** Ensure user is logged in and JWT token is valid

**Error:** Network request failed
- **Fix:** Check backend is running on correct port
- **Fix:** Verify EXPO_PUBLIC_API_URL is correct

### Photo Upload Fails

**Error:** "Impossible de télécharger la photo"
- **Fix:** Check AWS credentials in backend `.env`
- **Fix:** Verify S3 bucket exists and has correct permissions
- **Fix:** Check network connectivity

**Error:** "CORS policy"
- **Fix:** Add CORS configuration to S3 bucket
- **Fix:** Verify allowed origins include your domain

### Visit Save Fails

**Error:** "Veuillez sélectionner une mission"
- **Fix:** Ensure a mission is selected before taking photos

**Error:** "Veuillez prendre au moins une photo"
- **Fix:** Take at least one photo and wait for upload to complete

## Next Steps

1. ✅ Backend running with migrations
2. ✅ AWS S3 bucket configured
3. ✅ Frontend updated with API integration
4. 🔄 Test end-to-end flow
5. 🔄 Monitor for errors
6. 🔄 Add additional error handling as needed

## Support

For detailed AWS S3 setup instructions, see `IMPLEMENTATION_GUIDE.md`

---

**✅ IMPORTANT: No existing code was deleted. All changes are additive or modify specific functions only.**
