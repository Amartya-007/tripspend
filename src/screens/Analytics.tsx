import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TripData, getTripCategories, getTripPeople, calculateStats, calculateSettlement } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { motion } from 'motion/react';
import { TrendingUp, PieChart, BarChart3, Users, AlertTriangle, Zap, Crown, Trophy, Receipt } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';
import { loadSettledTransfers, isSettled, pruneStale } from '../utils/settlements.ts';

const dateFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' });

const CAT_GRADIENT: Record<string, string> = {
  Food: 'from-orange-500 to-orange-600',
  Travel: 'from-blue-500 to-blue-600',
  Stay: 'from-purple-500 to-purple-600',
  Misc: 'from-slate-500 to-slate-600',
};
const CAT_DOT: Record<string, string> = {
  Food: 'bg-orange-500', Travel: 'bg-blue-500', Stay: 'bg-purple-500', Misc: 'bg-slate-500',
};

interface Props { data: TripData; }

export const Analytics: React.FC<Props> = ({ data }) => {
  const stats = useMemo(() => calculateStats(data), [data]);
  const people = useMemo(() => getTripPeople(data.setup), [data.setup]);
  const settlement = useMemo(() => calculateSettlement(data.setup, data.expenses), [data.setup, data.expenses]);

  // Read settled transfers using structured storage, prune stale entries
  const settledTransfers = useMemo(() => {
    const loaded = loadSettledTransfers();
    return pruneStale(loaded, settlement.transfers);
  }, [settlement.transfers]);

  const pendingSettlement = useMemo(() => {
    const pending = settlement.transfers.filter(t => !isSettled(settledTransfers, t.from, t.to, t.amount));
    return {
      ...settlement,
      transfers: pending,
      totalToSettle: pending.reduce((s, t) => s + t.amount, 0),
    };
  }, [settlement, settledTransfers]);

  const personStats = useMemo(() => {
    if (!people.length) return [];
    const paid: Record<string, number> = {};
    const share: Record<string, number> = {};
    for (const p of people) { paid[p] = 0; share[p] = 0; }
    for (const exp of data.expenses) {
      if (exp.paidBy in paid) paid[exp.paidBy] += exp.amount;
      const pts = exp.participants?.length ? exp.participants : people;
      const s = pts.length > 0 ? exp.amount / pts.length : 0;
      for (const p of pts) { if (p in share) share[p] += s; }
    }
    return people
      .map(p => ({ name: p, paid: paid[p], share: share[p], net: settlement.balances[p] ?? 0 }))
      .sort((a, b) => b.paid - a.paid);
  }, [people, data.expenses, settlement.balances]);

  const categoryBreakdown = useMemo(() => {
    const cats = getTripCategories(data.setup);
    const totals = new Map<string, number>();
    for (const exp of data.expenses) totals.set(exp.category, (totals.get(exp.category) ?? 0) + exp.amount);
    return cats.map(name => ({ name, amount: totals.get(name) ?? 0 }))
      .filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [data.expenses, data.setup]);

  const dailyTimeline = useMemo(() => {
    const map = new Map<string, number>();
    for (const exp of data.expenses) map.set(exp.date, (map.get(exp.date) ?? 0) + exp.amount);
    return Array.from(map.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.expenses]);

  const maxDaily = useMemo(() => dailyTimeline.length ? Math.max(...dailyTimeline.map(d => d.amount)) : 1, [dailyTimeline]);
  const minDaily = useMemo(() => dailyTimeline.length ? Math.min(...dailyTimeline.map(d => d.amount)) : 0, [dailyTimeline]);

  const topExpenses = useMemo(() =>
    [...data.expenses].sort((a, b) => b.amount - a.amount).slice(0, 5),
    [data.expenses]
  );

  const topSpender = personStats[0] ?? null;
  const mostOwed = useMemo(() => [...personStats].sort((a, b) => b.net - a.net)[0] ?? null, [personStats]);

  const smartInsights = useMemo(() => {
    if (!stats || !data.expenses.length) return [];
    const lines: string[] = [];
    const total = stats.totalSpent;
    if (stats.daysRemaining > 0 && stats.dailyBurnRate > stats.remainingPerDay) {
      const pct = Math.round(((stats.dailyBurnRate - stats.remainingPerDay) / stats.remainingPerDay) * 100);
      lines.push(`Spending ${pct}% above safe daily pace`);
    }
    if (topSpender && total > 0) {
      const pct = Math.round((topSpender.paid / total) * 100);
      if (pct > 40) lines.push(`${topSpender.name} paid ${pct}% of total expenses`);
    }
    if (categoryBreakdown[0] && total > 0) {
      const pct = Math.round((categoryBreakdown[0].amount / total) * 100);
      if (pct > 35) lines.push(`${categoryBreakdown[0].name} dominates at ${pct}% of spending`);
    }
    if (stats.budgetLastsDays !== Infinity && stats.daysRemaining > 0 && stats.budgetLastsDays < stats.daysRemaining) {
      lines.push(`Budget runs out ${Math.floor(stats.budgetLastsDays)} days before trip ends`);
    }
    if (settlement.totalToSettle > 0) lines.push(`${formatCurrency(pendingSettlement.totalToSettle)} still needs to be settled`);
    return lines.slice(0, 4);
  }, [stats, topSpender, categoryBreakdown, settlement, data.expenses]);

  const healthScore = useMemo(() => {
    if (!stats) return null;
    let score = 100;
    const usedPct = 100 - stats.remainingPercentage;
    const expectedPct = stats.totalDays > 0 ? ((stats.totalDays - stats.daysRemaining) / stats.totalDays) * 100 : 0;
    if (usedPct > expectedPct + 20) score -= 25;
    else if (usedPct > expectedPct + 10) score -= 10;
    if (stats.isOverspending) score -= 20;
    if (pendingSettlement.totalToSettle > stats.totalSpent * 0.3) score -= 15;
    else if (pendingSettlement.totalToSettle > 0) score -= 5;
    if (dailyTimeline.length > 1 && stats.totalSpent > 0) {
      const avg = stats.totalSpent / dailyTimeline.length;
      const variance = dailyTimeline.reduce((s, d) => s + (d.amount - avg) ** 2, 0) / dailyTimeline.length;
      if (Math.sqrt(variance) > avg * 1.5) score -= 10;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [stats, settlement, dailyTimeline]);

  const healthStyle = healthScore === null ? null
    : healthScore >= 75 ? { text: 'text-green-600', bg: 'bg-green-50', bar: 'bg-green-500', label: 'Great' }
    : healthScore >= 50 ? { text: 'text-orange-500', bg: 'bg-orange-50', bar: 'bg-orange-500', label: 'Fair' }
    : { text: 'text-red-500', bg: 'bg-red-50', bar: 'bg-red-500', label: 'At Risk' };

  if (!stats) {
    return (
      <div className="page-shell flex items-center justify-center py-24">
        <p className="text-slate-400 font-semibold">Add expenses to see analytics</p>
      </div>
    );
  }

  if (data.expenses.length === 0) {
    return (
      <div className="page-shell space-y-4">
        <div className="page-header">
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Trip insights & breakdown</p>
        </div>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <TrendingUp className="w-8 h-8 text-blue-500" />
          </div>
          <p className="font-black text-slate-900 text-lg">Analytics will appear here</p>
          <p className="text-sm text-slate-500 mt-2">Add a few expenses to see category breakdowns, timeline spikes, and person-wise balances.</p>
          <Link
            to="/add"
            className="mt-5 inline-flex px-6 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors"
          >
            Add first expense
          </Link>
        </div>
      </div>
    );
  }

  const total = stats.totalSpent;
  const tripStart = data.setup?.startDate ? parseISO(data.setup.startDate) : null;

  return (
    <div className="page-shell space-y-5">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">Trip insights & breakdown</p>
      </div>

      {/* Smart Insights */}
      {smartInsights.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-gradient-to-br from-blue-600 to-blue-700 p-5 rounded-3xl text-white shadow-xl shadow-blue-200">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-yellow-300 fill-yellow-300" />
            <p className="font-bold">Smart Insights</p>
          </div>
          <div className="space-y-2">
            {smartInsights.map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-blue-300 rounded-full mt-1.5 flex-shrink-0" />
                <p className="text-blue-100 text-sm leading-snug">{line}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Burn Rate */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          <p className="font-bold text-slate-900">Burn Rate</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            { label: 'Current Daily', value: formatCurrency(stats.dailyBurnRate), sub: 'actual spend/day', warn: stats.dailyBurnRate > stats.remainingPerDay },
            { label: 'Safe Daily', value: formatCurrency(stats.remainingPerDay), sub: 'to stay on budget', warn: false },
            { label: 'Budget Lasts', value: stats.budgetLastsDays === Infinity ? '∞ days' : `${Math.floor(stats.budgetLastsDays)}d`, sub: 'at current pace', warn: stats.budgetLastsDays !== Infinity && stats.budgetLastsDays < stats.daysRemaining },
            { label: 'Days Left', value: `${stats.daysRemaining}`, sub: 'in trip', warn: false },
          ] as const).map(item => (
            <div key={item.label} className={`p-3 rounded-2xl ${item.warn ? 'bg-red-50 border border-red-100' : 'bg-slate-50'}`}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{item.label}</p>
              <p className={`text-lg font-black mt-0.5 ${item.warn ? 'text-red-600' : 'text-slate-900'}`}>{item.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{item.sub}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Per-person */}
      {personStats.length > 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-5 pb-2">
            <Users className="w-5 h-5 text-blue-600" />
            <p className="font-bold text-slate-900">Per Person</p>
          </div>
          <div className="flex gap-2 px-5 pb-3 flex-wrap">
            {topSpender && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-100 text-[10px] font-bold text-amber-700">
                <Crown className="w-3 h-3" />{topSpender.name} top spender
              </span>
            )}
            {mostOwed && mostOwed.net > 0.01 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 border border-green-100 text-[10px] font-bold text-green-700">
                <Trophy className="w-3 h-3" />{mostOwed.name} most owed
              </span>
            )}
          </div>
          {personStats.map((p, idx) => (
            <React.Fragment key={p.name}>
              {idx > 0 && <div className="h-px bg-slate-50 mx-5" />}
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-sm font-black text-blue-700 flex-shrink-0">
                  {p.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm">{p.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">paid {formatCurrency(p.paid)} · share {formatCurrency(p.share)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-black ${p.net > 0.01 ? 'text-green-600' : p.net < -0.01 ? 'text-red-500' : 'text-slate-400'}`}>
                    {p.net > 0.01 ? `+${formatCurrency(p.net)}` : p.net < -0.01 ? `-${formatCurrency(Math.abs(p.net))}` : 'Even'}
                  </p>
                  <p className="text-[10px] text-slate-400">{p.net > 0.01 ? 'to receive' : p.net < -0.01 ? 'to pay' : ''}</p>
                </div>
              </div>
            </React.Fragment>
          ))}
        </motion.div>
      )}

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="w-5 h-5 text-blue-600" />
            <p className="font-bold text-slate-900">Category Breakdown</p>
          </div>
          <div className="space-y-3">
            {categoryBreakdown.map((item, idx) => {
              const pct = total > 0 ? (item.amount / total) * 100 : 0;
              return (
                <div key={item.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${CAT_DOT[item.name] ?? 'bg-indigo-500'}`} />
                      <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                      {idx === 0 && pct > 35 && <span className="text-[9px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">Top</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                      <span className="text-sm font-bold text-slate-900">{formatCurrency(item.amount)}</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: idx * 0.05 }}
                      className={`h-full bg-gradient-to-r ${CAT_GRADIENT[item.name] ?? 'from-indigo-500 to-indigo-600'}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Daily Timeline */}
      {dailyTimeline.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <p className="font-bold text-slate-900">Daily Timeline</p>
          </div>
          <div className="space-y-2.5">
            {dailyTimeline.map((day, idx) => {
              const pct = maxDaily > 0 ? (day.amount / maxDaily) * 100 : 0;
              const isHigh = day.amount === maxDaily;
              const isLow = dailyTimeline.length > 1 && day.amount === minDaily;
              const overLimit = stats.remainingPerDay > 0 && day.amount > stats.remainingPerDay;
              const limitPct = stats.remainingPerDay > 0 && maxDaily > 0 ? (stats.remainingPerDay / maxDaily) * 100 : null;
              const dayNum = tripStart ? differenceInDays(parseISO(day.date), tripStart) + 1 : idx + 1;
              return (
                <div key={day.date}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 w-7 flex-shrink-0">D{dayNum}</span>
                      <span className="text-xs font-semibold text-slate-600">{dateFmt.format(new Date(day.date + 'T00:00:00'))}</span>
                      {isHigh && <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">spike</span>}
                      {isLow && <span className="text-[9px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">low</span>}
                    </div>
                    <span className={`text-xs font-bold flex-shrink-0 ${overLimit ? 'text-red-500' : 'text-slate-900'}`}>
                      {formatCurrency(day.amount)}{overLimit ? ' ⚠️' : ''}
                    </span>
                  </div>
                  <div className="relative w-full bg-slate-100 rounded-full h-2">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: idx * 0.03 }}
                      className={`h-full rounded-full ${overLimit ? 'bg-gradient-to-r from-red-400 to-red-500' : isHigh ? 'bg-gradient-to-r from-orange-400 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-blue-600'}`}
                    />
                    {limitPct !== null && (
                      <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-orange-400 rounded-full pointer-events-none" style={{ left: `${Math.min(limitPct, 99)}%` }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Top Expenses */}
      {topExpenses.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-5 pb-3">
            <Receipt className="w-5 h-5 text-blue-600" />
            <p className="font-bold text-slate-900">Top Expenses</p>
          </div>
          {topExpenses.map((exp, idx) => (
            <React.Fragment key={exp.id}>
              {idx > 0 && <div className="h-px bg-slate-50 mx-5" />}
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500 flex-shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{exp.note || exp.category}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{exp.category} · {exp.paidBy}</p>
                </div>
                <p className="text-sm font-black text-slate-900 flex-shrink-0">{formatCurrency(exp.amount)}</p>
              </div>
            </React.Fragment>
          ))}
        </motion.div>
      )}

      {/* Settlement Pressure */}
      {pendingSettlement.totalToSettle > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-amber-50 border border-amber-100 rounded-3xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">Unsettled</p>
            <p className="text-2xl font-black text-amber-800">{formatCurrency(pendingSettlement.totalToSettle)}</p>
            <p className="text-xs text-amber-600 mt-1">{pendingSettlement.transfers.length} transfer{pendingSettlement.transfers.length > 1 ? 's' : ''} pending</p>
          </div>
          <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
        </motion.div>
      )}

      {/* Trip Health Score */}
      {healthScore !== null && healthStyle && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Trip Health</p>
              <div className="flex items-end gap-1">
                <p className={`text-5xl font-black ${healthStyle.text}`}>{healthScore}</p>
                <p className="text-slate-400 text-lg font-bold mb-1">/100</p>
              </div>
            </div>
            <div className={`px-4 py-2 ${healthStyle.bg} rounded-2xl`}>
              <p className={`text-base font-black ${healthStyle.text}`}>{healthStyle.label}</p>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <motion.div
              initial={{ width: 0 }} animate={{ width: `${healthScore}%` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className={`h-full rounded-full ${healthStyle.bar}`}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">Based on budget usage, settlement balance & spending consistency</p>
        </motion.div>
      )}
    </div>
  );
};
