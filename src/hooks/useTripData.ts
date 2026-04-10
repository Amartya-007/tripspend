import { useState, useEffect, useMemo, useCallback } from 'react';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { TripData, TripSetup, Expense, Trip } from '../utils/calculations.ts';
import { indexedGet, indexedSet } from '../utils/indexedStorage';

const STORAGE_KEY = 'tripspend_data';
const TRIPS_STORAGE_KEY = 'tripspend_trips';
const ACTIVE_TRIP_KEY = 'tripspend_active_trip';
const PRESETS_KEY = 'tripspend_presets';
const TRIPS_IDB_KEY = 'tripspend_trips_full';
const PRESETS_IDB_KEY = 'tripspend_presets_full';
const COMPRESSED_PREFIX = 'lz:';

const nowIso = () => new Date().toISOString();

export interface QuickAddPreset {
  id: string;
  amount: number;
  category: string;
  note?: string;
  isFavorite: boolean;
}

const normalizeSetup = (setup: TripSetup | null): TripSetup | null => {
  if (!setup) return null;

  const raw = setup as TripSetup & { perPersonBudget?: number };
  const peopleCount = Number(raw.peopleCount) || 0;
  const budgetPerPerson = Number(raw.budgetPerPerson ?? raw.perPersonBudget) || 0;
  const computedTotalBudget = peopleCount * budgetPerPerson;
  const totalBudget = Number(raw.totalBudget);

  // If participants exist, use them; otherwise generate default names
  let participants = raw.participants || [];
  if (!participants.length && peopleCount > 0) {
    participants = Array.from({ length: peopleCount }, (_, i) => `Person ${i + 1}`);
  }

  // If customCategories exist, use them; otherwise use defaults
  const customCategories = raw.customCategories && raw.customCategories.length > 0
    ? raw.customCategories
    : ['Food', 'Travel', 'Stay', 'Misc'];

  return {
    peopleCount,
    budgetPerPerson,
    totalBudget: Number.isFinite(totalBudget) && totalBudget > 0 ? totalBudget : computedTotalBudget,
    startDate: raw.startDate,
    endDate: raw.endDate,
    lockPreviousDays: Boolean(raw.lockPreviousDays),
    participants,
    participantPhoneNumbers: raw.participantPhoneNumbers || {},
    participantUpiIds: raw.participantUpiIds || {},
    customCategories,
  };
};

const getPeople = (setup: TripSetup | null) => {
  if (!setup) return [];
  if (Array.isArray(setup.participants) && setup.participants.length > 0) {
    return setup.participants;
  }
  if (!setup.peopleCount || setup.peopleCount < 1) return [];
  return Array.from({ length: setup.peopleCount }, (_, i) => `Person ${i + 1}`);
};

const normalizeExpense = (expense: Expense, setup: TripSetup | null): Expense => {
  const people = getPeople(setup);
  const hasParticipants = Array.isArray(expense.participants) && expense.participants.length > 0;
  const receipts = Array.isArray(expense.receipts)
    ? expense.receipts.filter((item) => Boolean(item?.image))
    : (expense.receiptImage ? [{ image: expense.receiptImage, name: expense.receiptName }] : []);

  return {
    ...expense,
    participants: hasParticipants ? expense.participants : people,
    splitType: expense.splitType === 'custom' ? 'custom' : 'equal',
    splitMap: expense.splitMap || undefined,
    tags: Array.isArray(expense.tags) ? expense.tags : [],
    receipts,
    receiptImage: receipts[0]?.image || undefined,
    receiptName: receipts[0]?.name || undefined,
  };
};

const normalizeData = (data: TripData): TripData => {
  const setup = normalizeSetup(data.setup);

  return {
    setup,
    expenses: data.expenses.map((expense) => ({
      ...normalizeExpense(expense, setup),
      createdAt: expense.createdAt || nowIso(),
      updatedAt: expense.updatedAt || expense.createdAt || nowIso(),
    })),
    deletedExpenseMap: data.deletedExpenseMap || {},
  };
};

const stripReceiptData = (data: TripData): TripData => {
  return {
    setup: data.setup,
    deletedExpenseMap: data.deletedExpenseMap || {},
    expenses: data.expenses.map((expense) => ({
      ...expense,
      receipts: [],
      receiptImage: undefined,
      receiptName: undefined,
    }))
  };
};

