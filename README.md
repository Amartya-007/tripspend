# TripSpend

## Short Overview

TripSpend has evolved from a simple trip expense logger into a mobile-first group trip finance system.

It now covers the full trip lifecycle:

- plan setup (budget, dates, members, categories)
- daily expense capture (with safety checks)
- analytics and insights
- final settlement with proof and history

The app is offline-first by default, with optional Firebase-backed sync and collaboration.

## Features

### Core Trip Workflow

- Guided setup with validation for people count, budget limits, and trip date range
- Dashboard with remaining budget, burn rate, daily limit, and overspend alerts
- Add, edit, view, delete, and undo-delete expenses
- Lock previous days option to prevent editing older expense dates

### Expense Entry and Organization

- Expense fields: amount, category, date, note, tags, payer, participants
- Receipt attachments with image compression and resizing before save
- Duplicate warning for near-identical expenses within a short time window
- Large-expense confirmation when crossing daily-limit heuristics
- Voice-assisted expense capture (native and web speech recognition paths)
- Smart category hints from notes/OCR text
- Custom split mode (per-person split amounts), not only equal split
- Quick-add presets with favorites for frequent entries

### Search, Filters, and Sorting

- Full-text search across note, category, payer, tags, and amount
- Filters: category, person, date range, min/max amount
- Sorting: newest, oldest, highest amount

### Members, Categories, and Settlements

- Member management with rename, soft-delete, and restore
- Category management (custom categories per trip)
- Settlement recommendations (who pays whom)
- Mark settled and undo settlement
- Settlement proof metadata (image and note)
- Settlement audit log screen with action history

### Sharing and Reports

- Text summary sharing
- Summary image card for native share flows
- Trip closing PDF report
- JSON export/import backup

### Onboarding and Notifications

- First-run onboarding flow
- Notification permission gate before main usage
- Smart reminders for daily expense and pending settlements
- Native notifications on mobile with browser notification fallback on web

### Collaboration

- Shared trip mode with invite/join flow
- 12-digit invite code support in trip switcher
- Real-time sync for shared trips when Firebase is enabled

## Firebase (Checked Against Codebase)

TripSpend currently supports two Firebase data modes:

1. Shared collaborative mode

- Firestore path family: `trips/{tripId}`
- Subcollections used: `expenses`, `settlements`, `settlementHistory`
- Membership-based access control and creator-restricted operations

1. Personal cloud backup mode (legacy/solo)

- Firestore path family: `users/{userId}/trips/{tripId}`
- Expense subcollection under each trip
- Used for manual backup/restore and incremental sync when not in collaborative mode

Current repository status:

- Firestore rules file: `firestore.rules`
- Firebase config points to that rules file in `firebase.json`
- Web env-based Firebase initialization in `src/lib/firebase.ts`
- Auth hook checks readiness and gracefully disables auth when config is missing

Required environment variables (see `.env.example`):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (optional for analytics use)
- `GEMINI_API_KEY` (server-only; never prefix with `VITE_`)
- `FIREBASE_SERVICE_ACCOUNT_KEY` (server-only Admin SDK service-account JSON for authenticated AI requests)

## Deep Technical Details

### Architecture and Storage

- React 19 + TypeScript + Vite frontend
- Capacitor mobile runtime (Android project included)
- Local-first storage layers:
  - compressed localStorage cache (lz-string)
  - IndexedDB primary persistence
- Cloud path via Firestore when enabled

### Sync Strategy

- Incremental cloud sync for changed expenses
- Conflict handling using metadata/timestamp merge logic
- Retry queue with exponential backoff
- Tombstone-style deletion tracking to avoid resurrecting deleted records
- Local-first writes, then async cloud reconciliation

### Data Safety and Guardrails

- Setup validation for invalid budgets/dates/member counts
- Expense date window checks against trip period
- Lock-past-days protection
- Duplicate detection and high-spend confirmations
- Storage-pressure handling to preserve core data when receipts are large

### Notifications and Reminder Delivery

- Capacitor Push + Local notifications on native platforms
- Browser Notification fallback on web
- Deduped reminders to avoid repeat-spam behavior
- Device token lifecycle handling (register, refresh, cleanup)

### AI and OCR

- OCR support via Tesseract.js for receipt text extraction
- Optional AI categorization using Gemini model `gemini-2.5-flash`

## Local Development

Prerequisites:

- Node.js 18+
- npm

Install:

```bash
npm install
```

Run:

```bash
npm run dev
```

Quality/build:

```bash
npm run lint
npm run build
```

Optional env setup:

```bash
cp .env.example .env.local
```

The development server authenticates `/api/categorize-expense` with Firebase ID tokens. Configure server-only `GEMINI_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_KEY` before using AI categorization; do not put either value in browser-exposed variables.

## Android Build (Capacitor)

Build web assets and sync Android:

```bash
npm run build
npx cap sync android
```

Open in Android Studio:

```bash
npx cap open android
```

### Signed APK

This project is configured to read signing properties from `android/key.properties`.

1. Place release keystore at `android/app/tripspend-release.jks`
2. Create `android/key.properties` (do not commit)
3. Build release APK:

```bash
cd android
.\gradlew.bat clean assembleRelease
```

Final APK path:

- `android/app/build/outputs/apk/release/app-release.apk`

## Project Structure

```text
src/
  components/
  hooks/
  screens/
  services/
  utils/
android/
```

## Author

Amartya Vishwakarma
