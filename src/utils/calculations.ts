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
}

export interface TripData {
  setup: TripSetup | null;
  expenses: Expense[];
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

const getShareMap = (expense: Expense, peopleInExpense: string[]): Record<string, number> => {
  if (peopleInExpense.length === 0) return {};

  if (expense.splitType === 'custom' && expense.splitMap) {
    return peopleInExpense.reduce((acc, person) => {
      const value = Number(expense.splitMap?.[person] || 0);
      if (value > 0) acc[person] = value;
      return acc;
    }, {} as Record<string, number>);
  }

  const split = expense.amount / peopleInExpense.length;
  return peopleInExpense.reduce((acc, person) => {
    acc[person] = split;
    return acc;
  }, {} as Record<string, number>);
};

export const calculateSettlement = (setup: TripSetup | null, expenses: Expense[]): SettlementSummary => {
  const people = getTripPeople(setup);
  const balances = people.reduce((acc, person) => {
    acc[person] = 0;
    return acc;
  }, {} as Record<string, number>);

  expenses.forEach((expense) => {
    const participants = expense.participants && expense.participants.length > 0
      ? expense.participants
      : people;

    if (!expense.paidBy || !Object.prototype.hasOwnProperty.call(balances, expense.paidBy)) {
      return;
    }

    balances[expense.paidBy] += expense.amount;

    const shareMap = getShareMap(expense, participants);
    Object.entries(shareMap).forEach(([person, share]) => {
      if (Object.prototype.hasOwnProperty.call(balances, person)) {
        balances[person] -= share;
      }
    });
  });

  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < -0.01)
    .map(([person, amount]) => ({ person, amount: Math.abs(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0.01)
    .map(([person, amount]) => ({ person, amount }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const transfer = Math.min(debtor.amount, creditor.amount);

    if (transfer > 0.01) {
      transfers.push({
        from: debtor.person,
        to: creditor.person,
        amount: toRounded(transfer)
      });
    }

    debtor.amount = toRounded(debtor.amount - transfer);
    creditor.amount = toRounded(creditor.amount - transfer);

    if (debtor.amount <= 0.01) debtorIndex += 1;
    if (creditor.amount <= 0.01) creditorIndex += 1;
  }

  return {
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, toRounded(v)])),
    transfers,
    totalToSettle: toRounded(transfers.reduce((sum, transfer) => sum + transfer.amount, 0))
  };
};

export const calculateStats = (tripData: TripData) => {
  const { setup, expenses } = tripData;
  if (!setup) return null;

  // Single pass — compute total, today, yesterday simultaneously
  let totalSpent = 0;
  let todaySpent = 0;
  let yesterdaySpent = 0;

  for (const exp of expenses) {
    totalSpent += exp.amount;
    if (isToday(parseISO(exp.date))) todaySpent += exp.amount;
    else if (isYesterday(parseISO(exp.date))) yesterdaySpent += exp.amount;
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

  // Active trip window only; pre-trip should not distort burn-rate warnings.
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
    borderColor
  };
};
