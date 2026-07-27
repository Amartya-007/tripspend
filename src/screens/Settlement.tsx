import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TripData, TripSetup, Expense, calculateSettlement, getTripPeople } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { ArrowRight, CheckCircle2, Check, RotateCcw, X, ImagePlus, MessageSquare, FileImage, Clock, Banknote } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  SettledTransfer,
  loadSettledTransfers,
  markSettledWithMeta,
  unmarkSettled,
  pruneStale,
} from '../utils/settlements.ts';
import { useSettlementHistory } from '../hooks/useSettlementHistory.ts';
import { firestore } from '../lib/firebase';
import { MAX_SETTLEMENT_NOTE_LENGTH } from '../utils/constants.ts';
import { showCounter } from '../utils/validation.ts';
import { buildDisplayNameMap } from '../utils/memberDisplay';
import { buildSettlementWritePayload } from '../utils/memberManagementCore';

interface ConfirmPayload {
  from: string;
  to: string;
  amount: number;
}

interface TransferBreakdownItem {
  label: string;
  date?: string;
  expenseId: string;
  paidBy: string;
  total: number;
  signedAmount: number;
  relation: 'fromOwesTo' | 'toOwesFrom';
  fromShare: number;
  toShare: number;
}

// Tracks transfers where sender has marked as paid but receiver hasn't confirmed yet
interface PaidTransfer {
  from: string;
  to: string;
  amount: number;
  paidAt: string;
  note?: string;
  proofImage?: string;
  proofName?: string;
  fromMemberActive?: boolean;
  toMemberActive?: boolean;
  creatorOverride?: boolean;
}

interface SettlementProps {
  setup: TripSetup | null;
  expenses: Expense[];
  tripId?: string | null;
  userUid?: string | null;
  userDisplayName?: string | null;
  userEmail?: string | null;
  identityMap?: Record<string, string>;
  tripCreatorUid?: string | null;
  isCollaborative?: boolean;
  myMemberId?: string | null;
}

