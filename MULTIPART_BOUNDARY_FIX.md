# Multipart Boundary Error Fix

## Problem

Getting error when uploading files to `/api/upload/visit-photos`:

```json
{
    "message": "Multipart: Boundary not found",
    "error": "Bad Request",
    "statusCode": 400
}
```

## Root Cause

The issue was in the API service (`/services/api.ts`). The problem occurred because:

1. **Content-Type was hardcoded**: The API service was always setting `Content-Type: application/json` for all requests
2. **FormData was being stringified**: The `api.post()` method was calling `JSON.stringify()` on FormData objects
3. **Manual Content-Type header**: The upload service was manually setting `Content-Type: multipart/form-data` without the boundary parameter

### Why This Causes an Error

When uploading files with multipart/form-data:
- The browser/client must automatically set the `Content-Type` header
- The header includes a boundary parameter: `Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...`
- This boundary is used to separate different parts of the multipart request
- If you manually set `Content-Type: multipart/form-data` without the boundary, the server can't parse the request

## Solution

### 1. Updated API Service (`/services/api.ts`)

**Changed the `apiRequest` function to detect FormData:**

```typescript
// Check if body is FormData
const isFormData = options.body instanceof FormData;

const headers: Record<string, string> = {
  // Don't set Content-Type for FormData - browser will set it with boundary
  ...(!isFormData && { 'Content-Type': 'application/json' }),
  ...options.headers as Record<string, string>,
};

// Remove Content-Type if it was explicitly set to multipart/form-data
if (headers['Content-Type']?.includes('multipart/form-data')) {
  delete headers['Content-Type'];
}
```

**Updated `api.post()` and `api.put()` to not stringify FormData:**

```typescript
post: <T>(endpoint: string, body?: any, options?: RequestInit) =>
  apiRequest<T>(endpoint, {
    ...options,
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body),
  }),
```

### 2. Updated Upload Service (`/services/uploadService.ts`)

**Removed manual Content-Type headers:**

```typescript
// Before (WRONG)
const response = await api.post<UploadResponse>('/upload/visit-photos', formData, {
  headers: {
    'Content-Type': 'multipart/form-data',  // ❌ Missing boundary!
  },
});

// After (CORRECT)
const response = await api.post<UploadResponse>('/upload/visit-photos', formData);
// Browser automatically sets: Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...
```

### 3. Updated Upload Module (`/backend/src/upload/upload.module.ts`)

**Added explicit memory storage configuration:**

```typescript
import { memoryStorage } from 'multer';

MulterModule.register({
  storage: memoryStorage(),  // Store files in memory
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 20,                   // Max 20 files
  },
})
```

## How It Works Now

### Request Flow

1. **Frontend creates FormData:**
   ```typescript
   const formData = new FormData();
   formData.append('photos', blob, 'photo.jpg');
   ```

2. **API service detects FormData:**
   ```typescript
   const isFormData = options.body instanceof FormData;
   // Don't set Content-Type for FormData
   ```

3. **Browser sets proper Content-Type with boundary:**
   ```
   Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryXYZ123
   Authorization: Bearer <token>
   ```

4. **Backend receives and parses:**
   ```typescript
   @Post('visit-photos')
   @UseInterceptors(FilesInterceptor('photos', 20))
   async uploadVisitPhotos(@UploadedFiles() photos: Express.Multer.File[])
   ```

5. **Multer extracts files using boundary:**
   - Parses multipart body using boundary
   - Extracts file buffers
   - Validates file types and sizes
   - Returns file array to controller

6. **Files uploaded to S3:**
   ```typescript
   const results = await this.uploadService.uploadMultipleFiles(photos, 'visits/photos');
   ```

## Testing

### Test the fix with cURL:

```bash
curl -X POST http://localhost:8096/api/upload/visit-photos \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "photos=@photo1.jpg" \
  -F "photos=@photo2.jpg"
```

### Expected Response:

```json
{
  "success": true,
  "message": "2 photo(s) uploadée(s) avec succès",
  "data": [
    {
      "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/visits/photos/uuid1.jpg",
      "key": "visits/photos/uuid1.jpg"
    },
    {
      "url": "https://alpha-concept-access-point.s3.eu-central-1.amazonaws.com/visits/photos/uuid2.jpg",
      "key": "visits/photos/uuid2.jpg"
    }
  ]
}
```

## Key Takeaways

✅ **DO**: Let the browser/client set Content-Type for FormData
✅ **DO**: Check if body is FormData before stringifying
✅ **DO**: Use memory storage for multer in NestJS
✅ **DO**: Configure proper file limits

❌ **DON'T**: Manually set `Content-Type: multipart/form-data`
❌ **DON'T**: Call `JSON.stringify()` on FormData
❌ **DON'T**: Set Content-Type header when uploading files

## Files Modified

1. `/services/api.ts` - Fixed FormData detection and Content-Type handling
2. `/services/uploadService.ts` - Removed manual Content-Type headers
3. `/backend/src/upload/upload.module.ts` - Added memory storage configuration

## Related Documentation

- [MDN: FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData)
- [MDN: multipart/form-data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type)
- [NestJS: File Upload](https://docs.nestjs.com/techniques/file-upload)
- [Multer Documentation](https://github.com/expressjs/multer)
