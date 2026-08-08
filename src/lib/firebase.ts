import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, doc, getDocFromServer } from 'firebase/firestore';
import { getDatabase, type Database } from 'firebase/database';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  // Only needed for Realtime Database — Firestore doesn't use this.
  // Find it in Firebase Console -> Realtime Database -> the URL shown above your data tree.
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)';

const hasFirebaseConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
].every(Boolean);

const firebaseApp = hasFirebaseConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const firestore = (() => {
  if (!firebaseApp) return null;
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache(),
    }, databaseId);
  } catch {
    return getFirestore(firebaseApp, databaseId);
  }
})();

export const db = firestore;

const storage = firebaseApp ? getStorage(firebaseApp) : null;

// Realtime Database. This is a separate Firebase product from Firestore and
// requires its own instance to be created in the Firebase Console first
// (Build -> Realtime Database -> Create Database), plus VITE_FIREBASE_DATABASE_URL
// set to that instance's URL. `rtdb` stays null until both exist, so callers
// must check for null rather than assume it's configured just because
// Firestore is.
export const rtdb: Database | null = (() => {
  if (!firebaseApp || !firebaseConfig.databaseURL) return null;
  try {
    return getDatabase(firebaseApp);
  } catch {
    return null;
  }
})();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const isFirebaseReady = Boolean(firebaseApp && auth && firestore);

async function testConnection() {
  try {
    if (firestore) {
      await getDocFromServer(doc(firestore, 'test', 'connection'));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
