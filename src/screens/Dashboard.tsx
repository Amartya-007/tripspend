import React, { useEffect } from 'react';
import { TripData, calculateStats } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Wallet, TrendingUp, Users, PieChart, Settings, Zap, Calendar, Clock, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

interface DashboardProps {
  data: TripData;
}

export const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  const stats = calculateStats(data);

  if (!stats || !data.setup) return null;

  useEffect(() => {
    if (!stats.isOverspending) return;
    if (typeof Notification === 'undefined') return;

    const today = new Date().toISOString().split('T')[0];
    const key = 'tripspend_overspend_alert_date';
    if (localStorage.getItem(key) === today) return;

    const notify = () => {
      new Notification('TripSpend Alert', {
        body: `At current pace, you may overshoot by ${formatCurrency(stats.projectedDeficit)}.`
      });
      localStorage.setItem(key, today);
    };

    if (Notification.permission === 'granted') {
      notify();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          notify();
        }
      });
    }
  }, [stats.isOverspending, stats.projectedDeficit]);

  return (
    <div className="page-shell space-y-6">
      <div className="flex justify-between items-center page-header">
        <div>
          <h1 className="page-title">TripSpend</h1>
          <p className="page-subtitle">Budget Dashboard</p>
        </div>
        <Link to="/settings" className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 text-slate-600 hover:shadow-lg hover:text-blue-600 transition-all duration-200">
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {stats.isOverspending && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-red-50 to-rose-50 border border-red-200 p-4 rounded-3xl shadow-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold text-red-800">Budget Alert</p>
              <p className="text-sm text-red-700 leading-relaxed">
                At this burn rate, you are projected to overshoot by {formatCurrency(stats.projectedDeficit)} by trip end.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Main Balance Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className={`p-7 rounded-3xl border-2 ${stats.borderColor} ${stats.bgColor} shadow-lg hover:shadow-xl transition-shadow duration-300`}
      >
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Remaining Balance</p>
        <h2 className={`text-5xl font-black ${stats.statusColor} mb-5`}>
          {formatCurrency(stats.remainingBalance)}
        </h2>
        <div className="w-full bg-slate-200 rounded-full h-2.5 mb-4">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ${stats.statusColor.replace('text', 'bg')}`}
            style={{ width: `${Math.max(0, Math.min(100, stats.remainingPercentage))}%` }}
          />
        </div>
        <div className="flex justify-between items-center">
          <p className="text-sm font-semibold text-slate-700">
            {stats.remainingPercentage.toFixed(1)}% of budget left
          </p>
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            {stats.daysRemaining} days left
          </div>
        </div>
      </motion.div>

      {/* Daily Spend View */}
      <div className="grid grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card-elevated p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Today</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(stats.todaySpent)}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card-elevated p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center">
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Yesterday</span>
          </div>
          <p className="text-2xl font-black text-slate-600">{formatCurrency(stats.yesterdaySpent)}</p>
        </motion.div>
      </div>

      {/* Smart Insights */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-gradient-to-br from-blue-600 to-blue-700 p-7 rounded-3xl text-white shadow-xl shadow-blue-200">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="p-2 bg-blue-500/30 rounded-lg">
            <Zap className="w-5 h-5 text-yellow-300 fill-yellow-300" />
          </div>
          <h3 className="font-bold text-lg">Smart Insights</h3>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-blue-100 text-sm font-medium">Safe Daily Limit</span>
            <span className="font-black text-xl">{formatCurrency(stats.remainingPerDay)}</span>
          </div>
          <div className="h-px bg-blue-400/30" />
          <div className="flex justify-between items-center">
            <span className="text-blue-100 text-sm font-medium">Daily Burn Rate</span>
            <span className="font-bold text-lg">{formatCurrency(stats.dailyBurnRate)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-blue-100 text-sm font-medium">Budget Lasts</span>
            <span className="font-bold text-lg">
              {stats.budgetLastsDays === Infinity ? '∞' : Math.floor(stats.budgetLastsDays)} days
            </span>
          </div>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard 
          label="Total Spent" 
          value={formatCurrency(stats.totalSpent)} 
          icon={<TrendingUp className="w-5 h-5 text-orange-500" />}
          color="bg-orange-50"
        />
        <StatCard 
          label="Per Person" 
          value={formatCurrency(stats.perPersonSpend)} 
          icon={<Users className="w-5 h-5 text-purple-500" />}
          color="bg-purple-50"
        />
      </div>

      {/* Category Summary */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="card-premium p-7">
        <h3 className="text-lg font-bold text-slate-900 mb-5">Category Breakdown</h3>
        <div className="space-y-4">
          {['Food', 'Travel', 'Stay', 'Misc'].map((cat) => {
            const amount = data.expenses
              .filter(e => e.category === cat)
              .reduce((sum, e) => sum + e.amount, 0);
            const percentage = stats.totalSpent > 0 ? (amount / stats.totalSpent) * 100 : 0;
            
            return (
              <div key={cat} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-700">{cat}</span>
                  <span className="text-sm font-bold text-slate-900">{formatCurrency(amount)}</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

const StatCard = ({ label, value, icon, color }: { label: string, value: string, icon: React.ReactNode, color: string }) => (
  <motion.div 
    whileHover={{ scale: 1.05 }}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="card-premium p-5 flex flex-col gap-3 cursor-default"
  >
    <div className={`w-10 h-10 ${color} rounded-2xl flex items-center justify-center`}>
      {icon}
    </div>
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-1">{value}</p>
    </div>
  </motion.div>
);
