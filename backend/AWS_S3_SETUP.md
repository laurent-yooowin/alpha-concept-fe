# AWS S3 Upload Configuration

This document explains how the file upload system is configured to work with AWS S3.

## Overview

The application uses AWS S3 for storing uploaded files (images, PDFs, CSVs, etc.). Files are uploaded through the backend API which handles the S3 integration securely.

## S3 Configuration

### Access Point
- **ARN**: `arn:aws:s3:eu-central-1:219590715499:accesspoint/alpha-concept-access-point`
- **Bucket Name**: `alpha-concept-access-point`
- **Region**: `eu-central-1` (Europe - Frankfurt)

### Environment Variables

Add the following environment variables to your `/backend/.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=eu-central-1
AWS_BUCKET_NAME=alpha-concept-access-point
```

**Important**: Never commit these credentials to version control!

## API Endpoints

### 1. Upload Single File
**POST** `/api/upload/single`

Upload a single file.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` (File)

**Response:**
```json
{
  "success": true,
  "message": "Fichier uploadé avec succès",
  "data": {
    "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/uploads/uuid.jpg",
    "key": "uploads/uuid.jpg"
  }
}
```

### 2. Upload Multiple Files
**POST** `/api/upload/multiple`

Upload multiple files at once (max 10).

**Request:**
- Content-Type: `multipart/form-data`
- Body: `files[]` (Array of Files)

**Response:**
```json
{
  "success": true,
  "message": "5 fichier(s) uploadé(s) avec succès",
  "data": [
    {
      "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/uploads/uuid1.jpg",
      "key": "uploads/uuid1.jpg"
    },
    {
      "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/uploads/uuid2.jpg",
      "key": "uploads/uuid2.jpg"
    }
  ]
}
```

### 3. Upload Visit Photos
**POST** `/api/upload/visit-photos`

Upload photos for a visit (max 20).

**Request:**
- Content-Type: `multipart/form-data`
- Body: `photos[]` (Array of Image Files)

**Response:**
```json
{
  "success": true,
  "message": "3 photo(s) uploadée(s) avec succès",
  "data": [
    {
      "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/visits/photos/uuid1.jpg",
      "key": "visits/photos/uuid1.jpg"
    }
  ]
}
```

## File Restrictions

### Allowed File Types
- Images: JPEG, PNG, WebP
- Documents: PDF
- Spreadsheets: CSV, Excel (XLS, XLSX)

### File Size Limit
- Maximum: **10MB** per file

## S3 Folder Structure

Files are organized in the following folders:

```
alpha-concept-access-point/
├── uploads/              # General file uploads
│   └── {uuid}.{ext}
└── visits/
    └── photos/           # Visit photos
        └── {uuid}.jpg
```

## Security

### Authentication
All upload endpoints require JWT authentication. Users must be logged in to upload files.

### File Validation
- File type validation (MIME type checking)
- File size validation (max 10MB)
- Secure filename generation using UUIDs

### Public Access
Files are uploaded with `public-read` ACL, making them accessible via their public URLs.

## Frontend Integration

### Using the Upload Service

```typescript
import { uploadService } from '@/services/uploadService';

// Upload single file
const result = await uploadService.uploadSingleFile(blob, 'document.pdf');
console.log(result.url); // S3 public URL

// Upload multiple files
const results = await uploadService.uploadMultipleFiles([blob1, blob2]);

// Upload visit photos
const photoResults = await uploadService.uploadVisitPhotos([blob1, blob2, blob3]);
```

### Storing URLs in Database

When creating a visit, the photo URLs from S3 are stored in the database:

```typescript
const visitData = {
  missionId: '...',
  visitDate: new Date().toISOString(),
  photos: visitPhotos.map(result => ({
    id: generateId(),
    uri: result.url,        // S3 public URL
    s3Key: result.key,      // S3 key for deletion
    analysis: { ... },
    validated: false
  })),
  photoCount: visitPhotos.length,
  notes: '...'
};

await visitService.createVisit(visitData);
```

## Error Handling

Common errors and how to handle them:

### 400 Bad Request
- No file provided
- Invalid file type
- File too large

### 401 Unauthorized
- Missing or invalid JWT token

### 500 Internal Server Error
- S3 upload failed
- AWS credentials missing or invalid

## Testing

### Test Upload with cURL

```bash
curl -X POST http://localhost:3000/api/upload/single \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/image.jpg"
```

### Test Visit Photos Upload

```bash
curl -X POST http://localhost:3000/api/upload/visit-photos \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "photos=@/path/to/photo1.jpg" \
  -F "photos=@/path/to/photo2.jpg"
```

## Troubleshooting

### Upload fails with "Access Denied"
- Check AWS credentials in `.env`
- Verify S3 bucket permissions
- Ensure access point has correct policies

### Files not accessible via URL
- Check bucket ACL settings
- Verify `public-read` permission is set
- Check CORS configuration on S3 bucket

### "Invalid file type" error
- Check the allowed MIME types in `upload.service.ts`
- Ensure file extension matches content type

## Dependencies

The upload system uses the following npm packages:

```json
{
  "@aws-sdk/client-s3": "^3.609.0",
  "@aws-sdk/s3-request-presigner": "^3.609.0",
  "multer": "^1.4.5-lts.1",
  "uuid": "^9.0.1"
}
```

## Production Deployment

Before deploying to production:

1. ✅ Set production AWS credentials in environment variables
2. ✅ Configure proper IAM policies for S3 access
3. ✅ Set up CloudFront CDN for better performance (optional)
4. ✅ Enable S3 bucket versioning for file recovery
5. ✅ Set up S3 lifecycle policies for old file cleanup
6. ✅ Configure CORS on S3 bucket for web uploads

## Support

For issues related to AWS S3 configuration, contact your DevOps team or refer to:
- [AWS S3 Documentation](https://docs.aws.amazon.com/s3/)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/)
