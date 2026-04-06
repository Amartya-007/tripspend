# TripSpend

A mobile-first group trip expense tracker built with React + Capacitor. Track shared spending, split costs, scan receipts, and get smart budget insights — all offline, no account needed.

## Features

- **Budget tracking** — set per-person budget, monitor burn rate and daily limits
- **Smart expense entry** — voice input, receipt camera/OCR, AI categorization (Gemini)
- **Group splits** — track who paid, split equally or custom amounts, settlement calculator
- **Analytics** — category breakdown, daily spending trends, deficit projections
- **Receipt management** — attach multiple photos per expense with auto-compression
- **Backup & restore** — export/import JSON, share summary image card
- **Offline-first** — everything stored locally, no backend required
- **Android app** — built with Capacitor, native camera, share, and voice support

## Tech Stack

- React 19 + TypeScript
- Capacitor 8 (Android)
- Tailwind CSS 4
- Vite 6
- Tesseract.js (OCR)
- Google Gemini API (optional AI categorization)

## Getting Started

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the env file and optionally add your Gemini API key:
   ```bash
   cp .env.example .env.local
   ```
   > `VITE_GEMINI_API_KEY` is optional. Without it, AI categorization is disabled but everything else works.

3. Run the dev server:
   ```bash
   npm run dev
   ```

## Android Build

Make sure you have Android Studio and the Android SDK installed.

```bash
# Build the web app
npm run build

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_GEMINI_API_KEY` | No | Enables AI-powered receipt categorization via Gemini 2.5 Flash |

## Project Structure

```
src/
├── screens/        # All app screens (Dashboard, AddExpense, Analytics, etc.)
├── components/     # Shared components (BottomNav)
├── hooks/          # useTripData — state management + localStorage persistence
└── utils/          # calculations, AI categorization, helpers
android/            # Capacitor Android project
```

## Made by Amartya Vishwakarma
