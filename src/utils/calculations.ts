import { differenceInDays, isToday, isYesterday, parseISO, startOfDay } from 'date-fns';

export interface TripSetup {
  peopleCount: number;
  budgetPerPerson: number;
  totalBudget: number;
  startDate: string;
  endDate: string;
  lockPreviousDays: boolean;
  participants?: string[];
  participantUpiIds?: Record<string, string>;
  customCategories?: string[];
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  note?: string;
  date: string;
  paidBy: string;
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
}

export interface TripsContainer {
  trips: Trip[];
  activeTrip: string | null;
}

export interface SettlementTransfer {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementSummary {
  balances: Record<string, number>;
  transfers: SettlementTransfer[];
  totalToSettle: number;
}

export const getDefaultCategories = (): string[] => ['Food', 'Travel', 'Stay', 'Misc'];

export const getTripPeople = (setup: TripSetup | null): string[] => {
  if (!setup) return [];

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

  const people = getTripPeople(setup);
  const balances: Record<string, number> = {};

  for (let i = 0; i < people.length; i++) {
    balances[people[i]] = 0;
  }

  for (let i = 0; i < expenses.length; i++) {
    const expense = expenses[i];

    const payer = expense.paidBy;
    if (!payer || balances[payer] === undefined) continue;

    const participants =
      expense.participants && expense.participants.length > 0
        ? expense.participants
        : people;

    balances[payer] += expense.amount;

    const shareMap = getShareMap(expense, participants);

    for (const person in shareMap) {
      if (balances[person] !== undefined) {
        balances[person] -= shareMap[person];
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

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];

  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];

    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > EPSILON) {
      transfers.push({
        from: debtor.person,
        to: creditor.person,
        amount: toRounded(amount)
      });
    }

    debtor.amount = toRounded(debtor.amount - amount);
    creditor.amount = toRounded(creditor.amount - amount);

    if (debtor.amount <= EPSILON) d++;
    if (creditor.amount <= EPSILON) c++;
  }

  let total = 0;
  for (let i = 0; i < transfers.length; i++) {
    total += transfers[i].amount;
  }

  const roundedBalances: Record<string, number> = {};
  for (const k in balances) {
    roundedBalances[k] = toRounded(balances[k]);
  }

  return {
    balances: roundedBalances,
    transfers,
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