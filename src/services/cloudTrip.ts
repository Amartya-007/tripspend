import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { TripData, Trip } from '../utils/calculations';
import { firestore } from '../lib/firebase';

type ExpenseItem = TripData['expenses'][number];
type FirestoreMeta = Record<string, unknown>;

const requireFirestore = () => {
  if (!firestore) throw new Error('Firestore is not configured.');
  return firestore;
};

const tripDocRef = (uid: string, tripId: string) => doc(requireFirestore(), 'users', uid, 'trips', tripId);
const expensesColRef = (uid: string, tripId: string) => collection(requireFirestore(), 'users', uid, 'trips', tripId, 'expenses');
const expenseDocRef = (uid: string, tripId: string, expenseId: string) =>
  doc(requireFirestore(), 'users', uid, 'trips', tripId, 'expenses', expenseId);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
};

const sanitizeForFirestore = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
  }
  return value;
};

const isTripDataShape = (value: unknown): value is TripData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as TripData;
  return Array.isArray(candidate.expenses) && ('setup' in candidate);
};

const toExpenseItem = (expenseId: string, value: unknown): ExpenseItem | null => {
  const raw = asRecord(value);
  if (!raw) return null;

  const amount = raw.amount;
  const category = raw.category;
  const date = raw.date;
  const paidBy = raw.paidBy;

  if (typeof amount !== 'number') return null;
  if (typeof category !== 'string') return null;
  if (typeof date !== 'string') return null;
  if (typeof paidBy !== 'string') return null;

  return {
    ...(raw as Partial<ExpenseItem>),
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : expenseId,
    amount,
    category,
    date,
    paidBy,
  } as ExpenseItem;
};

export interface SyncTripResult {
  mergedTrip: Trip;
  pushedExpenses: number;
  pulledExpenses: number;
  deletedRemoteExpenses: number;
  lastAttemptAt: number;
  success: boolean;
  error?: string;
}

