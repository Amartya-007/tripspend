import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { Expense, Trip, TripData, TripSetup } from '../utils/calculations';
import { firestore } from '../lib/firebase';
import { QuickAddPreset } from './useTripData';

const ACTIVE_SHARED_TRIP_KEY = 'tripspend_active_shared_trip';
const PRESETS_KEY = 'tripspend_presets';

type FirestoreRecord = Record<string, unknown>;

const nowIso = () => new Date().toISOString();

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
};

const toIso = (value: unknown): string => {
  if (!value) return nowIso();
  if (typeof value === 'string') return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return nowIso();
};

const toExpense = (expenseId: string, payload: FirestoreRecord): Expense | null => {
  const amount = Number(payload.amount);
  const category = payload.category;
  const date = payload.date;
  const paidBy = (payload.payerId || payload.paidBy) as string | undefined;

  if (!Number.isFinite(amount) || typeof category !== 'string' || typeof date !== 'string' || !paidBy) {
    return null;
  }

  const participants = Array.isArray(payload.participantIds)
    ? payload.participantIds.filter((id): id is string => typeof id === 'string')
    : Array.isArray(payload.participants)
      ? payload.participants.filter((id): id is string => typeof id === 'string')
      : [];

  return {
    id: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : expenseId,
    amount,
    category,
    date,
    paidBy,
    participants,
    note: typeof payload.note === 'string' ? payload.note : undefined,
    splitType: payload.splitType === 'custom' ? 'custom' : 'equal',
    splitMap: typeof payload.splitMap === 'object' && payload.splitMap !== null ? payload.splitMap as Record<string, number> : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: toIso(payload.createdAt),
    updatedAt: toIso(payload.updatedAt),
    createdBy: typeof payload.createdBy === 'string' ? payload.createdBy : undefined,
  } as Expense & { createdBy?: string };
};

const buildTrip = (
  tripId: string,
  tripPayload: FirestoreRecord,
  expenses: Expense[]
): Trip => ({
  id: tripId,
  name: typeof tripPayload.name === 'string' ? tripPayload.name : 'Trip',
  createdAt: toIso(tripPayload.createdAt),
  updatedAt: toIso(tripPayload.updatedAt),
  data: {
    setup: (tripPayload.setup as TripSetup) || null,
    deletedExpenseMap: {},
    expenses: [...expenses].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || nowIso()) - Date.parse(a.updatedAt || a.createdAt || nowIso())),
  },
});

interface UseCollaborativeTripDataInput {
  userUid: string | null;
  enabled: boolean;
  onRemoteUpdate?: (tripId: string) => void;
}

