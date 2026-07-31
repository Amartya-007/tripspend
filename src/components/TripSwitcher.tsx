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
  onCreateTrip: (name: string) => string | null | void | Promise<string | null | void>;
  onGenerateInviteCode?: () => Promise<string | null>;
  onJoinTrip?: (tripId: string) => Promise<boolean>;
  onDeleteTrip: (tripId: string) => void;
  onRenameTrip: (tripId: string, newName: string) => void;
  notify?: (payload: NotificationPayload) => void;
  /** Whether the current user created the active trip — gates invite revocation. */
  isTripCreator?: boolean;
  /** Whether the active trip's invite code currently accepts new joins. Defaults to true. */
  inviteActive?: boolean;
  onToggleInviteActive?: (active: boolean) => Promise<boolean>;
}

export function TripSwitcher({
  trips,
  activeTrip,
  onSelectTrip,
  onCreateTrip,
  onGenerateInviteCode,
  onJoinTrip,
  onDeleteTrip,
  onRenameTrip,
  notify,
  isTripCreator,
  inviteActive = true,
  onToggleInviteActive,
}: TripSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [joinTripId, setJoinTripId] = useState('');
  const [joining, setJoining] = useState(false);
  const [generatingInviteCode, setGeneratingInviteCode] = useState(false);
  const [generatedInviteCode, setGeneratedInviteCode] = useState<string | null>(null);
  const [togglingInvite, setTogglingInvite] = useState(false);
  const [tab, setTab] = useState<'trips' | 'invite' | 'join'>('trips');

  const activeTripName = useMemo(
    () => trips.find(t => t.id === activeTrip)?.name || 'No Trip',
    [activeTrip, trips]
  );
  const activeTripId = useMemo(() => activeTrip || null, [activeTrip]);
  // Any all-digit id is a cloud trip id (local ids always look like `trip_<ts>_<rand>`,
  // never purely numeric) — don't gate on the current 6-digit code length here, or a
  // trip migrated before the 6-digit format was restored would wrongly show as unavailable.
  const effectiveInviteCode = useMemo(() => {
    if (generatedInviteCode && /^\d+$/.test(generatedInviteCode)) return generatedInviteCode;
    if (activeTripId && /^\d+$/.test(activeTripId)) return activeTripId;
    return null;
  }, [activeTripId, generatedInviteCode]);
  const canShareInviteCode = Boolean(effectiveInviteCode);

  const inviteMessage = useMemo(() => {
    if (!effectiveInviteCode) return '';
    return `Join my trip "${activeTripName}" on TripSpend! 🧳

Invite Code:
${effectiveInviteCode}

Open TripSpend app → Settings → My Trips → Join and enter this 6-digit code.`;
  }, [activeTripName, effectiveInviteCode]);

  const newTripTrimmed = useMemo(() => newTripName.trim(), [newTripName]);

  const push = useCallback((payload: NotificationPayload) => {
    if (notify) notify(payload);
  }, [notify]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setEditingId(null);
    setEditingName('');
    setGeneratedInviteCode(null);
    setTab('trips');
  }, []);

  const handleRenameSave = useCallback((tripId: string) => {
    const name = sanitize(editingName);
    if (name) onRenameTrip(tripId, name);
    setEditingId(null);
    setEditingName('');
  }, [editingName, onRenameTrip]);

  const handleCreateTrip = useCallback(async () => {
    if (creatingTrip) return;
    const name = sanitize(newTripTrimmed);
    if (!name) return;
    setCreatingTrip(true);
    try {
      const created = await onCreateTrip(name);
      if (created === null) {
        push({ title: 'Create failed', message: 'Could not create trip. Please try again.', variant: 'error' });
        return;
      }
      setNewTripName('');
      closeMenu();
    } catch (error) {
      console.error('[TripSwitcher] Trip creation threw an error.', error);
      push({ title: 'Create failed', message: 'Could not create trip. Please try again.', variant: 'error' });
    } finally {
      setCreatingTrip(false);
    }
  }, [closeMenu, creatingTrip, newTripTrimmed, onCreateTrip, push]);

  const handleGenerateInviteCode = useCallback(async () => {
    if (generatingInviteCode) return;
    setGeneratingInviteCode(true);
    try {
      const createdId = onGenerateInviteCode ? await onGenerateInviteCode() : null;
      if (createdId && /^\d+$/.test(createdId)) {
        setGeneratedInviteCode(createdId);
        return;
      }
      console.error('[TripSwitcher] Invite code generation returned no usable id.', { createdId });
      push({ title: 'Invite unavailable', message: 'Could not generate a cloud invite code. Please try again.', variant: 'error' });
    } catch (error) {
      console.error('[TripSwitcher] Invite code generation threw an error.', error);
      push({ title: 'Invite unavailable', message: 'Could not generate a cloud invite code. Please try again.', variant: 'error' });
    } finally {
      setGeneratingInviteCode(false);
    }
  }, [generatingInviteCode, onGenerateInviteCode, onSelectTrip, push]);

  const handleToggleInviteActive = useCallback(async () => {
    if (!onToggleInviteActive || togglingInvite) return;
    const nextActive = !inviteActive;
    setTogglingInvite(true);
    try {
      const ok = await onToggleInviteActive(nextActive);
      if (ok) {
        push({
          title: nextActive ? 'Invite reactivated' : 'Invite revoked',
          message: nextActive ? 'New people can join with this code again.' : 'No one can join with this code until you reactivate it.',
          variant: 'success',
        });
      } else {
        push({ title: 'Could not update invite', message: 'Please try again.', variant: 'error' });
      }
    } finally {
      setTogglingInvite(false);
    }
  }, [inviteActive, onToggleInviteActive, push, togglingInvite]);

  const handleJoinTrip = useCallback(async () => {
    if (!onJoinTrip || joining) return;
    const id = joinTripId.trim();
    if (!id) return;
    if (!/^\d{6}$/.test(id)) {
      push({ title: 'Invalid code', message: 'Enter a 6-digit invite code.', variant: 'error' });
      return;
    }
    setJoining(true);
    try {
      const joined = await onJoinTrip(id);
      if (joined) {
        setJoinTripId('');
        closeMenu();
        push({ title: 'Joined trip', message: 'You\'ve joined the shared trip.', variant: 'success' });
      } else {
        push({ title: 'Trip not found', message: 'Check the 6-digit invite code and try again.', variant: 'error' });
      }
    } finally {
      setJoining(false);
    }
  }, [closeMenu, joinTripId, joining, onJoinTrip, push]);

  const handleCopyId = useCallback(async () => {
    if (!effectiveInviteCode) {
      push({ title: 'Invite unavailable', message: 'This trip does not have a 6-digit invite code yet.', variant: 'warning' });
      return;
    }
    try {
      await navigator.clipboard.writeText(effectiveInviteCode);
      push({ title: 'Invite code copied', message: 'Ready to share with your friends.', variant: 'success', durationMs: 2500 });
    } catch {
      window.prompt('Copy Invite Code', effectiveInviteCode);
    }
  }, [effectiveInviteCode, push]);

  const handleShare = useCallback(async () => {
    if (!inviteMessage || !canShareInviteCode) {
      push({ title: 'Invite unavailable', message: 'This trip does not have a 6-digit invite code yet.', variant: 'warning' });
      return;
    }
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
  }, [activeTripName, canShareInviteCode, inviteMessage, push]);

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
                            onClick={() => { setGeneratedInviteCode(null); onSelectTrip(trip.id); closeMenu(); }}
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
                      onKeyDown={(e) => e.key === 'Enter' && void handleCreateTrip()}
                      placeholder="New trip name..."
                      maxLength={MAX_TRIP_NAME_LENGTH}
                      className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button
                      onClick={() => { void handleCreateTrip(); }}
                      disabled={!newTripTrimmed || creatingTrip}
                      className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold disabled:opacity-40 flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      {creatingTrip ? '...' : null}
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
                    <p className="text-xs text-slate-500 mt-1">
                      {canShareInviteCode
                        ? 'Friends can join using your 6-digit invite code.'
                        : 'This trip is local-only. Switch to a shared 6-digit trip code to invite others.'}
                    </p>
                  </div>

                  {!canShareInviteCode && (
                    <button
                      onClick={() => { void handleGenerateInviteCode(); }}
                      disabled={generatingInviteCode}
                      className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-blue-700 transition-colors"
                    >
                      {generatingInviteCode ? 'Generating code...' : 'Generate Invite Code'}
                    </button>
                  )}

                  {/* Trip ID display - Clickable to copy */}
                  <button
                    onClick={() => { void handleCopyId(); }}
                    className="w-full bg-slate-50 rounded-xl p-3 border border-slate-200 text-left active:bg-blue-50 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Trip Code</p>
                      <Copy className="w-3 h-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                    <p className="text-xs font-mono text-slate-700 break-all leading-relaxed">
                      {canShareInviteCode ? effectiveInviteCode : 'Not available for this trip'}
                    </p>
                  </button>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { void handleCopyId(); }}
                      disabled={!canShareInviteCode}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy Invite Code
                    </button>
                    <button
                      onClick={() => { void handleShare(); }}
                      disabled={!canShareInviteCode}
                      className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share Invite
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                    {canShareInviteCode
                      ? 'Share only this code. Friends paste it in Settings → My Trips → Join tab.'
                      : 'Tap Generate Invite Code to create a cloud trip code, then share it.'}
                  </p>

                  {isTripCreator && canShareInviteCode && onToggleInviteActive && (
                    <button
                      onClick={() => { void handleToggleInviteActive(); }}
                      disabled={togglingInvite}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold disabled:opacity-50 transition-colors ${
                        inviteActive
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                      }`}
                    >
                      {togglingInvite
                        ? 'Updating...'
                        : inviteActive
                          ? 'Revoke invite code'
                          : 'Reactivate invite code'}
                    </button>
                  )}
                  {isTripCreator && canShareInviteCode && !inviteActive && (
                    <p className="text-[10px] text-red-500 text-center leading-relaxed">
                      This invite code is currently revoked — no one can join with it.
                    </p>
                  )}
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
                    <p className="text-xs text-slate-500 mt-1">Enter the 6-digit invite code you received from a friend.</p>
                  </div>
                  <input
                    type="text"
                    value={joinTripId}
                    onChange={(e) => setJoinTripId(e.target.value.replace(/\D/g, '').slice(0, MAX_JOIN_TRIP_ID_LENGTH))}
                    onKeyDown={(e) => e.key === 'Enter' && void handleJoinTrip()}
                    placeholder="e.g. 482971"
                    maxLength={MAX_JOIN_TRIP_ID_LENGTH}
                    className="w-full text-sm px-3 py-2.5 border border-slate-200 rounded-xl font-mono tracking-[0.15em] focus:outline-none focus:ring-2 focus:ring-emerald-400"
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
