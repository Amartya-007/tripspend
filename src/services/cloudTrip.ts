import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { TripData } from '../utils/calculations';
import { firestore } from '../lib/firebase';

const ACTIVE_TRIP_DOC_ID = 'active';

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

export const saveTripToCloud = async (uid: string, data: TripData): Promise<void> => {
  if (!firestore) throw new Error('Firestore is not configured.');

  const ref = doc(firestore, 'users', uid, 'trips', ACTIVE_TRIP_DOC_ID);
  await setDoc(
    ref,
    {
      data: sanitizeForFirestore(data),
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    },
    { merge: true }
  );
};

export const loadTripFromCloud = async (uid: string): Promise<TripData | null> => {
  if (!firestore) throw new Error('Firestore is not configured.');

  const ref = doc(firestore, 'users', uid, 'trips', ACTIVE_TRIP_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const payload = snap.data()?.data;
  if (!isTripDataShape(payload)) return null;
  return payload;
};
