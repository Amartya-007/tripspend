import React, { useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Expense, TripSetup } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Calendar, Tag, ArrowLeft, Pencil, Trash2, ReceiptText, AlertCircle, User, Users } from 'lucide-react';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';

interface ExpenseDetailProps {
  expenses: Expense[];
  onDelete: (id: string) => void;
  setup: TripSetup | null;
}

export const ExpenseDetail: React.FC<ExpenseDetailProps> = ({ expenses, onDelete, setup }) => {
  const { id } = useParams();
  const navigate = useNavigate();

  const expense = useMemo(() => expenses.find((item) => item.id === id), [expenses, id]);

  const backToExpenses = useCallback(() => {
    navigate('/expenses');
  }, [navigate]);

  const expenseDate = useMemo(() => {
    if (!expense) return null;
    return parseISO(expense.date);
  }, [expense]);

  const formattedExpenseDate = useMemo(() => {
    if (!expenseDate) return '';
    return format(expenseDate, 'EEEE, MMM dd, yyyy');
  }, [expenseDate]);

  const createdAtLabel = useMemo(() => {
    if (!expense?.createdAt) return null;
    return format(new Date(expense.createdAt), 'hh:mm a');
  }, [expense?.createdAt]);

  const isLocked = useMemo(() => {
    if (!expenseDate) return false;
    if (!setup?.lockPreviousDays) return false;
    return isBefore(startOfDay(expenseDate), startOfDay(new Date()));
  }, [expenseDate, setup?.lockPreviousDays]);

  const participants = useMemo(() => expense?.participants ?? [], [expense?.participants]);
  const tags = useMemo(() => expense?.tags ?? [], [expense?.tags]);

  const receipts = useMemo(() => {
    if (!expense) return [];
    if (expense.receipts && expense.receipts.length > 0) return expense.receipts;
    return expense.receiptImage ? [{ image: expense.receiptImage, name: expense.receiptName }] : [];
  }, [expense]);

  const splitPerPerson = useMemo(() => {
    if (!expense || participants.length === 0) return null;
    return `₹${(expense.amount / participants.length).toFixed(0)} each`;
  }, [expense, participants.length]);

  if (!expense) {
    return (
      <div className="page-shell">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <p className="text-slate-700 font-semibold">Expense not found.</p>
          <button
            onClick={backToExpenses}
            className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold"
          >
            Back to Expenses
          </button>
        </div>
      </div>
    );
  }

  const goToEdit = useCallback(() => {
    navigate(`/edit/${expense.id}`);
  }, [navigate, expense.id]);

  const handleDelete = useCallback(() => {
    if (isLocked) {
      alert('This expense is locked and cannot be deleted.');
      return;
    }

    const shouldDelete = window.confirm('Delete this expense?');
    if (!shouldDelete) return;

    onDelete(expense.id);
    navigate('/expenses');
  }, [expense.id, isLocked, navigate, onDelete]);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={backToExpenses}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      {isLocked && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          This expense is locked for editing/deleting.
        </div>
      )}

      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Amount</p>
            <p className="text-3xl font-black text-slate-900">{formatCurrency(expense.amount)}</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">{expense.category}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Calendar className="w-4 h-4" />
          {formattedExpenseDate}
          {createdAtLabel && (
            <span className="ml-auto text-xs text-slate-400">
              added {createdAtLabel}
            </span>
          )}
        </div>

        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Paid by</p>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center border border-emerald-100">
              <User className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <p className="text-sm font-semibold text-slate-700">{expense.paidBy || 'Trip Wallet'}</p>
          </div>
        </div>

        {participants.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Users className="w-3 h-3" />
              Split between · {participants.length} people
            </p>
            <div className="flex flex-wrap gap-2">
              {participants.map((person) => (
                <span
                  key={person}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                    person === expense.paidBy
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : 'bg-slate-50 text-slate-600 border-slate-100'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white border border-current flex items-center justify-center text-[9px] font-black flex-shrink-0">
                    {person[0].toUpperCase()}
                  </span>
                  {person}
                  {person === expense.paidBy && (
                    <span className="text-[9px] font-bold text-emerald-500 ml-0.5">paid</span>
                  )}
                </span>
              ))}
            </div>
            {splitPerPerson && <p className="text-[10px] text-slate-400 mt-2">{splitPerPerson}</p>}
          </div>
        )}

        {expense.note && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Note</p>
            <p className="text-sm text-slate-700">{expense.note}</p>
          </div>
        )}

        {tags.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tags</p>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={`${expense.id}-${tag}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {receipts.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
              <ReceiptText className="w-3 h-3" />
              Receipts ({receipts.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {receipts.map((receipt, idx) => (
                <img
                  key={`${expense.id}-receipt-${idx}`}
                  src={receipt.image}
                  alt={receipt.name || `Receipt ${idx + 1}`}
                  className="w-full h-36 object-cover rounded-2xl border border-slate-100"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={goToEdit}
          disabled={Boolean(isLocked)}
          className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold inline-flex items-center justify-center gap-2"
        >
          <Pencil className="w-4 h-4" />
          Edit
        </button>

        <button
          onClick={handleDelete}
          disabled={Boolean(isLocked)}
          className="w-full py-3 rounded-2xl bg-red-50 hover:bg-red-100 disabled:bg-slate-100 text-red-600 disabled:text-slate-400 font-bold inline-flex items-center justify-center gap-2 border border-red-100 disabled:border-slate-200"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  );
};
