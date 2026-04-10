import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check, UserCircle2 } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { motion, AnimatePresence } from 'motion/react';
import { MAX_PARTICIPANT_NAME_LENGTH } from '../utils/constants.ts';
import { validateText, isDuplicate, sanitize } from '../utils/validation.ts';

interface GroupMemberManagerProps {
  setup: TripSetup | null;
  onUpdate: (setup: TripSetup) => void | Promise<void>;
  claimedNames?: string[];
}

const COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-emerald-100 text-emerald-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

export const GroupMemberManager: React.FC<GroupMemberManagerProps> = ({ setup, onUpdate, claimedNames = [] }) => {
  const navigate = useNavigate();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newMember, setNewMember] = useState('');
  const [editError, setEditError] = useState('');

  if (!setup) return null;

  const members = useMemo(() => setup.participants || [], [setup.participants]);
  const claimedSet = useMemo(() => new Set(claimedNames.map(n => n.toLowerCase())), [claimedNames]);
  const trimmedNewMember = useMemo(() => newMember.trim(), [newMember]);

  const newMemberError = useMemo(() => {
    if (!trimmedNewMember) return '';
    const textErr = validateText(trimmedNewMember, MAX_PARTICIPANT_NAME_LENGTH, 'Name');
    if (textErr) return textErr;
    if (isDuplicate(trimmedNewMember, members)) return 'This name already exists.';
    return '';
  }, [trimmedNewMember, members]);

  const canAddMember = useMemo(() => Boolean(trimmedNewMember) && !newMemberError, [trimmedNewMember, newMemberError]);

  const commit = useCallback((participants: string[]) => {
    if (
      participants.length === members.length
      && participants.every((name, idx) => name === members[idx])
    ) {
      return;
    }
    onUpdate({ ...setup, participants, peopleCount: participants.length });
  }, [setup, onUpdate, members]);

  const goBack = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const cancelEdit = useCallback(() => {
    setEditingIdx(null);
  }, []);

  const handleEditNameChange = useCallback((value: string) => {
    setEditName(value);
  }, []);

  const handleNewMemberChange = useCallback((value: string) => {
    setNewMember(value);
  }, []);

  const openEdit = useCallback((idx: number, name: string) => {
    setEditingIdx(idx);
    setEditName(name);
    setEditError('');
  }, []);

  const saveEdit = useCallback((idx: number) => {
    if (claimedSet.has(members[idx]?.toLowerCase())) { setEditError('This name is claimed and cannot be changed.'); return; }
    const trimmed = sanitize(editName);
    const textErr = validateText(trimmed, MAX_PARTICIPANT_NAME_LENGTH, 'Name');
    if (textErr) { setEditError(textErr); return; }
    if (isDuplicate(trimmed, members, idx)) { setEditError('This name already exists.'); return; }
    if (members[idx] === trimmed) { setEditingIdx(null); setEditError(''); return; }
    const updated = [...members];
    updated[idx] = trimmed;
    commit(updated);
    setEditingIdx(null);
    setEditError('');
  }, [editName, members, commit, claimedSet]);

  const deleteMember = useCallback((idx: number) => {
    if (members.length <= 1) return;
    commit(members.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  }, [members, commit, editingIdx]);

  const addMember = useCallback(() => {
    if (!canAddMember) return;
    commit([...members, sanitize(trimmedNewMember)]);
    setNewMember('');
  }, [canAddMember, members, commit, trimmedNewMember]);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center gap-3 page-header">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors -ml-1">
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
                        onChange={e => { handleEditNameChange(e.target.value); setEditError(''); }}
                        onKeyDown={e => e.key === 'Enter' && saveEdit(idx)}
                        placeholder="Name"
                        maxLength={MAX_PARTICIPANT_NAME_LENGTH}
                        autoFocus
                        className={`flex-1 px-3 py-2 rounded-xl border text-sm font-semibold text-slate-800 focus:outline-none ${editError ? 'border-red-400 bg-red-50' : 'border-blue-300 ring-2 ring-inset ring-blue-400 bg-blue-50'}`}
                      />
                    </div>
                    {editError && <p className="text-xs text-red-500 font-semibold">⚠ {editError}</p>}
                    <div className="flex gap-2">
                      <button onClick={cancelEdit} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">
                        Cancel
                      </button>
                      <button onClick={() => saveEdit(idx)} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" /> Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => {
                    if (claimedSet.has(member.toLowerCase())) return; // locked
                    openEdit(idx, member);
                  }} className="w-full flex items-center gap-3 p-4 text-left">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base font-black flex-shrink-0 ${colorClass}`}>
                      {member[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-sm">{member}</p>
                      {claimedSet.has(member.toLowerCase()) && (
                        <p className="text-[10px] text-slate-400 mt-0.5">Identity claimed — cannot rename</p>
                      )}
                    </div>
                    {members.length > 1 && !claimedSet.has(member.toLowerCase()) && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); deleteMember(idx); }}
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {claimedSet.has(member.toLowerCase()) && (
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-emerald-500 flex-shrink-0">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Add member */}
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <UserCircle2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={newMember}
              onChange={e => handleNewMemberChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addMember()}
              placeholder="Add new member..."
              maxLength={MAX_PARTICIPANT_NAME_LENGTH}
              className={`input-field pl-10 text-sm ${newMemberError ? 'border-red-400 bg-red-50 focus:ring-red-400' : ''}`}
            />
          </div>
          <button
            onClick={addMember}
            disabled={!canAddMember}
            className="w-12 h-12 bg-blue-600 disabled:bg-slate-200 text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        {newMemberError && <p className="text-xs text-red-500 font-semibold px-1">⚠ {newMemberError}</p>}
      </div>
    </div>
  );
};
