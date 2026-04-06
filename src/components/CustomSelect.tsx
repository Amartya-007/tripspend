import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  accentColor?: 'blue' | 'emerald';
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  accentColor = 'blue',
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const handleSelect = useCallback((val: T) => {
    onChange(val);
    setOpen(false);
  }, [onChange]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const accent = accentColor === 'emerald'
    ? { ring: 'ring-emerald-500 border-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', check: 'text-emerald-600' }
    : { ring: 'ring-blue-500 border-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', check: 'text-blue-600' };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`w-full px-4 py-3 rounded-xl border text-sm font-semibold text-left flex items-center justify-between gap-2 transition-all disabled:opacity-50 bg-white ${
          open
            ? `ring-2 ring-inset ${accent.ring} ${accent.bg} ${accent.text}`
            : 'border-slate-200 text-slate-700 hover:border-slate-300'
        }`}
      >
        <span className="truncate">{selected?.label ?? placeholder ?? 'Select...'}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </motion.span>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
          >
            {options.map((option, idx) => {
              const isSelected = option.value === value;
              return (
                <React.Fragment key={option.value}>
                  {idx > 0 && <div className="h-px bg-slate-50 mx-3" />}
                  <button
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`w-full px-4 py-3 text-sm font-semibold text-left flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? `${accent.bg} ${accent.text}`
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{option.label}</span>
                    {isSelected && <Check className={`w-4 h-4 flex-shrink-0 ${accent.check}`} />}
                  </button>
                </React.Fragment>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
