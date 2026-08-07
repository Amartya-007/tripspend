import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { TripSetup } from '../../utils/calculations';
import { FirestoreRecord, logSnapshotError, ACTIVE_SHARED_TRIP_KEY, ACTIVE_TRIP_PRESERVE_MS } from './utils';
import { migrateLegacyParticipants } from '../../utils/migration';

interface UseTripSyncInput {
  userUid: string | null;
  enabled: boolean;
  setCloudAccessDenied: (denied: boolean) => void;
}

export const useTripSync = ({ userUid, enabled, setCloudAccessDenied }: UseTripSyncInput) => {
  const [tripDocs, setTripDocs] = useState<Record<string, FirestoreRecord>>({});
  // True once the trips listener has delivered its first snapshot (or errored).
  // Distinguishes "still loading cloud trips" from "loaded, and there are none".
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [activeTrip, setActiveTrip] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_SHARED_TRIP_KEY);
    } catch {
      return null;
    }
  });

  const tripDocsRef = useRef<Record<string, FirestoreRecord>>({});
  const migratedTripIdsRef = useRef<Set<string>>(new Set());
  const preserveActiveTripUntilRef = useRef<number>(0);
  const activeTripIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !userUid || !firestore) {
      setTripDocs({});
      setTripsLoaded(false);
      activeTripIdsRef.current.clear();
      return;
    }

    const db = firestore;
    const tripsQuery = query(collection(db, 'trips'), where('members', 'array-contains', userUid));
    
    const unsubscribeTrips = onSnapshot(tripsQuery, (snapshot) => {
      const nextTripDocs: Record<string, FirestoreRecord> = {};
      const activeTripIds = new Set<string>();

      snapshot.docs.forEach((tripDoc) => {
        const payload = tripDoc.data() as FirestoreRecord;
        nextTripDocs[tripDoc.id] = payload;
        activeTripIds.add(tripDoc.id);

        const setup = payload.setup as TripSetup | undefined;
        if (
          setup?.participants?.length &&
          !setup.memberRegistry &&
          !migratedTripIdsRef.current.has(tripDoc.id)
        ) {
          migratedTripIdsRef.current.add(tripDoc.id);
          const migrated = migrateLegacyParticipants({ setup, expenses: [] });
          void updateDoc(doc(db, 'trips', tripDoc.id), {
            setup: migrated.setup,
            updatedAt: serverTimestamp(),
          }).catch((error) => {
            console.error('Failed to persist migrated trip setup', error);
          });
          nextTripDocs[tripDoc.id] = {
            ...payload,
            setup: migrated.setup,
          };
        }
      });

      tripDocsRef.current = nextTripDocs;
      setTripDocs(nextTripDocs);
      setTripsLoaded(true);
      activeTripIdsRef.current = activeTripIds;

      setActiveTrip((prev) => {
        if (prev && activeTripIds.has(prev)) return prev;

        // Preserve an explicitly selected/created trip briefly while snapshots catch up.
        if (prev && Date.now() < preserveActiveTripUntilRef.current) return prev;

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
    }, (error) => {
      // The listener will not deliver a snapshot after an error — mark loading
      // finished so the app can fall back instead of waiting forever.
      setTripsLoaded(true);
      logSnapshotError('Trips', error, setCloudAccessDenied);
    });

    return () => {
      unsubscribeTrips();
    };
  }, [enabled, userUid, setCloudAccessDenied]);

  useEffect(() => {
    try {
      if (activeTrip) localStorage.setItem(ACTIVE_SHARED_TRIP_KEY, activeTrip);
      else localStorage.removeItem(ACTIVE_SHARED_TRIP_KEY);
    } catch {
      // Ignore persistence failures.
    }
  }, [activeTrip]);

  const setActiveTripWithPreserve = (tripId: string | null) => {
    preserveActiveTripUntilRef.current = Date.now() + ACTIVE_TRIP_PRESERVE_MS;
    setActiveTrip(tripId);
  };

  return {
    tripDocs,
    tripDocsRef,
    tripsLoaded,
    activeTrip,
    setActiveTripWithPreserve,
    activeTripIds: activeTripIdsRef.current,
    setTripDocs,
  };
};
