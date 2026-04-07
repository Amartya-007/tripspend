import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Expense, TripSetup, getTripPeople } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Utensils, Plane, Home, Package, Calendar, Filter, X, Search, Tag, Image as ImageIcon, User, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { createPortal } from 'react-dom';

import { CustomSelect } from '../components/CustomSelect.tsx';
import { DatePicker } from '../components/DatePicker.tsx';

const formatAddedTime = (createdAt?: string) => {
  if (!createdAt) return 'Time unavailable';
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  return format(parsed, 'hh:mm a');
};

// Lookup maps — defined once outside component, O(1) access
const CATEGORY_ICON: Record<string, React.ReactElement> = {
  Food: <Utensils className="w-5 h-5 text-orange-500" />,
  Travel: <Plane className="w-5 h-5 text-blue-500" />,
  Stay: <Home className="w-5 h-5 text-purple-500" />,
};
const DEFAULT_ICON = <Package className="w-5 h-5 text-slate-500" />;

const CATEGORY_BG: Record<string, string> = {
  Food: 'bg-orange-50',
  Travel: 'bg-blue-50',
  Stay: 'bg-purple-50',
};
const DEFAULT_BG = 'bg-slate-50';

const FlyoutSelect = ({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: string;
  options: string[];
  onSave: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const selectedLabel = value || 'Select';

  const openSheet = () => {
    setDraftValue(value);
    setOpen(true);
  };

  const sheet = createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-5 shadow-2xl max-w-md mx-auto"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</p>
                <p className="text-sm text-slate-500 mt-1">Choose one filter value</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {options.map((option) => {
                const isSelected = option === draftValue;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDraftValue(option)}
                    className={`w-full px-4 py-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-semibold">{option}</span>
                    {isSelected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onSave(draftValue);
                  setOpen(false);
                }}
                className="py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
              >
                Save
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-left flex items-center justify-between gap-2 hover:border-slate-300 transition-all min-h-[3rem]"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>
      {sheet}
    </>
  );
};

interface ExpenseListProps {
  expenses: Expense[];
  setup: TripSetup | null;
  onUndoDelete: () => void;
  canUndoDelete: boolean;
}

export const ExpenseList: React.FC<ExpenseListProps> = ({ expenses, setup, onUndoDelete, canUndoDelete }) => {
  const navigate = useNavigate();
  const people = getTripPeople(setup);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [personFilter, setPersonFilter] = useState<string>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest'>('newest');

  const filteredExpenses = useMemo(() => {
    const base = expenses.filter(expense => {
      const matchesCategory = categoryFilter === 'All' || expense.category === categoryFilter;
      const matchesPerson = personFilter === 'All' ||
        expense.paidBy === personFilter ||
        (expense.participants || []).includes(personFilter);

      let matchesDate = true;
      if (startDate || endDate) {
        const expenseDate = parseISO(expense.date);
        const start = startDate ? startOfDay(parseISO(startDate)) : new Date(0);
        const end = endDate ? endOfDay(parseISO(endDate)) : new Date(8640000000000000);
        matchesDate = isWithinInterval(expenseDate, { start, end });
      }

      const query = searchQuery.trim().toLowerCase();
      const searchable = [
        expense.note || '',
        expense.category,
        expense.paidBy || '',
        (expense.tags || []).join(' '),
        expense.amount.toString()
      ].join(' ').toLowerCase();
      const matchesSearch = query.length === 0 || searchable.includes(query);

      const min = minAmount ? parseFloat(minAmount) : null;
      const max = maxAmount ? parseFloat(maxAmount) : null;
      const matchesAmount = (min === null || expense.amount >= min) && (max === null || expense.amount <= max);

      return matchesCategory && matchesPerson && matchesDate && matchesSearch && matchesAmount;
    });

    return base.sort((a, b) => {
      if (sortBy === 'highest') {
        return b.amount - a.amount;
      }
      if (sortBy === 'oldest') {
        return parseISO(a.date).getTime() - parseISO(b.date).getTime();
      }
      return parseISO(b.date).getTime() - parseISO(a.date).getTime();
    });
  }, [expenses, categoryFilter, startDate, endDate, searchQuery, sortBy, personFilter, minAmount, maxAmount]);

  const uniqueCategories = useMemo(
    () => ['All', ...Array.from(new Set(expenses.map(e => e.category)))],
    [expenses]
  );

  const clearFilters = () => {
    setCategoryFilter('All');
    setPersonFilter('All');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setSearchQuery('');
  };

  const isFiltered = categoryFilter !== 'All' || personFilter !== 'All' || startDate !== '' || endDate !== '' || searchQuery.trim() !== '' || minAmount !== '' || maxAmount !== '';

  const filtersPopup = createPortal(
    <AnimatePresence>
      {showFilters && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setShowFilters(false)}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-w-md mx-auto"
            style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>

            <div className="flex items-center justify-between px-4 pb-3">
              <div>
                <p className="text-sm font-black text-slate-800">Filters</p>
                <p className="text-xs text-slate-500">Refine transactions quickly</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 max-h-[72vh] overflow-y-auto pb-3">
              <div className="card-premium p-4 space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Category</label>
                  <FlyoutSelect
                    label="Category"
                    value={categoryFilter}
                    options={uniqueCategories}
                    onSave={setCategoryFilter}
                  />
                </div>

                {people.length > 0 && (
                  <>
                    <div className="h-px bg-slate-200" />
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block flex items-center gap-1">
                        <User className="w-3 h-3" /> Person
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {['All', ...people].map(person => (
                          <button
                            key={person}
                            onClick={() => setPersonFilter(person)}
                            className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                              personFilter === person
                                ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-md'
                                : 'bg-slate-100 text-slate-600 border border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {person}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="h-px bg-slate-200" />

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Amount Range</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                      <input
                        type="number"
                        value={minAmount}
                        onChange={e => setMinAmount(e.target.value)}
                        placeholder="Min"
                        className="input-field !py-2.5 !rounded-xl pl-7 text-sm"
                      />
                    </div>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                      <input
                        type="number"
                        value={maxAmount}
                        onChange={e => setMaxAmount(e.target.value)}
                        placeholder="Max"
                        className="input-field !py-2.5 !rounded-xl pl-7 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-200" />
                <div className="space-y-3">
                  <div className="relative">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">From</label>
                    {startDate && <button type="button" onClick={() => setStartDate('')} className="absolute right-0 top-0 text-[10px] text-red-400 font-semibold">Clear</button>}
                    <DatePicker
                      value={startDate || format(new Date(), 'yyyy-MM-dd')}
                      onChange={setStartDate}
                      compact
                    />
                  </div>
                  <div className="relative">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">To</label>
                    {endDate && <button type="button" onClick={() => setEndDate('')} className="absolute right-0 top-0 text-[10px] text-red-400 font-semibold">Clear</button>}
                    <DatePicker
                      value={endDate || format(new Date(), 'yyyy-MM-dd')}
                      onChange={setEndDate}
                      compact
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="py-2.5 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilters(false)}
                  className="py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
                >
                  Apply
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <div className="page-shell">
      <div className="flex justify-between items-center page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{filteredExpenses.length} recorded</p>
        </div>
        <div className="flex items-center gap-2">
          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="p-3 rounded-2xl border-2 border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all shadow-sm"
              aria-label="Clear filters"
              title="Clear filters"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-3 rounded-2xl border-2 transition-all shadow-sm ${showFilters || isFiltered ? 'bg-blue-50 border-blue-300 text-blue-600 shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            aria-label="Open filters"
            title="Filters"
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="mb-5 relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notes, amount, tags..."
          className="input-field pl-11"
        />
      </div>

      <div className="mb-5">
        <CustomSelect
          value={sortBy}
          options={[
            { value: 'newest', label: '↓ Newest First' },
            { value: 'oldest', label: '↑ Oldest First' },
            { value: 'highest', label: '↓ Highest Amount' },
          ]}
          onChange={(v) => setSortBy(v as 'newest' | 'oldest' | 'highest')}
        />
      </div>

      {filtersPopup}

      {filteredExpenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <div className="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center mb-6">
            <Package className="w-12 h-12 text-slate-300" />
          </div>
          <p className="font-semibold text-lg text-slate-700">
            {isFiltered ? 'No matching expenses' : 'No expenses yet'}
          </p>
          <p className="text-sm mt-1 text-slate-400">
            {isFiltered ? 'Try adjusting your filters' : 'Start tracking your trip spending'}
          </p>
          {!isFiltered && (
            <button
              onClick={() => navigate('/add')}
              className="mt-5 px-6 py-3 bg-blue-600 text-white text-sm font-bold rounded-2xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors"
            >
              Add first expense →
            </button>
          )}
          {isFiltered && (
            <button
              onClick={clearFilters}
              className="mt-5 px-5 py-2.5 bg-slate-100 text-slate-600 text-sm font-bold rounded-2xl hover:bg-slate-200 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredExpenses.map((expense) => (
              <motion.div
                key={expense.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="card-elevated p-5 flex items-center gap-4 cursor-pointer hover:shadow-lg hover:border-blue-200 hover:scale-105 transition-all duration-200"
                onClick={() => navigate(`/expense/${expense.id}`)}
              >
                <div className={`w-12 h-12 ${CATEGORY_BG[expense.category] ?? DEFAULT_BG} rounded-2xl flex items-center justify-center flex-shrink-0 font-bold`}>
                  {CATEGORY_ICON[expense.category] ?? DEFAULT_ICON}
                </div>
                
                <div className="flex-grow min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-bold text-slate-900 truncate text-base">
                      {expense.note || expense.category}
                    </h3>
                    <span className="font-black text-slate-900 whitespace-nowrap text-lg">
                      {formatCurrency(expense.amount)}
                    </span>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 mt-1.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                      <Calendar className="w-3 h-3 flex-shrink-0" />
                      <span className="whitespace-nowrap">{format(new Date(expense.date), 'MMM dd, yyyy')}</span>
                      <span className="text-slate-300 flex-shrink-0">•</span>
                      <span className="whitespace-nowrap">{formatAddedTime(expense.createdAt)}</span>
                    </div>
                    {expense.paidBy && expense.paidBy !== 'Trip Wallet' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[10px] flex-shrink-0">
                        <User className="w-2.5 h-2.5" />
                        {expense.paidBy}
                      </span>
                    )}
                  </div>
                    {((expense.tags && expense.tags.length > 0) || (expense.receipts && expense.receipts.length > 0) || expense.receiptImage) && (
                      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                        {(expense.tags || []).slice(0, 2).map((tag) => (
                          <span key={`${expense.id}-${tag}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                        {((expense.receipts && expense.receipts.length > 0) || expense.receiptImage) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-[10px] font-semibold text-amber-700">
                            <ImageIcon className="w-2.5 h-2.5" />
                            {(expense.receipts && expense.receipts.length > 0) ? `${expense.receipts.length} Receipts` : 'Receipt'}
                          </span>
                        )}
                      </div>
                    )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {canUndoDelete && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed bottom-24 left-4 right-4 max-w-md mx-auto bg-slate-900 text-white rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xl z-50"
        >
          <span className="text-sm font-medium">Expense deleted</span>
          <button
            onClick={onUndoDelete}
            className="px-4 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold hover:bg-slate-100 transition-colors"
          >
            Undo
          </button>
        </motion.div>
      )}
    </div>
  );
};
