import React, { useEffect, useMemo } from 'react';
import { TripData, Trip, Expense, TripSetup, calculateStats } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Settings, AlertTriangle, BarChart3, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { differenceInDays, parseISO, startOfDay } from 'date-fns';
import { TripSwitcher } from '../components/TripSwitcher';
import { NotificationPayload } from '../components/NotificationCard';

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
  onSaveSetup?: (setup: TripSetup) => void | Promise<void>;
  onAddExpense?: (expense: Expense) => void | Promise<void>;
  onUpdateExpense?: (expense: Expense) => void | Promise<void>;
  onDeleteExpense?: (id: string) => void | Promise<void>;
  onUndoDelete?: () => void | Promise<void>;
  canUndoDelete?: boolean;
  onNameCurrentTrip?: (name: string) => void;
  onSelectTrip?: (tripId: string) => void;
  trips?: Trip[];
  activeTrip?: string | null;
  onCreateTrip?: (name: string) => string | null | void | Promise<string | null | void>;
  onGenerateInviteCode?: () => Promise<string | null>;
  onJoinTrip?: (tripId: string) => Promise<boolean>;
  onDeleteTrip?: (tripId: string) => void;
  onRenameTrip?: (tripId: string, newName: string) => void;
  notify?: (payload: NotificationPayload) => void;
  isCollaborative?: boolean;
  userUid?: string | null;
  myMemberId?: string | null;
  identityMap?: Record<string, string>;
  isTripCreator?: boolean;
  inviteActive?: boolean;
  onToggleInviteActive?: (active: boolean) => Promise<boolean>;
}

export const Dashboard: React.FC<DashboardProps> = ({
  data,
  onSelectTrip,
  onCreateTrip,
  onGenerateInviteCode,
  onJoinTrip,
  onDeleteTrip,
  onRenameTrip,
  trips = [],
  activeTrip = null,
  notify,
  isCollaborative,
  isTripCreator,
  inviteActive,
  onToggleInviteActive,
}) => {
  const stats = useMemo(() => calculateStats(data), [data]);
  const todayDate = useMemo(() => startOfDay(new Date()), []);
  const daysUntilStart = useMemo(() => {
    if (!data.setup?.startDate) return 0;
    const start = startOfDay(parseISO(data.setup.startDate));
    return differenceInDays(start, todayDate);
  }, [data.setup?.startDate, todayDate]);
  const isPreTrip = useMemo(() => daysUntilStart > 0, [daysUntilStart]);

  useEffect(() => {
    if (!stats?.isOverspending) return;
    if (typeof Notification === 'undefined') return;
    const dateStr = todayDate.toISOString().split('T')[0];
    const key = 'tripspend_overspend_alert_date';
    if (localStorage.getItem(key) === dateStr) return;
    const notifyUser = () => {
      new Notification('TripSpend Alert', { body: `At current pace, you may overshoot by ${formatCurrency(stats.projectedDeficit)}.` });
      localStorage.setItem(key, dateStr);
    };
    if (Notification.permission === 'granted') notifyUser();
    else if (Notification.permission === 'default') Notification.requestPermission().then(p => p === 'granted' && notifyUser());
  }, [stats?.isOverspending, stats?.projectedDeficit, todayDate]);

  if (!data.setup) return null;

  return (
    <div className="page-shell space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center page-header mb-1">
        <div>
          <h1 className="page-title">TripSpend</h1>
          <p className="page-subtitle">Budget Dashboard</p>
        </div>
        <Link to="/settings" className="p-2.5 bg-white rounded-2xl shadow-md border border-slate-200 text-slate-500 hover:shadow-lg hover:text-blue-600 transition-all duration-200">
          <Settings className="w-4.5 h-4.5" />
        </Link>
      </div>

      {/* Trip Switcher (Collaborative only or multi-trip) */}
      {(isCollaborative || trips.length > 1) && onSelectTrip && onCreateTrip && onDeleteTrip && onRenameTrip && (
        <div className="mb-2">
          <TripSwitcher
            trips={trips}
            activeTrip={activeTrip}
            onSelectTrip={onSelectTrip}
            onCreateTrip={onCreateTrip}
            onGenerateInviteCode={onGenerateInviteCode}
            onJoinTrip={onJoinTrip}
            onDeleteTrip={onDeleteTrip}
            onRenameTrip={onRenameTrip}
            notify={notify}
            isTripCreator={isTripCreator}
            inviteActive={inviteActive}
            onToggleInviteActive={onToggleInviteActive}
          />
        </div>
      )}

      {/* Trip snapshot — always shown when setup exists */}
      {stats && (
        <>
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

          {/* Today / Yesterday — only shown when expenses exist */}
          {data.expenses.length > 0 && (
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
          )}

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
        </>
      )}
    </div>
  );
};