const toMillis = (value?: string | null): number => {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

const cloneTripData = (data: TripData): TripData => ({
  setup: data.setup,
  deletedExpenseMap: { ...(data.deletedExpenseMap || {}) },
  expenses: data.expenses.map((expense) => ({ ...expense })),
});

export const syncTripIncremental = async (uid: string, localTrip: Trip): Promise<SyncTripResult> => {
  const attemptAt = Date.now();
  const db = requireFirestore();
  const tripRef = tripDocRef(uid, localTrip.id);
  const remoteMetaSnap = await getDoc(tripRef);

  const localUpdatedMs = toMillis(localTrip.updatedAt || localTrip.createdAt);
  const remoteMeta = asRecord(remoteMetaSnap.data());
  const remoteUpdatedMs = toMillis((remoteMeta?.updatedAtIso as string | undefined) || null);

  const mergedTrip: Trip = {
    ...localTrip,
    data: cloneTripData(localTrip.data),
  };

  if (!remoteMetaSnap.exists() || localUpdatedMs >= remoteUpdatedMs) {
    await setDoc(
      tripRef,
      {
        id: localTrip.id,
        name: localTrip.name,
        setup: sanitizeForFirestore(localTrip.data.setup),
        createdAt: localTrip.createdAt,
        updatedAtIso: localTrip.updatedAt || localTrip.createdAt,
        updatedAt: serverTimestamp(),
        schemaVersion: 3,
      },
      { merge: true }
    );
  } else {
    const remote = remoteMeta;
    mergedTrip.name = (remote?.name as string) || mergedTrip.name;
    mergedTrip.createdAt = (remote?.createdAt as string) || mergedTrip.createdAt;
    mergedTrip.updatedAt = (remote?.updatedAtIso as string) || mergedTrip.updatedAt;
    mergedTrip.data.setup = (remote?.setup as TripData['setup']) || mergedTrip.data.setup;
  }

  let pushedExpenses = 0;
  let pulledExpenses = 0;
  let deletedRemoteExpenses = 0;

  try {
    const remoteExpensesSnap = await getDocs(expensesColRef(uid, localTrip.id));

    const localMap = new Map<string, ExpenseItem>(mergedTrip.data.expenses.map((expense) => [expense.id, expense]));
    const remoteMap = new Map<string, FirestoreMeta>(
      remoteExpensesSnap.docs.map((snap) => [snap.id, snap.data() as FirestoreMeta])
    );
    const deletedMap = mergedTrip.data.deletedExpenseMap || {};

    const batch = writeBatch(db);
    let hasBatchOps = false;

    for (const [remoteId, remoteRaw] of remoteMap.entries()) {
      const localExpense = localMap.get(remoteId);
      const remoteExpense = toExpenseItem(remoteId, remoteRaw);
      const tombstoneMs = toMillis(deletedMap[remoteId]);
      const remoteUpdated = toMillis(remoteExpense?.updatedAt || null);

      if (!remoteExpense) {
        if (localExpense) {
          batch.set(
            expenseDocRef(uid, localTrip.id, remoteId),
            sanitizeForFirestore(localExpense) as Record<string, unknown>,
            { merge: true }
          );
          hasBatchOps = true;
          pushedExpenses += 1;
        }
        continue;
      }

      if (tombstoneMs > 0 && tombstoneMs >= remoteUpdated) {
        batch.delete(expenseDocRef(uid, localTrip.id, remoteId));
        hasBatchOps = true;
        deletedRemoteExpenses += 1;
        localMap.delete(remoteId);
        continue;
      }

      if (!localExpense) {
        localMap.set(remoteId, remoteExpense);
        pulledExpenses += 1;
        continue;
      }

      const localUpdated = toMillis(localExpense.updatedAt || localExpense.createdAt);
      if (localUpdated >= remoteUpdated) {
        batch.set(
          expenseDocRef(uid, localTrip.id, remoteId),
          sanitizeForFirestore(localExpense) as Record<string, unknown>,
          { merge: true }
        );
        hasBatchOps = true;
        pushedExpenses += 1;
      } else {
        localMap.set(remoteId, remoteExpense);
        pulledExpenses += 1;
      }
    }

    for (const [localId, localExpense] of localMap.entries()) {
      if (remoteMap.has(localId)) continue;
      if (deletedMap[localId]) continue;

      batch.set(
        expenseDocRef(uid, localTrip.id, localId),
        sanitizeForFirestore(localExpense) as Record<string, unknown>,
        { merge: true }
      );
      hasBatchOps = true;
      pushedExpenses += 1;
    }

    if (hasBatchOps) {
      await batch.commit();
    }

    mergedTrip.data.expenses = Array.from(localMap.values()).sort(
      (a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt)
    );
  } catch (error) {
    // Compatibility fallback: if incremental subcollection sync cannot run (e.g., rules not updated),
    // write full data into trip document so sync still succeeds.
    await setDoc(
      tripRef,
      {
        name: mergedTrip.name,
        setup: sanitizeForFirestore(mergedTrip.data.setup),
        data: sanitizeForFirestore(mergedTrip.data),
        createdAt: mergedTrip.createdAt,
        updatedAtIso: mergedTrip.updatedAt || mergedTrip.createdAt,
        updatedAt: serverTimestamp(),
        schemaVersion: 3,
        syncFallback: true,
      },
      { merge: true }
    );
    pushedExpenses = mergedTrip.data.expenses.length;
    pulledExpenses = 0;
    deletedRemoteExpenses = 0;
    console.warn('Incremental sync fallback to trip document payload', error);
  }

  return {
    mergedTrip,
    pushedExpenses,
    pulledExpenses,
    deletedRemoteExpenses,
    lastAttemptAt: attemptAt,
    success: true,
  };
};

// Legacy support: Save single trip (backward compatibility)
const ACTIVE_TRIP_DOC_ID = 'active';

const normalizeTripInput = (trip: Trip | TripData): {
  tripId: string;
  data: TripData;
  name: string;
  createdAt: string;
  updatedAt: string;
} => {
  if ('id' in trip && 'name' in trip) {
    return {
      tripId: trip.id,
      data: trip.data,
      name: trip.name,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt || trip.createdAt,
    };
  }

  const now = new Date().toISOString();
  return {
    tripId: ACTIVE_TRIP_DOC_ID,
    data: trip,
    name: 'Trip',
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Save a single trip to Firestore
 */
export const saveTripToCloud = async (uid: string, trip: Trip | TripData): Promise<void> => {
  const db = requireFirestore();
  const { tripId, data, name, createdAt, updatedAt } = normalizeTripInput(trip);
  const ref = tripDocRef(uid, tripId);
  await setDoc(
    ref,
    {
      name,
      setup: sanitizeForFirestore(data.setup),
      createdAt,
      updatedAtIso: updatedAt,
      data: sanitizeForFirestore(data),
      updatedAt: serverTimestamp(),
      schemaVersion: 3,
    },
    { merge: true }
  );

  if (data.expenses.length === 0) return;

  const expensesBatch = writeBatch(db);
  for (const expense of data.expenses) {
    expensesBatch.set(
      expenseDocRef(uid, tripId, expense.id),
      sanitizeForFirestore(expense) as Record<string, unknown>,
      { merge: true }
    );
  }
  await expensesBatch.commit();
};

/**
 * Load all trips for a user
 */
export const loadAllTripsFromCloud = async (uid: string): Promise<Trip[]> => {
  const tripsRef = collection(requireFirestore(), 'users', uid, 'trips');
  const snap = await getDocs(tripsRef);

  const trips = await Promise.all(
    snap.docs.map(async (tripDoc) => {
      const payload = asRecord(tripDoc.data());
      let tripData = payload?.data as TripData | undefined;

      if (!tripData) {
        const expensesSnap = await getDocs(expensesColRef(uid, tripDoc.id));
        tripData = {
          setup: (payload?.setup as TripData['setup']) || null,
          deletedExpenseMap: {},
          expenses: expensesSnap.docs.map((expenseDoc) => expenseDoc.data() as ExpenseItem),
        };
      }

      if (!isTripDataShape(tripData)) return null;

      const now = new Date().toISOString();
      const createdAt = (payload?.createdAt as string) || now;
      const updatedAt = (payload?.updatedAtIso as string) || createdAt;

      return {
        id: tripDoc.id,
        name: (payload?.name as string) || tripDoc.id,
        createdAt,
        updatedAt,
        data: tripData,
      } as Trip;
    })
  );

  return trips
    .filter((trip): trip is Trip => trip !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

/**
 * Load a single trip by ID
 */
export const loadTripFromCloud = async (uid: string, tripId?: string): Promise<TripData | null> => {
  const targetTripId = tripId || ACTIVE_TRIP_DOC_ID;
  const ref = tripDocRef(uid, targetTripId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const payload = asRecord(snap.data());
  const embedded = payload?.data;
  if (isTripDataShape(embedded)) return embedded;

  const expensesSnap = await getDocs(expensesColRef(uid, targetTripId));
  return {
    setup: (payload?.setup as TripData['setup']) || null,
    deletedExpenseMap: {},
    expenses: expensesSnap.docs.map((expenseDoc) => expenseDoc.data() as ExpenseItem),
  };
};

/**
 * Delete a trip from the cloud (atomically deletes subcollection documents and parent doc)
 */
export const deleteTripFromCloud = async (uid: string, tripId: string): Promise<void> => {
  const db = requireFirestore();
  const ref = tripDocRef(uid, tripId);

  const expensesSnap = await getDocs(expensesColRef(uid, tripId));
  const batch = writeBatch(db);

  for (const expenseDoc of expensesSnap.docs) {
    batch.delete(expenseDoc.ref);
  }
  batch.delete(ref);

  await batch.commit();
};