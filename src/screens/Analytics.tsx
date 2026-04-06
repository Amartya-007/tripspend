import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, PieChart, BarChart3 } from 'lucide-react';
import { TripData, getTripCategories, calculateStats } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { motion } from 'motion/react';

interface AnalyticsProps {
  data: TripData;
}

export const Analytics: React.FC<AnalyticsProps> = ({ data }) => {
  const navigate = useNavigate();
  const stats = calculateStats(data);

  const categoryBreakdown = useMemo(() => {
    const categories = getTripCategories(data.setup);
    const breakdown: Record<string, number> = {};
    
    categories.forEach(cat => {
      breakdown[cat] = data.expenses
        .filter(e => e.category === cat)
        .reduce((sum, e) => sum + e.amount, 0);
    });

    return Object.entries(breakdown)
      .map(([name, amount]) => ({ name, amount }))
      .filter(item => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [data.expenses, data.setup]);

  const dailySpending = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    
    data.expenses.forEach(exp => {
      const date = exp.date;
      dailyMap[date] = (dailyMap[date] || 0) + exp.amount;
    });

    return Object.entries(dailyMap)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14); // Last 14 days
  }, [data.expenses]);

  const totalSpent = stats?.totalSpent || 0;
  const maxCategoryAmount = categoryBreakdown.length > 0 ? categoryBreakdown[0].amount : 1;
  const maxDailyAmount = dailySpending.length > 0 ? Math.max(...dailySpending.map(d => d.amount)) : 1;

  const getColorForCategory = (category: string): string => {
    switch (category) {
      case 'Food': return 'bg-orange-500';
      case 'Travel': return 'bg-blue-500';
      case 'Stay': return 'bg-purple-500';
      case 'Misc': return 'bg-slate-500';
      default: return 'bg-indigo-500';
    }
  };

  const getCategoryColor = (category: string): string => {
    switch (category) {
      case 'Food': return 'from-orange-500 to-orange-600';
      case 'Travel': return 'from-blue-500 to-blue-600';
      case 'Stay': return 'from-purple-500 to-purple-600';
      case 'Misc': return 'from-slate-500 to-slate-600';
      default: return 'from-indigo-500 to-indigo-600';
    }
  };

  if (!stats) {
    return (
      <div className="page-shell">
        <div className="text-slate-600">No data available</div>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <div className="w-16" />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-4 rounded-2xl border border-slate-200"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total Spent</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(totalSpent)}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-4 rounded-2xl border border-slate-200"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Per Person</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(stats.perPersonSpend)}</p>
        </motion.div>
      </div>

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-5">
            <PieChart className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-slate-900">Spending by Category</h2>
          </div>

          <div className="space-y-4">
            {categoryBreakdown.map((item, idx) => {
              const percentage = (item.amount / totalSpent) * 100;
              return (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + idx * 0.05 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{formatCurrency(item.amount)}</p>
                      <p className="text-xs text-slate-500">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`h-full bg-gradient-to-r ${getCategoryColor(item.name)}`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Daily Spending Trend */}
      {dailySpending.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-slate-900">Daily Spending Trend</h2>
          </div>

          <div className="space-y-3">
            {dailySpending.map((day, idx) => {
              const percentage = (day.amount / maxDailyAmount) * 100;
              return (
                <motion.div
                  key={day.date}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + idx * 0.02 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-600">
                      {new Date(day.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-xs font-bold text-slate-900">{formatCurrency(day.amount)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Insights */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-2xl border border-blue-200"
      >
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <h2 className="font-bold text-slate-900">Insights</h2>
        </div>

        <ul className="space-y-2 text-sm text-slate-700">
          <li>• Daily burn rate: <span className="font-bold">{formatCurrency(stats.dailyBurnRate)}</span></li>
          <li>• Days remaining: <span className="font-bold">{stats.daysRemaining}</span></li>
          <li>• Budget remaining: <span className="font-bold text-blue-600">{formatCurrency(stats.remainingBalance)}</span></li>
          {stats.isOverspending && (
            <li className="text-red-600">• ⚠️ At current pace, projected deficit: <span className="font-bold">{formatCurrency(stats.projectedDeficit)}</span></li>
          )}
        </ul>
      </motion.div>
    </div>
  );
};
