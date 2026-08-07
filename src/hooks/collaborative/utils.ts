import { Timestamp, doc, runTransaction, type Firestore, type DocumentReference } from 'firebase/firestore';

export type FirestoreRecord = Record<string, unknown>;

export const ACTIVE_SHARED_TRIP_KEY = 'tripspend_active_shared_trip';
export const PRESETS_KEY = 'tripspend_presets';
export const ACTIVE_TRIP_PRESERVE_MS = 6000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const inviteExpiry = () => new Date(Date.now() + INVITE_TTL_MS);

export const isPermissionDeniedError = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message?.toLowerCase() || '';
  return code === 'permission-denied' || message.includes('insufficient permissions');
};

export const nowIso = () => new Date().toISOString();

export const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
};

export const toIso = (value: unknown): string => {
  if (!value) return nowIso();
  if (typeof value === 'string') return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return nowIso();
};

export const generateShortCode = (): string => {
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint8Array(6);
    crypto.getRandomValues(values);
    for (let i = 0; i < 6; i++) {
      result += String(values[i] % 10);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      result += Math.floor(Math.random() * 10).toString();
    }
  }
  return result;
};

const TRIP_CODE_MAX_ATTEMPTS = 10;

/**
 * Creates a new /trips/{code} document under a fresh, collision-checked
 * 6-digit invite code. Generates a candidate code, verifies (inside a
 * transaction) that no trip already owns it, and writes `data` there.
 * Retries on collision up to TRIP_CODE_MAX_ATTEMPTS times.
 *
 * Shared by every trip-creation path (manual setup save, named create,
 * bulk local-trip import) so the retry/collision logic only lives once.
 */
export const createUniqueTripDoc = async (
  db: Firestore,
  data: FirestoreRecord,
): Promise<DocumentReference> => {
  for (let attempt = 0; attempt < TRIP_CODE_MAX_ATTEMPTS; attempt += 1) {
    const candidateRef = doc(db, 'trips', generateShortCode());
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(candidateRef);
        if (snap.exists()) throw new Error('COLLISION');
        transaction.set(candidateRef, data);
      });
      return candidateRef;
    } catch (e: any) {
      if (e.message !== 'COLLISION') throw e;
    }
  }
  throw new Error('Failed to generate a unique 6-digit invite code after multiple attempts');
};

/**
 * Standard onSnapshot(...) error handler: logs the failure, and — for
 * permission-denied errors specifically — flips cloudAccessDenied so the UI
 * can show the right fallback. Shared by every collection listener
 * (trips, expenses, ...) so the logging/detection logic only lives once.
 */
export const logSnapshotError = (
  label: string,
  error: unknown,
  setCloudAccessDenied: (denied: boolean) => void,
) => {
  const errCode = (error as { code?: string })?.code || 'unknown';
  console.error(`[TripSpend] ${label} listener error (${errCode}):`, error);
  if (isPermissionDeniedError(error)) {
    console.warn(`[TripSpend] Permission denied on ${label.toLowerCase()} — setting cloudAccessDenied`);
    setCloudAccessDenied(true);
  }
};
