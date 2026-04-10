import React, { useEffect, useMemo } from 'react';
import { TripData, calculateStats } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Settings, AlertTriangle, BarChart3, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';

const MOTION_VARIANTS = {
  fadeSlideDown: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } },
  fadeSlideUp: { initial: { opacity: 0, y: 15 }, animate: { opacity: 1, y: 0 } },
  fadeScale: { initial: { opacity: 0, scale: 0.95 }, animate: { opacity: 1, scale: 1 } },
};

const ANIMATION_DELAYS = {
  balance: 0.05,
  today: 0.1,
  dailyLimit: 0.15,
  analyticsCta: 0.2,
};

interface DashboardProps {
  data: TripData;
}

export const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  const stats = useMemo(() => calculateStats(data), [data]);
  const todayDate = useMemo(() => startOfDay(new Date()), []);
  const daysUntilStart = useMemo(() => {
    if (!data.setup?.startDate) return 0;
    const start = startOfDay(parseISO(data.setup.startDate));
    return differenceInDays(start, todayDate);
  }, [data.setup?.startDate, todayDate]);
  const isPreTrip = useMemo(() => daysUntilStart > 0, [daysUntilStart]);

  if (!stats || !data.setup) return null;

  if (data.expenses.length === 0) {
    return (
      <div className="page-shell space-y-5">
        <div className="flex justify-between items-center page-header">
          <div>
            <h1 className="page-title">TripSpend</h1>
            <p className="page-subtitle">Budget Dashboard</p>
          </div>
          <Link to="/settings" className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 text-slate-500 hover:shadow-lg hover:text-blue-600 transition-all duration-200">
            <Settings className="w-5 h-5" />
          </Link>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-center">
          <p className="font-black text-slate-900 text-lg">No expenses yet</p>
          <p className="text-sm text-slate-500 mt-2">Start with your first expense to unlock burn rate, alerts, and analytics.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link to="/add" className="py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors">
              Add Expense
            </Link>
            <Link to="/setup" className="py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors">
              Edit Setup
            </Link>
          </div>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!stats.isOverspending) return;
    if (typeof Notification === 'undefined') return;
    const dateStr = todayDate.toISOString().split('T')[0];
    const key = 'tripspend_overspend_alert_date';
    if (localStorage.getItem(key) === dateStr) return;
    const notify = () => {
      new Notification('TripSpend Alert', { body: `At current pace, you may overshoot by ${formatCurrency(stats.projectedDeficit)}.` });
      localStorage.setItem(key, dateStr);
    };
    if (Notification.permission === 'granted') notify();
    else if (Notification.permission === 'default') Notification.requestPermission().then(p => p === 'granted' && notify());
  }, [stats.isOverspending, stats.projectedDeficit, todayDate]);

  return (
    <div className="page-shell space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center page-header">
        <div>
          <h1 className="page-title">TripSpend</h1>
          <p className="page-subtitle">Budget Dashboard</p>
        </div>
        <Link to="/settings" className="p-2.5 bg-white rounded-2xl shadow-md border border-slate-200 text-slate-500 hover:shadow-lg hover:text-blue-600 transition-all duration-200">
          <Settings className="w-4.5 h-4.5" />
        </Link>
      </div>

      {/* Trip snapshot */}
      <motion.div {...MOTION_VARIANTS.fadeSlideDown}
        className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-4 text-white shadow-lg shadow-blue-200">
        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-2">Current Trip</p>
        {isPreTrip && (
          <div className="mb-2 inline-flex items-center px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
            <span className="text-[10px] font-bold text-blue-50">
              Starts in {daysUntilStart} day{daysUntilStart > 1 ? 's' : ''}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><p className="text-blue-200 text-[10px]">Budget</p><p className="font-black text-base">{formatCurrency(data.setup.totalBudget)}</p></div>
          <div><p className="text-blue-200 text-[10px]">Spent</p><p className="font-black text-base">{formatCurrency(stats.totalSpent)}</p></div>
          <div><p className="text-blue-200 text-[10px]">People</p><p className="font-black text-base">{data.setup.peopleCount}</p></div>
          <div><p className="text-blue-200 text-[10px]">Expenses</p><p className="font-black text-base">{data.expenses.length}</p></div>
        </div>
      </motion.div>

      {/* Overspend alert */}
      {stats.isOverspending && (
        <motion.div {...MOTION_VARIANTS.fadeSlideDown}
          className="bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-2xl">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div>
              <p className="font-bold text-red-800 text-sm">Budget Alert</p>
              <p className="text-xs text-red-700">
                Projected to overshoot by {formatCurrency(stats.projectedDeficit)}.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Remaining balance */}
      <motion.div {...MOTION_VARIANTS.fadeScale} transition={{ delay: ANIMATION_DELAYS.balance }}
        className={`p-4 rounded-2xl border-2 ${stats.borderColor} ${stats.bgColor} shadow-sm`}>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Remaining Balance</p>
        <h2 className={`text-4xl font-black ${stats.statusColor} mb-3`}>{formatCurrency(stats.remainingBalance)}</h2>
        <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${stats.statusColor.replace('text', 'bg')}`}
            style={{ width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-xs font-semibold text-slate-500">
          <span>{stats.remainingPercentage.toFixed(1)}% of budget left</span>
          <span>{stats.daysRemaining} days left</span>
        </div>
      </motion.div>

      {/* Today / Yesterday */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div {...MOTION_VARIANTS.fadeSlideUp} transition={{ delay: ANIMATION_DELAYS.today }} className="card-elevated p-3.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Today</p>
          <p className="text-xl font-black text-slate-900">{formatCurrency(stats.todaySpent)}</p>
        </motion.div>
        <motion.div {...MOTION_VARIANTS.fadeSlideUp} transition={{ delay: ANIMATION_DELAYS.today }} className="card-elevated p-3.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Yesterday</p>
          <p className="text-xl font-black text-slate-500">{formatCurrency(stats.yesterdaySpent)}</p>
        </motion.div>
      </div>

      {/* Safe daily limit */}
      <motion.div {...MOTION_VARIANTS.fadeSlideUp} transition={{ delay: ANIMATION_DELAYS.dailyLimit }}
        className="bg-gradient-to-br from-blue-600 to-blue-700 p-4 rounded-2xl text-white shadow-lg shadow-blue-200">
        <p className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-2">Today's Limit</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-blue-200 text-[10px] mb-0.5">Safe to spend today</p>
            <p className="text-3xl font-black">{formatCurrency(stats.remainingPerDay)}</p>
          </div>
          <div className="text-right">
            <p className="text-blue-200 text-[10px] mb-0.5">Burn rate</p>
            <p className="text-lg font-bold">{formatCurrency(stats.dailyBurnRate)}</p>
          </div>
        </div>
      </motion.div>

      {/* Analytics CTA */}
      <motion.div {...MOTION_VARIANTS.fadeSlideUp} transition={{ delay: ANIMATION_DELAYS.analyticsCta }}>
        <Link
          to="/analytics"
          className="flex items-center justify-between p-3.5 bg-blue-50 border border-blue-100 rounded-2xl group hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Full Analytics</p>
              <p className="text-xs text-slate-500">Per person · burn rate · health score</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  );
};
