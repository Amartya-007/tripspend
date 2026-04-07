export type SettlementHistoryAction = 'settled' | 'undo';

export interface SettlementHistoryEntry {
  id: string;
  action: SettlementHistoryAction;
  from: string;
  to: string;
  amount: number;
  note?: string;
  proofImage?: string;
  proofName?: string;
  createdAt: string;
}

interface AppendSettlementHistoryInput {
  action: SettlementHistoryAction;
  from: string;
  to: string;
  amount: number;
  note?: string;
  proofImage?: string;
  proofName?: string;
}

const STORAGE_KEY = 'tripspend_settlement_history_v1';
const MAX_HISTORY = 500;

export const loadSettlementHistory = (): SettlementHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SettlementHistoryEntry[]) : [];
  } catch {
    return [];
  }
};

const saveSettlementHistory = (entries: SettlementHistoryEntry[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
};

export const clearSettlementHistory = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const appendSettlementHistory = (input: AppendSettlementHistoryInput): SettlementHistoryEntry[] => {
  const nextEntry: SettlementHistoryEntry = {
    id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    action: input.action,
    from: input.from,
    to: input.to,
    amount: Math.round(input.amount * 100) / 100,
    note: input.note?.trim() || undefined,
    proofImage: input.proofImage,
    proofName: input.proofName,
    createdAt: new Date().toISOString(),
  };

  const prev = loadSettlementHistory();
  const next = [nextEntry, ...prev].slice(0, MAX_HISTORY);
  saveSettlementHistory(next);
  return next;
};
