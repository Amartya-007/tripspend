import { getDatabase, ref, set, get, push, update, remove } from 'firebase/database';
import { Trip, TripData } from '../utils/calculations';
import { firebaseApp } from '../lib/firebase';

// Ensure the firebaseApp exists; if not, throw so callers see an actionable error
const db = () => {
  if (!firebaseApp) throw new Error('Firebase app not configured. Set up firebase.config in lib/firebase.');
  return getDatabase(firebaseApp);
};

const sanitize = (v: unknown): unknown => {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, sanitize(val)])
    );
  }
  return v;
};

export const saveTripToRealtime = async (uid: string, trip: Trip | TripData): Promise<void> => {
  const tripId = (trip as any).id;
  const path = `users/${uid}/trips/${tripId}`;
  await set(ref(db(), path), sanitize(trip));
};

export const loadAllTripsFromRealtime = async (uid: string): Promise<Trip[]> => {
  const snap = await get(ref(db(), `users/${uid}/trips`));
  const val = snap.val();
  if (!val) return [];
  return Object.keys(val).map((k) => ({ ...(val[k] as any), id: k } as Trip));
};

export const syncTripIncrementalRealtime = async (uid: string, localTrip: Trip): Promise<any> => {
  // Basic incremental sync: just overwrite the remote trip for now.
  await saveTripToRealtime(uid, localTrip);
  return { mergedTrip: localTrip, pushedExpenses: localTrip.data.expenses.length, pulledExpenses: 0, deletedRemoteExpenses: 0, lastAttemptAt: Date.now(), success: true };
};
