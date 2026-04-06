import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check, UserCircle2 } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { motion, AnimatePresence } from 'motion/react';

interface GroupMemberManagerProps {
  setup: TripSetup | null;
  onUpdate: (setup: TripSetup) => void;
}

const COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

export const GroupMemberManager: React.FC<GroupMemberManagerProps> = ({ setup, onUpdate }) => {
  const navigate = useNavigate();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newMember, setNewMember] = useState('');

  if (!setup) return null;

  const members = setup.participants || [];

  const commit = useCallback((participants: string[]) => {
    onUpdate({ ...setup, participants, peopleCount: participants.length });
  }, [setup, onUpdate]);

  const openEdit = useCallback((idx: number, name: string) => {
    setEditingIdx(idx);
    setEditName(name);
  }, []);

  const saveEdit = useCallback((idx: number) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const updated = [...members];
    updated[idx] = trimmed;
    commit(updated);
    setEditingIdx(null);
  }, [editName, members, commit]);

  const deleteMember = useCallback((idx: number) => {
    if (members.length <= 1) return;
    commit(members.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  }, [members, commit, editingIdx]);

  const addMember = useCallback(() => {
    const trimmed = newMember.trim();
    if (!trimmed || members.includes(trimmed)) return;
    commit([...members, trimmed]);
    setNewMember('');
  }, [newMember, members, commit]);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center gap-3 page-header">
        <button onClick={() => navigate('/settings')} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">{members.length} participant{members.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {members.map((member, idx) => {
            const isEditing = editingIdx === idx;
            const colorClass = COLORS[idx % COLORS.length];

            return (
              <motion.div
                key={`${idx}-${member}`}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -60, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"
              >
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base font-black flex-shrink-0 ${colorClass}`}>
                        {(editName[0] || member[0]).toUpperCase()}
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveEdit(idx)}
                        placeholder="Name"
                        autoFocus
                        className="flex-1 px-3 py-2 rounded-xl border border-blue-300 ring-2 ring-inset ring-blue-400 text-sm font-semibold text-slate-800 focus:outline-none bg-blue-50"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingIdx(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">
                        Cancel
                      </button>
                      <button onClick={() => saveEdit(idx)} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" /> Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => openEdit(idx, member)} className="w-full flex items-center gap-3 p-4 text-left">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base font-black flex-shrink-0 ${colorClass}`}>
                      {member[0].toUpperCase()}
                    </div>
                    <p className="font-bold text-slate-900 text-sm flex-1">{member}</p>
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); deleteMember(idx); }}
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Add member */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <UserCircle2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={newMember}
            onChange={e => setNewMember(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addMember()}
            placeholder="Add new member..."
            className="input-field pl-10 text-sm"
          />
        </div>
        <button
          onClick={addMember}
          disabled={!newMember.trim() || members.includes(newMember.trim())}
          className="w-12 h-12 bg-blue-600 disabled:bg-slate-200 text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
