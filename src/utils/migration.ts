import { TripData, TripSetup, Expense, MemberRecord } from './calculations';

const createMemberId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `member_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

const cloneExpense = (expense: Expense): Expense => ({
  ...expense,
  participants: Array.isArray(expense.participants) ? [...expense.participants] : expense.participants,
  splitMap: expense.splitMap ? { ...expense.splitMap } : expense.splitMap,
  tags: Array.isArray(expense.tags) ? [...expense.tags] : expense.tags,
  receipts: Array.isArray(expense.receipts) ? expense.receipts.map((receipt) => ({ ...receipt })) : expense.receipts,
});

const createLookup = (participants: string[]) => {
  const queues = new Map<string, string[]>();
  const orderedIds: string[] = [];

  participants.forEach((name) => {
    const memberId = createMemberId();
    orderedIds.push(memberId);
    const key = name.trim();
    const current = queues.get(key) || [];
    current.push(memberId);
    queues.set(key, current);
  });

  const consume = (name: string) => {
    const key = name.trim();
    const current = queues.get(key);
    if (!current || current.length === 0) {
      return null;
    }
    const next = current.shift() || null;
    if (current.length > 0) queues.set(key, current);
    else queues.delete(key);
    return next;
  };

  const peek = (name: string) => {
    const key = name.trim();
    const current = queues.get(key);
    return current?.[0] || null;
  };

  return { consume, peek, orderedIds };
};

const remapValue = (value: unknown, consume: (name: string) => string | null) => {
  if (typeof value !== 'string') return value;
  return consume(value) || value;
};

export function migrateLegacyParticipants(data: TripData): TripData {
  try {
    if (!data?.setup) return data;
    if (data.setup.memberRegistry) return data;
    if (!Array.isArray(data.setup.participants) || data.setup.participants.length === 0) {
      return data;
    }

    const participants = data.setup.participants.map((participant) => participant.trim()).filter(Boolean);
    if (participants.length === 0) return data;

    const lookup = createLookup(participants);
    const registry: Record<string, MemberRecord> = {};

    participants.forEach((name, index) => {
      const memberId = lookup.orderedIds[index];
      registry[memberId] = {
        memberId,
        name,
        isActive: true,
        joinedAt: new Date(Date.now() + index).toISOString(),
      };
    });

    const remappedExpenses = data.expenses.map((expense) => {
      const next = cloneExpense(expense);
      next.paidBy = remapValue(next.paidBy, lookup.consume) as string;
      if (Array.isArray(next.participants)) {
        next.participants = next.participants.map((participant) => remapValue(participant, lookup.consume) as string);
      }
      if (next.splitMap) {
        const nextSplitMap: Record<string, number> = {};
        for (const [key, amount] of Object.entries(next.splitMap)) {
          const nextKey = remapValue(key, lookup.consume) as string;
          nextSplitMap[nextKey] = amount;
        }
        next.splitMap = nextSplitMap;
      }
      return next;
    });

    const nextSetup: TripSetup = {
      ...data.setup,
      memberRegistry: registry,
    };
    delete (nextSetup as { participants?: string[] }).participants;

    return {
      ...data,
      setup: nextSetup,
      expenses: remappedExpenses,
    };
  } catch (error) {
    console.error('Failed to migrate legacy participants', error);
    return data;
  }
}
