import { differenceInDays, isToday, isYesterday, parseISO, startOfDay } from 'date-fns';

/**
 * Stable identity record for a trip participant.
 * `memberId` is a UUID assigned once at creation and never changes.
 */
export interface MemberRecord {
  memberId: string;    // UUID, immutable, generated once at creation
  name: string;        // mutable display name, 1–50 chars after trim
  isActive: boolean;   // false = soft-deleted
  joinedAt: string;    // ISO timestamp, set at creation, immutable
  leftAt?: string;     // ISO timestamp, set on soft-delete, cleared on restore
  color?: string;      // optional hex or Tailwind token for avatar badge
}

/** Authoritative map of memberId → MemberRecord for a trip. */
export type MemberRegistry = Record<string, MemberRecord>; // keyed by memberId

export interface TripSetup {
  peopleCount: number;
  budgetPerPerson: number;
  totalBudget: number;
  startDate: string;
  endDate: string;
  lockPreviousDays: boolean;
  /** @deprecated Legacy name-string list. Kept for migration detection; removed after migration completes. */
  participants?: string[];
  /** Stable UUID-keyed member map. Replaces `participants[]` after migration. */
  memberRegistry?: MemberRegistry;
  participantPhoneNumbers?: Record<string, string>;
  participantUpiIds?: Record<string, string>;
  customCategories?: string[];
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  note?: string;
  date: string;
  /** memberId of the payer. Stores a name string in legacy trips; stores memberId after migration. */
  paidBy: string;
  /** memberIds of participants in this expense. Stores name strings in legacy trips; stores memberIds after migration. */
  participants?: string[];
  splitType?: 'equal' | 'custom';
  splitMap?: Record<string, number>;
  tags?: string[];
  receipts?: Array<{
    image: string;
    name?: string;
  }>;
  receiptImage?: string;
  receiptName?: string;
  ocrText?: string;
  isAiCategorized?: boolean;
  createdAt?: string; // ISO timestamp — set on creation, not on edit
  updatedAt?: string; // ISO timestamp — set on creation and edit
}

export interface TripData {
  setup: TripSetup | null;
  expenses: Expense[];
  deletedExpenseMap?: Record<string, string>; // expenseId -> deletedAt ISO
}

export interface Trip {
  id: string;
  name: string;
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  data: TripData;
  /** Whether this trip's invite code currently accepts new joins (cloud trips only). */
  inviteActive?: boolean;
}

export interface TripsContainer {
  trips: Trip[];
  activeTrip: string | null;
}

export interface SettlementTransfer {
  /** memberId of the payer. Stores a name string in legacy trips; stores memberId after migration. */
  from: string;
  /** memberId of the receiver. Stores a name string in legacy trips; stores memberId after migration. */
  to: string;
  amount: number;
}

export interface SettlementSummary {
  balances: Record<string, number>;
  transfers: SettlementTransfer[];
  totalToSettle: number;
}

const toIsoTime = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRegistryMembers = (setup: TripSetup | null, includeInactive = false): MemberRecord[] => {
  if (!setup?.memberRegistry) return [];
  return Object.values(setup.memberRegistry)
    .filter((member) => includeInactive || member.isActive)
    .sort((left, right) => {
      const leftTime = toIsoTime(left.joinedAt);
      const rightTime = toIsoTime(right.joinedAt);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.memberId.localeCompare(right.memberId);
    });
};

const getTripMemberIds = (setup: TripSetup | null, includeInactive = false): string[] => {
  if (!setup) return [];
  if (setup.memberRegistry) {
    return getRegistryMembers(setup, includeInactive).map((member) => member.memberId);
  }
  if (Array.isArray(setup.participants) && setup.participants.length > 0) {
    return setup.participants;
  }
  if (setup.peopleCount > 0) {
    return Array.from({ length: setup.peopleCount }, (_, i) => `Person ${i + 1}`);
  }
  return [];
};

const getDefaultCategories = (): string[] => ['Food', 'Travel', 'Stay', 'Misc'];

export const getTripPeople = (setup: TripSetup | null): string[] => {
  if (!setup) return [];

  if (setup.memberRegistry) {
    return getRegistryMembers(setup).map((member) => member.name);
  }

  if (Array.isArray(setup.participants) && setup.participants.length > 0) {
    return setup.participants;
  }

  if (setup.peopleCount > 0) {
    return Array.from({ length: setup.peopleCount }, (_, i) => `Person ${i + 1}`);
  }

  return [];
};

