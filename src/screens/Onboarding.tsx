import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Wallet, Users, BarChart3, ShieldCheck } from 'lucide-react';

interface OnboardingScreenProps {
  onComplete: () => void;
}

interface OnboardingSlide {
  title: string;
  subtitle: string;
  bullets: string[];
  icon: React.ReactNode;
  color: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    title: 'Welcome to TripSpend',
    subtitle: 'Set up your trip in under 60 seconds',
    bullets: [
      'Add your members and budget once',
      'Customize categories for this trip',
      'Track spending without any account'
    ],
    icon: <Wallet className="w-6 h-6" />,
    color: 'from-blue-600 to-indigo-600',
  },
  {
    title: 'Split Clearly',
    subtitle: 'Know exactly who paid and who owes',
    bullets: [
      'Capture payer and participants per expense',
      'See auto-calculated net balances',
      'Mark settlements with notes and proof'
    ],
    icon: <Users className="w-6 h-6" />,
    color: 'from-emerald-600 to-teal-600',
  },
  {
    title: 'Stay in Control',
    subtitle: 'Keep budget and trends visible every day',
    bullets: [
      'Track burn rate and daily safe spend',
      'Review category and member analytics',
      'Export summaries and closing reports'
    ],
    icon: <BarChart3 className="w-6 h-6" />,
    color: 'from-amber-500 to-orange-600',
  },
];

const TOTAL_SLIDES = SLIDES.length;
const PROGRESS_SPRING = { type: 'spring', stiffness: 200, damping: 26 } as const;

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [index, setIndex] = useState(0);
  const current = useMemo(() => SLIDES[index], [index]);
  const isLast = useMemo(() => index === TOTAL_SLIDES - 1, [index]);
  const stepLabel = useMemo(() => `Step ${index + 1} of ${TOTAL_SLIDES}`, [index]);

  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    setIndex((v) => Math.min(TOTAL_SLIDES - 1, v + 1));
  }, []);

  const progressWidth = useMemo(() => `${((index + 1) / TOTAL_SLIDES) * 100}%`, [index]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 px-4 py-7 flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-6">
        <div className="mb-5">
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-600 rounded-full"
              initial={false}
              animate={{ width: progressWidth }}
              transition={PROGRESS_SPRING}
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">{stepLabel}</p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            className="space-y-5"
          >
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${current.color} text-white flex items-center justify-center shadow-lg`}>
              {current.icon}
            </div>

            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">{current.title}</h1>
              <p className="text-sm text-slate-500 mt-1">{current.subtitle}</p>
            </div>

            <div className="space-y-2.5">
              {current.bullets.map((line, bulletIdx) => (
                <div key={`${index}-${bulletIdx}`} className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-slate-700 leading-snug">{line}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            onClick={handleComplete}
            className="py-3 rounded-2xl bg-slate-100 text-slate-700 font-bold text-sm hover:bg-slate-200 transition-colors"
          >
            Skip
          </button>
          {isLast ? (
            <button
              onClick={handleComplete}
              className="py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors"
            >
              Start Setup
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors inline-flex items-center justify-center gap-1"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
