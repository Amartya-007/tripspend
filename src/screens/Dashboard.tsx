import React, { useEffect, useMemo } from 'react';
import { TripData, calculateStats } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Settings, Zap, Calendar, Clock, AlertTriangle, BarChart3, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

interface DashboardProps {
  data: TripData;
}

export const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  const stats = useMemo(() => calculateStats(data), [data]);

  if (!stats || !data.setup) return null;

  useEffect(() => {
    if (!stats.isOverspending) return;
    if (typeof Notification === 'undefined') return;
    const today = new Date().toISOString().split('T')[0];
    const key = 'tripspend_overspend_alert_date';
    if (localStorage.getItem(key) === today) return;
    const notify = () => {
      new Notification('TripSpend Alert', { body: `At current pace, you may overshoot by ${formatCurrency(stats.projectedDeficit)}.` });
      localStorage.setItem(key, today);
    };
    if (Notification.permission === 'granted') notify();
    else if (Notification.permission === 'default') Notification.requestPermission().then(p => p === 'granted' && notify());
  }, [stats.isOverspending, stats.projectedDeficit]);

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex justify-between items-center page-header">
        <div>
          <h1 className="page-title">TripSpend</h1>
          <p className="page-subtitle">Budget Dashboard</p>
        </div>
        <Link to="/settings" className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 text-slate-600 hover:shadow-lg hover:text-blue-600 transition-all duration-200">
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {/* Trip snapshot */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl p-5 text-white shadow-xl shadow-blue-200">
        <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-3">Current Trip</p>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-blue-200 text-xs">Budget</p><p className="font-black text-xl">{formatCurrency(data.setup.totalBudget)}</p></div>
          <div><p className="text-blue-200 text-xs">Spent</p><p className="font-black text-xl">{formatCurrency(stats.totalSpent)}</p></div>
          <div><p className="text-blue-200 text-xs">People</p><p className="font-black text-xl">{data.setup.peopleCount}</p></div>
          <div><p className="text-blue-200 text-xs">Expenses</p><p className="font-black text-xl">{data.expenses.length}</p></div>
        </div>
      </motion.div>

      {/* Overspend alert */}
      {stats.isOverspending && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 p-4 rounded-3xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold text-red-800">Budget Alert</p>
              <p className="text-sm text-red-700 leading-relaxed">
                Projected to overshoot by {formatCurrency(stats.projectedDeficit)} by trip end.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Remaining balance */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}
        className={`p-6 rounded-3xl border-2 ${stats.borderColor} ${stats.bgColor} shadow-sm`}>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Remaining Balance</p>
        <h2 className={`text-5xl font-black ${stats.statusColor} mb-4`}>{formatCurrency(stats.remainingBalance)}</h2>
        <div className="w-full bg-slate-200 rounded-full h-2.5 mb-3">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${stats.statusColor.replace('text', 'bg')}`}
            style={{ width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
          <span>{stats.remainingPercentage.toFixed(1)}% of budget left</span>
          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{stats.daysRemaining} days left</span>
        </div>
      </motion.div>

      {/* Today / Yesterday */}
      <div className="grid grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card-elevated p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Today</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(stats.todaySpent)}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card-elevated p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center">
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Yesterday</span>
          </div>
          <p className="text-2xl font-black text-slate-600">{formatCurrency(stats.yesterdaySpent)}</p>
        </motion.div>
      </div>

      {/* Safe daily limit — single most useful number */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-gradient-to-br from-blue-600 to-blue-700 p-5 rounded-3xl text-white shadow-xl shadow-blue-200">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-blue-500/30 rounded-lg">
            <Zap className="w-4 h-4 text-yellow-300 fill-yellow-300" />
          </div>
          <p className="font-bold">Today's Limit</p>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-blue-200 text-xs mb-1">Safe to spend today</p>
            <p className="text-4xl font-black">{formatCurrency(stats.remainingPerDay)}</p>
          </div>
          <div className="text-right">
            <p className="text-blue-200 text-xs mb-1">Burn rate</p>
            <p className="text-xl font-bold">{formatCurrency(stats.dailyBurnRate)}</p>
          </div>
        </div>
      </motion.div>

      {/* Analytics CTA */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Link
          to="/analytics"
          className="flex items-center justify-between p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl group hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Full Analytics</p>
              <p className="text-xs text-slate-500 mt-0.5">Per person, burn rate, health score</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-blue-400 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  );
};