const stripReceiptsFromTrips = (trips: Trip[]): Trip[] => (
  trips.map((trip) => ({
    ...trip,
    data: stripReceiptData(trip.data),
  }))
);

const parseStoredValue = <T,>(stored: string): T | null => {
  try {
    if (stored.startsWith(COMPRESSED_PREFIX)) {
      const decompressed = decompressFromUTF16(stored.slice(COMPRESSED_PREFIX.length));
      if (!decompressed) return null;
      return JSON.parse(decompressed) as T;
    }
    return JSON.parse(stored) as T;
  } catch {
    return null;
  }
};

const readStoredObject = <T,>(key: string): T | null => {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  return parseStoredValue<T>(saved);
};

const writeStoredObject = (key: string, value: unknown) => {
  const json = JSON.stringify(value);
  const compressed = compressToUTF16(json);
  localStorage.setItem(key, `${COMPRESSED_PREFIX}${compressed}`);
};

const generateTripId = (): string => `trip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const migrateOldFormat = (): Trip | null => {
  // Detect old single-trip format stored in STORAGE_KEY
  const oldData = localStorage.getItem(STORAGE_KEY);
  if (!oldData) return null;

  try {
    const parsed = JSON.parse(oldData) as TripData;
    // Check if it looks like old single-trip format
    if ((parsed.setup || parsed.expenses?.length) && typeof parsed === 'object') {
      const trip: Trip = {
        id: generateTripId(),
        name: 'My Trip',
        createdAt: new Date().toISOString(),
        data: normalizeData(parsed),
      };
      // Clean up old storage
      localStorage.removeItem(STORAGE_KEY);
      return trip;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

export function useTripData() {
  const [lastDeletedExpense, setLastDeletedExpense] = useState<Expense | null>(null);
  // Tracks whether the async IndexedDB hydration has completed (or failed).
  // Until true, the app should not make routing decisions based on `data.setup`.
  const [isHydrated, setIsHydrated] = useState(false);

  const [presets, setPresets] = useState<QuickAddPreset[]>(() => {
    const parsed = readStoredObject<QuickAddPreset[]>(PRESETS_KEY);
    return Array.isArray(parsed) ? parsed : [];
  });

  // Initialize multi-trip state
  const [trips, setTrips] = useState<Trip[]>(() => {
    const parsed = readStoredObject<Trip[]>(TRIPS_STORAGE_KEY);
    if (Array.isArray(parsed)) {
      return parsed.map((trip) => ({
        ...trip,
        updatedAt: trip.updatedAt || trip.createdAt || nowIso(),
        data: normalizeData(trip.data),
      }));
    }

    // Try to migrate old single-trip format
    const migrated = migrateOldFormat();
    return migrated ? [migrated] : [];
  });

  const [activeTrip, setActiveTrip] = useState<string | null>(() => {
    const saved = localStorage.getItem(ACTIVE_TRIP_KEY);
    if (saved) return saved;

    // Default to first trip if available
    const parsed = readStoredObject<Trip[]>(TRIPS_STORAGE_KEY);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0].id;
    }

    // Check for migrated old format
    const migrated = migrateOldFormat();
    return migrated ? migrated.id : null;
  });

  // Get currently active trip data
  const data: TripData = useMemo(
    () => trips.find((t) => t.id === activeTrip)?.data ?? { setup: null, expenses: [] },
    [trips, activeTrip]
  );

  // Persist trips to localStorage
  useEffect(() => {
    try {
      writeStoredObject(TRIPS_STORAGE_KEY, trips);
    } catch (error) {
      try {
        // Fallback when storage is tight: drop receipt images and retry.
        const lighterTrips = stripReceiptsFromTrips(trips);
        writeStoredObject(TRIPS_STORAGE_KEY, lighterTrips);
        setTrips(lighterTrips);
      } catch {
        console.error('Failed to save trips', error);
      }
    }
  }, [trips]);

  // Persist active trip to localStorage
  useEffect(() => {
    try {
      if (activeTrip) {
        localStorage.setItem(ACTIVE_TRIP_KEY, activeTrip);
      } else {
        localStorage.removeItem(ACTIVE_TRIP_KEY);
      }
    } catch {
      console.error('Failed to save active trip', {});
    }
  }, [activeTrip]);

  // Persist presets
  useEffect(() => {
    try {
      writeStoredObject(PRESETS_KEY, presets);
    } catch {
      console.error('Failed to save presets', {});
    }
  }, [presets]);

  // Auto-create first trip if none exist
  useEffect(() => {
    if (trips.length === 0) {
      const newTrip: Trip = {
        id: generateTripId(),
        name: 'My Trip',
        createdAt: new Date().toISOString(),
        updatedAt: nowIso(),
        data: { setup: null, expenses: [] },
      };
      setTrips([newTrip]);
      setActiveTrip(newTrip.id);
    }
  }, []);

  // Ensure an active trip is always selected when trips exist (important after migration/hydration).
  useEffect(() => {
    if (!activeTrip && trips.length > 0) {
      setActiveTrip(trips[0].id);
    }
  }, [activeTrip, trips]);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromIndexedDb = async () => {
      try {
        const [savedTrips, savedPresets] = await Promise.all([
          indexedGet<Trip[]>(TRIPS_IDB_KEY),
          indexedGet<QuickAddPreset[]>(PRESETS_IDB_KEY),
        ]);

        if (!cancelled && Array.isArray(savedTrips) && savedTrips.length > 0) {
          setTrips(prev => {
            // Only hydrate if IDB has more trips or more recent data than current state
            // This prevents IDB from overwriting freshly-added expenses
            const idbTotal = savedTrips.reduce((s, t) => s + t.data.expenses.length, 0);
            const currentTotal = prev.reduce((s, t) => s + t.data.expenses.length, 0);
            const idbUpdated = Math.max(...savedTrips.map(t => new Date(t.updatedAt || t.createdAt || 0).getTime()));
            const currentUpdated = Math.max(...prev.map(t => new Date(t.updatedAt || t.createdAt || 0).getTime()), 0);

            // Prefer whichever has more data, or if equal prefer more recent
            if (idbTotal > currentTotal || (idbTotal === currentTotal && idbUpdated > currentUpdated)) {
              return savedTrips.map((trip) => ({
                ...trip,
                updatedAt: trip.updatedAt || trip.createdAt || nowIso(),
                data: normalizeData(trip.data),
              }));
            }
            return prev;
          });
          setActiveTrip((prev) => {
            if (prev && savedTrips.some((trip) => trip.id === prev)) return prev;
            return savedTrips[0].id;
          });
        }

        if (!cancelled && Array.isArray(savedPresets)) {
          setPresets(savedPresets);
        }
      } catch (error) {
        console.error('IndexedDB hydration failed', error);
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    };

    void hydrateFromIndexedDb();

    return () => {
      cancelled = true;
    };
  }, []);

  // Helper to update current trip's data
  const updateCurrentTrip = useCallback((updater: (prev: TripData) => TripData) => {
    setTrips(prev => prev.map(trip =>
      trip.id === activeTrip ? { ...trip, data: updater(trip.data), updatedAt: nowIso() } : trip
    ));
  }, [activeTrip]);

  const saveSetup = useCallback((setup: TripSetup) => {
    updateCurrentTrip(prev => {
      // Create name mapping using name-to-name comparison (not position-based)
      // to handle deletions and reordering correctly
      const oldParticipants = getPeople(prev.setup);
      const newParticipants = getPeople(setup);
      const newSet = new Set(newParticipants);
      const nameMapping: Record<string, string> = {};
      
      // Build mapping: if a name changed position but still exists, keep as-is
      // Only map names that existed before but changed (same index, different name)
      for (let i = 0; i < Math.max(oldParticipants.length, newParticipants.length); i++) {
        const oldName = oldParticipants[i];
        const newName = newParticipants[i];
        
        // Both exist at this position and are different
        if (oldName && newName && oldName !== newName) {
          // Check if oldName still exists elsewhere in new list (just reordered) or truly renamed
          if (!newSet.has(oldName)) {
            // oldName is not in newSet, so it was truly replaced at this position
            nameMapping[oldName] = newName;
          }
          // Otherwise oldName exists elsewhere in new list - it's a reorder, don't map
        }
      }
      
      // Remove mappings for deleted names (safety check)
      for (const [oldName, newName] of Object.entries(nameMapping)) {
        if (!newSet.has(newName)) {
          delete nameMapping[oldName];
        }
      }

      // Update expenses with new names
      const updatedExpenses = prev.expenses.map(expense => {
        let updated = expense;
        
        // Update paidBy if name changed
        if (expense.paidBy && nameMapping[expense.paidBy]) {
          updated = { ...updated, paidBy: nameMapping[expense.paidBy] };
        }
        
        // Update participants if names changed, preserve deleted names (historical accuracy)
        if (Array.isArray(updated.participants)) {
          updated = {
            ...updated,
            participants: updated.participants.map(p => nameMapping[p] ?? p)
          };
        }
        
        // Update splitMap keys if custom split
        if (updated.splitMap && typeof updated.splitMap === 'object') {
          const newSplitMap: Record<string, number> = {};
          for (const [name, amount] of Object.entries(updated.splitMap)) {
            const newName = nameMapping[name] ?? name;
            newSplitMap[newName] = amount;
          }
          updated = { ...updated, splitMap: newSplitMap };
        }
        
        return normalizeExpense(updated, setup);
      });

      return {
        ...prev,
        setup,
        expenses: updatedExpenses
      };
    });
  }, [updateCurrentTrip]);

  const addExpense = useCallback((expense: Expense) => {
    updateCurrentTrip(prev => ({
      ...prev,
      ...(() => {
        const map = { ...(prev.deletedExpenseMap || {}) };
        delete map[expense.id];
        return { deletedExpenseMap: map };
      })(),
      expenses: [{
        ...normalizeExpense(expense, prev.setup),
        createdAt: expense.createdAt || nowIso(),
        updatedAt: nowIso(),
      }, ...prev.expenses],
    }));
    setLastDeletedExpense(null);
  }, [updateCurrentTrip]);

  const updateExpense = useCallback((updatedExpense: Expense) => {
    updateCurrentTrip(prev => ({
      ...prev,
      expenses: prev.expenses.map(e => e.id === updatedExpense.id ? {
        ...normalizeExpense(updatedExpense, prev.setup),
        createdAt: e.createdAt || updatedExpense.createdAt || nowIso(),
        updatedAt: nowIso(),
      } : e)
    }));
  }, [updateCurrentTrip]);

  const deleteExpense = useCallback((id: string) => {
    setTrips(prev => prev.map(trip => {
      if (trip.id !== activeTrip) return trip;

      const target = trip.data.expenses.find((expense) => expense.id === id);
      if (target) {
        setLastDeletedExpense(target);
      }

      return {
        ...trip,
        data: {
          ...trip.data,
          deletedExpenseMap: {
            ...(trip.data.deletedExpenseMap || {}),
            [id]: nowIso(),
          },
          expenses: trip.data.expenses.filter(e => e.id !== id)
        }
      };
    }));
  }, [activeTrip]);

  const undoDeleteExpense = useCallback(() => {
    if (!lastDeletedExpense) return;

    updateCurrentTrip(prev => {
      if (prev.expenses.some((expense) => expense.id === lastDeletedExpense.id)) {
        return prev;
      }

      return {
        ...prev,
        ...(() => {
          const map = { ...(prev.deletedExpenseMap || {}) };
          delete map[lastDeletedExpense.id];
          return { deletedExpenseMap: map };
        })(),
        expenses: [{
          ...normalizeExpense(lastDeletedExpense, prev.setup),
          createdAt: lastDeletedExpense.createdAt || nowIso(),
          updatedAt: nowIso(),
        }, ...prev.expenses]
      };
    });
    setLastDeletedExpense(null);
  }, [lastDeletedExpense, updateCurrentTrip]);

  const clearUndoDelete = useCallback(() => {
    setLastDeletedExpense(null);
  }, []);

  const resetTrip = useCallback(() => {
    updateCurrentTrip(() => ({ setup: null, expenses: [] }));
  }, [updateCurrentTrip]);

  const toggleLock = useCallback((locked: boolean) => {
    updateCurrentTrip(prev => {
      if (!prev.setup) return prev;
      return {
        ...prev,
        setup: { ...prev.setup, lockPreviousDays: locked }
      };
    });
  }, [updateCurrentTrip]);

  const restoreData = useCallback((setup: TripSetup, expenses: Expense[]) => {
    updateCurrentTrip(() => normalizeData({ setup, expenses }));
  }, [updateCurrentTrip]);

  // Multi-trip management functions
  const createTrip = useCallback((name: string, initialSetup?: TripSetup) => {
    const newTrip: Trip = {
      id: generateTripId(),
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      data: {
        setup: initialSetup ?? null,
        expenses: [],
        deletedExpenseMap: {},
      },
    };
    setTrips(prev => [...prev, newTrip]);
    setActiveTrip(newTrip.id);
    return newTrip.id;
  }, []);

  const joinTrip = useCallback(async (_tripId: string) => {
    return false;
  }, []);

  const deleteTrip = useCallback((tripId: string) => {
    setTrips(prev => {
      const filtered = prev.filter(t => t.id !== tripId);
      // If we deleted the active trip, switch to first available
      if (activeTrip === tripId) {
        setActiveTrip(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  }, [activeTrip]);

  const renameTrip = useCallback((tripId: string, newName: string) => {
    setTrips(prev => prev.map(trip =>
      trip.id === tripId ? { ...trip, name: newName, updatedAt: nowIso() } : trip
    ));
  }, []);

  const setActiveTripId = useCallback((tripId: string | null) => {
    // Only switch if trip exists or is null
    if (tripId === null || trips.some(t => t.id === tripId)) {
      setActiveTrip(tripId);
    }
  }, [trips]);

  const getTrips = useCallback(() => trips, [trips]);

  const getActiveTripName = useCallback(() => {
    return trips.find(t => t.id === activeTrip)?.name ?? 'Unknown Trip';
  }, [trips, activeTrip]);

  const mergeTripFromSync = useCallback((incomingTrip: Trip) => {
    setTrips(prev => {
      const exists = prev.some((trip) => trip.id === incomingTrip.id);
      if (!exists) {
        return [...prev, {
          ...incomingTrip,
          updatedAt: incomingTrip.updatedAt || incomingTrip.createdAt || nowIso(),
          data: normalizeData(incomingTrip.data),
        }];
      }

      return prev.map((trip) => {
        if (trip.id !== incomingTrip.id) return trip;
        return {
          ...incomingTrip,
          updatedAt: incomingTrip.updatedAt || incomingTrip.createdAt || nowIso(),
          data: normalizeData(incomingTrip.data),
        };
      });
    });
  }, []);

  const addPreset = useCallback((preset: Omit<QuickAddPreset, 'id'>) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setPresets(prev => [...prev, { ...preset, id }]);
  }, []);

  const updatePreset = useCallback((id: string, preset: Omit<QuickAddPreset, 'id'>) => {
    setPresets(prev => prev.map(p => p.id === id ? { ...preset, id } : p));
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  const togglePresetFavorite = useCallback((id: string) => {
    setPresets(prev =>
      prev.map(p => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
    );
  }, []);

  useEffect(() => {
    void indexedSet(TRIPS_IDB_KEY, trips).catch((error) => {
      console.error('Failed to persist full trips in IndexedDB', error);
    });
  }, [trips]);

  useEffect(() => {
    void indexedSet(PRESETS_IDB_KEY, presets).catch((error) => {
      console.error('Failed to persist presets in IndexedDB', error);
    });
  }, [presets]);

  return {
    // Single trip interface (for backward compatibility)
    data,
    isHydrated,
    presets,
    saveSetup,
    addExpense,
    updateExpense,
    deleteExpense,
    undoDeleteExpense,
    clearUndoDelete,
    canUndoDelete: Boolean(lastDeletedExpense),
    resetTrip,
    toggleLock,
    restoreData,
    addPreset,
    updatePreset,
    deletePreset,
    togglePresetFavorite,
    // Multi-trip interface
    trips,
    activeTrip,
    createTrip,
    joinTrip,
    deleteTrip,
    renameTrip,
    setActiveTripId,
    getTrips,
    getActiveTripName,
    mergeTripFromSync,
  };
}
