# TripSpend

TripSpend is a mobile-first group trip expense tracker built with React, TypeScript, and Capacitor.

It helps a group set a trip budget, track expenses, split costs by participant, and settle dues with clear transfer suggestions. The app is offline-first and stores data locally on device.

## What the app does

- Guided trip setup (people count, participant names, budget per person, trip dates, categories)
- Dashboard with remaining budget, burn rate, daily limit, and overspend alerts
- Add/Edit expense flow with:
   - amount, category, date, note, tags
   - payer and participants
   - receipt attachments
   - camera capture (native on Android)
   - optional voice input and OCR helpers
- Expense list and detail views with delete + undo support
- Analytics screen with:
   - category breakdown
   - per-person contribution and balance
   - daily timeline and top expenses
   - trip health score and smart insights
- Settlement screen with who-pays-whom transfers and mark-as-settled tracking
- Member and category management screens
- Settings tools:
   - text summary share
   - summary image share card (native file share on mobile)
   - trip closing PDF report (totals, category chart, paid-by summary, settlements)
   - export/import JSON backup
   - full trip reset

## Tech Stack

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind CSS 4
- **UI Library**: Motion (animations), Framer Motion (transitions)
- **Mobile**: Capacitor 8 (Android) with plugins: App, Camera, Filesystem, Share
- **Cloud Sync**: Firebase Auth, Firestore (incremental sync with conflict resolution)
- **Local Storage**: 
  - localStorage with lz-string compression (~40-50% reduction)
  - IndexedDB as primary persistent layer
- **OCR & AI**: 
  - Tesseract.js (OCR for receipt scanning)
  - Optional Gemini API for smart expense categorization
- **PDF Export**: html2canvas + jsPDF for trip summary reports

## Data and Privacy

- **Offline-First**: No backend required for core usage. App works fully offline.
- **Local Storage Only by Default**: All data persists locally in compressed localStorage + IndexedDB on device.
- **Cloud Sync Optional**: Firebase integration is entirely opt-in via Settings.
- **Storage Pressure Handling**: If storage quota exceeded:
  - Receipt images automatically stripped to preserve core trip data
  - Data syncs to cloud via Firestore (if configured)
  - Large payloads are compressed with lz-string (~40-50% reduction)
- **Personal Data**: Only your device and your Firebase account (if enabled) store trip data. No third-party tracking.

## Cloud Sync & Storage

TripSpend now includes **enterprise-grade cloud sync** with offline support, conflict resolution, and automatic retries:

### Storage Architecture (3-Layer)

1. **Compressed localStorage** (~40-50% reduction via lz-string)
   - Fast cache layer for instant app startup
   - Reduced payload for low-bandwidth scenarios

2. **IndexedDB** (primary local storage)
   - Large-capacity persistent storage for full trip data
   - Auto-hydrates on app startup
   - Fallback from localStorage if needed

3. **Firestore** (cloud backup with incremental sync)
   - Per-trip documents with expense subcollections
   - Metadata-based conflict resolution (newest-wins)
   - Automatic retry queue with exponential backoff

### Sync Features

- **Incremental Sync**: Only changed expenses sync to cloud (efficient bandwidth)
- **Conflict Resolution**: Timestamps determine winner on conflicting edits
- **Offline Queue**: Automatic retry with backoff (15s → 37.5s → 93s → ... → 5min max)
- **Tombstone Deletion**: Soft-delete tracking prevents restore conflicts
- **Auto-Sync**: Queues sync on every edit, processes every 5 seconds
- **Fallback Mode**: If Firestore rules block subcollections, falls back to trip-document payload
- **Sync Status**: Real-time telemetry in Settings (last sync, pending changes, next retry countdown)

### Firebase Setup (Google login + cloud sync)

1. **In Firebase Console** (project: `tripSpend`)

- Go to Authentication → Sign-in method → enable `Google` provider
- Go to Firestore Database → create database (production or test mode)
- For Android app support:
   - Add Android app in Project settings
   - Package name should match your Capacitor app id
   - Add SHA-1 and SHA-256 from your signing/debug keystore
   - Download `google-services.json` for future reference

2. **Configure web environment variables**

- Copy `.env.example` to `.env.local`
- Fill these values from Firebase Project settings → General → Your apps (Web app):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

3. **Firestore Rules** (with incremental sync support)

Use owner-only rules with expenses subcollection:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(userId) {
      return request.auth != null && request.auth.uid == userId;
    }

    match /users/{userId}/trips/{tripId} {
      allow read, write: if isOwner(userId);
      
      match /expenses/{expenseId} {
        allow read, write: if isOwner(userId);
      }
    }
  }
}
```

4. **Use it in app**

- Open Settings → Cloud Sync (Firebase)
- Sign in with Google
- Tap `Backup to Cloud` to sync current trip (or auto-syncs on edits)
- Tap `Restore from Cloud` to load latest backup from cloud

### How It Works

- **Local Priority**: Data always saves locally first for instant feedback
- **Background Sync**: Changes automatically enqueue for cloud sync
- **Conflict Safety**: If two devices edit the same expense, the one with the newer timestamp wins
- **Deletion Tracking**: Deleted expenses are soft-deleted (tombstone) to prevent cloud conflicts
- **Retry Intelligence**: Failed syncs retry with exponential backoff; immediate retry on network reconnect

## Advanced Features

### Member Management

- **Edit Names**: Members screen allows renaming participants
- **Smart Name Mapping**: When you rename "Alice" to "Alicia", all historical expenses automatically update their payer/participant references
- **Reorder Handling**: Deleting or reordering members preserves expense history correctly
- **Prevent Data Loss**: Minimum 1 member required at all times

### In-App Notifications

- **Custom Notification Card**: Branded in-app alerts replacing system popups
- **4 Variants**: Success (synced), Error (failed), Info (no backup), Warning (sign in needed)
- **Auto-Dismiss**: 2.6s default with manual close button
- **Real-Time Updates**: Sync telemetry, import/export status, and errors via notifications

### Sync Status Telemetry

Settings → Cloud Sync shows real-time metrics:
- **Last Success**: When data last synced successfully to cloud
- **Last Attempt**: When sync was last attempted (success or failure)
- **Pending Changes**: Number of expenses waiting to sync
- **Next Retry**: Countdown to next auto-retry (if failed)

## Local development

Prerequisites:

- Node.js 18+
- npm

Install dependencies:

```bash
npm install
```

Optional environment setup (for AI categorization):

```bash
cp .env.example .env.local
```

Set this only if needed:

- VITE_GEMINI_API_KEY

Run the app locally:

```bash
npm run dev
```

Useful commands:

```bash
npm run lint
npm run build
```

## Android build (Capacitor)

Build web assets and sync Android project:

```bash
npm run build
npx cap sync android
```

Open Android project in Android Studio (optional):

```bash
npx cap open android
```

## Build a final signed APK to share

This project is already configured to read signing info from android/key.properties.

1. Keystore location

- Place release keystore at android/app/tripspend-release.jks

2. Create android/key.properties (local file, do not commit)

Example:

```properties
storeFile=app/tripspend-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=tripspend-key
keyPassword=YOUR_KEY_PASSWORD
```

3. Build signed release APK

```bash
cd android
.\gradlew.bat clean assembleRelease
```

4. Final APK path

- android/app/build/outputs/apk/release/app-release.apk

You can now share this APK directly.

## Project structure

```text
src/
   components/
   hooks/
   screens/
   utils/
android/
```

## Author

Amartya Vishwakarma
