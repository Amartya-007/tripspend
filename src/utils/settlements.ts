// Structured settlement storage — replaces the old string-key Set approach

export interface SettledTransfer {
  from: string;
  to: string;
  amount: number;
  settledAt: string; // ISO timestamp
  note?: string;
  proofImage?: string;
  proofName?: string;
}

const STORAGE_KEY = 'tripspend_settled_v2';

export const loadSettledTransfers = (): SettledTransfer[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SettledTransfer[]) : [];
  } catch {
    return [];
  }
};

const save = (transfers: SettledTransfer[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers));
};

// Exact match: from + to + amount (rounded to 2dp to avoid float drift)
const matches = (a: SettledTransfer, from: string, to: string, amount: number) =>
  a.from === from && a.to === to && Math.round(a.amount * 100) === Math.round(amount * 100);

export const isSettled = (settled: SettledTransfer[], from: string, to: string, amount: number) =>
  settled.some(s => matches(s, from, to, amount));

export const markSettled = (settled: SettledTransfer[], from: string, to: string, amount: number): SettledTransfer[] => {
  if (isSettled(settled, from, to, amount)) return settled;
  const next = [...settled, { from, to, amount, settledAt: new Date().toISOString() }];
  save(next);
  return next;
};

export interface SettlementMeta {
  note?: string;
  proofImage?: string;
  proofName?: string;
}

export const markSettledWithMeta = (
  settled: SettledTransfer[],
  from: string,
  to: string,
  amount: number,
  meta?: SettlementMeta
): SettledTransfer[] => {
  if (isSettled(settled, from, to, amount)) return settled;
  const next = [
    ...settled,
    {
      from,
      to,
      amount,
      settledAt: new Date().toISOString(),
      note: meta?.note?.trim() || undefined,
      proofImage: meta?.proofImage,
      proofName: meta?.proofName,
    }
  ];
  save(next);
  return next;
};

export const unmarkSettled = (settled: SettledTransfer[], from: string, to: string, amount: number): SettledTransfer[] => {
  const next = settled.filter(s => !matches(s, from, to, amount));
  save(next);
  return next;
};

// Remove stale entries — transfers that no longer exist in current calculation
export const pruneStale = (settled: SettledTransfer[], currentTransfers: { from: string; to: string; amount: number }[]): SettledTransfer[] => {
  const pruned = settled.filter(s =>
    currentTransfers.some(t => matches(s, t.from, t.to, t.amount))
  );
  if (pruned.length !== settled.length) save(pruned);
  return pruned;
};