export function useCollaborativeTripData({ userUid, enabled, onRemoteUpdate }: UseCollaborativeTripDataInput) {
  const [tripDocs, setTripDocs] = useState<Record<string, FirestoreRecord>>({});
  const [expensesByTrip, setExpensesByTrip] = useState<Record<string, Expense[]>>({});
  const [activeTrip, setActiveTrip] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_SHARED_TRIP_KEY);
    } catch {
      return null;
    }
  });
  const [lastDeletedExpense, setLastDeletedExpense] = useState<Expense | null>(null);
  const [presets, setPresets] = useState<QuickAddPreset[]>(() => readJson<QuickAddPreset[]>(PRESETS_KEY, []));

  // Track whether the initial snapshot has been received per trip (to avoid false "remote update" on first load)
  const initialSnapshotReceivedRef = useRef<Set<string>>(new Set());
  const expensesUnsubMapRef = useRef<Map<string, () => void>>(new Map());
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  useEffect(() => { onRemoteUpdateRef.current = onRemoteUpdate; }, [onRemoteUpdate]);

  useEffect(() => {
    writeJson(PRESETS_KEY, presets);
  }, [presets]);

  useEffect(() => {
    if (!enabled || !userUid || !firestore) {
      expensesUnsubMapRef.current.forEach((unsubscribe) => unsubscribe());
      expensesUnsubMapRef.current.clear();
      initialSnapshotReceivedRef.current.clear();
      setTripDocs({});
      setExpensesByTrip({});
      return;
    }

    const db = firestore;

    const tripsQuery = query(collection(db, 'trips'), where('members', 'array-contains', userUid));
    const unsubscribeTrips = onSnapshot(tripsQuery, (snapshot) => {
      const nextTripDocs: Record<string, FirestoreRecord> = {};
      const activeTripIds = new Set<string>();

      snapshot.docs.forEach((tripDoc) => {
        nextTripDocs[tripDoc.id] = tripDoc.data() as FirestoreRecord;
        activeTripIds.add(tripDoc.id);
      });

      setTripDocs(nextTripDocs);

      // Start listeners for new trips.
      for (const tripId of activeTripIds) {
        if (expensesUnsubMapRef.current.has(tripId)) continue;

        const expensesQuery = query(collection(db, 'trips', tripId, 'expenses'));
        const unsubscribeExpenses = onSnapshot(expensesQuery, (expensesSnap) => {
          const expenses: Expense[] = [];
          expensesSnap.docs.forEach((expenseDoc) => {
            const parsed = toExpense(expenseDoc.id, expenseDoc.data() as FirestoreRecord);
            if (parsed) expenses.push(parsed);
          });

          // Fire remote-update callback only after the initial snapshot is received
          // and only for changes that came from the server (not local writes)
          if (initialSnapshotReceivedRef.current.has(tripId)) {
            const hasServerChange = expensesSnap.docChanges().some(
              (change) => change.type !== 'removed' && change.doc.metadata.hasPendingWrites === false
            );
            if (hasServerChange) {
              onRemoteUpdateRef.current?.(tripId);
            }
          } else {
            initialSnapshotReceivedRef.current.add(tripId);
          }

          setExpensesByTrip((prev) => ({
            ...prev,
            [tripId]: expenses,
          }));
        });

        expensesUnsubMapRef.current.set(tripId, unsubscribeExpenses);
      }

      // Remove listeners for removed trips.
      expensesUnsubMapRef.current.forEach((unsubscribe, tripId) => {
        if (activeTripIds.has(tripId)) return;
        unsubscribe();
        expensesUnsubMapRef.current.delete(tripId);
        setExpensesByTrip((prev) => {
          const next = { ...prev };
          delete next[tripId];
          return next;
        });
      });

      setActiveTrip((prev) => {
        if (prev && activeTripIds.has(prev)) return prev;
        const first = snapshot.docs[0]?.id || null;
        if (first) {
          try {
            localStorage.setItem(ACTIVE_SHARED_TRIP_KEY, first);
          } catch {
            // Ignore persistence failures.
          }
        }
        return first;
      });
    });

    return () => {
      unsubscribeTrips();
      expensesUnsubMapRef.current.forEach((unsubscribe) => unsubscribe());
      expensesUnsubMapRef.current.clear();
    };
  }, [enabled, userUid]);

  useEffect(() => {
    try {
      if (activeTrip) localStorage.setItem(ACTIVE_SHARED_TRIP_KEY, activeTrip);
      else localStorage.removeItem(ACTIVE_SHARED_TRIP_KEY);
    } catch {
      // Ignore persistence failures.
    }
  }, [activeTrip]);

  const trips = useMemo(() => Object.entries(tripDocs)
    .map(([tripId, payload]) => buildTrip(tripId, payload, expensesByTrip[tripId] || []))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)), [tripDocs, expensesByTrip]);

  // identityMap: uid → participantName for the active trip
  const identityMap = useMemo<Record<string, string>>(() => {
    if (!activeTrip || !tripDocs[activeTrip]) return {};
    const raw = tripDocs[activeTrip].identityMap;
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, string>;
  }, [activeTrip, tripDocs]);

  // The participant name claimed by the current user in the active trip
  const myParticipantName = useMemo(() => {
    if (!userUid) return null;
    return identityMap[userUid] ?? null;
  }, [identityMap, userUid]);

  const data: TripData = useMemo(() => {
    if (!activeTrip) return { setup: null, expenses: [] };
    const active = trips.find((trip) => trip.id === activeTrip);
    return active?.data ?? { setup: null, expenses: [] };
  }, [activeTrip, trips]);

  const activeTripDocRef = useMemo(() => {
    if (!firestore || !activeTrip) return null;
    return doc(firestore, 'trips', activeTrip);
  }, [activeTrip]);

  const saveSetup = useCallback(async (setup: TripSetup) => {
    if (!enabled || !firestore || !userUid) return;

    try {
      if (activeTripDocRef) {
        const now = nowIso();

        // Optimistically update local collaborative cache so UI can proceed immediately.
        setTripDocs((prev) => {
          const existing = prev[activeTripDocRef.id] || {};
          return {
            ...prev,
            [activeTripDocRef.id]: {
              ...existing,
              setup,
              updatedAt: now,
            },
          };
        });

        await updateDoc(activeTripDocRef, {
          setup,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      // First setup in collaborative mode: create a starter shared trip and persist setup.
      const tripRef = await addDoc(collection(firestore, 'trips'), {
        name: 'My Trip',
        createdBy: userUid,
        members: [userUid],
        setup,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const now = nowIso();
      setTripDocs((prev) => ({
        ...prev,
        [tripRef.id]: {
          name: 'My Trip',
          createdBy: userUid,
          members: [userUid],
          setup,
          createdAt: now,
          updatedAt: now,
        },
      }));
      setExpensesByTrip((prev) => ({
        ...prev,
        [tripRef.id]: prev[tripRef.id] || [],
      }));

      setActiveTrip(tripRef.id);
    } catch (error) {
      console.error('Failed to save shared trip setup', error);
    }
  }, [activeTripDocRef, enabled, userUid]);

  const addExpense = useCallback(async (expense: Expense) => {
    if (!enabled || !firestore || !activeTrip || !userUid) return;
    const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
    const expenseDoc = doc(expensesRef, expense.id);

    try {
      await setDoc(expenseDoc, {
        id: expense.id,
        amount: expense.amount,
        category: expense.category,
        payerId: expense.paidBy,
        participantIds: expense.participants || [],
        date: expense.date,
        note: expense.note || null,
        tags: expense.tags || [],
        splitType: expense.splitType || 'equal',
        splitMap: expense.splitMap || null,
        createdBy: userUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await updateDoc(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });
      setLastDeletedExpense(null);
    } catch (error) {
      console.error('Failed to add shared expense', error);
    }
  }, [activeTrip, enabled, userUid]);

  const updateExpense = useCallback(async (updatedExpense: Expense) => {
    if (!enabled || !firestore || !activeTrip) return;
    const expenseRef = doc(firestore, 'trips', activeTrip, 'expenses', updatedExpense.id);

    try {
      await updateDoc(expenseRef, {
        amount: updatedExpense.amount,
        category: updatedExpense.category,
        payerId: updatedExpense.paidBy,
        participantIds: updatedExpense.participants || [],
        date: updatedExpense.date,
        note: updatedExpense.note || null,
        tags: updatedExpense.tags || [],
        splitType: updatedExpense.splitType || 'equal',
        splitMap: updatedExpense.splitMap || null,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('Failed to update shared expense', error);
    }
  }, [activeTrip, enabled]);

  const deleteExpense = useCallback(async (expenseId: string) => {
    if (!enabled || !firestore || !activeTrip) return;

    const currentExpense = (expensesByTrip[activeTrip] || []).find((expense) => expense.id === expenseId) || null;
    if (currentExpense) setLastDeletedExpense(currentExpense);

    try {
      await deleteDoc(doc(firestore, 'trips', activeTrip, 'expenses', expenseId));
      await updateDoc(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('Failed to delete shared expense', error);
    }
  }, [activeTrip, enabled, expensesByTrip]);

  const undoDeleteExpense = useCallback(async () => {
    if (!lastDeletedExpense) return;
    await addExpense(lastDeletedExpense);
  }, [addExpense, lastDeletedExpense]);

  const clearUndoDelete = useCallback(() => {
    setLastDeletedExpense(null);
  }, []);

  const resetTrip = useCallback(async () => {
    if (!enabled || !firestore || !activeTrip) return;

    try {
      const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
      const snap = await getDocs(expensesRef);
      const batch = writeBatch(firestore);

      snap.docs.forEach((expenseDoc) => batch.delete(expenseDoc.ref));
      batch.update(doc(firestore, 'trips', activeTrip), {
        setup: null,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (error) {
      console.error('Failed to reset shared trip', error);
    }
  }, [activeTrip, enabled]);

  const toggleLock = useCallback(async (locked: boolean) => {
    if (!data.setup) return;
    await saveSetup({ ...data.setup, lockPreviousDays: locked });
  }, [data.setup, saveSetup]);

  const restoreData = useCallback(async (setup: TripSetup, expenses: Expense[]) => {
    if (!enabled || !firestore || !activeTrip || !userUid) return;

    try {
      const tripRef = doc(firestore, 'trips', activeTrip);
      const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
      const existing = await getDocs(expensesRef);
      const batch = writeBatch(firestore);

      existing.docs.forEach((expenseDoc) => batch.delete(expenseDoc.ref));

      expenses.forEach((expense) => {
        const expenseRef = doc(expensesRef, expense.id);
        batch.set(expenseRef, {
          id: expense.id,
          amount: expense.amount,
          category: expense.category,
          payerId: expense.paidBy,
          participantIds: expense.participants || [],
          date: expense.date,
          note: expense.note || null,
          tags: expense.tags || [],
          splitType: expense.splitType || 'equal',
          splitMap: expense.splitMap || null,
          createdBy: userUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });

      batch.update(tripRef, {
        setup,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (error) {
      console.error('Failed to restore shared trip data', error);
    }
  }, [activeTrip, enabled, userUid]);

  const createTrip = useCallback(async (name: string, initialSetup?: TripSetup) => {
    if (!enabled || !firestore || !userUid) return null;

    try {
      const tripRef = await addDoc(collection(firestore, 'trips'), {
        name,
        createdBy: userUid,
        members: [userUid],
        setup: initialSetup || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setActiveTrip(tripRef.id);
      return tripRef.id;
    } catch (error) {
      console.error('Failed to create shared trip', error);
      return null;
    }
  }, [enabled, userUid]);

  const importLocalTrips = useCallback(async (localTrips: Trip[], preferredActiveTripId: string | null) => {
    if (!enabled || !firestore || !userUid) return false;
    if (!Array.isArray(localTrips) || localTrips.length === 0) return false;

    try {
      // If user already has shared trips, do not auto-duplicate imported data.
      const existingShared = await getDocs(query(collection(firestore, 'trips'), where('members', 'array-contains', userUid)));
      if (!existingShared.empty) {
        return false;
      }

      const idMap = new Map<string, string>();

      for (let i = 0; i < localTrips.length; i += 1) {
        const localTrip = localTrips[i];
        const tripRef = await addDoc(collection(firestore, 'trips'), {
          name: localTrip.name,
          createdBy: userUid,
          members: [userUid],
          setup: localTrip.data.setup || null,
          createdAt: localTrip.createdAt || nowIso(),
          updatedAt: localTrip.updatedAt || localTrip.createdAt || nowIso(),
        });

        idMap.set(localTrip.id, tripRef.id);

        const expenses = localTrip.data.expenses || [];
        if (expenses.length === 0) continue;

        const batch = writeBatch(firestore);
        const expensesRef = collection(firestore, 'trips', tripRef.id, 'expenses');

        for (let j = 0; j < expenses.length; j += 1) {
          const expense = expenses[j];
          const expenseRef = doc(expensesRef, expense.id);
          batch.set(expenseRef, {
            id: expense.id,
            amount: expense.amount,
            category: expense.category,
            payerId: expense.paidBy,
            participantIds: expense.participants || [],
            date: expense.date,
            note: expense.note || null,
            tags: expense.tags || [],
            splitType: expense.splitType || 'equal',
            splitMap: expense.splitMap || null,
            createdBy: userUid,
            createdAt: expense.createdAt || nowIso(),
            updatedAt: expense.updatedAt || expense.createdAt || nowIso(),
          }, { merge: true });
        }

        await batch.commit();
      }

      if (preferredActiveTripId && idMap.has(preferredActiveTripId)) {
        setActiveTrip(idMap.get(preferredActiveTripId) || null);
      }

      return true;
    } catch (error) {
      console.error('Failed to import local trips into shared trips', error);
      return false;
    }
  }, [enabled, userUid]);

  const joinTrip = useCallback(async (tripId: string) => {
    if (!enabled || !firestore || !userUid) return false;
    const cleaned = tripId.trim();
    if (!cleaned) return false;

    try {
      const tripRef = doc(firestore, 'trips', cleaned);
      const tripSnap = await getDoc(tripRef);
      if (!tripSnap.exists()) return false;

      await updateDoc(tripRef, {
        members: arrayUnion(userUid),
        updatedAt: serverTimestamp(),
      });

      setActiveTrip(cleaned);
      return true;
    } catch (error) {
      console.error('Failed to join shared trip', error);
      return false;
    }
  }, [enabled, userUid]);

  // Claim a participant slot: writes uid → participantName mapping into the trip doc
  const claimParticipantIdentity = useCallback(async (tripId: string, participantName: string) => {
    if (!enabled || !firestore || !userUid) return false;
    try {
      const tripRef = doc(firestore, 'trips', tripId);
      await updateDoc(tripRef, {
        [`identityMap.${userUid}`]: participantName,
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (error) {
      console.error('Failed to claim participant identity', error);
      return false;
    }
  }, [enabled, userUid]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!enabled || !firestore) return;

    try {
      const expensesRef = collection(firestore, 'trips', tripId, 'expenses');
      const snap = await getDocs(expensesRef);
      const batch = writeBatch(firestore);

      snap.docs.forEach((expenseDoc) => batch.delete(expenseDoc.ref));
      batch.delete(doc(firestore, 'trips', tripId));
      await batch.commit();

      setActiveTrip((prev) => (prev === tripId ? null : prev));
    } catch (error) {
      console.error('Failed to delete shared trip', error);
    }
  }, [enabled]);

  const renameTrip = useCallback(async (tripId: string, newName: string) => {
    if (!enabled || !firestore) return;
    try {
      await updateDoc(doc(firestore, 'trips', tripId), {
        name: newName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to rename shared trip', error);
    }
  }, [enabled]);

  const setActiveTripId = useCallback((tripId: string | null) => {
    setActiveTrip(tripId);
  }, []);

  const getTrips = useCallback(() => trips, [trips]);

  const getActiveTripName = useCallback(() => (
    trips.find((trip) => trip.id === activeTrip)?.name || 'Unknown Trip'
  ), [activeTrip, trips]);

  const mergeTripFromSync = useCallback(() => {
    // No-op in real-time mode. Listeners are the source of truth.
  }, []);

  const addPreset = useCallback((preset: Omit<QuickAddPreset, 'id'>) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    setPresets((prev) => [...prev, { ...preset, id }]);
  }, []);

  const updatePreset = useCallback((id: string, preset: Omit<QuickAddPreset, 'id'>) => {
    setPresets((prev) => prev.map((item) => (item.id === id ? { ...preset, id } : item)));
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const togglePresetFavorite = useCallback((id: string) => {
    setPresets((prev) => prev.map((item) => (item.id === id ? { ...item, isFavorite: !item.isFavorite } : item)));
  }, []);

  return {
    data,
    presets,
    saveSetup,
    addExpense,
    updateExpense,
    deleteExpense,
    undoDeleteExpense,
    clearUndoDelete,
    canUndoDelete: Boolean(lastDeletedExpense),
    resetTrip,
    toggleLock,
    restoreData,
    addPreset,
    updatePreset,
    deletePreset,
    togglePresetFavorite,
    trips,
    activeTrip,
    createTrip,
    importLocalTrips,
    joinTrip,
    claimParticipantIdentity,
    identityMap,
    myParticipantName,
    deleteTrip,
    renameTrip,
    setActiveTripId,
    getTrips,
    getActiveTripName,
    mergeTripFromSync,
  };
}
