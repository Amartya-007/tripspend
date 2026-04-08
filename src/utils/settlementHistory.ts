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

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const createHistoryId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sh_${crypto.randomUUID()}`;
  }
  return `sh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

const isAction = (value: unknown): value is SettlementHistoryAction => value === 'settled' || value === 'undo';

const toEntry = (value: unknown): SettlementHistoryEntry | null => {
  if (!value || typeof value !== 'object') return null;

  const entry = value as Partial<SettlementHistoryEntry>;
  if (!entry.id || typeof entry.id !== 'string') return null;
  if (!isAction(entry.action)) return null;
  if (typeof entry.from !== 'string' || typeof entry.to !== 'string') return null;
  if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount)) return null;
  if (typeof entry.createdAt !== 'string') return null;

  return {
    id: entry.id,
    action: entry.action,
    from: entry.from,
    to: entry.to,
    amount: roundCurrency(entry.amount),
    note: typeof entry.note === 'string' ? entry.note : undefined,
    proofImage: typeof entry.proofImage === 'string' ? entry.proofImage : undefined,
    proofName: typeof entry.proofName === 'string' ? entry.proofName : undefined,
    createdAt: entry.createdAt,
  };
};

export const loadSettlementHistory = (): SettlementHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toEntry)
      .filter((entry): entry is SettlementHistoryEntry => entry !== null)
      .slice(0, MAX_HISTORY);
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
    id: createHistoryId(),
    action: input.action,
    from: input.from,
    to: input.to,
    amount: roundCurrency(input.amount),
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
