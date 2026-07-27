import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { firestore } from '../lib/firebase';
import {
  SettlementHistoryEntry,
  SettlementHistoryAction,
  loadSettlementHistory,
  appendSettlementHistory,
  clearSettlementHistory,
} from '../utils/settlementHistory';

interface UseSettlementHistoryInput {
  tripId: string | null;
  isCollaborative: boolean;
}

const roundCurrency = (v: number) => Math.round(v * 100) / 100;

const createHistoryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `sh_${crypto.randomUUID()}`
    : `sh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const toEntry = (id: string, data: Record<string, unknown>): SettlementHistoryEntry | null => {
  const action = data.action;
  if (action !== 'settled' && action !== 'undo') return null;
  if (typeof data.from !== 'string' || typeof data.to !== 'string') return null;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount)) return null;
  const createdAt =
    typeof data.createdAt === 'string'
      ? data.createdAt
      : data.createdAt && typeof (data.createdAt as { toDate?: () => Date }).toDate === 'function'
        ? (data.createdAt as { toDate: () => Date }).toDate().toISOString()
        : new Date().toISOString();

  return {
    id,
    action: action as SettlementHistoryAction,
    from: data.from,
    to: data.to,
    amount: roundCurrency(amount),
    note: typeof data.note === 'string' ? data.note : undefined,
    proofImage: typeof data.proofImage === 'string' ? data.proofImage : undefined,
    proofName: typeof data.proofName === 'string' ? data.proofName : undefined,
    createdAt,
  };
};

export function useSettlementHistory({ tripId, isCollaborative }: UseSettlementHistoryInput) {
  const [entries, setEntries] = useState<SettlementHistoryEntry[]>(() =>
    isCollaborative ? [] : loadSettlementHistory()
  );

  // Real-time listener for collaborative mode
  useEffect(() => {
    if (!isCollaborative || !tripId || !firestore) return;

    const historyRef = collection(firestore, 'trips', tripId, 'settlementHistory');
    const unsubscribe = onSnapshot(historyRef, (snap) => {
      const next: SettlementHistoryEntry[] = [];
      snap.docs.forEach((d) => {
        const parsed = toEntry(d.id, d.data() as Record<string, unknown>);
        if (parsed) next.push(parsed);
      });
      // Sort newest first
      next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setEntries(next.slice(0, 500));
    });

    return () => unsubscribe();
  }, [isCollaborative, tripId]);

  const append = useCallback(
    async (input: {
      action: SettlementHistoryAction;
      from: string;
      to: string;
      amount: number;
      note?: string;
      proofImage?: string;
      proofName?: string;
    }) => {
      if (isCollaborative && tripId && firestore) {
        const id = createHistoryId();
        const ref = doc(firestore, 'trips', tripId, 'settlementHistory', id);
        await setDoc(ref, {
          action: input.action,
          from: input.from,
          to: input.to,
          amount: roundCurrency(input.amount),
          note: input.note?.trim() || null,
          proofImage: input.proofImage || null,
          proofName: input.proofName || null,
          createdAt: serverTimestamp(),
        });
      } else {
        const updated = appendSettlementHistory(input);
        setEntries(updated);
      }
    },
    [isCollaborative, tripId]
  );

  const clear = useCallback(() => {
    if (!isCollaborative) {
      clearSettlementHistory();
      setEntries([]);
    }
    // In collaborative mode, clearing is not supported (audit trail should be preserved)
  }, [isCollaborative]);

  return { entries, append, clear, isCollaborative };
}
