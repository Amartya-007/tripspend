import React from 'react';
import { ArrowLeftRight, CircleArrowRight, HandCoins } from 'lucide-react';
import { motion } from 'motion/react';
import { TripData, calculateSettlement, getTripPeople } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';

interface SettlementProps {
  data: TripData;
}

export const Settlement: React.FC<SettlementProps> = ({ data }) => {
  const people = getTripPeople(data.setup);
  const settlement = calculateSettlement(data.setup, data.expenses);

  if (!data.setup) return null;

  return (
    <div className="page-shell space-y-6">
      <div className="page-header">
        <h1 className="page-title">Settlement</h1>
        <p className="page-subtitle">Who owes whom at the end of the trip</p>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HandCoins className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-slate-900">Total To Settle</h2>
          </div>
          <span className="text-xl font-black text-slate-900">{formatCurrency(settlement.totalToSettle)}</span>
        </div>

        <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-3">Net Balances</p>
        <div className="space-y-2">
          {people.map((person) => {
            const value = settlement.balances[person] || 0;
            const isPositive = value > 0;
            const isNegative = value < 0;

            return (
              <div key={person} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50">
                <span className="font-semibold text-slate-700">{person}</span>
                <span className={`font-black ${isPositive ? 'text-green-600' : isNegative ? 'text-red-500' : 'text-slate-500'}`}>
                  {value > 0 ? '+' : ''}{formatCurrency(value)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <ArrowLeftRight className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-slate-900">Suggested Transfers</h2>
        </div>

        {settlement.transfers.length === 0 ? (
          <p className="text-sm text-slate-500">All settled up. No transfers needed.</p>
        ) : (
          <div className="space-y-3">
            {settlement.transfers.map((transfer, index) => (
              <motion.div
                key={`${transfer.from}-${transfer.to}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl border border-slate-100 bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-700">{transfer.from}</span>
                  <CircleArrowRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-slate-700">{transfer.to}</span>
                  <span className="ml-auto font-black text-slate-900">{formatCurrency(transfer.amount)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
