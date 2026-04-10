import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronDown, Copy, Edit2, Link, Plus, Share2, Trash2, UserPlus } from 'lucide-react';
import { Trip } from '../utils/calculations';
import { MAX_TRIP_NAME_LENGTH, MAX_JOIN_TRIP_ID_LENGTH } from '../utils/constants.ts';
import { sanitize } from '../utils/validation.ts';
import { NotificationPayload } from './NotificationCard.tsx';

interface TripSwitcherProps {
  trips: Trip[];
  activeTrip: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => void;
  onJoinTrip?: (tripId: string) => Promise<boolean>;
  onDeleteTrip: (tripId: string) => void;
  onRenameTrip: (tripId: string, newName: string) => void;
  notify?: (payload: NotificationPayload) => void;
}

export function TripSwitcher({
  trips,
  activeTrip,
  onSelectTrip,
  onCreateTrip,
  onJoinTrip,
  onDeleteTrip,
  onRenameTrip,
  notify,
}: TripSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [joinTripId, setJoinTripId] = useState('');
  const [joining, setJoining] = useState(false);
  const [tab, setTab] = useState<'trips' | 'invite' | 'join'>('trips');

  const activeTripName = useMemo(
    () => trips.find(t => t.id === activeTrip)?.name || 'No Trip',
    [activeTrip, trips]
  );
  const activeTripId = useMemo(() => activeTrip || null, [activeTrip]);

  const inviteUrl = useMemo(() => {
    if (!activeTripId) return '';
    return `tripspend:///?joinTripId=${encodeURIComponent(activeTripId)}`;
  }, [activeTripId]);

  const inviteMessage = useMemo(() => {
    if (!activeTripId) return '';
    return `Hey! Join my trip "${activeTripName}" on TripSpend 🧳\n\nTap this link to join directly:\ntripspend:///?joinTripId=${encodeURIComponent(activeTripId)}\n\nOr open TripSpend → Settings → My Trips → Join tab and paste:\n${activeTripId}`;
  }, [activeTripId, activeTripName]);

  const newTripTrimmed = useMemo(() => newTripName.trim(), [newTripName]);

  const push = useCallback((payload: NotificationPayload) => {
    if (notify) notify(payload);
  }, [notify]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setEditingId(null);
    setEditingName('');
    setTab('trips');
  }, []);

  const handleRenameSave = useCallback((tripId: string) => {
    const name = sanitize(editingName);
    if (name) onRenameTrip(tripId, name);
    setEditingId(null);
    setEditingName('');
  }, [editingName, onRenameTrip]);

  const handleCreateTrip = useCallback(() => {
    const name = sanitize(newTripTrimmed);
    if (!name) return;
    onCreateTrip(name);
    setNewTripName('');
    closeMenu();
  }, [closeMenu, newTripTrimmed, onCreateTrip]);

  const handleJoinTrip = useCallback(async () => {
    if (!onJoinTrip || joining) return;
    const id = joinTripId.trim();
    if (!id) return;
    setJoining(true);
    try {
      const joined = await onJoinTrip(id);
      if (joined) {
        setJoinTripId('');
        closeMenu();
        push({ title: 'Joined trip', message: 'You\'ve joined the shared trip.', variant: 'success' });
      } else {
        push({ title: 'Trip not found', message: 'Check the Trip ID and try again.', variant: 'error' });
      }
    } finally {
      setJoining(false);
    }
  }, [closeMenu, joinTripId, joining, onJoinTrip, push]);

  const handleCopyId = useCallback(async () => {
    if (!activeTripId) return;
    try {
      await navigator.clipboard.writeText(activeTripId);
      push({ title: 'Trip ID copied', message: 'Share it with your friends to invite them.', variant: 'success', durationMs: 2500 });
    } catch {
      window.prompt('Copy Trip ID', activeTripId);
    }
  }, [activeTripId, push]);

  const handleShare = useCallback(async () => {
    if (!inviteMessage) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${activeTripName} on TripSpend`, text: inviteMessage });
        return;
      } catch { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(inviteMessage);
      push({ title: 'Invite copied', message: 'Send this message to your friends.', variant: 'success', durationMs: 2500 });
    } catch {
      window.prompt('Share this invite', inviteMessage);
    }
  }, [activeTripName, inviteMessage, push]);

  const handleDeleteTrip = useCallback((tripId: string, tripName: string) => {
    if (!window.confirm(`Delete "${tripName}"? This cannot be undone.`)) return;
    onDeleteTrip(tripId);
    closeMenu();
  }, [closeMenu, onDeleteTrip]);

  return (
    <div className="relative w-full">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(p => !p)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
      >
        <div className="min-w-0 text-left">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Active Trip</p>
          <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{activeTripName}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {trips.length > 1 && (
            <span className="text-[11px] font-bold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{trips.length}</span>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-10"
              onClick={closeMenu}
            />

            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full mt-2 left-0 right-0 z-20 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
            >
              {/* Tab bar */}
              <div className="flex border-b border-slate-100">
                {(['trips', 'invite', 'join'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2.5 text-xs font-bold transition-colors ${
                      tab === t
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {t === 'trips' ? 'Trips' : t === 'invite' ? 'Invite' : 'Join'}
                  </button>
                ))}
              </div>

              {/* Tab: Trips */}
              {tab === 'trips' && (
                <div>
                  <div className="max-h-52 overflow-y-auto">
                    {trips.map((trip) => (
                      <div key={trip.id} className={`flex items-center gap-2 px-3 py-2.5 ${activeTrip === trip.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                        {editingId === trip.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => handleRenameSave(trip.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameSave(trip.id);
                              if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                            }}
                            maxLength={MAX_TRIP_NAME_LENGTH}
                            className="flex-1 text-sm px-2 py-1 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        ) : (
                          <button
                            onClick={() => { onSelectTrip(trip.id); closeMenu(); }}
                            className="flex-1 text-left text-sm font-semibold text-slate-900 truncate"
                          >
                            {trip.name}
                          </button>
                        )}
                        {activeTrip === trip.id && editingId !== trip.id && (
                          <Check className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        )}
                        {editingId !== trip.id && (
                          <div className="flex gap-0.5 flex-shrink-0">
                            <button onClick={() => { setEditingId(trip.id); setEditingName(trip.name); }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {trips.length > 1 && (
                              <button onClick={() => handleDeleteTrip(trip.id, trip.name)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* New trip */}
                  <div className="px-3 py-2.5 border-t border-slate-100 flex gap-2">
                    <input
                      type="text"
                      value={newTripName}
                      onChange={(e) => setNewTripName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateTrip()}
                      placeholder="New trip name..."
                      maxLength={MAX_TRIP_NAME_LENGTH}
                      className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button
                      onClick={handleCreateTrip}
                      disabled={!newTripTrimmed}
                      className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-40 flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Tab: Invite */}
              {tab === 'invite' && (
                <div className="p-4 space-y-3">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <UserPlus className="w-6 h-6 text-blue-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-900">Invite to "{activeTripName}"</p>
                    <p className="text-xs text-slate-500 mt-1">Share your Trip ID with friends so they can join.</p>
                  </div>

                  {/* Trip ID display */}
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Trip ID</p>
                    <p className="text-xs font-mono text-slate-700 break-all leading-relaxed">{activeTripId}</p>
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { void handleCopyId(); }}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy ID
                    </button>
                    <button
                      onClick={() => { void handleShare(); }}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share invite
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">
                    Friends need to sign in with Google, then go to Settings → My Trips → Join tab and paste the Trip ID.
                  </p>
                </div>
              )}

              {/* Tab: Join */}
              {tab === 'join' && (
                <div className="p-4 space-y-3">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Link className="w-6 h-6 text-emerald-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-900">Join a shared trip</p>
                    <p className="text-xs text-slate-500 mt-1">Paste the Trip ID you received from a friend.</p>
                  </div>
                  <input
                    type="text"
                    value={joinTripId}
                    onChange={(e) => setJoinTripId(e.target.value.trim().slice(0, MAX_JOIN_TRIP_ID_LENGTH))}
                    onKeyDown={(e) => e.key === 'Enter' && void handleJoinTrip()}
                    placeholder="Paste Trip ID here..."
                    maxLength={MAX_JOIN_TRIP_ID_LENGTH}
                    className="w-full text-sm px-3 py-2.5 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    autoFocus
                  />
                  <button
                    onClick={() => { void handleJoinTrip(); }}
                    disabled={!joinTripId.trim() || joining}
                    className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-700 transition-colors"
                  >
                    {joining ? 'Joining...' : 'Join trip'}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