export const getTripCategories = (setup: TripSetup | null): string[] => {
  if (setup?.customCategories && setup.customCategories.length > 0) {
    return setup.customCategories;
  }
  return getDefaultCategories();
};

const toRounded = (value: number) => Math.round(value * 100) / 100;
const EPSILON = 0.01;

const mergeTransfers = (transfers: SettlementTransfer[]): SettlementTransfer[] => {
  const map = new Map<string, number>();

  for (let i = 0; i < transfers.length; i += 1) {
    const transfer = transfers[i];
    const key = `${transfer.from}|${transfer.to}`;
    map.set(key, toRounded((map.get(key) || 0) + transfer.amount));
  }

  const merged: SettlementTransfer[] = [];
  map.forEach((amount, key) => {
    if (amount <= EPSILON) return;
    const [from, to] = key.split('|');
    merged.push({ from, to, amount: toRounded(amount) });
  });

  return merged;
};

const getShareMap = (expense: Expense, peopleInExpense: string[]): Record<string, number> => {
  if (peopleInExpense.length === 0) return {};

  if (expense.splitType === 'custom' && expense.splitMap) {
    const customMap = expense.splitMap;
    const acc: Record<string, number> = {};
    for (const person of peopleInExpense) {
      const value = Number(customMap[person] || 0);
      if (value > 0) acc[person] = value;
    }
    return acc;
  }

  const split = expense.amount / peopleInExpense.length;
  const acc: Record<string, number> = {};
  for (const person of peopleInExpense) {
    acc[person] = split;
  }
  return acc;
};

export const calculateSettlement = (
  setup: TripSetup | null,
  expenses: Expense[]
): SettlementSummary => {

  if (!setup) {
    return { balances: {}, transfers: [], totalToSettle: 0 };
  }

  const people = setup.memberRegistry
    ? getTripMemberIds(setup, true)
    : getTripPeople(setup);
  const balances: Record<string, number> = {};
  const legacyNameToId = setup.memberRegistry
    ? Object.values(setup.memberRegistry).reduce<Record<string, string>>((acc, member) => {
        acc[member.name] = member.memberId;
        return acc;
      }, {})
    : null;
  const resolvePerson = (value: string | undefined): string | null => {
    if (!value) return null;
    if (balances[value] !== undefined) return value;
    if (legacyNameToId && legacyNameToId[value] && balances[legacyNameToId[value]] !== undefined) {
      return legacyNameToId[value];
    }
    return null;
  };

  for (let i = 0; i < people.length; i++) {
    balances[people[i]] = 0;
  }

  for (let i = 0; i < expenses.length; i++) {
    const expense = expenses[i];

    const payer = resolvePerson(expense.paidBy);
    if (!payer) continue;

    const participants =
      expense.participants && expense.participants.length > 0
        ? expense.participants
        : people;

    balances[payer] += expense.amount;

    const shareMap = getShareMap(expense, participants);

    for (const person in shareMap) {
      const resolvedParticipant = resolvePerson(person);
      if (resolvedParticipant) {
        balances[resolvedParticipant] -= shareMap[person];
      }
    }
  }

  const debtors: { person: string; amount: number }[] = [];
  const creditors: { person: string; amount: number }[] = [];

  for (const person in balances) {
    const amount = balances[person];

    if (amount < -EPSILON) {
      debtors.push({ person, amount: -amount });
    } else if (amount > EPSILON) {
      creditors.push({ person, amount });
    }
  }

  const transfers: SettlementTransfer[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    // Drop settled rows to keep loops tight.
    for (let i = debtors.length - 1; i >= 0; i -= 1) {
      if (debtors[i].amount <= EPSILON) debtors.splice(i, 1);
    }
    for (let i = creditors.length - 1; i >= 0; i -= 1) {
      if (creditors[i].amount <= EPSILON) creditors.splice(i, 1);
    }

    if (debtors.length === 0 || creditors.length === 0) break;

    // First try exact pairing to reduce transfer count.
    let exactMatched = false;
    for (let d = 0; d < debtors.length && !exactMatched; d += 1) {
      for (let c = 0; c < creditors.length; c += 1) {
        if (Math.abs(debtors[d].amount - creditors[c].amount) > EPSILON) continue;

        const amount = Math.min(debtors[d].amount, creditors[c].amount);
        transfers.push({
          from: debtors[d].person,
          to: creditors[c].person,
          amount: toRounded(amount)
        });

        debtors[d].amount = 0;
        creditors[c].amount = 0;
        exactMatched = true;
        break;
      }
    }

    if (exactMatched) continue;

    // Fall back to max debtor vs max creditor.
    let debtorIndex = 0;
    for (let i = 1; i < debtors.length; i += 1) {
      if (debtors[i].amount > debtors[debtorIndex].amount) debtorIndex = i;
    }

    let creditorIndex = 0;
    for (let i = 1; i < creditors.length; i += 1) {
      if (creditors[i].amount > creditors[creditorIndex].amount) creditorIndex = i;
    }

    const amount = Math.min(debtors[debtorIndex].amount, creditors[creditorIndex].amount);

    if (amount > EPSILON) {
      transfers.push({
        from: debtors[debtorIndex].person,
        to: creditors[creditorIndex].person,
        amount: toRounded(amount)
      });
    }

    debtors[debtorIndex].amount = toRounded(debtors[debtorIndex].amount - amount);
    creditors[creditorIndex].amount = toRounded(creditors[creditorIndex].amount - amount);
  }

  const optimizedTransfers = mergeTransfers(transfers);

  let total = 0;
  for (let i = 0; i < optimizedTransfers.length; i++) {
    total += optimizedTransfers[i].amount;
  }

  const roundedBalances: Record<string, number> = {};
  for (const k in balances) {
    roundedBalances[k] = toRounded(balances[k]);
  }

  return {
    balances: roundedBalances,
    transfers: optimizedTransfers,
    totalToSettle: toRounded(total)
  };
};

