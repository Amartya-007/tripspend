import { useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseReady } from '../lib/firebase';

export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseReady || !auth) {
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
  }, []);

  const signInWithGoogle = async () => {
    if (!isFirebaseReady || !auth) {
      throw new Error('Firebase is not configured.');
    }

    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  return useMemo(
    () => ({
      user,
      loading,
      signInWithGoogle,
      logout,
      isConfigured: isFirebaseReady,
    }),
    [user, loading]
  );
}