export const Settlement: React.FC<SettlementProps> = ({
  setup,
  expenses,
  tripId = null,
  userUid = null,
  userDisplayName = null,
  userEmail = null,
  identityMap = {},
  tripCreatorUid = null,
  isCollaborative = false,
  myMemberId: propMyMemberId = null,
}) => {
  const navigate = useNavigate();
  const proofInputRef = useRef<HTMLInputElement>(null);
  const registry = setup?.memberRegistry ?? {};
  const people = useMemo(() => (setup?.memberRegistry ? Object.keys(setup.memberRegistry) : getTripPeople(setup)), [setup]);
  const displayNames = useMemo(() => buildDisplayNameMap(registry, true), [registry]);
  const settlement = useMemo(
    () => calculateSettlement(setup, expenses),
    [setup, expenses]
  );
  
  // Debug: log settlement data
  useEffect(() => {
    console.log('[Settlement] MOUNTED with data:', { 
      memberCount: people.length, 
      setupExists: !!setup,
      expensesCount: expenses?.length ?? 0,
      transferCount: settlement.transfers.length,
      timestamp: new Date().toLocaleTimeString()
    });
  }, [people.length, setup, expenses, settlement]);

  // Special watcher for expenses changes
  useEffect(() => {
    console.log('[Settlement] EXPENSES CHANGED:', {
      newCount: expenses?.length ?? 0,
      transfers: settlement.transfers.map(t => ({ from: t.from, to: t.to, amount: t.amount })),
      timestamp: new Date().toLocaleTimeString()
    });
    
    // Log each expense being passed
    console.log('[Settlement] Expense list:', expenses?.map(e => ({
      id: e.id,
      amount: e.amount,
      date: e.date,
      paidBy: e.paidBy,
      participants: e.participants?.length ?? 0
    })) ?? []);
    
    // Calculate total from expenses for sanity check
    if (expenses && expenses.length > 0) {
      const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
      const transferTotal = settlement.transfers.reduce((sum, t) => sum + t.amount, 0);
      console.log('[Settlement] Sanity check:', {
        totalExpenseAmount: totalExpense,
        totalTransferAmount: transferTotal,
        match: Math.abs(totalExpense - transferTotal) < 0.01
      });
    }
  }, [expenses, settlement]);
  
  const myMemberId = useMemo(() => propMyMemberId || (userUid ? identityMap[userUid] ?? null : null), [propMyMemberId, identityMap, userUid]);
  const isCreator = Boolean(userUid && tripCreatorUid && userUid === tripCreatorUid);

  const { append: appendHistory } = useSettlementHistory({
    tripId: tripId ?? null,
    isCollaborative: Boolean(isCollaborative && tripId),
  });

  const [settled, setSettled] = useState<SettledTransfer[]>(() => {
    const loaded = loadSettledTransfers();
    // Prune stale entries on load
    return pruneStale(loaded, settlement.transfers);
  });

  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [settlementNote, setSettlementNote] = useState('');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [previewProof, setPreviewProof] = useState<string | null>(null);
  const [selectedBreakdown, setSelectedBreakdown] = useState<ConfirmPayload | null>(null);

  // paid = sender marked as paid, awaiting receiver confirmation
  // key: transferKey, value: PaidTransfer
  const [paidMap, setPaidMap] = useState<Map<string, PaidTransfer>>(new Map());

  // Which sheet is open: 'markPaid' (sender) | 'confirmReceived' (receiver) | null
  const [activeSheet, setActiveSheet] = useState<'markPaid' | 'confirmReceived' | null>(null);
  const [sheetPayload, setSheetPayload] = useState<ConfirmPayload | null>(null);

  const collaborativeEnabled = Boolean(isCollaborative && tripId && userUid && firestore);

  const toIso = useCallback((value: unknown): string => {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return new Date().toISOString();
  }, []);

  const transferKey = useCallback((from: string, to: string, amount: number) => {
    return `${from}|${to}|${Math.round(amount * 100)}`;
  }, []);

  const openBreakdown = useCallback((payload: ConfirmPayload) => {
    setSelectedBreakdown(payload);
  }, []);

  const closeBreakdown = useCallback(() => {
    setSelectedBreakdown(null);
  }, []);

  // Single pass: build both map and key set together
  const { settledMap, settledKeySet } = useMemo(() => {
    const map = new Map<string, SettledTransfer>();
    const keys = new Set<string>();
    for (const entry of settled) {
      const key = transferKey(entry.from, entry.to, entry.amount);
      map.set(key, entry);
      keys.add(key);
    }
    return { settledMap: map, settledKeySet: keys };
  }, [settled, transferKey]);

  const identitySet = useMemo(() => {
    const values = new Set<string>();
    const add = (value?: string | null) => {
      if (!value) return;
      const normalized = value.trim().toLowerCase();
      if (normalized) values.add(normalized);
    };
    // Claimed participant name takes priority — most reliable identity
    add(myMemberId);
    add(userDisplayName);
    add(userEmail);
    return values;
  }, [myMemberId, userDisplayName, userEmail]);

  const isReceiver = useCallback((to: string) => {
    if (!collaborativeEnabled) return true;
    return myMemberId === to;
  }, [collaborativeEnabled, myMemberId]);

  const isSender = useCallback((from: string) => {
    if (!collaborativeEnabled) return false;
    return myMemberId === from;
  }, [collaborativeEnabled, myMemberId]);

  const isFromMemberActive = useCallback((from: string) => registry[from]?.isActive !== false, [registry]);
  const isToMemberActive = useCallback((to: string) => registry[to]?.isActive !== false, [registry]);

  // Keep for guard checks in confirmSettle / handleUnmark
  const canSettleTransfer = useCallback((from: string, to: string) => {
    if (!collaborativeEnabled) return true;
    return myMemberId === to || myMemberId === from || (isCreator && (!isFromMemberActive(from) || !isToMemberActive(to)));
  }, [collaborativeEnabled, isCreator, isFromMemberActive, isToMemberActive, myMemberId]);

  useEffect(() => {
    if (!collaborativeEnabled || !tripId || !firestore) {
      return;
    }

    const settlementsRef = collection(firestore, 'trips', tripId, 'settlements');
    const unsubscribe = onSnapshot(settlementsRef, (snapshot) => {
      const nextSettled: SettledTransfer[] = [];
      const nextPaid = new Map<string, PaidTransfer>();

      snapshot.docs.forEach((entryDoc) => {
        const payload = entryDoc.data() as Record<string, unknown>;
        if (typeof payload.from !== 'string' || typeof payload.to !== 'string') return;
        const amount = Number(payload.amount);
        if (!Number.isFinite(amount)) return;

        if (payload.status === 'completed') {
          nextSettled.push({
            from: payload.from,
            to: payload.to,
            amount,
            settledAt: toIso(payload.completedAt || payload.updatedAt || payload.createdAt),
            fromUserId: typeof payload.fromUserId === 'string' ? payload.fromUserId : undefined,
            toUserId: typeof payload.toUserId === 'string' ? payload.toUserId : undefined,
            status: 'completed',
            note: typeof payload.note === 'string' ? payload.note : undefined,
            proofImage: typeof payload.proofImage === 'string' ? payload.proofImage : undefined,
            proofName: typeof payload.proofName === 'string' ? payload.proofName : undefined,
            creatorOverride: Boolean(payload.creatorOverride),
          });
        } else if (payload.status === 'paid') {
          const key = transferKey(payload.from, payload.to, amount);
          nextPaid.set(key, {
            from: payload.from,
            to: payload.to,
            amount,
            paidAt: toIso(payload.paidAt || payload.updatedAt || payload.createdAt),
            note: typeof payload.note === 'string' ? payload.note : undefined,
            proofImage: typeof payload.proofImage === 'string' ? payload.proofImage : undefined,
            proofName: typeof payload.proofName === 'string' ? payload.proofName : undefined,
            fromMemberActive: typeof payload.fromMemberActive === 'boolean' ? payload.fromMemberActive : undefined,
            toMemberActive: typeof payload.toMemberActive === 'boolean' ? payload.toMemberActive : undefined,
            creatorOverride: Boolean(payload.creatorOverride),
          });
        }
      });

      setSettled(pruneStale(nextSettled, settlement.transfers));
      setPaidMap(nextPaid);
    });

    return () => unsubscribe();
  }, [collaborativeEnabled, settlement.transfers, toIso, tripId]);

  useEffect(() => {
    if (collaborativeEnabled) return;
    setSettled((prev) => pruneStale(prev, settlement.transfers));
  }, [collaborativeEnabled, settlement.transfers]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read proof image'));
      reader.onloadend = () => {
        if (typeof reader.result !== 'string') { reject(new Error('Invalid file data')); return; }
        resolve(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handlePickProof = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setProofImage(dataUrl);
      setProofName(file.name);
    } catch {
      alert('Could not read selected image. Try another file.');
    } finally {
      e.target.value = '';
    }
  }, []);

  const resetSheet = useCallback(() => {    setActiveSheet(null);
    setSheetPayload(null);
    setSettlementNote('');
    setProofImage(null);
    setProofName(null);
  }, []);

  // Sender opens "Mark as paid" sheet
  const openMarkPaid = useCallback((payload: ConfirmPayload) => {
    setSheetPayload(payload);
    setSettlementNote('');
    setProofImage(null);
    setProofName(null);
    setActiveSheet('markPaid');
  }, []);

  // Receiver opens "Confirm received" sheet
  const openConfirmReceived = useCallback((payload: ConfirmPayload) => {
    // Pre-fill note/proof from paid state if available
    const key = transferKey(payload.from, payload.to, payload.amount);
    const paid = paidMap.get(key);
    setSheetPayload(payload);
    setSettlementNote(paid?.note || '');
    setProofImage(paid?.proofImage || null);
    setProofName(paid?.proofName || null);
    setActiveSheet('confirmReceived');
  }, [paidMap, transferKey]);

  // Sender confirms: "I paid" → status becomes 'paid'
  const confirmMarkPaid = useCallback(async () => {
    if (!sheetPayload) return;
    const key = transferKey(sheetPayload.from, sheetPayload.to, sheetPayload.amount);
    const creatorOverride = Boolean(isCreator && !isFromMemberActive(sheetPayload.from));

    if (collaborativeEnabled && tripId && userUid && firestore) {
      try {
        const ref = doc(firestore, 'trips', tripId, 'settlements', key);
        await setDoc(ref, buildSettlementWritePayload({
          transfer: sheetPayload,
          status: 'paid',
          fromUserId: userUid,
          toUserId: null,
          fromMemberActive: isFromMemberActive(sheetPayload.from),
          toMemberActive: isToMemberActive(sheetPayload.to),
          creatorOverride,
          note: settlementNote,
          proofImage,
          proofName,
          nowIso: new Date().toISOString(),
        }), { merge: true });
      } catch (err) {
        console.error('Failed to mark as paid', err);
        alert('Could not update. Please try again.');
        return;
      }
    } else {
      // Local mode: store in paidMap
      setPaidMap(prev => {
        const next = new Map(prev);
        next.set(key, {
          from: sheetPayload.from,
          to: sheetPayload.to,
          amount: sheetPayload.amount,
          paidAt: new Date().toISOString(),
          note: settlementNote.trim() || undefined,
          proofImage: proofImage || undefined,
          proofName: proofName || undefined,
          fromMemberActive: isFromMemberActive(sheetPayload.from),
          toMemberActive: isToMemberActive(sheetPayload.to),
          creatorOverride,
        });
        return next;
      });
    }

    appendHistory({ action: 'settled', from: sheetPayload.from, to: sheetPayload.to, amount: sheetPayload.amount, note: settlementNote });
    resetSheet();
  }, [sheetPayload, collaborativeEnabled, tripId, userUid, settlementNote, proofImage, proofName, transferKey, appendHistory, resetSheet]);

  // Receiver confirms: "I received it" → status becomes 'completed'
  const confirmReceived = useCallback(async () => {
    if (!sheetPayload) return;
    const key = transferKey(sheetPayload.from, sheetPayload.to, sheetPayload.amount);
    const creatorOverride = Boolean(isCreator && !isToMemberActive(sheetPayload.to));

    if (collaborativeEnabled && tripId && userUid && firestore) {
      try {
        const ref = doc(firestore, 'trips', tripId, 'settlements', key);
        await setDoc(ref, buildSettlementWritePayload({
          transfer: sheetPayload,
          status: 'completed',
          fromUserId: null,
          toUserId: userUid,
          fromMemberActive: isFromMemberActive(sheetPayload.from),
          toMemberActive: isToMemberActive(sheetPayload.to),
          creatorOverride,
          note: settlementNote,
          proofImage,
          proofName,
          nowIso: new Date().toISOString(),
        }), { merge: true });
      } catch (err) {
        console.error('Failed to confirm received', err);
        alert('Could not update. Please try again.');
        return;
      }
    } else {
      setSettled(prev => markSettledWithMeta(prev, sheetPayload.from, sheetPayload.to, sheetPayload.amount, {
        note: settlementNote,
        proofImage: proofImage || undefined,
        proofName: proofName || undefined,
      }));
      setPaidMap(prev => { const next = new Map(prev); next.delete(key); return next; });
    }

    appendHistory({ action: 'settled', from: sheetPayload.from, to: sheetPayload.to, amount: sheetPayload.amount, note: settlementNote, proofImage: proofImage || undefined, proofName: proofName || undefined });
    resetSheet();
  }, [sheetPayload, collaborativeEnabled, tripId, userUid, settlementNote, proofImage, proofName, transferKey, appendHistory, resetSheet]);

  const handleUnmark = useCallback(async (from: string, to: string, amount: number) => {
    const key = transferKey(from, to, amount);

    if (collaborativeEnabled && tripId && firestore) {
      try {
        const ref = doc(firestore, 'trips', tripId, 'settlements', key);
        await updateDoc(ref, { status: 'pending', updatedAt: serverTimestamp() });
      } catch (err) {
        console.error('Failed to reopen settlement', err);
        alert('Could not reopen. Please try again.');
        return;
      }
    } else {
      setSettled(prev => unmarkSettled(prev, from, to, amount));
      setPaidMap(prev => { const next = new Map(prev); next.delete(key); return next; });
    }

    appendHistory({ action: 'undo', from, to, amount });
  }, [collaborativeEnabled, tripId, transferKey, appendHistory]);

  const { pendingTransfers, paidTransfers, settledTransfers } = useMemo(() => ({
    pendingTransfers: settlement.transfers.filter(t => {
      const key = transferKey(t.from, t.to, t.amount);
      return !settledKeySet.has(key) && !paidMap.has(key);
    }),
    paidTransfers: settlement.transfers.filter(t => {
      const key = transferKey(t.from, t.to, t.amount);
      return !settledKeySet.has(key) && paidMap.has(key);
    }),
    settledTransfers: settlement.transfers.filter(t => settledKeySet.has(transferKey(t.from, t.to, t.amount))),
  }), [settlement.transfers, settledKeySet, paidMap, transferKey]);

  const getExpenseShareMap = useCallback((expense: Expense, participants: string[]) => {
    if (participants.length === 0) return {} as Record<string, number>;

    if (expense.splitType === 'custom' && expense.splitMap) {
      const custom: Record<string, number> = {};
      for (let i = 0; i < participants.length; i += 1) {
        const person = participants[i];
        const value = Number(expense.splitMap[person] || 0);
        if (value > 0) custom[person] = value;
      }
      if (Object.keys(custom).length > 0) return custom;
    }

    const equalShare = expense.amount / participants.length;
    const equal: Record<string, number> = {};
    for (let i = 0; i < participants.length; i += 1) {
      equal[participants[i]] = equalShare;
    }
    return equal;
  }, []);

  const getTransferBreakdown = useCallback((from: string, to: string, _amount: number) => {
    const logs: TransferBreakdownItem[] = [];

    for (let i = 0; i < expenses.length; i += 1) {
      const expense = expenses[i];
      if (!expense.paidBy) continue;

      const participants = expense.participants && expense.participants.length > 0 ? expense.participants : people;
      if (participants.length === 0) continue;

      const shareMap = getExpenseShareMap(expense, participants);
      const fromShare = Number(shareMap[from] || 0);
      const toShare = Number(shareMap[to] || 0);

      let signedAmount = 0;
      let relation: 'fromOwesTo' | 'toOwesFrom' | null = null;

      if (expense.paidBy === to && fromShare > 0) {
        signedAmount = fromShare;
        relation = 'fromOwesTo';
      } else if (expense.paidBy === from && toShare > 0) {
        signedAmount = -toShare;
        relation = 'toOwesFrom';
      }

      if (!relation) continue;

      logs.push({
        label: expense.note?.trim() || expense.category || `Expense ${i + 1}`,
        date: expense.date,
        expenseId: expense.id,
        paidBy: expense.paidBy,
        total: expense.amount,
        signedAmount,
        relation,
        fromShare,
        toShare,
      });
    }

    return logs;
  }, [expenses, getExpenseShareMap, people]);

  const pendingTotal = useMemo(
    () => [...pendingTransfers, ...paidTransfers].reduce((s, t) => s + t.amount, 0),
    [pendingTransfers, paidTransfers]
  );

  const goMembers = useCallback(() => navigate('/members'), [navigate]);
  const goAddExpense = useCallback(() => navigate('/add'), [navigate]);

  const allSettled = settlement.transfers.length > 0 && pendingTransfers.length === 0 && paidTransfers.length === 0;
  const selectedBreakdownItems = useMemo(
    () => (selectedBreakdown ? getTransferBreakdown(selectedBreakdown.from, selectedBreakdown.to, selectedBreakdown.amount) : []),
    [getTransferBreakdown, selectedBreakdown]
  );
  const selectedBreakdownCount = selectedBreakdownItems.length;
  const selectedBreakdownTotals = useMemo(() => {
    let forward = 0;
    let reverse = 0;
    for (let i = 0; i < selectedBreakdownItems.length; i += 1) {
      const signed = selectedBreakdownItems[i].signedAmount;
      if (signed > 0) forward += signed;
      if (signed < 0) reverse += Math.abs(signed);
    }
    return {
      forward,
      reverse,
      net: forward - reverse,
    };
  }, [selectedBreakdownItems]);
  const selectedBreakdownTransferGap = useMemo(() => {
    if (!selectedBreakdown) return 0;
    return selectedBreakdown.amount - selectedBreakdownTotals.net;
  }, [selectedBreakdown, selectedBreakdownTotals.net]);

  if (people.length === 0) {
    return (
      <div className="page-shell flex flex-col items-center justify-center py-24">
        <p className="font-bold text-lg text-slate-700">No participants yet</p>
        <p className="text-sm text-slate-400 mt-1">Add members to calculate settlements</p>
        <button
          onClick={goMembers}
          className="mt-5 px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-100"
        >
          Add Members →
        </button>
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="page-shell space-y-4">
        <div className="page-header">
          <h1 className="page-title">Settlement</h1>
          <p className="page-subtitle">Who owes who</p>
        </div>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-center">
          <p className="font-black text-slate-900 text-lg">No expenses yet</p>
          <p className="text-sm text-slate-500 mt-2">Add the first expense to automatically generate settlement transfers.</p>
          <button
            onClick={goAddExpense}
            className="mt-5 px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-100"
          >
            Add first expense →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-5">
      <div className="page-header">
        <h1 className="page-title">Settlement</h1>
        <p className="page-subtitle">Who owes who</p>
      </div>

      {/* Hero summary */}
      {allSettled ? (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-green-200 flex items-center gap-4"
        >
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <p className="font-black text-xl">All settled up!</p>
            <p className="text-green-100 text-sm mt-0.5">Everyone's square with each other</p>
          </div>
        </motion.div>
      ) : pendingTransfers.length > 0 || paidTransfers.length > 0 ? (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-3xl text-white shadow-xl shadow-blue-200"
        >
          <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-1">Still to settle</p>
          <p className="text-4xl font-black">{formatCurrency(pendingTotal)}</p>
          <p className="text-blue-200 text-sm mt-2">
            {pendingTransfers.length > 0 && `${pendingTransfers.length} pending`}
            {pendingTransfers.length > 0 && paidTransfers.length > 0 && ' · '}
            {paidTransfers.length > 0 && `${paidTransfers.length} awaiting confirmation`}
            {settledTransfers.length > 0 && ` · ${settledTransfers.length} done`}
          </p>
        </motion.div>
      ) : null}

      {/* Net Balances */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Net Balances</p>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          {people.map((person, idx) => {
            const balance = settlement.balances[person] ?? 0;
            const isPositive = balance > 0.01;
            const isNegative = balance < -0.01;
            const isInactive = registry[person]?.isActive === false;
            return (
              <React.Fragment key={person}>
                {idx > 0 && <div className="h-px bg-slate-50 mx-4" />}
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex items-center justify-between px-4 py-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black border ${
                      isPositive ? 'bg-green-50 text-green-700 border-green-100' :
                      isNegative ? 'bg-red-50 text-red-600 border-red-100' :
                      'bg-slate-50 text-slate-500 border-slate-100'
                    }`}>
                      {(displayNames[person] || person)[0].toUpperCase()}
                    </div>
                    <span className={`font-semibold text-sm ${isInactive ? 'text-slate-400' : 'text-slate-800'}`}>
                      {displayNames[person] || person}
                    </span>
                    {isInactive && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-slate-500 bg-slate-100 border border-slate-200">left</span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${
                      isPositive ? 'text-green-600' : isNegative ? 'text-red-500' : 'text-slate-400'
                    }`}>
                      {isPositive ? `+${formatCurrency(balance)}` :
                       isNegative ? `-${formatCurrency(Math.abs(balance))}` : 'Even'}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {isPositive ? 'to receive' : isNegative ? 'to pay' : 'settled'}
                    </p>
                  </div>
                </motion.div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Pending Transfers — no action taken yet */}
      {pendingTransfers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            Pending · {pendingTransfers.length}
          </p>
          <div className="space-y-3">
            <AnimatePresence>
              {pendingTransfers.map((transfer, idx) => (
                <motion.div
                  key={`${transfer.from}-${transfer.to}-${transfer.amount}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 60, scale: 0.95 }}
                  transition={{ delay: idx * 0.04 }}
                  className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden"
                >
                  <div className="w-full p-4 flex items-center gap-3 text-left">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center text-sm font-black text-red-600 border border-red-100 flex-shrink-0">
                        {(displayNames[transfer.from] || transfer.from)[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold text-sm truncate ${isFromMemberActive(transfer.from) ? 'text-slate-900' : 'text-slate-400'}`}>{displayNames[transfer.from] || transfer.from}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          <span className={`font-bold text-sm truncate ${isToMemberActive(transfer.to) ? 'text-slate-900' : 'text-slate-400'}`}>{displayNames[transfer.to] || transfer.to}</span>
                        </div>
                        <span className="text-xs text-slate-400 mt-0.5">
                          {formatCurrency(transfer.amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 pb-4 pt-0 flex items-center justify-end gap-2">
                    {/* Local mode: single-tap settle. Collaborative: sender marks paid first */}
                    {!collaborativeEnabled ? (
                      <button
                        onClick={() => openConfirmReceived({ from: transfer.from, to: transfer.to, amount: transfer.amount })}
                        className="flex-shrink-0 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Mark settled
                      </button>
                    ) : isSender(transfer.from) ? (
                      <button
                        onClick={() => openMarkPaid({ from: transfer.from, to: transfer.to, amount: transfer.amount })}
                        className="flex-shrink-0 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-1.5 hover:bg-amber-100 transition-colors"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        Mark as paid
                      </button>
                    ) : isCreator && !isFromMemberActive(transfer.from) ? (
                      <button
                        onClick={() => openMarkPaid({ from: transfer.from, to: transfer.to, amount: transfer.amount })}
                        className="flex-shrink-0 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold flex items-center gap-1.5 hover:bg-amber-100 transition-colors"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        Mark paid (on behalf)
                      </button>
                    ) : isReceiver(transfer.to) ? (
                      <span className="flex-shrink-0 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-xs font-semibold inline-flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        Waiting
                      </span>
                    ) : null}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Paid Transfers — sender marked paid, receiver needs to confirm */}
      {paidTransfers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3">
            Needs confirmation · {paidTransfers.length}
          </p>
          <div className="space-y-3">
            <AnimatePresence>
              {paidTransfers.map((transfer, idx) => {
                const paid = paidMap.get(transferKey(transfer.from, transfer.to, transfer.amount));
                return (
                  <motion.div
                    key={`paid-${transfer.from}-${transfer.to}-${transfer.amount}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 60, scale: 0.95 }}
                    transition={{ delay: idx * 0.04 }}
                    className="bg-amber-50 border-2 border-amber-200 rounded-3xl shadow-sm overflow-hidden"
                  >
                    <div className="w-full p-4 flex items-center gap-3 text-left">
                      <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center text-sm font-black text-amber-700 border border-amber-200 flex-shrink-0">
                        {(displayNames[transfer.from] || transfer.from)[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold text-sm truncate ${isFromMemberActive(transfer.from) ? 'text-slate-900' : 'text-slate-400'}`}>{displayNames[transfer.from] || transfer.from}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          <span className={`font-bold text-sm truncate ${isToMemberActive(transfer.to) ? 'text-slate-900' : 'text-slate-400'}`}>{displayNames[transfer.to] || transfer.to}</span>
                        </div>
                        <span className="text-xs text-amber-700 font-semibold mt-0.5">
                          {(displayNames[transfer.from] || transfer.from)} marked {formatCurrency(transfer.amount)} as paid
                        </span>
                        {paid?.creatorOverride && (
                          <p className="text-[10px] text-amber-700 mt-1">Confirmed by trip creator</p>
                        )}
                        {paid?.note && (
                          <p className="text-[10px] text-slate-500 mt-1 inline-flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {paid.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {paid?.proofImage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewProof(paid.proofImage || null);
                            }}
                            className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                            title="View proof"
                          >
                            <FileImage className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="px-4 pb-4 pt-0 flex gap-2">
                      {isReceiver(transfer.to) ? (
                        <button
                          onClick={() => openConfirmReceived({ from: transfer.from, to: transfer.to, amount: transfer.amount })}
                          className="flex-1 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-100"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Confirm received
                        </button>
                      ) : isCreator && !isToMemberActive(transfer.to) ? (
                        <button
                          onClick={() => openConfirmReceived({ from: transfer.from, to: transfer.to, amount: transfer.amount })}
                          className="flex-1 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-100"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Confirm (on behalf)
                        </button>
                      ) : isSender(transfer.from) ? (
                        <span className="flex-1 py-2.5 rounded-2xl bg-amber-100 text-amber-700 text-xs font-semibold text-center">
                          Waiting for {transfer.to} to confirm
                        </span>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Settled Transfers */}
      {settledTransfers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            Settled · {settledTransfers.length}
          </p>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            {settledTransfers.map((transfer, idx) => {
              const entry = settledMap.get(transferKey(transfer.from, transfer.to, transfer.amount));
              return (
                <React.Fragment key={`${transfer.from}-${transfer.to}-${transfer.amount}`}>
                  {idx > 0 && <div className="h-px bg-slate-50 mx-4" />}
                  <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden opacity-60">
                    <div className="w-full flex items-center gap-3 px-4 py-3 text-left">
                      <div className="w-7 h-7 bg-green-50 rounded-lg flex items-center justify-center border border-green-100 flex-shrink-0">
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-semibold line-through truncate ${isFromMemberActive(transfer.from) ? 'text-slate-500' : 'text-slate-400'}`}>{displayNames[transfer.from] || transfer.from}</span>
                          <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
                          <span className={`text-xs font-semibold line-through truncate ${isToMemberActive(transfer.to) ? 'text-slate-500' : 'text-slate-400'}`}>{displayNames[transfer.to] || transfer.to}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {formatCurrency(transfer.amount)} · paid outside app
                          {entry?.settledAt && ` · ${new Date(entry.settledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </p>
                        {entry?.creatorOverride && (
                          <p className="text-[10px] text-amber-700 mt-1">Confirmed by trip creator</p>
                        )}
                        {entry?.note && (
                          <p className="text-[10px] text-slate-500 mt-1 inline-flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {entry.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {entry?.proofImage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewProof(entry.proofImage || null);
                            }}
                            className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                            title={entry.proofName || 'View proof'}
                          >
                            <FileImage className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isReceiver(transfer.to) && (
                      <div className="px-4 pb-4 pt-0 flex justify-end">
                        <button
                          onClick={() => handleUnmark(transfer.from, transfer.to, transfer.amount)}
                          className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          title="Reopen"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedBreakdown && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
              onClick={closeBreakdown}
            />
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl rounded-t-[2rem] bg-white shadow-2xl shadow-slate-900/20 border-t border-slate-200 overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Settlement breakdown</p>
                  <h3 className="text-lg font-black text-slate-900 truncate">
                    {displayNames[selectedBreakdown.from] || selectedBreakdown.from} → {displayNames[selectedBreakdown.to] || selectedBreakdown.to}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {formatCurrency(selectedBreakdown.amount)} transfer · {selectedBreakdownCount} log{selectedBreakdownCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">Build SB-2026-04-12-A</p>
                </div>
                <button
                  type="button"
                  onClick={closeBreakdown}
                  className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition-colors"
                  aria-label="Close breakdown"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
                {selectedBreakdownCount > 0 ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{displayNames[selectedBreakdown.from] || selectedBreakdown.from} owes</p>
                          <p className="text-sm font-black text-emerald-600">{formatCurrency(selectedBreakdownTotals.forward)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reverse owes</p>
                          <p className="text-sm font-black text-rose-500">-{formatCurrency(selectedBreakdownTotals.reverse)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ledger net</p>
                          <p className="text-sm font-black text-blue-600">{formatCurrency(Math.abs(selectedBreakdownTotals.net))}</p>
                        </div>
                      </div>
                      {Math.abs(selectedBreakdownTransferGap) > 0.01 && (
                        <p className="mt-2 text-[10px] text-slate-500 text-center">
                          Final transfer {formatCurrency(selectedBreakdown.amount)} includes {formatCurrency(Math.abs(selectedBreakdownTransferGap))} balancing from multi-person netting.
                        </p>
                      )}
                    </div>
                    {selectedBreakdownItems.map((item) => {
                      const amount = Math.abs(item.signedAmount);
                      const fromGets = item.relation === 'toOwesFrom';
                      const toGets = item.relation === 'fromOwesTo';
                      return (
                      <div key={item.expenseId} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{item.label}</p>
                            <p className="text-[11px] text-slate-400">Paid by {displayNames[item.paidBy] || item.paidBy}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'No date'} · {item.relation === 'fromOwesTo' ? `${displayNames[selectedBreakdown.from] || selectedBreakdown.from} owes ${displayNames[selectedBreakdown.to] || selectedBreakdown.to}` : `${displayNames[selectedBreakdown.to] || selectedBreakdown.to} owes ${displayNames[selectedBreakdown.from] || selectedBreakdown.from}`}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-black ${item.signedAmount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{item.signedAmount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(item.signedAmount))}</p>
                            <p className="text-[10px] text-slate-400">Pair impact</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className={`rounded-2xl border px-3 py-2 ${fromGets ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold text-slate-900 truncate">{displayNames[selectedBreakdown.from] || selectedBreakdown.from}</p>
                              <span className={`text-[10px] font-bold uppercase tracking-wider ${fromGets ? 'text-green-600' : 'text-red-600'}`}>{fromGets ? 'Gets' : 'Owes'}</span>
                            </div>
                            <p className={`mt-1 text-sm font-black ${fromGets ? 'text-green-600' : 'text-red-500'}`}>{fromGets ? '+' : '-'}{formatCurrency(amount)}</p>
                          </div>
                          <div className={`rounded-2xl border px-3 py-2 ${toGets ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold text-slate-900 truncate">{displayNames[selectedBreakdown.to] || selectedBreakdown.to}</p>
                              <span className={`text-[10px] font-bold uppercase tracking-wider ${toGets ? 'text-green-600' : 'text-red-600'}`}>{toGets ? 'Gets' : 'Owes'}</span>
                            </div>
                            <p className={`mt-1 text-sm font-black ${toGets ? 'text-green-600' : 'text-red-500'}`}>{toGets ? '+' : '-'}{formatCurrency(amount)}</p>
                          </div>
                        </div>

                        <div className={`rounded-xl border px-3 py-2 ${item.relation === 'fromOwesTo' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                          <p className={`text-xs font-bold ${item.relation === 'fromOwesTo' ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {item.relation === 'fromOwesTo'
                              ? `${displayNames[selectedBreakdown.from] || selectedBreakdown.from} owes ${displayNames[selectedBreakdown.to] || selectedBreakdown.to}`
                              : `${displayNames[selectedBreakdown.to] || selectedBreakdown.to} owes ${displayNames[selectedBreakdown.from] || selectedBreakdown.from}`}
                            {' '}
                            {formatCurrency(Math.abs(item.signedAmount))}
                          </p>
                        </div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No direct expense breakdown is available for this transfer.
                  </div>
                )}
              </div>

              <div className="px-5 pb-5 pt-0">
                <button
                  type="button"
                  onClick={closeBreakdown}
                  className="w-full py-3 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Sheet: Sender marks as paid */}
      <AnimatePresence>
        {activeSheet === 'markPaid' && sheetPayload && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40" onClick={resetSheet} />
            <motion.div
              initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6 shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-black text-slate-900">Mark as Paid</h3>
                <button onClick={resetSheet} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
                <div className="bg-amber-50 rounded-2xl p-4 mb-4 flex items-center gap-3 border border-amber-200">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-sm font-black text-amber-700 border border-amber-200 flex-shrink-0">
                  {(displayNames[sheetPayload.from] || sheetPayload.from)[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{displayNames[sheetPayload.from] || sheetPayload.from}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-900">{displayNames[sheetPayload.to] || sheetPayload.to}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(sheetPayload.amount)}</p>
                </div>
              </div>
              <p className="text-sm text-slate-500 text-center mb-5 leading-relaxed">
                Confirm you've sent{' '}
                <span className="font-bold text-slate-900">{formatCurrency(sheetPayload.amount)}</span>{' '}
                to <span className="font-bold text-slate-900">{displayNames[sheetPayload.to] || sheetPayload.to}</span>.{' '}
                They'll need to confirm receipt.
              </p>
              <div className="space-y-3 mb-5">
                <div>
                  <textarea
                    value={settlementNote}
                    onChange={(e) => setSettlementNote(e.target.value.slice(0, MAX_SETTLEMENT_NOTE_LENGTH))}
                    placeholder="Optional note (e.g. UPI ref, transaction ID)"
                    rows={2}
                    maxLength={MAX_SETTLEMENT_NOTE_LENGTH}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {showCounter(settlementNote, MAX_SETTLEMENT_NOTE_LENGTH) && (
                    <p className="text-[11px] text-slate-400 text-right mt-0.5">{settlementNote.length}/{MAX_SETTLEMENT_NOTE_LENGTH}</p>
                  )}
                </div>
                <input ref={proofInputRef} type="file" accept="image/*" onChange={handlePickProof} className="hidden" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => proofInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 inline-flex items-center gap-1.5">
                    <ImagePlus className="w-3.5 h-3.5" />
                    {proofImage ? 'Replace proof' : 'Add payment proof'}
                  </button>
                  {proofImage && (
                    <button type="button" onClick={() => setPreviewProof(proofImage)}
                      className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                      Preview
                    </button>
                  )}
                </div>
                {proofName && <p className="text-[11px] text-slate-500">Attached: {proofName}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={resetSheet} className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors">
                  Cancel
                </button>
                <button onClick={confirmMarkPaid} className="py-3 rounded-2xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-colors shadow-lg shadow-amber-100">
                  Yes, I paid
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Sheet: Receiver confirms received */}
      <AnimatePresence>
        {activeSheet === 'confirmReceived' && sheetPayload && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40" onClick={resetSheet} />
            <motion.div
              initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6 shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-black text-slate-900">Confirm Received</h3>
                <button onClick={resetSheet} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
                <div className="bg-emerald-50 rounded-2xl p-4 mb-4 flex items-center gap-3 border border-emerald-200">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-sm font-black text-emerald-700 border border-emerald-200 flex-shrink-0">
                  {(displayNames[sheetPayload.from] || sheetPayload.from)[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{displayNames[sheetPayload.from] || sheetPayload.from}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-900">{displayNames[sheetPayload.to] || sheetPayload.to}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(sheetPayload.amount)}</p>
                </div>
              </div>
              <p className="text-sm text-slate-500 text-center mb-5 leading-relaxed">
                <span className="font-bold text-slate-900">{displayNames[sheetPayload.from] || sheetPayload.from}</span> says they've paid.{' '}
                Confirm you received{' '}
                <span className="font-bold text-slate-900">{formatCurrency(sheetPayload.amount)}</span>.
              </p>
              <div className="space-y-3 mb-5">
                <div>
                  <textarea
                    value={settlementNote}
                    onChange={(e) => setSettlementNote(e.target.value.slice(0, MAX_SETTLEMENT_NOTE_LENGTH))}
                    placeholder="Optional note"
                    rows={2}
                    maxLength={MAX_SETTLEMENT_NOTE_LENGTH}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {showCounter(settlementNote, MAX_SETTLEMENT_NOTE_LENGTH) && (
                    <p className="text-[11px] text-slate-400 text-right mt-0.5">{settlementNote.length}/{MAX_SETTLEMENT_NOTE_LENGTH}</p>
                  )}
                </div>
                <input ref={proofInputRef} type="file" accept="image/*" onChange={handlePickProof} className="hidden" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => proofInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 inline-flex items-center gap-1.5">
                    <ImagePlus className="w-3.5 h-3.5" />
                    {proofImage ? 'Replace proof' : 'Add proof image'}
                  </button>
                  {proofImage && (
                    <button type="button" onClick={() => setPreviewProof(proofImage)}
                      className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                      Preview
                    </button>
                  )}
                </div>
                {proofName && <p className="text-[11px] text-slate-500">Attached: {proofName}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={resetSheet} className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors">
                  Not yet
                </button>
                <button onClick={confirmReceived} className="py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-100">
                  Yes, I received it
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewProof && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50"
              onClick={() => setPreviewProof(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-6"
            >
              <div className="relative max-w-md w-full">
                <button
                  onClick={() => setPreviewProof(null)}
                  className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-slate-700 shadow-md flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
                <img src={previewProof} alt="Settlement proof" className="w-full rounded-2xl border border-white/20 shadow-2xl" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
