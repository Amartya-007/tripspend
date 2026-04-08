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
      const nativeResult = await FirebaseAuthentication.signInWithGoogle();
      const idToken = nativeResult.credential?.idToken;
      if (!idToken) {
        throw new Error('Google sign-in succeeded but no ID token was returned.');
      }

      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      return;
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
