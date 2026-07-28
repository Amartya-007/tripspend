import { useState, useMemo, useCallback, useEffect } from 'react';
import { Trip, TripData, TripSetup } from '../utils/calculations';
import { QuickAddPreset } from './useTripData';
import { getMyMemberId } from '../utils/memberManagementCore';
import { useTripSync } from './collaborative/useTripSync';
import { useExpenseSync } from './collaborative/useExpenseSync';
import { useTripMutations } from './collaborative/useTripMutations';
import { useExpenseMutations } from './collaborative/useExpenseMutations';
import { PRESETS_KEY, readJson, writeJson, nowIso, toIso } from './collaborative/utils';
import { remapExpensesToMemberIds } from './collaborative/expenseParser';
import { writeBatch, collection, getDocs, doc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../lib/firebase';

interface UseCollaborativeTripDataInput {
  userUid: string | null;
  enabled: boolean;
  onRemoteUpdate?: (tripId: string) => void;
}

export function useCollaborativeTripData({ userUid, enabled, onRemoteUpdate }: UseCollaborativeTripDataInput) {
  const [cloudAccessDenied, setCloudAccessDenied] = useState(false);
  const [presets, setPresets] = useState<QuickAddPreset[]>(() => readJson<QuickAddPreset[]>(PRESETS_KEY, []));

  useEffect(() => {
    writeJson(PRESETS_KEY, presets);
  }, [presets]);

  const {
    tripDocs,
    tripDocsRef,
    tripsLoaded,
    activeTrip,
    setActiveTripWithPreserve,
    activeTripIds,
    setTripDocs,
  } = useTripSync({ userUid, enabled, setCloudAccessDenied });

  const expensesByTrip = useExpenseSync({
    enabled,
    activeTripIds,
    tripDocsRef,
    setCloudAccessDenied,
    onRemoteUpdate,
  });

  const tripMutations = useTripMutations({
    enabled,
    userUid,
    activeTrip,
    setActiveTripWithPreserve,
    setCloudAccessDenied,
    setTripDocs,
  });

  const expenseMutations = useExpenseMutations({
    enabled,
    userUid,
    activeTrip,
    setCloudAccessDenied,
    expensesByTrip,
  });

  const trips = useMemo(() => Object.entries(tripDocs)
    .map(([tripId, payload]) => {
      const setup = payload.setup as TripSetup | null;
      const rawExpenses = expensesByTrip[tripId] || [];
      const remappedExpenses = remapExpensesToMemberIds(rawExpenses, setup);
      
      return {
        id: tripId,
        name: typeof payload.name === 'string' ? payload.name : 'Trip',
        createdAt: toIso(payload.createdAt),
        updatedAt: toIso(payload.updatedAt),
        inviteActive: typeof payload.inviteActive === 'boolean' ? payload.inviteActive : true,
        data: {
          setup,
          deletedExpenseMap: {},
          expenses: [...remappedExpenses].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || nowIso()) - Date.parse(a.updatedAt || a.createdAt || nowIso())),
        },
      } as Trip;
    })
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)),
  [tripDocs, expensesByTrip]);

  const identityMap = useMemo<Record<string, string>>(() => {
    if (!activeTrip || !tripDocs[activeTrip]) return {};
    const raw = tripDocs[activeTrip].identityMap;
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, string>;
  }, [activeTrip, tripDocs]);

  const myMemberId = useMemo(() => getMyMemberId(identityMap, userUid), [identityMap, userUid]);

  const tripCreatorUid = useMemo(() => {
    if (!activeTrip || !tripDocs[activeTrip]) return null;
    return typeof tripDocs[activeTrip].createdBy === 'string' ? tripDocs[activeTrip].createdBy : null;
  }, [activeTrip, tripDocs]);

  const data: TripData = useMemo(() => {
    if (!activeTrip) return { setup: null, expenses: [] };
    const active = trips.find((trip) => trip.id === activeTrip);
    return active?.data ?? { setup: null, expenses: [] };
  }, [activeTrip, trips]);

  const setActiveTripId = useCallback((tripId: string | null) => {
    setActiveTripWithPreserve(tripId);
  }, [setActiveTripWithPreserve]);

  const getTrips = useCallback(() => trips, [trips]);

  const getActiveTripName = useCallback(() => (
    trips.find((trip) => trip.id === activeTrip)?.name || 'Unknown Trip'
  ), [activeTrip, trips]);

  const mergeTripFromSync = useCallback(() => {}, []);

  const resetTrip = useCallback(async () => {
    if (!enabled || !firestore || !activeTrip) return;
    try {
      const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
      const snap = await getDocs(expensesRef);
      const batch = writeBatch(firestore);
      snap.docs.forEach((expenseDoc) => batch.delete(expenseDoc.ref));
      batch.update(doc(firestore, 'trips', activeTrip), {
        setup: null,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (error) {
      console.error('Failed to reset shared trip', error);
    }
  }, [activeTrip, enabled]);

  const toggleLock = useCallback(async (locked: boolean) => {
    if (!data.setup) return;
    await tripMutations.saveSetup({ ...data.setup, lockPreviousDays: locked });
  }, [data.setup, tripMutations.saveSetup]);

  const restoreData = useCallback(async (setup: TripSetup, expenses: any[]) => {
    if (!enabled || !firestore || !activeTrip || !userUid) return;
    try {
      const tripRef = doc(firestore, 'trips', activeTrip);
      const expensesRef = collection(firestore, 'trips', activeTrip, 'expenses');
      const existing = await getDocs(expensesRef);
      const batch = writeBatch(firestore);
      existing.docs.forEach((expenseDoc) => batch.delete(expenseDoc.ref));
      expenses.forEach((expense) => {
        const expenseRef = doc(expensesRef, expense.id);
        batch.set(expenseRef, {
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
      });
      batch.update(tripRef, { setup, updatedAt: serverTimestamp() });
      await batch.commit();
    } catch (error) {
      console.error('Failed to restore shared trip data', error);
    }
  }, [activeTrip, enabled, userUid]);

  const addPreset = useCallback((preset: Omit<QuickAddPreset, 'id'>) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    setPresets((prev) => [...prev, { ...preset, id }]);
  }, []);

  const updatePreset = useCallback((id: string, preset: Omit<QuickAddPreset, 'id'>) => {
    setPresets((prev) => prev.map((item) => (item.id === id ? { ...preset, id } : item)));
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const togglePresetFavorite = useCallback((id: string) => {
    setPresets((prev) => prev.map((item) => (item.id === id ? { ...item, isFavorite: !item.isFavorite } : item)));
  }, []);

  return {
    data,
    presets,
    saveSetup: tripMutations.saveSetup,
    addExpense: expenseMutations.addExpense,
    updateExpense: expenseMutations.updateExpense,
    deleteExpense: expenseMutations.deleteExpense,
    undoDeleteExpense: expenseMutations.undoDeleteExpense,
    clearUndoDelete: expenseMutations.clearUndoDelete,
    canUndoDelete: expenseMutations.canUndoDelete,
    createTrip: tripMutations.createTrip,
    joinTrip: tripMutations.joinTrip,
    deleteTrip: tripMutations.deleteTrip,
    renameTrip: tripMutations.renameTrip,
    setInviteActive: tripMutations.setInviteActive,
    removeMemberUid: tripMutations.removeMemberUid,
    activeTrip,
    setActiveTripId,
    trips,
    getTrips,
    getActiveTripName,
    mergeTripFromSync,
    importLocalTrips: tripMutations.importLocalTrips,
    cloudAccessDenied,
    tripsLoaded,
    addPreset,
    updatePreset,
    deletePreset,
    togglePresetFavorite,
    identityMap,
    myMemberId,
    claimMemberIdentity: tripMutations.claimMemberIdentity,
    tripCreatorUid,
    toggleLock,
    restoreData,
    resetTrip,
  };
}
