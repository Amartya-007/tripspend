import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: appletConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: appletConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: appletConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: appletConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: appletConfig.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: appletConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: appletConfig.measurementId || import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const databaseId = appletConfig.firestoreDatabaseId || '(default)';

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

