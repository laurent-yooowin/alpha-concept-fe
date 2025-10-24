# Dependency Fix - lucide-react-native

## ✅ Issue Fixed

**Error:**
```
Unable to resolve "lucide-react-native" from "app/(tabs)/_layout.tsx"
```

**Cause:** The `lucide-react-native` package was not listed in `package.json` dependencies.

## Solution

Added `lucide-react-native` to the dependencies in `package.json`:

```json
{
  "dependencies": {
    ...
    "lucide-react-native": "^0.462.0"
  }
}
```

## Installation

Run the following command to install the missing dependency:

```bash
npm install
```

## What This Package Does

`lucide-react-native` provides beautiful, consistent icons used throughout the app:
- Navigation icons (Home, Camera, User, etc.)
- UI icons (Calendar, Clock, Plus, etc.)
- Status icons (Check, X, Alert, etc.)

## Files Using This Package

- `/app/(tabs)/_layout.tsx` - Tab bar icons
- `/app/(tabs)/index.tsx` - Mission form icons
- `/app/(tabs)/visite.tsx` - Camera and action icons
- `/app/(tabs)/missions.tsx` - Mission list icons
- `/app/(tabs)/profil.tsx` - Profile icons
- `/app/(tabs)/rapports.tsx` - Report icons

## No Other Changes

✅ No other files were modified
✅ No existing code was deleted
✅ Only added the missing dependency

---

**After running `npm install`, the app should start without errors.**
