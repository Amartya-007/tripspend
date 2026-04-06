import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Expense } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Utensils, Plane, Home, Package, Calendar, Filter, X, Search, Tag, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';

interface ExpenseListProps {
  expenses: Expense[];
  onUndoDelete: () => void;
  canUndoDelete: boolean;
}

export const ExpenseList: React.FC<ExpenseListProps> = ({ expenses, onUndoDelete, canUndoDelete }) => {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<Expense['category'] | 'All'>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest'>('newest');

  const filteredExpenses = useMemo(() => {
    const base = expenses.filter(expense => {
      const matchesCategory = categoryFilter === 'All' || expense.category === categoryFilter;
      
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
        (expense.tags || []).join(' '),
        expense.amount.toString()
      ].join(' ').toLowerCase();
      const matchesSearch = query.length === 0 || searchable.includes(query);

      return matchesCategory && matchesDate && matchesSearch;
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
  }, [expenses, categoryFilter, startDate, endDate, searchQuery, sortBy]);

  const getIcon = (category: Expense['category']) => {
    switch (category) {
      case 'Food': return <Utensils className="w-5 h-5 text-orange-500" />;
      case 'Travel': return <Plane className="w-5 h-5 text-blue-500" />;
      case 'Stay': return <Home className="w-5 h-5 text-purple-500" />;
      case 'Misc': return <Package className="w-5 h-5 text-slate-500" />;
    }
  };

  const getBg = (category: Expense['category']) => {
    switch (category) {
      case 'Food': return 'bg-orange-50';
      case 'Travel': return 'bg-blue-50';
      case 'Stay': return 'bg-purple-50';
      case 'Misc': return 'bg-slate-50';
    }
  };

  const categories: (Expense['category'] | 'All')[] = ['All', 'Food', 'Travel', 'Stay', 'Misc'];

  const clearFilters = () => {
    setCategoryFilter('All');
    setStartDate('');
    setEndDate('');
    setSearchQuery('');
  };

  const isFiltered = categoryFilter !== 'All' || startDate !== '' || endDate !== '' || searchQuery.trim() !== '';

  return (
    <div className="page-shell">
      <div className="flex justify-between items-center page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">{filteredExpenses.length} recorded</p>
        </div>
        <button 
          onClick={() => setShowFilters(!showFilters)}
          className={`p-3 rounded-2xl border-2 transition-all shadow-sm ${showFilters || isFiltered ? 'bg-blue-50 border-blue-300 text-blue-600 shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
        >
          <Filter className="w-5 h-5" />
        </button>
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'highest')}
          className="input-field font-medium text-slate-700 cursor-pointer"
        >
          <option value="newest">↓ Sort: Newest First</option>
          <option value="oldest">↑ Sort: Oldest First</option>
          <option value="highest">⬇ Sort: Highest Amount</option>
        </select>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="card-premium p-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Category</label>
                <div className="flex flex-wrap gap-2.5">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all ${
                        categoryFilter === cat 
                          ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md' 
                          : 'bg-slate-100 text-slate-600 border border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-slate-200" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">From</label>
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">To</label>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>
              </div>

              {isFiltered && (
                <button 
                  onClick={clearFilters}
                  className="w-full py-2.5 text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-2xl flex items-center justify-center gap-2 transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear All Filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filteredExpenses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <div className="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center mb-4 mb-6">
            <Package className="w-12 h-12 text-slate-300" />
          </div>
          <p className="font-semibold text-lg text-slate-700">No expenses yet</p>
          <p className="text-sm mt-2">Add your first transaction to get started</p>
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
                <div className={`w-12 h-12 ${getBg(expense.category)} rounded-2xl flex items-center justify-center flex-shrink-0 font-bold`}>
                  {getIcon(expense.category)}
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
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(expense.date), 'MMM dd, yyyy')}
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
