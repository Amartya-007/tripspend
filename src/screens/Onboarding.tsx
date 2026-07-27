import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IndianRupee, Users, TrendingUp, ArrowRight, Check } from 'lucide-react';

interface OnboardingScreenProps {
  onComplete: () => void;
}

const SLIDES = [
  {
    icon: <IndianRupee className="w-8 h-8 text-white" />,
    gradient: 'from-blue-600 to-blue-700',
    glow: 'shadow-blue-300',
    bg: 'bg-blue-50',
    accent: 'text-blue-600',
    title: 'Track Every Rupee',
    subtitle: 'Set up your trip budget in under 60 seconds',
    features: [
      { emoji: '💰', text: 'Set per-person budget once' },
      { emoji: '🏷️', text: 'Custom categories for your trip' },
      { emoji: '📵', text: 'Works fully offline, no account needed' },
    ],
  },
  {
    icon: <Users className="w-8 h-8 text-white" />,
    gradient: 'from-emerald-500 to-emerald-600',
    glow: 'shadow-emerald-300',
    bg: 'bg-emerald-50',
    accent: 'text-emerald-600',
    title: 'Split Without Drama',
    subtitle: 'Know exactly who paid and who owes',
    features: [
      { emoji: '🧾', text: 'Capture payer and split per expense' },
      { emoji: '⚖️', text: 'Auto-calculated net balances' },
      { emoji: '✅', text: 'Mark settlements with proof' },
    ],
  },
  {
    icon: <TrendingUp className="w-8 h-8 text-white" />,
    gradient: 'from-violet-600 to-purple-700',
    glow: 'shadow-violet-300',
    bg: 'bg-violet-50',
    accent: 'text-violet-600',
    title: 'Stay in Control',
    subtitle: 'Smart insights that keep you on budget',
    features: [
      { emoji: '🔥', text: 'Daily burn rate and safe spend limit' },
      { emoji: '📊', text: 'Category and member analytics' },
      { emoji: '📄', text: 'PDF closing report to share' },
    ],
  },
];

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const next = useCallback(() => {
    setDirection(1);
    setIndex(i => Math.min(SLIDES.length - 1, i + 1));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex flex-col items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm flex flex-col gap-6">

        {/* Icon hero */}
        <div className="flex justify-center">
          <motion.div
            key={index}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${slide.gradient} flex items-center justify-center shadow-2xl ${slide.glow}`}
          >
            {slide.icon}
          </motion.div>
        </div>

        {/* Text */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={{ opacity: 0, x: direction * 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -30 }}
            transition={{ duration: 0.22 }}
            className="text-center space-y-2"
          >
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">{slide.title}</h1>
            <p className="text-slate-500 text-sm">{slide.subtitle}</p>
          </motion.div>
        </AnimatePresence>

        {/* Feature list */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`features-${index}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className={`${slide.bg} rounded-3xl p-5 space-y-3`}
          >
            {slide.features.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xl w-7 flex-shrink-0">{f.emoji}</span>
                <p className="text-sm font-semibold text-slate-700">{f.text}</p>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Dot indicators */}
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <motion.div
              key={i}
              animate={{ width: i === index ? 24 : 8, opacity: i === index ? 1 : 0.3 }}
              transition={{ duration: 0.25 }}
              className={`h-2 rounded-full ${i === index ? `bg-gradient-to-r ${slide.gradient}` : 'bg-slate-300'}`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onComplete}
            className="py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-600 font-bold text-sm shadow-sm hover:bg-slate-50 transition-colors"
          >
            Skip
          </button>
          {isLast ? (
            <button
              onClick={onComplete}
              className={`py-3.5 rounded-2xl bg-gradient-to-r ${slide.gradient} text-white font-bold text-sm shadow-lg ${slide.glow} flex items-center justify-center gap-2 transition-all`}
            >
              <Check className="w-4 h-4" />
              Let's Go
            </button>
          ) : (
            <button
              onClick={next}
              className={`py-3.5 rounded-2xl bg-gradient-to-r ${slide.gradient} text-white font-bold text-sm shadow-lg ${slide.glow} flex items-center justify-center gap-2 transition-all`}
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
