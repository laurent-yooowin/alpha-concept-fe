# Mobile Photo Upload Fix

## Problem

Photos upload successfully on web browsers but fail on mobile (iOS/Android) devices.

## Root Cause

React Native and web browsers handle file uploads differently:

### Web Browsers
- Files are represented as `Blob` objects
- FormData accepts `Blob` directly
- `fetch(uri).blob()` works to convert URIs to Blobs

### React Native (Mobile)
- Files are represented as local file system URIs (e.g., `file:///path/to/photo.jpg`)
- FormData on React Native expects file objects in a specific format
- `fetch(uri).blob()` doesn't work reliably on mobile for local file URIs
- FormData requires files as objects with `uri`, `type`, and `name` properties

## Solution

### 1. Updated Upload Service (`/services/uploadService.ts`)

**Added Platform Detection:**

```typescript
import { Platform } from 'react-native';
```

**Modified File Handling:**

```typescript
if (typeof file === 'string' && Platform.OS !== 'web') {
  // Mobile: file is a URI, append as object
  formData.append('photos', {
    uri: file,
    type: 'image/jpeg',
    name: fileName,
  } as any);
} else {
  // Web: file is a Blob, append directly
  formData.append('photos', file as Blob, fileName);
}
```

**Why This Works:**

- **On Mobile**: FormData on React Native expects file objects with URI, type, and name
- **On Web**: FormData expects Blob objects directly
- Platform detection ensures correct format for each environment

### 2. Updated Visit Page (`/app/(tabs)/visite.tsx`)

**Changed Photo Upload Logic:**

```typescript
let fileToUpload: Blob | string;

if (Platform.OS === 'web') {
  // Web: Use fetch to get blob
  const response = await fetch(photo.uri);
  fileToUpload = await response.blob();
} else {
  // Mobile: Pass URI directly, FormData will handle it
  fileToUpload = photo.uri;
}

const uploadResults = await uploadService.uploadVisitPhotos([fileToUpload]);
```

**Key Changes:**

- Web: Converts URI to Blob using `fetch().blob()`
- Mobile: Passes URI string directly
- Upload service handles platform-specific formatting

## How It Works Now

### Web Flow

1. **Camera captures photo** → Returns data URI or Blob URL
2. **Convert to Blob:**
   ```typescript
   const response = await fetch(photo.uri);
   const blob = await response.blob();
   ```
3. **Create FormData:**
   ```typescript
   formData.append('photos', blob, 'photo.jpg');
   ```
4. **Send to backend** → Multer receives Blob in request

### Mobile Flow

1. **Camera captures photo** → Returns file system URI (`file:///...`)
2. **Keep as URI string:**
   ```typescript
   const fileToUpload = photo.uri;
   ```
3. **Create FormData with object:**
   ```typescript
   formData.append('photos', {
     uri: photo.uri,
     type: 'image/jpeg',
     name: 'photo.jpg'
   });
   ```
4. **React Native converts to multipart** → Backend receives file data

## React Native FormData Format

On React Native, FormData expects file objects in this format:

```typescript
{
  uri: string;      // Local file system path
  type: string;     // MIME type
  name: string;     // Filename
}
```

Example:

```typescript
formData.append('photo', {
  uri: 'file:///var/mobile/Containers/Data/Application/.../photo.jpg',
  type: 'image/jpeg',
  name: 'photo_123456.jpg'
});
```

## Backend Compatibility

The backend (NestJS with Multer) is compatible with both formats:

- **Web**: Receives multipart/form-data with Blob
- **Mobile**: Receives multipart/form-data with file stream

Multer handles both transparently and provides the same `Express.Multer.File` interface.

## Supported Platforms

✅ **Web** (Chrome, Safari, Firefox, Edge)
- Uses standard Blob API
- FormData with Blob objects

✅ **iOS** (React Native)
- Uses file system URIs
- FormData with URI objects

✅ **Android** (React Native)
- Uses file system URIs
- FormData with URI objects

## Testing

### Test on Web
1. Open app in web browser
2. Go to visit page
3. Take a photo
4. Photo should upload to S3 successfully

### Test on iOS
1. Build iOS app: `npx expo run:ios`
2. Open app on device/simulator
3. Go to visit page
4. Take a photo
5. Photo should upload to S3 successfully

### Test on Android
1. Build Android app: `npx expo run:android`
2. Open app on device/emulator
3. Go to visit page
4. Take a photo
5. Photo should upload to S3 successfully

## Common Issues and Solutions

### Issue: "Network request failed" on mobile

**Cause**: App doesn't have internet permission

**Solution**: Check `app.json` for permissions:
```json
{
  "expo": {
    "android": {
      "permissions": ["INTERNET", "CAMERA"]
    },
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "App needs camera access",
        "NSPhotoLibraryUsageDescription": "App needs photo library access"
      }
    }
  }
}
```

### Issue: "Upload failed" with 400 error

**Cause**: FormData format incorrect for platform

**Solution**: Ensure Platform.OS detection is working:
```typescript
console.log('Platform:', Platform.OS);
console.log('File type:', typeof file);
```

### Issue: Photo displays locally but doesn't upload

**Cause**: API endpoint unreachable from mobile device

**Solution**:
- Ensure backend API URL is accessible from mobile
- Use device IP address instead of `localhost`
- Check CORS settings on backend

## API Configuration

### Environment Variables

Ensure `.env` file has correct API URL for mobile testing:

```env
# For development on mobile device
EXPO_PUBLIC_API_URL=http://192.168.1.100:8096/api

# For production
EXPO_PUBLIC_API_URL=https://api.yourapp.com/api
```

**Important**: Mobile devices can't access `localhost`. Use:
- Device IP address (e.g., `192.168.1.100`)
- Or backend hostname (e.g., `api.yourapp.com`)

## Files Modified

1. ✅ `/services/uploadService.ts`
   - Added Platform import
   - Added platform-specific FormData handling
   - Updated all upload methods

2. ✅ `/app/(tabs)/visite.tsx`
   - Updated photo upload logic
   - Added platform-specific file preparation
   - Maintained backward compatibility with web

## Type Definitions

```typescript
// Upload service accepts both Blob and URI string
type FileInput = Blob | string;

// React Native file object format
interface ReactNativeFile {
  uri: string;
  type: string;
  name: string;
}
```

## Key Takeaways

✅ **DO:**
- Use Platform.OS to detect environment
- Pass URI strings on mobile
- Convert to Blob on web
- Let FormData handle platform-specific formatting

❌ **DON'T:**
- Try to convert mobile URIs to Blobs with fetch()
- Use same approach for all platforms
- Assume FormData works identically everywhere
- Forget to test on actual devices

## Summary

The mobile upload fix ensures photos are uploaded correctly on both web and mobile platforms by:

1. ✅ Detecting platform (web vs mobile)
2. ✅ Using appropriate file format for each platform
3. ✅ Letting FormData handle platform-specific conversion
4. ✅ Maintaining single codebase for all platforms
5. ✅ Preserving full compatibility with backend API

**Photos now upload successfully on all platforms!** 📱💻
