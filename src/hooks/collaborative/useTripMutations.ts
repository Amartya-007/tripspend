import { useCallback } from 'react';
import { collection, deleteDoc, doc, writeBatch, serverTimestamp, runTransaction, getDoc, getDocs, updateDoc, query, where, arrayUnion, arrayRemove, deleteField, DocumentReference } from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { Trip, TripSetup } from '../../utils/calculations';
import { FirestoreRecord, inviteExpiry, isPermissionDeniedError, nowIso, toIso, generateShortCode } from './utils';
import { migrateLegacyParticipants } from '../../utils/migration';
import { claimMemberIdentity as claimMemberIdentityCore } from '../../utils/memberManagementCore';

interface UseTripMutationsInput {
  enabled: boolean;
  userUid: string | null;
  activeTrip: string | null;
  setActiveTripWithPreserve: (tripId: string | null) => void;
  setCloudAccessDenied: (denied: boolean) => void;
  setTripDocs: React.Dispatch<React.SetStateAction<Record<string, FirestoreRecord>>>;
}

export const useTripMutations = ({
  enabled,
  userUid,
  activeTrip,
  setActiveTripWithPreserve,
  setCloudAccessDenied,
  setTripDocs,
}: UseTripMutationsInput) => {
  const saveSetup = useCallback(async (setup: TripSetup) => {
    if (!enabled || !firestore || !userUid) return;

    try {
      if (activeTrip) {
        const activeTripDocRef = doc(firestore, 'trips', activeTrip);
        const now = nowIso();

        setTripDocs((prev) => {
          const existing = prev[activeTrip] || {};
          return { ...prev, [activeTrip]: { ...existing, setup, updatedAt: now } };
        });

        await updateDoc(activeTripDocRef, {
          setup,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      let tripRef: DocumentReference | null = null;
      let shortCode = '';

      for (let i = 0; i < 10; i++) {
        shortCode = generateShortCode();
        const candidateRef = doc(firestore, 'trips', shortCode);
        
        try {
          await runTransaction(firestore, async (transaction) => {
            const snap = await transaction.get(candidateRef);
            if (snap.exists()) throw new Error('COLLISION');
            transaction.set(candidateRef, {
              name: 'My Trip',
              createdBy: userUid,
              members: [userUid],
              setup,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              inviteActive: true,
              inviteExpiresAt: inviteExpiry(),
            });
          });
          tripRef = candidateRef;
          break;
        } catch (e: any) {
          if (e.message !== 'COLLISION') throw e;
        }
      }

      if (!tripRef) throw new Error('Failed to generate a unique trip code after multiple attempts');

      const now = nowIso();
      setTripDocs((prev) => ({
        ...prev,
        [tripRef!.id]: {
          name: 'My Trip',
          createdBy: userUid,
          members: [userUid],
          setup,
          createdAt: now,
          updatedAt: now,
          inviteActive: true,
          inviteExpiresAt: inviteExpiry().toISOString(),
        },
      }));
      setActiveTripWithPreserve(tripRef.id);
    } catch (error) {
      console.error('Failed to save shared trip setup', error);
    }
  }, [activeTrip, enabled, userUid, setActiveTripWithPreserve, setTripDocs]);

  const createTrip = useCallback(async (name: string, initialSetup?: TripSetup) => {
    if (!enabled || !firestore || !userUid) return null;

    try {
      let tripRef: DocumentReference | null = null;
      let shortCode = '';

      for (let attempt = 0; attempt < 10; attempt += 1) {
        shortCode = generateShortCode();
        const candidateRef = doc(firestore, 'trips', shortCode);
        try {
          await runTransaction(firestore, async (transaction) => {
            const snap = await transaction.get(candidateRef);
            if (snap.exists()) throw new Error('COLLISION');
            transaction.set(candidateRef, {
              name,
              createdBy: userUid,
              members: [userUid],
              setup: initialSetup || null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              inviteActive: true,
              inviteExpiresAt: inviteExpiry(),
            });
          });
          tripRef = candidateRef;
          break;
        } catch (e: any) {
          if (e.message !== 'COLLISION') throw e;
        }
      }

      if (!tripRef) throw new Error('Failed to generate a unique 12-digit invite code');
      
      const verifySnap = await getDoc(tripRef);
      if (!verifySnap.exists()) {
        console.error('CRITICAL: Trip write succeeded but immediate getDoc failed.');
        throw new Error('Trip write verification failed');
      }

      setActiveTripWithPreserve(tripRef.id);
      return tripRef.id;
    } catch (error) {
      console.error('Failed to create shared trip', error);
      return null;
    }
  }, [enabled, userUid, setActiveTripWithPreserve]);

  const importLocalTrips = useCallback(async (localTrips: Trip[], preferredActiveTripId: string | null): Promise<string | null> => {
    if (!enabled || !firestore || !userUid) return null;
    if (!Array.isArray(localTrips) || localTrips.length === 0) return null;

    try {
      const existingShared = await getDocs(query(collection(firestore, 'trips'), where('members', 'array-contains', userUid)));
      const existingBySourceId = new Map<string, string>();
      const existingBySignature = new Map<string, string>();

      existingShared.docs.forEach((tripDoc) => {
        const payload = tripDoc.data() as FirestoreRecord;
        if (typeof payload.sourceLocalTripId === 'string') existingBySourceId.set(payload.sourceLocalTripId, tripDoc.id);
        const name = typeof payload.name === 'string' ? payload.name : '';
        if (name) existingBySignature.set(`${name}::${toIso(payload.createdAt)}`, tripDoc.id);
      });

      const idMap = new Map<string, string>();
      // Trips already migrated in a previous run still resolve to an id, so a repeat
      // "Generate Invite Code" tap returns the existing code instead of doing nothing.
      existingBySourceId.forEach((cloudId, sourceId) => idMap.set(sourceId, cloudId));

      let importedCount = 0;

      for (let i = 0; i < localTrips.length; i += 1) {
        const localTrip = localTrips[i];
        const signature = `${localTrip.name}::${localTrip.createdAt || ''}`;
        if (existingBySourceId.has(localTrip.id)) continue;
        if (existingBySignature.has(signature)) {
          idMap.set(localTrip.id, existingBySignature.get(signature)!);
          continue;
        }

        const migratedTripData = migrateLegacyParticipants(localTrip.data);
        const payload = {
          name: localTrip.name,
          createdBy: userUid,
          members: [userUid],
          sourceLocalTripId: localTrip.id,
          setup: migratedTripData.setup || null,
          createdAt: localTrip.createdAt || nowIso(),
          updatedAt: localTrip.updatedAt || localTrip.createdAt || nowIso(),
          inviteActive: true,
          inviteExpiresAt: inviteExpiry(),
        };

        let tripRef: DocumentReference | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidateRef = doc(firestore, 'trips', generateShortCode());
          try {
            await runTransaction(firestore, async (transaction) => {
              const snap = await transaction.get(candidateRef);
              if (snap.exists()) throw new Error('COLLISION');
              transaction.set(candidateRef, payload);
            });
            tripRef = candidateRef;
            break;
          } catch (e: any) {
            if (e.message !== 'COLLISION') throw e;
          }
        }

        if (!tripRef) continue;

        importedCount += 1;
        idMap.set(localTrip.id, tripRef.id);

        const expenses = migratedTripData.expenses || [];
        if (expenses.length > 0) {
          const batch = writeBatch(firestore);
          const expensesRef = collection(firestore, 'trips', tripRef.id, 'expenses');
          expenses.forEach((expense) => {
            const expenseRef = doc(expensesRef, expense.id);
            batch.set(expenseRef, {
              ...expense,
              payerId: expense.paidBy,
              participantIds: expense.participants || [],
              createdBy: userUid,
              createdAt: expense.createdAt || nowIso(),
              updatedAt: expense.updatedAt || expense.createdAt || nowIso(),
            }, { merge: true });
          });
          await batch.commit();
        }
      }

      if (preferredActiveTripId && idMap.has(preferredActiveTripId)) {
        const resolvedId = idMap.get(preferredActiveTripId) || null;
        setActiveTripWithPreserve(resolvedId);
        return resolvedId;
      }

      if (!preferredActiveTripId && (importedCount > 0 || idMap.size > 0)) {
        const firstImported = idMap.values().next().value as string | undefined;
        if (firstImported) setActiveTripWithPreserve(firstImported);
        return firstImported || null;
      }

      return null;
    } catch (error) {
      console.error('Failed to import local trips', error);
      if (isPermissionDeniedError(error)) setCloudAccessDenied(true);
      return null;
    }
  }, [enabled, userUid, setActiveTripWithPreserve, setCloudAccessDenied]);

  const joinTrip = useCallback(async (tripId: string) => {
    if (!enabled || !firestore || !userUid) return false;
    const cleaned = tripId.trim();
    if (!/^\d{12}$/.test(cleaned)) return false;

    try {
      const tripRef = doc(firestore, 'trips', cleaned);
      await updateDoc(tripRef, {
        members: arrayUnion(userUid),
        updatedAt: serverTimestamp(),
      });
      setActiveTripWithPreserve(cleaned);
      return true;
    } catch (error) {
      console.error('Failed to join trip', error);
      if (isPermissionDeniedError(error)) setCloudAccessDenied(true);
      return false;
    }
  }, [enabled, userUid, setActiveTripWithPreserve, setCloudAccessDenied]);

  const claimMemberIdentity = useCallback(async (tripId: string, memberId: string) => {
    if (!enabled || !firestore || !userUid) return false;
    try {
      const tripRef = doc(firestore, 'trips', tripId);
      await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(tripRef);
        if (!snapshot.exists()) throw new Error('Trip not found');
        const payload = snapshot.data() as FirestoreRecord;
        const currentIdentityMap = (payload.identityMap && typeof payload.identityMap === 'object')
          ? payload.identityMap as Record<string, string> : {};
        claimMemberIdentityCore(currentIdentityMap, userUid, memberId);
        transaction.update(tripRef, {
          [`identityMap.${userUid}`]: memberId,
          updatedAt: serverTimestamp(),
        });
      });
      return true;
    } catch (error) {
      console.error('Failed to claim member identity', error);
      return false;
    }
  }, [enabled, userUid]);

  const deleteTrip = useCallback(async (tripId: string) => {
    if (!enabled || !firestore) return;
    try {
      const expensesRef = collection(firestore, 'trips', tripId, 'expenses');
      const snap = await getDocs(expensesRef);
      for (let start = 0; start < snap.docs.length; start += 450) {
        const batch = writeBatch(firestore);
        snap.docs.slice(start, start + 450).forEach((expenseDoc) => batch.delete(expenseDoc.ref));
        await batch.commit();
      }
      await deleteDoc(doc(firestore, 'trips', tripId));
      
      if (activeTrip === tripId) {
        setActiveTripWithPreserve(null);
      }
    } catch (error) {
      console.error('Failed to delete shared trip', error);
    }
  }, [enabled, activeTrip, setActiveTripWithPreserve]);

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

  // Creator-only: turn the invite code on/off. Turning it back on issues a fresh
  // expiry window. Existing members are unaffected either way.
  const setInviteActive = useCallback(async (tripId: string, active: boolean) => {
    if (!enabled || !firestore) return false;
    try {
      await updateDoc(doc(firestore, 'trips', tripId), {
        inviteActive: active,
        ...(active ? { inviteExpiresAt: inviteExpiry() } : {}),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (error) {
      console.error('Failed to update invite status', error);
      if (isPermissionDeniedError(error)) setCloudAccessDenied(true);
      return false;
    }
  }, [enabled, setCloudAccessDenied]);

  // Creator-only: actually revoke a member's Firestore access, not just their
  // display-registry entry. Enforced server-side by onlyCreatorRemoveMember().
  const removeMemberUid = useCallback(async (tripId: string, memberUid: string) => {
    if (!enabled || !firestore || !userUid) return false;
    if (memberUid === userUid) return false;
    try {
      await updateDoc(doc(firestore, 'trips', tripId), {
        members: arrayRemove(memberUid),
        [`identityMap.${memberUid}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (error) {
      console.error('Failed to remove member access', error);
      if (isPermissionDeniedError(error)) setCloudAccessDenied(true);
      return false;
    }
  }, [enabled, userUid, setCloudAccessDenied]);

  return {
    saveSetup,
    createTrip,
    importLocalTrips,
    joinTrip,
    claimMemberIdentity,
    deleteTrip,
    renameTrip,
    setInviteActive,
    removeMemberUid,
  };
};
