import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TripData, calculateSettlement, getTripPeople } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { ArrowRight, CheckCircle2, Users, Check, RotateCcw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const SETTLED_KEY = 'tripspend_settled_transfers';

const makeTransferKey = (from: string, to: string, amount: number) =>
  `${from}→${to}:${amount}`;

const loadSettled = (): Set<string> => {
  try {
    const raw = localStorage.getItem(SETTLED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
};

const saveSettled = (settled: Set<string>) => {
  localStorage.setItem(SETTLED_KEY, JSON.stringify([...settled]));
};

interface ConfirmPayload {
  key: string;
  from: string;
  to: string;
  amount: number;
}

interface SettlementProps {
  data: TripData;
}

export const Settlement: React.FC<SettlementProps> = ({ data }) => {
  const navigate = useNavigate();
  const people = getTripPeople(data.setup);
  const settlement = useMemo(
    () => calculateSettlement(data.setup, data.expenses),
    [data.setup, data.expenses]
  );
  const [settled, setSettled] = useState<Set<string>>(loadSettled);
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);

  const toggleSettled = useCallback((key: string) => {
    setSettled(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      saveSettled(next);
      return next;
    });
  }, []);

  const handleMarkSettled = useCallback((payload: ConfirmPayload) => {
    setConfirmPayload(payload);
  }, []);

  const confirmSettle = useCallback(() => {
    if (!confirmPayload) return;
    toggleSettled(confirmPayload.key);
    setConfirmPayload(null);
  }, [confirmPayload, toggleSettled]);

  const { pendingTransfers, settledTransfers } = useMemo(() => ({
    pendingTransfers: settlement.transfers.filter(t => !settled.has(makeTransferKey(t.from, t.to, t.amount))),
    settledTransfers: settlement.transfers.filter(t => settled.has(makeTransferKey(t.from, t.to, t.amount))),
  }), [settlement.transfers, settled]);

  const pendingTotal = useMemo(
    () => pendingTransfers.reduce((s, t) => s + t.amount, 0),
    [pendingTransfers]
  );

  const allSettled = settlement.transfers.length > 0 && pendingTransfers.length === 0;

  if (people.length === 0) {
    return (
      <div className="page-shell flex flex-col items-center justify-center py-24">
        <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-4">
          <Users className="w-10 h-10 text-slate-300" />
        </div>
        <p className="font-bold text-lg text-slate-700">No participants yet</p>
        <p className="text-sm text-slate-400 mt-1">Add members to calculate settlements</p>
        <button
          onClick={() => navigate('/members')}
          className="mt-5 px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-100"
        >
          Add Members →
        </button>
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
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
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
      ) : pendingTransfers.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-3xl text-white shadow-xl shadow-blue-200"
        >
          <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-1">Still to settle</p>
          <p className="text-4xl font-black">{formatCurrency(pendingTotal)}</p>
          <p className="text-blue-200 text-sm mt-2">
            {pendingTransfers.length} transfer{pendingTransfers.length > 1 ? 's' : ''} pending
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
                      {person[0].toUpperCase()}
                    </div>
                    <span className="font-semibold text-slate-800 text-sm">{person}</span>
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

      {/* Pending Transfers */}
      {pendingTransfers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            Pending · {pendingTransfers.length}
          </p>
          <div className="space-y-3">
            <AnimatePresence>
              {pendingTransfers.map((transfer, idx) => {
                const key = makeTransferKey(transfer.from, transfer.to, transfer.amount);
                return (
                  <motion.div
                    key={key}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 60, scale: 0.95 }}
                    transition={{ delay: idx * 0.04 }}
                    className="bg-white border border-slate-100 rounded-3xl shadow-sm p-4 flex items-center gap-3"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center text-sm font-black text-red-600 border border-red-100 flex-shrink-0">
                        {transfer.from[0].toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 text-sm truncate">{transfer.from}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          <span className="font-bold text-slate-900 text-sm truncate">{transfer.to}</span>
                        </div>
                        <span className="text-xs text-slate-400 mt-0.5">{formatCurrency(transfer.amount)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleMarkSettled({ key, from: transfer.from, to: transfer.to, amount: transfer.amount })}
                      className="flex-shrink-0 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-100 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Settle
                    </button>
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
              const key = makeTransferKey(transfer.from, transfer.to, transfer.amount);
              return (
                <React.Fragment key={key}>
                  {idx > 0 && <div className="h-px bg-slate-50 mx-4" />}
                  <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex items-center gap-3 px-4 py-3 opacity-60"
                  >
                    <div className="w-7 h-7 bg-green-50 rounded-lg flex items-center justify-center border border-green-100 flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 line-through truncate">{transfer.from}</span>
                        <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-500 line-through truncate">{transfer.to}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{formatCurrency(transfer.amount)} · paid outside app</p>
                    </div>
                    <button
                      onClick={() => toggleSettled(key)}
                      className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Undo"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation bottom sheet */}
      <AnimatePresence>
        {confirmPayload && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setConfirmPayload(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 80 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6 shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-black text-slate-900">Confirm Settlement</h3>
                <button onClick={() => setConfirmPayload(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 mb-5 flex items-center gap-3">
                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-sm font-black text-red-600 border border-red-100 flex-shrink-0">
                  {confirmPayload.from[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{confirmPayload.from}</span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-900">{confirmPayload.to}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{formatCurrency(confirmPayload.amount)}</p>
                </div>
              </div>

              <p className="text-sm text-slate-600 text-center mb-6 leading-relaxed">
                Did <span className="font-bold text-slate-900">{confirmPayload.from}</span> already pay{' '}
                <span className="font-bold text-slate-900">{confirmPayload.to}</span> outside this app?
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setConfirmPayload(null)}
                  className="py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-colors"
                >
                  Not yet
                </button>
                <button
                  onClick={confirmSettle}
                  className="py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-100"
                >
                  Yes, mark settled
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
