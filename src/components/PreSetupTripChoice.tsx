import React, { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, LogIn, Plus, Ticket } from 'lucide-react';

interface PreSetupTripChoiceProps {
  onCreateTrip: () => void;
  onJoinTrip: (tripId: string) => Promise<boolean>;
  defaultJoinTripId?: string | null;
}

export const PreSetupTripChoice: React.FC<PreSetupTripChoiceProps> = ({
  onCreateTrip,
  onJoinTrip,
  defaultJoinTripId = null,
}) => {
  const [joinTripId, setJoinTripId] = useState(defaultJoinTripId || '');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = useCallback(async () => {
    const trimmed = joinTripId.trim();
    if (!trimmed) {
      setError('Enter a Trip ID to join.');
      return;
    }

    setJoining(true);
    setError('');
    try {
      const joined = await onJoinTrip(trimmed);
      if (!joined) {
        setError('Could not join that trip. Check the Trip ID and try again.');
      }
    } catch {
      setError('Could not join that trip. Please try again.');
    } finally {
      setJoining(false);
    }
  }, [joinTripId, onJoinTrip]);

  return (
    <div className="min-h-screen px-4 py-8 flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-6 border border-white/60"
      >
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200 mx-auto mb-5">
          <Ticket className="w-7 h-7 text-white" />
        </div>

        <h2 className="text-2xl font-black text-slate-900 text-center">What do you want to do?</h2>
        <p className="text-sm text-slate-500 text-center mt-2 mb-6 leading-relaxed">
          Create a new trip for yourself, or join a trip that someone already shared with you.
        </p>

        <button
          type="button"
          onClick={onCreateTrip}
          className="w-full mb-4 rounded-2xl bg-blue-600 text-white px-4 py-4 font-bold flex items-center justify-between shadow-lg shadow-blue-100 hover:bg-blue-700 transition-colors"
        >
          <span className="flex items-center gap-3">
            <Plus className="w-5 h-5" />
            Create a new trip
          </span>
          <ArrowRight className="w-5 h-5" />
        </button>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 mb-3 text-slate-700 font-bold">
            <LogIn className="w-4 h-4" />
            Join an existing trip
          </div>

          <input
            value={joinTripId}
            onChange={(event) => setJoinTripId(event.target.value)}
            placeholder="Enter 6-digit invite code"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={() => { void handleJoin(); }}
            disabled={joining}
            className="mt-3 w-full rounded-xl bg-slate-900 text-white px-4 py-3 font-bold disabled:opacity-60"
          >
            {joining ? 'Joining...' : 'Join trip'}
          </button>

          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            Ask your friend for the 6-digit invite code and enter it here.
          </p>
        </div>
      </motion.div>
    </div>
  );
};
