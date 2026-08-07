import { getDatabase, ref, set, get, update } from 'firebase/database';
import { Trip, TripData } from '../utils/calculations';
import { firebaseApp } from '../lib/firebase';

const db = () => {
  if (!firebaseApp) throw new Error('Firebase app not configured. Set up firebase.config in lib/firebase.');
  return getDatabase(firebaseApp);
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
};

const sanitizeForRealtime = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(sanitizeForRealtime);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitizeForRealtime(v)])
    );
  }
  return value;
};

const toMillis = (value?: string | null): number => {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

type ExpenseItem = TripData['expenses'][number];

const toExpenseItem = (expenseId: string, value: unknown): ExpenseItem | null => {
  const raw = asRecord(value);
  if (!raw) return null;

  const amount = raw.amount as unknown;
  const category = raw.category as unknown;
  const date = raw.date as unknown;
  const paidBy = raw.paidBy as unknown;

  if (typeof amount !== 'number') return null;
  if (typeof category !== 'string') return null;
  if (typeof date !== 'string') return null;
  if (typeof paidBy !== 'string') return null;

  return {
    ...(raw as Partial<ExpenseItem>),
    id: typeof raw.id === 'string' && raw.id.length > 0 ? (raw.id as string) : expenseId,
    amount: amount as number,
    category: category as string,
    date: date as string,
    paidBy: paidBy as string,
  } as ExpenseItem;
};

const cloneTripData = (data: TripData): TripData => ({
  setup: data.setup,
  deletedExpenseMap: { ...(data.deletedExpenseMap || {}) },
  expenses: data.expenses.map((expense) => ({ ...expense })),
});

export interface SyncTripResult {
  mergedTrip: Trip;
  pushedExpenses: number;
  pulledExpenses: number;
  deletedRemoteExpenses: number;
  lastAttemptAt: number;
  success: boolean;
  error?: string;
}

export const saveTripToRealtime = async (uid: string, trip: Trip | TripData): Promise<void> => {
  const tripId = (trip as any).id;
  const path = `users/${uid}/trips/${tripId}/meta`;
  const meta = {
    id: (trip as any).id,
    name: (trip as any).name,
    setup: sanitizeForRealtime((trip as any).data?.setup || (trip as any).setup) as unknown,
    createdAt: (trip as any).createdAt,
    updatedAtIso: (trip as any).updatedAt || (trip as any).createdAt,
    schemaVersion: 3,
  };
  await set(ref(db(), path), meta);

  // write expenses as child nodes under /expenses/{expenseId}
  const expenses = ((trip as any).data && (trip as any).data.expenses) || [];
  const updates: Record<string, unknown> = {};
  for (const exp of expenses) {
    const id = exp.id;
    updates[`users/${uid}/trips/${tripId}/expenses/${id}`] = sanitizeForRealtime(exp);
  }
  if (Object.keys(updates).length > 0) {
    await update(ref(db()), updates);
  }
};

export const loadAllTripsFromRealtime = async (uid: string): Promise<Trip[]> => {
  const snap = await get(ref(db(), `users/${uid}/trips`));
  const val = snap.val();
  if (!val) return [];
  return Object.keys(val).map((k) => {
    const node = val[k] as any;
    const meta = node.meta || {};
    const expensesObj = node.expenses || {};
    const expenses = Object.keys(expensesObj).map((eid) => ({ ...(expensesObj[eid] as any), id: eid }));
    const trip: Trip = {
      id: k,
      name: meta.name || '',
      createdAt: meta.createdAt || '',
      updatedAt: meta.updatedAtIso || meta.createdAt || '',
      data: {
        setup: meta.setup || {},
        deletedExpenseMap: {},
        expenses: expenses,
      },
    } as Trip;
    return trip;
  });
};

export const syncTripIncrementalRealtime = async (uid: string, localTrip: Trip): Promise<SyncTripResult> => {
  const attemptAt = Date.now();
  try {
    const tripPath = `users/${uid}/trips/${localTrip.id}`;
    const remoteSnap = await get(ref(db(), tripPath));
    const remote = remoteSnap.val() as Record<string, any> | null;

    const localUpdatedMs = toMillis(localTrip.updatedAt || localTrip.createdAt);
    const remoteMeta = (remote && (remote.meta as Record<string, any>)) || null;
    const remoteUpdatedMs = toMillis((remoteMeta && (remoteMeta.updatedAtIso as string)) || null);

    const mergedTrip: Trip = {
      ...localTrip,
      data: cloneTripData(localTrip.data),
    };

    const updates: Record<string, unknown> = {};
    // If remote missing or local is newer, write meta
    if (!remote || localUpdatedMs >= remoteUpdatedMs) {
      updates[`${tripPath}/meta`] = {
        id: localTrip.id,
        name: localTrip.name,
        setup: sanitizeForRealtime(localTrip.data.setup),
        createdAt: localTrip.createdAt,
        updatedAtIso: localTrip.updatedAt || localTrip.createdAt,
        schemaVersion: 3,
      };
    } else {
      // remote wins for meta
      const remoteName = remoteMeta?.name as string | undefined;
      const remoteCreatedAt = remoteMeta?.createdAt as string | undefined;
      const remoteUpdatedAtIso = remoteMeta?.updatedAtIso as string | undefined;
      mergedTrip.name = remoteName || mergedTrip.name;
      mergedTrip.createdAt = remoteCreatedAt || mergedTrip.createdAt;
      mergedTrip.updatedAt = remoteUpdatedAtIso || mergedTrip.updatedAt;
      mergedTrip.data.setup = (remoteMeta?.setup as TripData['setup']) || mergedTrip.data.setup;
    }

    // load remote expenses map
    const remoteExpensesObj = (remote && remote.expenses) || {};
    const localMap = new Map<string, ExpenseItem>(mergedTrip.data.expenses.map((e) => [e.id, e]));
    const remoteMap = new Map<string, Record<string, unknown>>(
      Object.keys(remoteExpensesObj).map((k) => [k, remoteExpensesObj[k] as Record<string, unknown>])
    );
    const deletedMap = mergedTrip.data.deletedExpenseMap || {};

    let pushedExpenses = 0;
    let pulledExpenses = 0;
    let deletedRemoteExpenses = 0;

    // compare remote -> local
    for (const [remoteId, remoteRaw] of remoteMap.entries()) {
      const localExpense = localMap.get(remoteId);
      const remoteExpense = toExpenseItem(remoteId, remoteRaw);
      const tombstoneMs = toMillis(deletedMap[remoteId]);
      const remoteUpdated = toMillis(remoteExpense?.updatedAt || null);

      if (!remoteExpense) {
        if (localExpense) {
          updates[`${tripPath}/expenses/${remoteId}`] = sanitizeForRealtime(localExpense);
          pushedExpenses += 1;
        }
        continue;
      }

      if (tombstoneMs > 0 && tombstoneMs >= remoteUpdated) {
        updates[`${tripPath}/expenses/${remoteId}`] = null; // delete
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
        updates[`${tripPath}/expenses/${remoteId}`] = sanitizeForRealtime(localExpense);
        pushedExpenses += 1;
      } else {
        localMap.set(remoteId, remoteExpense);
        pulledExpenses += 1;
      }
    }

    // push local only expenses
    for (const [localId, localExpense] of localMap.entries()) {
      if (remoteMap.has(localId)) continue;
      if (deletedMap[localId]) continue;
      updates[`${tripPath}/expenses/${localId}`] = sanitizeForRealtime(localExpense);
      pushedExpenses += 1;
    }

    if (Object.keys(updates).length > 0) {
      await update(ref(db()), updates);
    }

    mergedTrip.data.expenses = Array.from(localMap.values()).sort(
      (a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt)
    );

    return {
      mergedTrip,
      pushedExpenses,
      pulledExpenses,
      deletedRemoteExpenses,
      lastAttemptAt: attemptAt,
      success: true,
    } as SyncTripResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown incremental sync error';
    console.error('Realtime incremental sync failed:', message);
    return {
      mergedTrip: localTrip,
      pushedExpenses: 0,
      pulledExpenses: 0,
      deletedRemoteExpenses: 0,
      lastAttemptAt: Date.now(),
      success: false,
      error: message,
    } as SyncTripResult;
  }
};