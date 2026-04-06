import { useState, useEffect } from 'react';
import { TripData, TripSetup, Expense } from '../utils/calculations.ts';

const STORAGE_KEY = 'tripspend_data';
const PRESETS_KEY = 'tripspend_presets';

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
    expenses: data.expenses.map((expense) => normalizeExpense(expense, setup))
  };
};

const stripReceiptData = (data: TripData): TripData => {
  return {
    setup: data.setup,
    expenses: data.expenses.map((expense) => ({
      ...expense,
      receipts: [],
      receiptImage: undefined,
      receiptName: undefined,
    }))
  };
};

export function useTripData() {
  const [lastDeletedExpense, setLastDeletedExpense] = useState<Expense | null>(null);

  const [presets, setPresets] = useState<QuickAddPreset[]>(() => {
    const saved = localStorage.getItem(PRESETS_KEY);
    if (!saved) {
      return [];
    }
    try {
      return JSON.parse(saved) as QuickAddPreset[];
    } catch {
      return [];
    }
  });

  const [data, setData] = useState<TripData>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { setup: null, expenses: [] };
    }

    try {
      const parsed = JSON.parse(saved) as TripData;
      return normalizeData(parsed);
    } catch {
      return { setup: null, expenses: [] };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    } catch {
      console.error('Failed to save presets', {});
    }
  }, [presets]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      try {
        const lighterData = stripReceiptData(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lighterData));
        setData(lighterData);
      } catch {
        console.error('TripSpend persistence failed', error);
      }
    }
  }, [data]);

  const saveSetup = (setup: TripSetup) => {
    setData(prev => ({
      ...prev,
      setup,
      expenses: prev.expenses.map(expense => normalizeExpense(expense, setup))
    }));
  };

  const addExpense = (expense: Expense) => {
    setData(prev => ({
      ...prev,
      expenses: [normalizeExpense(expense, prev.setup), ...prev.expenses]
    }));
    setLastDeletedExpense(null);
  };

  const updateExpense = (updatedExpense: Expense) => {
    setData(prev => ({
      ...prev,
      expenses: prev.expenses.map(e => e.id === updatedExpense.id ? normalizeExpense(updatedExpense, prev.setup) : e)
    }));
  };

  const deleteExpense = (id: string) => {
    setData(prev => {
      const target = prev.expenses.find((expense) => expense.id === id);
      if (target) {
        setLastDeletedExpense(target);
      }

      return {
        ...prev,
        expenses: prev.expenses.filter(e => e.id !== id)
      };
    });
  };

  const undoDeleteExpense = () => {
    if (!lastDeletedExpense) return;

    setData(prev => {
      if (prev.expenses.some((expense) => expense.id === lastDeletedExpense.id)) {
        return prev;
      }

      return {
        ...prev,
        expenses: [normalizeExpense(lastDeletedExpense, prev.setup), ...prev.expenses]
      };
    });
    setLastDeletedExpense(null);
  };

  const clearUndoDelete = () => {
    setLastDeletedExpense(null);
  };

  const resetTrip = () => {
    setData({ setup: null, expenses: [] });
    localStorage.removeItem(STORAGE_KEY);
  };

  const toggleLock = (locked: boolean) => {
    setData(prev => {
      if (!prev.setup) return prev;
      return {
        ...prev,
        setup: { ...prev.setup, lockPreviousDays: locked }
      };
    });
  };

  const restoreData = (setup: TripSetup, expenses: Expense[]) => {
    setData(normalizeData({ setup, expenses }));
  };

  const addPreset = (preset: Omit<QuickAddPreset, 'id'>) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setPresets(prev => [...prev, { ...preset, id }]);
  };

  const updatePreset = (id: string, preset: Omit<QuickAddPreset, 'id'>) => {
    setPresets(prev => prev.map(p => p.id === id ? { ...preset, id } : p));
  };

  const deletePreset = (id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  };

  const togglePresetFavorite = (id: string) => {
    setPresets(prev =>
      prev.map(p => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
    );
  };

  return {
    data,
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
    togglePresetFavorite
  };
}
