import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence,
  signInWithCredential,
  GoogleAuthProvider,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, googleProvider, isFirebaseReady } from '../lib/firebase';

const NATIVE_SIGN_IN_RETRY_DELAY_MS = 700;

const sleep = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

const isTransientNoCredentialError = (error: unknown) => {
  const message = (error as { message?: string })?.message?.toLowerCase() || '';
  const code = (error as { code?: string })?.code?.toLowerCase() || '';
  return (
    message.includes('no credentials')
    || message.includes('credential is not available')
    || code.includes('no_credentials')
  );
};

export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isConfigured = Boolean(isFirebaseReady && auth);

  useEffect(() => {
    if (!isConfigured || !auth) {
      setLoading(false);
      return;
    }

    setPersistence(auth, browserLocalPersistence).catch(() => {
      // Ignore persistence errors and continue.
    });

    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return () => unsub();
  }, [isConfigured]);

  const signInWithGoogle = useCallback(async () => {
    if (!isConfigured || !auth) {
      throw new Error('Firebase is not configured.');
    }

    if (Capacitor.isNativePlatform()) {
      let lastError: unknown;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const nativeResult = await FirebaseAuthentication.signInWithGoogle();
          const idToken = nativeResult.credential?.idToken || null;
          const accessToken = nativeResult.credential?.accessToken || null;

          if (!idToken && !accessToken) {
            throw new Error('Google sign-in succeeded but no credentials were returned.');
          }

          const credential = GoogleAuthProvider.credential(idToken, accessToken);
          await signInWithCredential(auth, credential);
          return;
        } catch (error) {
          lastError = error;
          const shouldRetry = attempt === 0 && isTransientNoCredentialError(error);
          if (!shouldRetry) {
            throw error;
          }
          await sleep(NATIVE_SIGN_IN_RETRY_DELAY_MS);
        }
      }

      throw lastError;
    }

    await signInWithPopup(auth, googleProvider);
  }, [isConfigured]);

  const logout = useCallback(async () => {
    if (!auth) return;
    await signOut(auth);
  }, []);

  return useMemo(
    () => ({
      user,
      loading,
      signInWithGoogle,
      logout,
      isConfigured,
    }),
    [user, loading, signInWithGoogle, logout, isConfigured]
  );
}
