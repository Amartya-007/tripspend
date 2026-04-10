import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, CheckSquare, ChevronDown, Search, Square, UserCheck } from 'lucide-react';

type Accent = 'blue' | 'emerald';
type Mode = 'single' | 'multiple';

interface PeoplePickerSheetProps {
  people: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  mode?: Mode;
  disabled?: boolean;
  triggerLabel: string;
  title: string;
  subtitle?: string;
  accent?: Accent;
  searchPlaceholder?: string;
  doneLabel?: string;
  showSelectedSummary?: boolean;
  paidBy?: string;
  showPayerBadge?: boolean;
  showPayerWarning?: boolean;
  showSelectAllAction?: boolean;
  showClearAllAction?: boolean;
  showOnlyPayerAction?: boolean;
}

const AVATAR_COLOR_CLASSES = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-emerald-100 text-emerald-700 border-emerald-200',
  'bg-amber-100 text-amber-700 border-amber-200',
  'bg-violet-100 text-violet-700 border-violet-200',
  'bg-cyan-100 text-cyan-700 border-cyan-200',
  'bg-rose-100 text-rose-700 border-rose-200',
] as const;

const ACCENT_STYLES: Record<Accent, { triggerOpen: string; ring: string; button: string; buttonShadow: string }> = {
  blue: {
    triggerOpen: 'ring-2 ring-inset ring-blue-500 border-blue-500 text-blue-700 bg-blue-50',
    ring: 'focus:ring-blue-500',
    button: 'bg-blue-600',
    buttonShadow: 'shadow-blue-100',
  },
  emerald: {
    triggerOpen: 'ring-2 ring-inset ring-emerald-500 border-emerald-500 text-emerald-700 bg-emerald-50',
    ring: 'focus:ring-emerald-500',
    button: 'bg-emerald-600',
    buttonShadow: 'shadow-emerald-100',
  },
};

export const PeoplePickerSheet: React.FC<PeoplePickerSheetProps> = React.memo(({
  people,
  selected,
  onChange,
  mode = 'multiple',
  disabled = false,
  triggerLabel,
  title,
  subtitle,
  accent = 'blue',
  searchPlaceholder = 'Search members...',
  doneLabel = 'Done',
  showSelectedSummary = true,
  paidBy,
  showPayerBadge = false,
  showPayerWarning = false,
  showSelectAllAction = false,
  showClearAllAction = false,
  showOnlyPayerAction = false,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const styles = ACCENT_STYLES[accent];

  const filteredPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return people;
    return people.filter((person) => person.toLowerCase().includes(q));
  }, [people, searchQuery]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const avatarColorByPerson = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < people.length; i += 1) {
      map.set(people[i], AVATAR_COLOR_CLASSES[i % AVATAR_COLOR_CLASSES.length]);
    }
    return map;
  }, [people]);

  const payerIncluded = useMemo(
    () => !paidBy || selectedSet.has(paidBy),
    [paidBy, selectedSet]
  );

  const close = useCallback(() => {
    setOpen(false);
    setSearchQuery('');
  }, []);

  const togglePerson = useCallback((person: string) => {
    const isSelected = selectedSet.has(person);

    if (mode === 'single') {
      onChange([person]);
      close();
      return;
    }

    if (isSelected) {
      onChange(selected.filter((p) => p !== person));
      return;
    }

    onChange([...selected, person]);
  }, [close, mode, onChange, selected, selectedSet]);

  const selectAll = useCallback(() => {
    onChange([...people]);
  }, [onChange, people]);

  const clearAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  const selectOnlyPayer = useCallback(() => {
    if (paidBy && people.includes(paidBy)) {
      onChange([paidBy]);
      return;
    }
    if (people.length > 0) onChange([people[0]]);
  }, [onChange, paidBy, people]);

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold text-left flex items-center justify-between gap-2 transition-all disabled:opacity-50 bg-white ${
          open ? styles.triggerOpen : 'border-slate-200 text-slate-700 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{triggerLabel}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[95]"
              onClick={close}
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[100] bg-white rounded-t-3xl shadow-2xl max-w-md mx-auto"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-slate-200 rounded-full" />
              </div>

              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-black text-slate-900">{title}</p>
                {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
              </div>

              {(showSelectAllAction || showClearAllAction || showOnlyPayerAction) && (
                <div className="px-4 py-2 flex gap-2 border-b border-slate-100">
                  {showSelectAllAction && (
                    <button type="button" onClick={selectAll} className="text-xs text-blue-600 font-semibold px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors inline-flex items-center gap-1.5">
                      <CheckSquare className="w-3.5 h-3.5" /> Everyone
                    </button>
                  )}
                  {showClearAllAction && (
                    <button type="button" onClick={clearAll} className="text-xs text-red-600 font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors inline-flex items-center gap-1.5">
                      <Square className="w-3.5 h-3.5" /> None
                    </button>
                  )}
                  {showOnlyPayerAction && (
                    <button type="button" onClick={selectOnlyPayer} className="text-xs text-slate-600 font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors inline-flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> Only payer
                    </button>
                  )}
                </div>
              )}

              <div className="px-4 pt-2 pb-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className={`w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 ${styles.ring}`}
                  />
                </div>
                {showPayerWarning && !payerIncluded && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Payer is not selected in split
                  </div>
                )}
              </div>

              <div className="max-h-[48vh] overflow-y-auto px-2 py-2">
                {filteredPeople.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm font-medium text-slate-400">No members match your search.</div>
                )}
                {filteredPeople.map((person, idx) => {
                  const isSelected = selectedSet.has(person);
                  const avatarColor = avatarColorByPerson.get(person) || AVATAR_COLOR_CLASSES[0];

                  return (
                    <React.Fragment key={person}>
                      {idx > 0 && <div className="h-px bg-slate-50 mx-2" />}
                      <button
                        type="button"
                        onClick={() => togglePerson(person)}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                          isSelected && mode === 'single' ? 'bg-emerald-50'
                          : 'hover:bg-slate-50'
                        }`}
                      >
                        {mode === 'multiple' && (
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                          }`}>
                            {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                          </div>
                        )}
                        <div className={`w-7 h-7 rounded-full border text-[11px] font-black flex items-center justify-center flex-shrink-0 ${avatarColor}`}>
                          {person[0]?.toUpperCase() || '?'}
                        </div>
                        <span className={`text-sm font-semibold flex-1 text-left ${isSelected ? 'text-slate-900' : 'text-slate-500'}`}>
                          {person}
                        </span>
                        {showPayerBadge && person === paidBy && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">paid</span>
                        )}
                        {mode === 'single' && isSelected && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">selected</span>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 pt-2">
                {showSelectedSummary && <p className="text-xs font-semibold text-slate-500 mb-2">{selected.length} selected</p>}
                <button
                  type="button"
                  onClick={close}
                  className={`w-full py-3 rounded-2xl ${styles.button} text-white text-sm font-bold shadow-lg ${styles.buttonShadow}`}
                >
                  {doneLabel}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
});

PeoplePickerSheet.displayName = 'PeoplePickerSheet';
