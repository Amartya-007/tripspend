/**
 * Realtime Database mirror for shared trips.
 *
 * TripSpend's source of truth for shared/collaborative trips is Firestore
 * (see src/services/cloudTrip.ts and src/hooks/collaborative/). Everything
 * in this file writes the same trips/members/invites/logs shape into
 * Realtime Database *in parallel*, matching database.rules.json at the repo
 * root.
 *
 * These functions are best-effort mirrors, not a second source of truth:
 * every exported function catches its own errors, logs them, and resolves
 * to a boolean/null rather than throwing — a Realtime Database hiccup
 * (rules misconfigured, instance not provisioned yet, offline, quota) must
 * never break the real Firestore-backed trip flow that the rest of the app
 * depends on.
 *
 * Setup required before any of this works:
 *   1. Firebase Console -> Build -> Realtime Database -> Create Database
 *      (this is a separate product from Firestore; it does not exist just
 *      because Firestore is already set up).
 *   2. Set VITE_FIREBASE_DATABASE_URL to that instance's URL.
 *   3. `npm run deploy:rtdb-rules` to publish database.rules.json.
 */
import {
  ref,
  set,
  remove,
  push,
  update,
  get,
  onValue,
  off,
  serverTimestamp as rtdbServerTimestamp,
  type Unsubscribe,
} from 'firebase/database';
import { rtdb } from '../lib/firebase';

export interface RtdbMember {
  addedAt: number | object; // number once resolved; object while pending (ServerValue.TIMESTAMP)
  addedByInvite?: string;
}

export interface RtdbTripMeta {
  id: string;
  createdBy: string;
  createdAt: number | object;
  updatedAtIso: string;
}

export interface RtdbLogEntry {
  ts: number | object;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

const warn = (label: string, error: unknown) => {
  console.warn(`[realtimeTrip] ${label} failed (Firestore is unaffected):`, error);
};

/**
 * Mirrors trip creation: writes meta, then self-adds the creator as the
 * first member, then registers the invite code. Sequenced (not a single
 * multi-path update) because the members rule needs meta to already be
 * persisted before it will let the creator add themselves.
 *
 * Pass the same 6-digit code Firestore already generated for this trip
 * (see createUniqueTripDoc in hooks/collaborative/utils.ts) so the invite
 * code stays the same across both databases instead of inventing a second one.
 */
export const mirrorCreateSharedTrip = async (
  tripId: string,
  uid: string,
): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    await set(ref(rtdb, `trips/${tripId}/meta`), {
      id: tripId,
      createdBy: uid,
      createdAt: rtdbServerTimestamp(),
      updatedAtIso: new Date().toISOString(),
    });

    await set(ref(rtdb, `trips/${tripId}/members/${uid}`), {
      addedAt: rtdbServerTimestamp(),
    });

    await set(ref(rtdb, `public_trips/${tripId}`), {
      tripId,
      createdBy: uid,
      createdAt: rtdbServerTimestamp(),
    });

    await mirrorAppendLog(tripId, uid, 'trip_created');
    return true;
  } catch (error) {
    warn('mirrorCreateSharedTrip', error);
    return false;
  }
};

/**
 * Mirrors a member redeeming a 6-digit invite code. Rules verify server-side
 * that public_trips/{code}.tripId === tripId before allowing this write.
 */
export const mirrorJoinTrip = async (tripId: string, uid: string): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    await set(ref(rtdb, `trips/${tripId}/members/${uid}`), {
      addedAt: rtdbServerTimestamp(),
      addedByInvite: tripId,
    });
    await mirrorAppendLog(tripId, uid, 'member_joined');
    return true;
  } catch (error) {
    warn('mirrorJoinTrip', error);
    return false;
  }
};

/**
 * Mirrors removing a member. Per database.rules.json (matching the original
 * design notes), any existing member can remove any other member — this is
 * more permissive than the Firestore rules, where only the trip creator can.
 * Worth confirming that's actually the behavior you want before relying on it.
 */
export const mirrorRemoveMember = async (
  tripId: string,
  actorUid: string,
  memberUidToRemove: string,
): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    await remove(ref(rtdb, `trips/${tripId}/members/${memberUidToRemove}`));
    await mirrorAppendLog(tripId, actorUid, 'member_removed', { removedUid: memberUidToRemove });
    return true;
  } catch (error) {
    warn('mirrorRemoveMember', error);
    return false;
  }
};

/**
 * Appends an audit-log entry. Logs are append-only by rule — no update or
 * delete is ever allowed on an existing log entry once written.
 */
export const mirrorAppendLog = async (
  tripId: string,
  actor: string,
  action: string,
  details?: Record<string, unknown>,
): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    const logRef = push(ref(rtdb, `trips/${tripId}/logs`));
    const entry: RtdbLogEntry = { ts: rtdbServerTimestamp(), actor, action };
    if (details) entry.details = details;
    await set(logRef, entry);
    return true;
  } catch (error) {
    warn('mirrorAppendLog', error);
    return false;
  }
};

/** Mirrors an expense write into the shared trip's RTDB expense list. */
export const mirrorUpsertExpense = async (
  tripId: string,
  expenseId: string,
  expense: { amount: number; category: string; date: string; paidBy: string; [key: string]: unknown },
): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    await update(ref(rtdb, `trips/${tripId}/expenses/${expenseId}`), {
      ...expense,
      id: expenseId,
    });
    return true;
  } catch (error) {
    warn('mirrorUpsertExpense', error);
    return false;
  }
};

export const mirrorDeleteExpense = async (tripId: string, expenseId: string): Promise<boolean> => {
  if (!rtdb) return false;
  try {
    await remove(ref(rtdb, `trips/${tripId}/expenses/${expenseId}`));
    return true;
  } catch (error) {
    warn('mirrorDeleteExpense', error);
    return false;
  }
};

/** One-off read of a trip's members. Returns {} if RTDB isn't configured or the read fails. */
export const getTripMembers = async (tripId: string): Promise<Record<string, RtdbMember>> => {
  if (!rtdb) return {};
  try {
    const snap = await get(ref(rtdb, `trips/${tripId}/members`));
    return (snap.val() as Record<string, RtdbMember>) || {};
  } catch (error) {
    warn('getTripMembers', error);
    return {};
  }
};

/** Live subscription to a trip's members. Returns a no-op unsubscribe if RTDB isn't configured. */
export const subscribeToTripMembers = (
  tripId: string,
  callback: (members: Record<string, RtdbMember>) => void,
): Unsubscribe => {
  if (!rtdb) return () => {};
  const membersRef = ref(rtdb, `trips/${tripId}/members`);
  onValue(membersRef, (snap) => callback((snap.val() as Record<string, RtdbMember>) || {}));
  return () => off(membersRef);
};

/** Live subscription to a trip's audit log, most recent last (as written). */
export const subscribeToTripLogs = (
  tripId: string,
  callback: (logs: Record<string, RtdbLogEntry>) => void,
): Unsubscribe => {
  if (!rtdb) return () => {};
  const logsRef = ref(rtdb, `trips/${tripId}/logs`);
  onValue(logsRef, (snap) => callback((snap.val() as Record<string, RtdbLogEntry>) || {}));
  return () => off(logsRef);
};
