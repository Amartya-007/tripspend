import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, LogOut, Repeat2, Mail } from 'lucide-react';

interface AccountSwitchDialogProps {
  isOpen: boolean;
  userEmail: string | null;
  isLoading: boolean;
  onSwitchAccount: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

export const AccountSwitchDialog: React.FC<AccountSwitchDialogProps> = ({
  isOpen,
  userEmail,
  isLoading,
  onSwitchAccount,
  onSignOut,
  onClose,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end"
          onClick={onClose}
        >
          <motion.div
            initial={{ translateY: '100%' }}
            animate={{ translateY: 0 }}
            exit={{ translateY: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-full bg-white rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Account Settings</h2>
              <button
                onClick={onClose}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Content - Scrollable */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 pb-8">
              {/* Current Account Display */}
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-4 border border-blue-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Logged In</p>
                    <p className="text-sm font-semibold text-slate-900 truncate">{userEmail}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                {/* Switch Account Button */}
                <button
                  onClick={onSwitchAccount}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
                >
                  <Repeat2 className="w-4 h-4" />
                  {isLoading ? 'Switching...' : 'Switch Account'}
                </button>

                {/* Sign Out Button */}
                <button
                  onClick={onSignOut}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold rounded-xl transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>

                {/* Close Button */}
                <button
                  onClick={onClose}
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-white border-2 border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-semibold rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
