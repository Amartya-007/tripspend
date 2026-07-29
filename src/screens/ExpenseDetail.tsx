import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Expense, TripSetup } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { Calendar, Tag, ArrowLeft, Pencil, Trash2, ReceiptText, AlertCircle, User, Users, X } from 'lucide-react';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { buildDisplayNameMap } from '../utils/memberDisplay';

interface ExpenseDetailProps {
  expenses: Expense[];
  onDelete: (id: string) => void | Promise<void>;
  onUpdate?: (expense: Expense) => void | Promise<void>;
  setup: TripSetup | null;
  isCollaborative?: boolean;
  userUid?: string | null;
  myMemberId?: string | null;
}

export const ExpenseDetail: React.FC<ExpenseDetailProps> = ({ expenses, onDelete, setup, isCollaborative, userUid, myMemberId }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
  const displayNames = useMemo(() => buildDisplayNameMap(setup?.memberRegistry ?? {}, true), [setup?.memberRegistry]);
  const tags = useMemo(() => expense?.tags ?? [], [expense?.tags]);

  const receipts = useMemo(() => {
    if (!expense) return [];
    if (expense.receipts && expense.receipts.length > 0) return expense.receipts;
    return expense.receiptImage ? [{ image: expense.receiptImage, name: expense.receiptName }] : [];
  }, [expense]);

  const splitPerPerson = useMemo(() => {
    if (!expense || participants.length === 0) return null;
    return formatCurrency(expense.amount / participants.length);
  }, [expense, participants.length]);

  const goToEdit = useCallback(() => {
    if (!expense) return;
    navigate(`/edit/${expense.id}`);
  }, [navigate, expense]);

  const openDeleteConfirm = useCallback(() => {
    if (isLocked) {
      alert('This expense is locked and cannot be deleted.');
      return;
    }
    setDeleteError('');
    setShowDeleteConfirm(true);
  }, [isLocked]);

  const cancelDelete = useCallback(() => {
    if (isDeleting) return;
    setShowDeleteConfirm(false);
  }, [isDeleting]);

  const confirmDelete = useCallback(async () => {
    if (!expense || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');
    try {
      await Promise.resolve(onDelete(expense.id));
      navigate('/expenses');
    } catch (error) {
      console.error('[ExpenseDetail] Failed to delete expense:', error);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteError('Could not delete this expense. Please try again.');
    }
  }, [expense, isDeleting, navigate, onDelete]);

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

      {deleteError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {deleteError}
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
            <p className="text-sm font-semibold text-slate-700">{displayNames[expense.paidBy] || expense.paidBy || 'Trip Wallet'}</p>
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
                  {displayNames[person] || person}
                  {person === expense.paidBy && (
                    <span className="text-[9px] font-bold text-emerald-500 ml-0.5">paid</span>
                  )}
                </span>
              ))}
            </div>
            {splitPerPerson && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Per person share</p>
                <p className="mt-0.5 text-lg font-black text-amber-900">
                  {splitPerPerson}
                  <span className="ml-1 text-xs font-semibold text-amber-700">each</span>
                </p>
                <p className="text-[11px] text-amber-800/90">Each selected person will owe this amount.</p>
              </div>
            )}
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
          onClick={openDeleteConfirm}
          disabled={Boolean(isLocked)}
          className="w-full py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 disabled:bg-slate-100 text-rose-600 disabled:text-slate-400 font-bold inline-flex items-center justify-center gap-2 border border-rose-100 disabled:border-slate-200"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-slate-900/40 flex items-end sm:items-center justify-center p-4"
            onClick={cancelDelete}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              className="w-full max-w-sm bg-white rounded-[2rem] border border-slate-100 shadow-2xl ring-2 ring-rose-200 p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-rose-600" />
                </div>
                <button
                  type="button"
                  onClick={cancelDelete}
                  disabled={isDeleting}
                  className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="mt-4 text-lg font-black text-slate-900">Delete this expense?</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatCurrency(expense.amount)} · {expense.category} will be permanently removed. This can't be undone.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={cancelDelete}
                  disabled={isDeleting}
                  className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-bold inline-flex items-center justify-center gap-2"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
