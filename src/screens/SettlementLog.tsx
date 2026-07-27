import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, RotateCcw, FileImage, History, MessageSquare, Trash2 } from 'lucide-react';
import { formatCurrency } from '../utils/cn';
import { SettlementHistoryEntry } from '../utils/settlementHistory.ts';
import { useSettlementHistory } from '../hooks/useSettlementHistory.ts';
import { motion, AnimatePresence } from 'motion/react';
import { TripSetup } from '../utils/calculations.ts';
import { buildDisplayNameMap } from '../utils/memberDisplay';

const historyDateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

interface SettlementLogProps {
  tripId?: string | null;
  isCollaborative?: boolean;
  userUid?: string | null;
  setup?: TripSetup | null;
}

export const SettlementLog: React.FC<SettlementLogProps> = ({
  tripId = null,
  isCollaborative = false,
  setup = null,
}) => {
  const navigate = useNavigate();
  const { entries, clear } = useSettlementHistory({
    tripId,
    isCollaborative,
  });
  const [previewProof, setPreviewProof] = React.useState<string | null>(null);
  const hasEntries = entries.length > 0;

  const stats = useMemo(() => {
    const settled = entries.filter(e => e.action === 'settled').length;
    const undone = entries.filter(e => e.action === 'undo').length;
    return { settled, undone };
  }, [entries]);

  const displayNames = useMemo(() => {
    const registry = setup?.memberRegistry ?? {};
    if (!registry || Object.keys(registry).length === 0) return {} as Record<string, string>;
    return buildDisplayNameMap(registry);
  }, [setup]);

  const resolveMemberName = useCallback((value: string) => displayNames[value] || value, [displayNames]);

  const displayEntries = useMemo(() => {
    return entries.map((entry) => ({
      ...entry,
      fromLabel: resolveMemberName(entry.from),
      toLabel: resolveMemberName(entry.to),
      actionLabel: entry.action === 'settled' ? 'paid' : 're-opened',
      dateLabel: historyDateFmt.format(new Date(entry.createdAt)),
      isSettled: entry.action === 'settled',
    }));
  }, [entries, resolveMemberName]);

  const goBack = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const closeProofPreview = useCallback(() => {
    setPreviewProof(null);
  }, []);

  const openProofPreview = useCallback((proof: string | null | undefined) => {
    setPreviewProof(proof || null);
  }, []);

  const handleClear = useCallback(() => {
    if (!window.confirm('Clear full settlement log? This does not change current settled state.')) return;
    clear();
  }, [clear]);

  return (
    <div className="page-shell space-y-5">
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="page-title">Full Settlement Log</h1>
            <p className="page-subtitle">Complete audit trail of settle and reopen actions</p>
          </div>
        </div>
      </div>

      {hasEntries && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4 flex items-center justify-between">
          <div className="text-xs text-slate-500 font-semibold">
            <span className="text-emerald-600 font-bold">{stats.settled}</span> settled actions ·{' '}
            <span className="text-amber-600 font-bold">{stats.undone}</span> reopen actions
          </div>
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Log
          </button>
        </div>
      )}

      {!hasEntries ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
            <History className="w-7 h-7 text-slate-400" />
          </div>
          <p className="font-black text-slate-900">No history yet</p>
          <p className="text-sm text-slate-500 mt-1">Settlement actions will appear here as an audit trail.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          {displayEntries.map((entry, idx) => (
            <React.Fragment key={entry.id}>
              {idx > 0 && <div className="h-px bg-slate-50 mx-4" />}
              <div className="px-4 py-3 flex items-start gap-3">
                <div className={`mt-0.5 w-7 h-7 rounded-lg border flex items-center justify-center ${entry.isSettled ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                  {entry.isSettled ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {entry.fromLabel} {entry.actionLabel} {entry.toLabel}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {formatCurrency(entry.amount)} · {entry.dateLabel}
                  </p>
                  {entry.note && (
                    <p className="text-[11px] text-slate-500 mt-1 inline-flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {entry.note}
                    </p>
                  )}
                </div>
                {entry.proofImage && (
                  <button
                    onClick={() => openProofPreview(entry.proofImage)}
                    className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                    title={entry.proofName || 'View proof'}
                  >
                    <FileImage className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      <AnimatePresence>
        {previewProof && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50"
              onClick={closeProofPreview}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-6"
            >
              <div className="relative max-w-md w-full">
                <img src={previewProof} alt="Settlement proof" className="w-full rounded-2xl border border-white/20 shadow-2xl" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
