import React, { useState, useCallback, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isSameMonth, isToday, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';

interface DatePickerProps {
  value: string; // yyyy-MM-dd
  onChange: (value: string) => void;
  disabled?: boolean;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SWIPE_THRESHOLD = 50;

export const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, disabled }) => {
  const selected = useMemo(() => value ? parseISO(value) : new Date(), [value]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected));
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState(1);
  const touchStartX = useRef<number | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth));
    const end = endOfWeek(endOfMonth(viewMonth));
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const prevMonth = useCallback(() => {
    setDirection(-1);
    setViewMonth(m => subMonths(m, 1));
  }, []);

  const nextMonth = useCallback(() => {
    setDirection(1);
    setViewMonth(m => addMonths(m, 1));
  }, []);

  const handleSelect = useCallback((day: Date) => {
    onChange(format(day, 'yyyy-MM-dd'));
    setOpen(false);
  }, [onChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    delta < 0 ? nextMonth() : prevMonth();
  }, [nextMonth, prevMonth]);

  const sheet = createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
          />

          {/* Bottom sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl max-w-md mx-auto"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>

            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-3">
              <button type="button" onClick={prevMonth} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 text-slate-500 transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={format(viewMonth, 'yyyy-MM')}
                  initial={{ opacity: 0, x: direction * 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -20 }}
                  transition={{ duration: 0.15 }}
                  className="text-base font-black text-slate-800"
                >
                  {format(viewMonth, 'MMMM yyyy')}
                </motion.span>
              </AnimatePresence>
              <button type="button" onClick={nextMonth} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-slate-100 text-slate-500 transition-colors">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Swipeable grid */}
            <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="px-4">
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-[11px] font-bold text-slate-400 uppercase tracking-wide py-1">{d}</div>
                ))}
              </div>

              {/* Days */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={format(viewMonth, 'yyyy-MM')}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -40 }}
                  transition={{ duration: 0.18 }}
                  className="grid grid-cols-7 gap-y-1"
                >
                  {days.map(day => {
                    const isSelected = isSameDay(day, selected);
                    const isCurrentMonth = isSameMonth(day, viewMonth);
                    const isTodayDate = isToday(day);
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => handleSelect(day)}
                        className={`relative h-10 w-full rounded-xl text-sm font-semibold transition-all ${
                          isSelected ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                          : isTodayDate ? 'bg-blue-50 text-blue-600 font-black'
                          : isCurrentMonth ? 'text-slate-700 active:bg-slate-100'
                          : 'text-slate-300'
                        }`}
                      >
                        {format(day, 'd')}
                        {isTodayDate && !isSelected && (
                          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-500 rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Today + Cancel */}
            <div className="grid grid-cols-2 gap-3 px-4 mt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSelect(new Date())}
                className="py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-100"
              >
                Today
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold text-left flex items-center justify-between gap-2 transition-all disabled:opacity-50 bg-white ${
          open ? 'border-blue-500 ring-2 ring-inset ring-blue-500 text-blue-700 bg-blue-50'
               : 'border-slate-200 text-slate-700 hover:border-slate-300'
        }`}
      >
        <span>{format(selected, 'EEE, MMM d, yyyy')}</span>
        <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
      </button>
      {sheet}
    </div>
  );
};
