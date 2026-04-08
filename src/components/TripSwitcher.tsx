import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trip } from '../utils/calculations';

interface TripSwitcherProps {
  trips: Trip[];
  activeTrip: string | null;
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (name: string) => void;
  onDeleteTrip: (tripId: string) => void;
  onRenameTrip: (tripId: string, newName: string) => void;
}

export function TripSwitcher({
  trips,
  activeTrip,
  onSelectTrip,
  onCreateTrip,
  onDeleteTrip,
  onRenameTrip,
}: TripSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newTripName, setNewTripName] = useState('');

  const activeTripName = useMemo(
    () => trips.find(t => t.id === activeTrip)?.name || 'No Trip',
    [activeTrip, trips]
  );
  const newTripTrimmed = useMemo(() => newTripName.trim(), [newTripName]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setEditingId(null);
    setEditingName('');
  }, []);

  const toggleMenu = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleRenameStart = useCallback((trip: Trip) => {
    setEditingId(trip.id);
    setEditingName(trip.name);
  }, []);

  const handleRenameSave = useCallback((tripId: string) => {
    const name = editingName.trim();
    if (name) {
      onRenameTrip(tripId, name);
    }
    setEditingId(null);
    setEditingName('');
  }, [editingName, onRenameTrip]);

  const handleCreateTrip = useCallback(() => {
    const name = newTripTrimmed;
    if (!name) return;
    onCreateTrip(name);
    setNewTripName('');
    closeMenu();
  }, [closeMenu, newTripTrimmed, onCreateTrip]);

  const handleSelectTrip = useCallback((tripId: string) => {
    onSelectTrip(tripId);
    closeMenu();
  }, [closeMenu, onSelectTrip]);

  const handleDeleteTrip = useCallback((tripId: string, tripName: string) => {
    const ok = window.confirm(`Delete trip "${tripName}"? This cannot be undone.`);
    if (!ok) return;
    onDeleteTrip(tripId);
    closeMenu();
  }, [closeMenu, onDeleteTrip]);

  const handleEditingNameChange = useCallback((value: string) => {
    setEditingName(value);
  }, []);

  const handleNewTripNameChange = useCallback((value: string) => {
    setNewTripName(value);
  }, []);

  const handleNewTripKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleCreateTrip();
  }, [handleCreateTrip]);

  const handleRenameKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>, tripId: string) => {
    if (event.key === 'Enter') handleRenameSave(tripId);
    if (event.key === 'Escape') {
      setEditingId(null);
      setEditingName('');
    }
  }, [handleRenameSave]);

  return (
    <div className="relative w-full">
      {/* Current Trip Button */}
      <button
        onClick={toggleMenu}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-300 transition-colors"
      >
        <div className="min-w-0 text-left">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Active Trip</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{activeTripName}</p>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <span className="text-xs font-semibold bg-slate-100 rounded-full px-2 py-1">{trips.length}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isOpen ? 'M19 14l-7 7m0 0l-7-7m7 7V3' : 'M5 10l7-7m0 0l7 7m-7-7v14'} />
          </svg>
        </div>
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-2 w-full bg-white border-2 border-slate-200 rounded-xl shadow-lg overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Your Trips</p>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {/* Trip List */}
              {trips.map((trip) => (
                <div
                  key={trip.id}
                  className={`px-3 py-2.5 flex items-center gap-2 ${
                    activeTrip === trip.id ? 'bg-blue-50 border-l-4 border-blue-500' : 'hover:bg-slate-50'
                  }`}
                >
                  {editingId === trip.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      onChange={(e) => handleEditingNameChange(e.target.value)}
                      onBlur={() => handleRenameSave(trip.id)}
                      onKeyDown={(e) => handleRenameKeyDown(e, trip.id)}
                      className="flex-1 text-sm px-2 py-1 border border-slate-300 rounded"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => handleSelectTrip(trip.id)}
                        className="flex-1 text-left text-sm font-medium text-slate-900 hover:text-blue-600 truncate"
                      >
                        {trip.name}
                      </button>
                      {activeTrip === trip.id && (
                        <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </>
                  )}

                  {/* Edit & Delete */}
                  {editingId !== trip.id && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleRenameStart(trip)}
                        className="p-1 text-slate-600 hover:text-slate-900"
                        title="Rename"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    {trips.length > 1 && (
                      <button
                        onClick={() => handleDeleteTrip(trip.id, trip.name)}
                        className="p-1 text-red-600 hover:text-red-900"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 px-3 py-2.5 bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTripName}
                  onChange={(e) => handleNewTripNameChange(e.target.value)}
                  onKeyDown={handleNewTripKeyDown}
                  placeholder="Name your next trip"
                  className="flex-1 min-w-0 text-sm px-3 py-2 border border-slate-300 rounded-lg"
                />
                <button
                  onClick={handleCreateTrip}
                  disabled={!newTripTrimmed}
                  className="shrink-0 px-3 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
