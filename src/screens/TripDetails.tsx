import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, IndianRupee, Lock, Users, Tag, ChevronRight, Calendar } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { DatePicker } from '../components/DatePicker.tsx';
import { motion } from 'motion/react';
import { format, addDays } from 'date-fns';
import { MAX_BUDGET_PER_PERSON, BUDGET_REGEX } from '../utils/constants.ts';

interface TripDetailsProps {
  setup: TripSetup | null;
  onSave: (setup: TripSetup) => void;
}

export const TripDetails: React.FC<TripDetailsProps> = ({ setup, onSave }) => {
  const navigate = useNavigate();

  const [budget, setBudget] = useState(setup?.budgetPerPerson?.toString() || '');
  const [startDate, setStartDate] = useState(setup?.startDate || format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(setup?.endDate || format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [lockPrevious, setLockPrevious] = useState(setup?.lockPreviousDays || false);
  const [error, setError] = useState('');

  const budgetNum = useMemo(() => parseFloat(budget) || 0, [budget]);
  const peopleCount = setup?.peopleCount || 1;
  const totalBudget = useMemo(() => budgetNum * peopleCount, [budgetNum, peopleCount]);

  const budgetError = useMemo(() => {
    if (!budget) return '';
    const n = parseFloat(budget);
    if (isNaN(n) || n <= 0) return 'Budget must be greater than ₹0.';
    if (n > MAX_BUDGET_PER_PERSON) return `Max ${formatCurrency(MAX_BUDGET_PER_PERSON)} per person.`;
    return '';
  }, [budget]);

  const handleBudgetChange = useCallback((value: string) => {
    if (!BUDGET_REGEX.test(value)) return;
    setBudget(value);
    setError('');
  }, []);

  const handleStartDateChange = useCallback((value: string) => {
    setStartDate(value);
    if (value > endDate) setEndDate(value);
  }, [endDate]);

  const handleSave = useCallback(() => {
    if (!setup) return;
    if (budgetNum <= 0 || budgetNum > MAX_BUDGET_PER_PERSON) {
      setError('Please enter a valid budget per person.');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date.');
      return;
    }
    onSave({
      ...setup,
      budgetPerPerson: budgetNum,
      totalBudget,
      startDate,
      endDate,
      lockPreviousDays: lockPrevious,
    });
    navigate('/settings');
  }, [setup, budgetNum, totalBudget, startDate, endDate, lockPrevious, onSave, navigate]);

  if (!setup) return null;

  return (
    <div className="page-shell space-y-4">
      <div className="flex items-center gap-3 page-header">
        <button onClick={() => navigate('/settings')}
          className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">Trip Settings</h1>
          <p className="page-subtitle">{setup.participants?.length ?? setup.peopleCount} people · {formatCurrency(setup.totalBudget)} total</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 font-medium">
          ⚠ {error}
        </div>
      )}

      {/* Budget & Dates */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Budget</p>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <IndianRupee className="w-3.5 h-3.5" />
              Per person
            </label>
            <input
              type="number"
              value={budget}
              onChange={(e) => handleBudgetChange(e.target.value)}
              placeholder="0"
              min="1"
              max={MAX_BUDGET_PER_PERSON}
              step="0.01"
              className={`w-full px-4 py-3 text-2xl font-black rounded-2xl border focus:outline-none focus:ring-2 transition-all ${
                budgetError ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-500'
              }`}
            />
            {budgetError && <p className="text-xs text-red-500 font-semibold mt-1.5">⚠ {budgetError}</p>}
            {budgetNum > 0 && !budgetError && (
              <div className="mt-3 bg-blue-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-blue-600 font-semibold">Total trip budget</span>
                <span className="text-sm font-black text-blue-700">{formatCurrency(totalBudget)}</span>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          <div className="space-y-3">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Dates
            </label>
            <div>
              <p className="text-xs text-slate-400 mb-1.5">Start</p>
              <DatePicker value={startDate} onChange={handleStartDateChange} />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1.5">End</p>
              <DatePicker value={endDate} onChange={setEndDate} minDate={startDate} />
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* Lock toggle */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${lockPrevious ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Lock past days</p>
                <p className="text-xs text-slate-400 mt-0.5">Prevent editing previous day expenses</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLockPrevious(p => !p)}
              className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${lockPrevious ? 'bg-blue-600' : 'bg-slate-300'}`}
              aria-pressed={lockPrevious}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform duration-200 ${lockPrevious ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Save budget/dates */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={handleSave}
        disabled={!!budgetError || budgetNum <= 0}
        className="w-full py-4 rounded-2xl bg-blue-600 disabled:bg-slate-200 text-white font-bold text-sm shadow-lg shadow-blue-100 transition-all"
      >
        Save Changes
      </motion.button>

      {/* People & Categories */}
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">People & Categories</p>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/members')}
            className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left group"
          >
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-teal-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-slate-900">Manage Members</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {(setup.participants?.length ?? setup.peopleCount)} participant{(setup.participants?.length ?? setup.peopleCount) !== 1 ? 's' : ''}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
          </motion.button>

          <div className="h-px bg-slate-50 mx-4" />

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate('/categories')}
            className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left group"
          >
            <div className="w-9 h-9 bg-rose-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Tag className="w-4 h-4 text-rose-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-slate-900">Manage Categories</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {(setup.customCategories?.length ?? 4)} categor{(setup.customCategories?.length ?? 4) !== 1 ? 'ies' : 'y'}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
          </motion.button>
        </div>
      </div>
    </div>
  );
};
