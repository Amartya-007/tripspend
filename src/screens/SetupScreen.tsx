import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, IndianRupee, ArrowRight, Calendar, Lock, Tag, X, Plus } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays } from 'date-fns';

interface SetupScreenProps {
  onSave: (setup: TripSetup) => void;
  initialData?: TripSetup | null;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSave, initialData }) => {
  const [step, setStep] = useState<'people-count' | 'people-names' | 'budget' | 'dates' | 'categories'>('people-count');
  const [peopleCount, setPeopleCount] = useState(initialData?.peopleCount?.toString() || '');
  const [participants, setParticipants] = useState<string[]>(initialData?.participants || []);
  const [budget, setBudget] = useState(initialData?.budgetPerPerson?.toString() || '');
  const [startDate, setStartDate] = useState(initialData?.startDate || format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(initialData?.endDate || format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [lockPrevious, setLockPrevious] = useState(initialData?.lockPreviousDays || false);
  const [categories, setCategories] = useState<string[]>(initialData?.customCategories || ['Food', 'Travel', 'Stay', 'Misc']);
  const [newCategory, setNewCategory] = useState('');
  
  const navigate = useNavigate();

  const peopleNum = parseInt(peopleCount) || 0;
  const budgetNum = parseFloat(budget) || 0;
  const totalBudget = peopleNum * budgetNum;

  const handlePeopleCountNext = () => {
    if (peopleNum > 0) {
      if (!participants.length) {
        setParticipants(Array.from({ length: peopleNum }, (_, i) => `Person ${i + 1}`));
      }
      setStep('people-names');
    }
  };

  const updateParticipantName = (index: number, name: string) => {
    const updated = [...participants];
    updated[index] = name;
    setParticipants(updated);
  };

  const handleAddCategory = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      setCategories([...categories, newCategory.trim()]);
      setNewCategory('');
    }
  };

  const handleRemoveCategory = (idx: number) => {
    if (categories.length > 1) {
      setCategories(categories.filter((_, i) => i !== idx));
    }
  };

  const handleSave = () => {
    if (peopleNum > 0 && budgetNum > 0 && startDate && endDate) {
      onSave({
        peopleCount: peopleNum,
        budgetPerPerson: budgetNum,
        totalBudget,
        startDate,
        endDate,
        lockPreviousDays: lockPrevious,
        participants: participants.filter(p => p.trim()),
        customCategories: categories,
      });
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 px-4 py-7 flex flex-col items-center justify-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md card-premium shadow-2xl p-8"
      >
        {/* Progress indicator */}
        <div className="flex justify-between items-center mb-8">
          {(['people-count', 'people-names', 'budget', 'dates', 'categories'] as const).map((s, idx) => (
            <motion.div
              key={s}
              className={`w-2 h-2 rounded-full transition-all ${
                step === s ? 'bg-blue-600 w-8' : 
                ['people-count', 'people-names', 'budget', 'dates', 'categories'].indexOf(step) > idx 
                  ? 'bg-blue-300' 
                  : 'bg-slate-300'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 'people-count' && (
            <motion.div
              key="people-count"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">Trip Setup</h1>
                <p className="text-slate-500 mt-2 text-sm">Who's joining the trip?</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                    <Users className="w-3 h-3 text-blue-600" />
                  </div>
                  Number of People
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={peopleCount}
                  onChange={(e) => setPeopleCount(e.target.value)}
                  placeholder="e.g. 4"
                  className="input-field text-4xl font-black text-center"
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-2 text-center">1-20 people</p>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handlePeopleCountNext}
                disabled={peopleNum <= 0}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </motion.button>
            </motion.div>
          )}

          {step === 'people-names' && (
            <motion.div
              key="people-names"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-slate-900">Who's who?</h1>
                <p className="text-slate-500 mt-1 text-sm">Enter names for each participant</p>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto">
                {participants.map((name, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={name}
                    onChange={(e) => updateParticipantName(idx, e.target.value)}
                    placeholder={`Person ${idx + 1}`}
                    className="input-field text-sm"
                  />
                ))}
              </div>

              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('people-count')}
                  className="btn-secondary flex-1"
                >
                  ← Back
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('budget')}
                  className="btn-primary flex-1"
                >
                  Next →
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 'budget' && (
            <motion.div
              key="budget"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center mb-8">
                <h1 className="text-2xl font-black text-slate-900">Set Budget</h1>
                <p className="text-slate-500 mt-1 text-sm">Per person budget for the trip</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <div className="w-5 h-5 bg-green-100 rounded flex items-center justify-center">
                    <IndianRupee className="w-3 h-3 text-green-600" />
                  </div>
                  Budget per Person
                </label>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="₹"
                  className="input-field text-4xl font-black text-center"
                  autoFocus
                />
              </div>

              <motion.div 
                layout
                className="bg-gradient-to-br from-blue-50 to-blue-100 p-5 rounded-2xl border-2 border-blue-200"
              >
                <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Total Trip Budget</p>
                <p className="text-3xl font-black text-blue-900">{formatCurrency(totalBudget)}</p>
              </motion.div>

              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('people-names')}
                  className="btn-secondary flex-1"
                >
                  ← Back
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('dates')}
                  disabled={budgetNum <= 0}
                  className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next →
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 'dates' && (
            <motion.div
              key="dates"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-slate-900">Trip Dates</h1>
                <p className="text-slate-500 mt-1 text-sm">When does the trip happen?</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2.5">Start</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2.5">End</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100 p-4 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${lockPrevious ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Lock Past Days</p>
                    <p className="text-xs text-slate-500">Prevent edits</p>
                  </div>
                </div>
                <button 
                  onClick={() => setLockPrevious(!lockPrevious)}
                  className={`w-14 h-7 rounded-full transition-all relative shadow-sm ${lockPrevious ? 'bg-blue-600 shadow-blue-200' : 'bg-slate-300'}`}
                >
                  <motion.div 
                    layout
                    className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${lockPrevious ? 'left-8' : 'left-1'}`}
                  />
                </button>
              </div>

              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('budget')}
                  className="btn-secondary flex-1"
                >
                  ← Back
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('categories')}
                  className="btn-primary flex-1"
                >
                  Next →
                </motion.button>
              </div>
            </motion.div>
          )}

          {step === 'categories' && (
            <motion.div
              key="categories"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-slate-900">Expense Categories</h1>
                <p className="text-slate-500 mt-1 text-sm">Customize your categories</p>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {categories.map((cat, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200"
                  >
                    <span className="text-sm font-semibold text-slate-700">{cat}</span>
                    {categories.length > 1 && (
                      <button
                        onClick={() => handleRemoveCategory(idx)}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Add new category..."
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCategory()}
                  className="input-field flex-1 text-sm"
                />
                <button
                  onClick={handleAddCategory}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setStep('dates')}
                  className="btn-secondary flex-1"
                >
                  ← Back
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  disabled={peopleNum <= 0 || budgetNum <= 0}
                  className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {initialData ? 'Update' : 'Start Trip'}
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
