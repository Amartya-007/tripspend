import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { Expense, TripSetup } from '../../utils/calculations';
import { FirestoreRecord, logSnapshotError } from './utils';
import { toExpense } from './expenseParser';

interface UseExpenseSyncInput {
  enabled: boolean;
  activeTripIds: Set<string>;
  tripDocsRef: React.MutableRefObject<Record<string, FirestoreRecord>>;
  setCloudAccessDenied: (denied: boolean) => void;
  onRemoteUpdate?: (tripId: string) => void;
}

export const useExpenseSync = ({
  enabled,
  activeTripIds,
  tripDocsRef,
  setCloudAccessDenied,
  onRemoteUpdate,
}: UseExpenseSyncInput) => {
  const [expensesByTrip, setExpensesByTrip] = useState<Record<string, Expense[]>>({});
  
  const expensesUnsubMapRef = useRef<Map<string, () => void>>(new Map());
  const initialSnapshotReceivedRef = useRef<Set<string>>(new Set());
  
  // Cache to store parsed Expense objects by their ID to prevent recreating them on every snapshot.
  const expenseCacheMapRef = useRef<Map<string, Map<string, Expense>>>(new Map());
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate;
  }, [onRemoteUpdate]);

  useEffect(() => {
    if (!enabled || !firestore) {
      expensesUnsubMapRef.current.forEach((unsubscribe) => unsubscribe());
      expensesUnsubMapRef.current.clear();
      initialSnapshotReceivedRef.current.clear();
      expenseCacheMapRef.current.clear();
      setExpensesByTrip({});
      return;
    }

    const db = firestore;

    // Start listeners for new active trips.
    for (const tripId of activeTripIds) {
      if (expensesUnsubMapRef.current.has(tripId)) continue;

      const cache = new Map<string, Expense>();
      expenseCacheMapRef.current.set(tripId, cache);

      const expensesQuery = query(collection(db, 'trips', tripId, 'expenses'));
      const unsubscribeExpenses = onSnapshot(expensesQuery, (expensesSnap) => {
        const tripSetup = (tripDocsRef.current[tripId]?.setup as TripSetup | undefined) || null;
        
        let hasChanges = false;

        expensesSnap.docChanges().forEach((change) => {
          hasChanges = true;
          if (change.type === 'removed') {
            cache.delete(change.doc.id);
          } else {
            const parsed = toExpense(change.doc.id, change.doc.data() as FirestoreRecord, tripSetup);
            if (parsed) {
              cache.set(change.doc.id, parsed);
            }
          }
        });

        if (hasChanges || !initialSnapshotReceivedRef.current.has(tripId)) {
          const expensesArray = Array.from(cache.values());
          
          setExpensesByTrip((prev) => ({
            ...prev,
            [tripId]: expensesArray,
          }));
        }

        // Fire remote-update callback
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
      }, (error) => {
        logSnapshotError('Expenses', error, setCloudAccessDenied);
      });

      expensesUnsubMapRef.current.set(tripId, unsubscribeExpenses);
    }

    // Remove listeners for removed trips.
    expensesUnsubMapRef.current.forEach((unsubscribe, tripId) => {
      if (activeTripIds.has(tripId)) return;
      unsubscribe();
      expensesUnsubMapRef.current.delete(tripId);
      initialSnapshotReceivedRef.current.delete(tripId);
      expenseCacheMapRef.current.delete(tripId);
      setExpensesByTrip((prev) => {
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
    });
  }, [enabled, activeTripIds, tripDocsRef, setCloudAccessDenied]);

  // Clean up all on unmount
  useEffect(() => {
    return () => {
      expensesUnsubMapRef.current.forEach((unsubscribe) => unsubscribe());
      expensesUnsubMapRef.current.clear();
    };
  }, []);

  return expensesByTrip;
};
