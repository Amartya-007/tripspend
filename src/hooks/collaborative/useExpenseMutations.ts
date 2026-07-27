import { useCallback, useState } from 'react';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../../lib/firebase';
import { Expense } from '../../utils/calculations';
import { isPermissionDeniedError } from './utils';

interface UseExpenseMutationsInput {
  enabled: boolean;
  userUid: string | null;
  activeTrip: string | null;
  setCloudAccessDenied: (denied: boolean) => void;
  expensesByTrip: Record<string, Expense[]>;
}

export const useExpenseMutations = ({
  enabled,
  userUid,
  activeTrip,
  setCloudAccessDenied,
  expensesByTrip,
}: UseExpenseMutationsInput) => {
  const [lastDeletedExpense, setLastDeletedExpense] = useState<Expense | null>(null);

  const addExpense = useCallback((expense: Expense) => {
    if (!enabled) throw new Error('Offline mode: cannot save to cloud');
    if (!firestore) throw new Error('Firebase not initialized');
    if (!userUid) throw new Error('User not authenticated');
    if (!activeTrip) throw new Error('No trip selected');

    const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
    const expenseDoc = doc(expensesRef, expense.id);

    const batch = writeBatch(firestore);
    batch.set(expenseDoc, {
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

    batch.update(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });

    batch.commit().catch((error) => {
      console.error('Failed to add shared expense', error);
      if (isPermissionDeniedError(error)) {
        setCloudAccessDenied(true);
      }
    });

    setLastDeletedExpense(null);
  }, [activeTrip, enabled, userUid, setCloudAccessDenied]);

  const updateExpense = useCallback((updatedExpense: Expense) => {
    if (!enabled) throw new Error('Offline mode: cannot save to cloud');
    if (!firestore) throw new Error('Firebase not initialized');
    if (!activeTrip) throw new Error('No trip selected');

    const expenseRef = doc(firestore, 'trips', activeTrip, 'expenses', updatedExpense.id);

    const batch = writeBatch(firestore);
    batch.update(expenseRef, {
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

    batch.update(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });

    batch.commit().catch((error) => {
      console.error('Failed to update shared expense', error);
      if (isPermissionDeniedError(error)) {
        setCloudAccessDenied(true);
      }
    });
  }, [activeTrip, enabled, setCloudAccessDenied]);

  const deleteExpense = useCallback((expenseId: string) => {
    if (!enabled) throw new Error('Offline mode: cannot delete from cloud');
    if (!firestore) throw new Error('Firebase not initialized');
    if (!activeTrip) throw new Error('No trip selected');

    const currentExpense = (expensesByTrip[activeTrip] || []).find((expense) => expense.id === expenseId) || null;
    if (currentExpense) setLastDeletedExpense(currentExpense);

    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, 'trips', activeTrip, 'expenses', expenseId));
    batch.update(doc(firestore, 'trips', activeTrip), { updatedAt: serverTimestamp() });

    batch.commit().catch((error) => {
      console.error('Failed to delete shared expense', error);
      if (isPermissionDeniedError(error)) {
        setCloudAccessDenied(true);
      }
    });
  }, [activeTrip, enabled, expensesByTrip, setCloudAccessDenied]);

  const undoDeleteExpense = useCallback(() => {
    if (!lastDeletedExpense) return;
    addExpense(lastDeletedExpense);
  }, [addExpense, lastDeletedExpense]);

  const clearUndoDelete = useCallback(() => {
    setLastDeletedExpense(null);
  }, []);

  return {
    addExpense,
    updateExpense,
    deleteExpense,
    undoDeleteExpense,
    clearUndoDelete,
    canUndoDelete: Boolean(lastDeletedExpense),
  };
};
