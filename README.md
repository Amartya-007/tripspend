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

## Tech stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Motion (animations)
- Capacitor 8 (Android)
- Capacitor plugins: App, Camera, Filesystem, Share
- Tesseract.js (OCR)
- Optional Gemini categorization via API key

## Data and privacy

- No backend is required for core usage.
- Data is persisted in localStorage.
- If storage pressure happens, receipt image payloads may be stripped to preserve core trip data.

## Firebase setup (Google login + cloud sync)

TripSpend now supports:

- Firebase Auth (Google sign-in)
- Firestore backup/restore for active trip data
- Firebase Storage is optional for future receipt upload support

1) In Firebase Console (project: `tripSpend`)

- Go to Authentication -> Sign-in method -> enable `Google` provider
- Go to Firestore Database -> create database in production or test mode
- For Android app support:
   - Add Android app in Project settings
   - Package name should match your Capacitor app id
   - Add SHA-1 and SHA-256 from your signing/debug keystore
   - Download `google-services.json` (keep for native plugin setup if needed later)

2) Configure web env vars

- Copy `.env.example` to `.env.local`
- Fill these values from Firebase Project settings -> General -> Your apps (Web app):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

3) Firestore rules (minimum)

Use owner-only rules for trip data:

```txt
rules_version = '2';
service cloud.firestore {
   match /databases/{database}/documents {
      match /users/{userId}/trips/{tripId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
      }
   }
}
```

4) Use it in app

- Open Settings -> Cloud Sync (Firebase)
- Sign in with Google
- Tap `Backup to Cloud` to push local setup+expenses
- Tap `Restore from Cloud` to pull latest backup

Notes:

- Current cloud sync stores `setup` + `expenses` in Firestore doc:
   - `users/{uid}/trips/active`
- Local storage remains primary; cloud sync is manual backup/restore.

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

1) Keystore location

- Place release keystore at android/app/tripspend-release.jks

2) Create android/key.properties (local file, do not commit)

Example:

```properties
storeFile=app/tripspend-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=tripspend-key
keyPassword=YOUR_KEY_PASSWORD
```

3) Build signed release APK

```bash
cd android
.\gradlew.bat clean assembleRelease
```

4) Final APK path

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