export const calculateStats = (tripData: TripData) => {
  const { setup, expenses } = tripData;
  if (!setup) return null;

  let totalSpent = 0;
  let todaySpent = 0;
  let yesterdaySpent = 0;

  for (const exp of expenses) {
    totalSpent += exp.amount;
    const expenseDate = parseISO(exp.date);
    if (isToday(expenseDate)) todaySpent += exp.amount;
    else if (isYesterday(expenseDate)) yesterdaySpent += exp.amount;
  }

  const remainingBalance = setup.totalBudget - totalSpent;
  const perPersonSpend = setup.peopleCount > 0 ? totalSpent / setup.peopleCount : 0;
  const remainingPercentage = (remainingBalance / setup.totalBudget) * 100;

  const today = startOfDay(new Date());
  const tripStart = startOfDay(parseISO(setup.startDate));
  const tripEnd = startOfDay(parseISO(setup.endDate));
  const totalDays = Math.max(1, differenceInDays(tripEnd, tripStart) + 1);

  const hasStarted = today >= tripStart;
  const hasEnded = today > tripEnd;

  const daysPassed = hasStarted ? Math.max(1, differenceInDays(today, tripStart) + 1) : 0;
  const daysRemaining = hasEnded
    ? 0
    : hasStarted
      ? Math.max(0, differenceInDays(tripEnd, today))
      : totalDays;

  const dailyBurnRate = daysPassed > 0 ? totalSpent / daysPassed : 0;
  const remainingPerDay = daysRemaining > 0 ? remainingBalance / daysRemaining : remainingBalance;
  const budgetLastsDays = dailyBurnRate > 0 ? remainingBalance / dailyBurnRate : Infinity;
  const projectedEndBalance = hasStarted
    ? remainingBalance - (dailyBurnRate * daysRemaining)
    : remainingBalance;
  const projectedDeficit = projectedEndBalance < 0 ? Math.abs(projectedEndBalance) : 0;
  const isOverspending = remainingBalance < 0 || (hasStarted && daysRemaining > 0 && dailyBurnRate > remainingPerDay);

  let statusColor = 'text-green-500';
  let bgColor = 'bg-green-50';
  let borderColor = 'border-green-200';

  if (remainingPercentage < 20) {
    statusColor = 'text-red-500';
    bgColor = 'bg-red-50';
    borderColor = 'border-red-200';
  } else if (remainingPercentage <= 50) {
    statusColor = 'text-orange-500';
    bgColor = 'bg-orange-50';
    borderColor = 'border-orange-200';
  }

  return {
    totalSpent,
    remainingBalance,
    perPersonSpend,
    remainingPercentage,
    todaySpent,
    yesterdaySpent,
    dailyBurnRate,
    remainingPerDay,
    budgetLastsDays,
    projectedEndBalance,
    projectedDeficit,
    isOverspending,
    totalDays,
    daysRemaining,
    statusColor,
    bgColor,
    borderColor,
  };
};