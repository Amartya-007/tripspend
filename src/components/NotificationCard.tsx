import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export type NotificationVariant = 'success' | 'error' | 'info' | 'warning';

export interface NotificationPayload {
  title: string;
  message?: string;
  body?: string;
  data?: Record<string, unknown>;
  variant?: NotificationVariant;
  durationMs?: number;
}

interface NotificationCardProps {
  notification: (NotificationPayload & { id: number }) | null;
  onClose: () => void;
}

const variantStyle: Record<NotificationVariant, { ring: string; dot: string; title: string }> = {
  success: {
    ring: 'ring-emerald-200',
    dot: 'bg-emerald-500',
    title: 'text-emerald-800',
  },
  error: {
    ring: 'ring-rose-200',
    dot: 'bg-rose-500',
    title: 'text-rose-800',
  },
  info: {
    ring: 'ring-blue-200',
    dot: 'bg-blue-500',
    title: 'text-blue-800',
  },
  warning: {
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
    title: 'text-amber-800',
  },
};

export function NotificationCard({ notification, onClose }: NotificationCardProps) {
  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(onClose, notification.durationMs ?? 2600);
    return () => window.clearTimeout(timeout);
  }, [notification, onClose]);

  return (
    <AnimatePresence>
      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.97 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[140] w-[calc(100%-2rem)] max-w-md"
        >
          <div className={`rounded-2xl bg-white shadow-2xl ring-2 ${variantStyle[notification.variant ?? 'info'].ring} p-4`}>
            <div className="flex items-start gap-3">
              <span className={`mt-1 w-2.5 h-2.5 rounded-full ${variantStyle[notification.variant ?? 'info'].dot}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${variantStyle[notification.variant ?? 'info'].title}`}>{notification.title}</p>
                {(notification.body || notification.message) && (
                  <p className="mt-1 text-xs text-slate-600 leading-5">{notification.body || notification.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
