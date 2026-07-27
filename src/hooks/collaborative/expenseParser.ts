import { Expense, TripSetup } from '../../utils/calculations';
import { FirestoreRecord, toIso } from './utils';

export const toExpense = (expenseId: string, payload: FirestoreRecord, setup?: TripSetup | null): Expense | null => {
  if (typeof payload.amount !== 'number') return null;
  if (typeof payload.category !== 'string') return null;
  if (typeof payload.date !== 'string') return null;

  const amount = payload.amount;
  const category = payload.category;
  const date = payload.date;
  const paidBy = typeof payload.payerId === 'string' ? payload.payerId : (typeof payload.paidBy === 'string' ? payload.paidBy : '');
  const participants = Array.isArray(payload.participantIds)
    ? payload.participantIds
    : Array.isArray(payload.participants)
      ? payload.participants
      : [];

  const registry = setup?.memberRegistry;
  const legacyParticipants = Array.isArray(setup?.participants) ? setup.participants : [];
  const participantLookup = new Map<string, string[]>();
  if (!registry && legacyParticipants.length > 0) {
    legacyParticipants.forEach((name) => {
      const key = name.trim();
      const current = participantLookup.get(key) || [];
      current.push(key);
      participantLookup.set(key, current);
    });
  }

  const resolveLegacy = (value: string) => {
    if (registry) return value;
    const trimmed = value.trim();
    if (participantLookup.has(trimmed)) {
      const matches = participantLookup.get(trimmed)!;
      return matches[0] || value;
    }
    return value;
  };

  return {
    id: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : expenseId,
    amount,
    category,
    date,
    paidBy: paidBy ? resolveLegacy(paidBy) : paidBy,
    participants: participants.map((participant) => resolveLegacy(participant)),
    note: typeof payload.note === 'string' ? payload.note : undefined,
    splitType: payload.splitType === 'custom' ? 'custom' : 'equal',
    splitMap: typeof payload.splitMap === 'object' && payload.splitMap !== null ? payload.splitMap as Record<string, number> : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: toIso(payload.createdAt),
    updatedAt: toIso(payload.updatedAt),
    createdBy: typeof payload.createdBy === 'string' ? payload.createdBy : undefined,
  } as Expense & { createdBy?: string };
};

export const remapExpensesToMemberIds = (expenses: Expense[], setup: TripSetup | null): Expense[] => {
  if (!setup) return expenses;

  const registry = setup.memberRegistry;
  const legacyParticipants = Array.isArray(setup.participants) ? setup.participants : [];
  const nameQueues = new Map<string, string[]>();

  if (registry) {
    Object.values(registry).forEach((member) => {
      const key = member.name.trim();
      const current = nameQueues.get(key) || [];
      current.push(member.memberId);
      nameQueues.set(key, current);
    });
  } else if (legacyParticipants.length > 0) {
    legacyParticipants.forEach((name, index) => {
      const key = name.trim();
      const current = nameQueues.get(key) || [];
      current.push(`legacy_${index}_${key}`);
      nameQueues.set(key, current);
    });
  }

  const resolve = (value: string) => {
    if (!value) return value;
    if (registry && registry[value]) return value;
    const trimmed = value.trim();
    for (const member of Object.values(registry || {})) {
      if (member.memberId === trimmed) return value;
    }
    const current = nameQueues.get(trimmed);
    return current?.[0] || value;
  };

  let hasChanges = false;

  const remapped = expenses.map((expense) => {
    const newPaidBy = resolve(expense.paidBy);
    const newParticipants = Array.isArray(expense.participants) ? expense.participants.map(resolve) : expense.participants;
    
    let newSplitMap = expense.splitMap;
    if (expense.splitMap) {
      newSplitMap = Object.fromEntries(Object.entries(expense.splitMap).map(([key, amount]) => [resolve(key), amount]));
    }

    if (
      newPaidBy !== expense.paidBy ||
      JSON.stringify(newParticipants) !== JSON.stringify(expense.participants) ||
      JSON.stringify(newSplitMap) !== JSON.stringify(expense.splitMap)
    ) {
      hasChanges = true;
      return {
        ...expense,
        paidBy: newPaidBy,
        participants: newParticipants,
        splitMap: newSplitMap,
      };
    }
    return expense;
  });

  return hasChanges ? remapped : expenses;
};
