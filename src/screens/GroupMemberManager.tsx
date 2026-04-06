import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, Check } from 'lucide-react';
import { TripSetup } from '../utils/calculations.ts';
import { motion, AnimatePresence } from 'motion/react';

interface GroupMemberManagerProps {
  setup: TripSetup | null;
  onUpdate: (setup: TripSetup) => void;
}

export const GroupMemberManager: React.FC<GroupMemberManagerProps> = ({ setup, onUpdate }) => {
  const navigate = useNavigate();
  const [members, setMembers] = useState<string[]>(setup?.participants || []);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newMember, setNewMember] = useState('');

  if (!setup) {
    return (
      <div className="page-shell">
        <div className="text-slate-600">No trip setup found</div>
      </div>
    );
  }

  const handleAddMember = () => {
    if (newMember.trim() && !members.includes(newMember.trim())) {
      setMembers([...members, newMember.trim()]);
      setNewMember('');
    }
  };

  const handleEditMember = (idx: number) => {
    setEditingIdx(idx);
    setEditValue(members[idx]);
  };

  const handleSaveEdit = (idx: number) => {
    if (editValue.trim()) {
      const updated = [...members];
      updated[idx] = editValue.trim();
      setMembers(updated);
      setEditingIdx(null);
    }
  };

  const handleDeleteMember = (idx: number) => {
    if (members.length > 1) {
      setMembers(members.filter((_, i) => i !== idx));
    }
  };

  const handleSave = () => {
    onUpdate({
      ...setup,
      participants: members.filter(m => m.trim()),
      peopleCount: members.length,
    });
    navigate('/settings');
  };

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center justify-between page-header">
        <button
          onClick={() => navigate('/settings')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h1 className="page-title text-2xl">Manage Members</h1>
        <div className="w-8" />
      </div>

      <div className="space-y-3">
        <AnimatePresence>
          {members.map((member, idx) => (
            <motion.div
              key={`${idx}-${member}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between gap-3"
            >
              {editingIdx === idx ? (
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 input-field text-sm"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveEdit(idx)}
                    className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm font-semibold text-slate-700 flex-1">{member}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEditMember(idx)}
                      className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {members.length > 1 && (
                      <button
                        onClick={() => handleDeleteMember(idx)}
                        className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newMember}
          onChange={(e) => setNewMember(e.target.value)}
          placeholder="Add new member..."
          onKeyPress={(e) => e.key === 'Enter' && handleAddMember()}
          className="input-field flex-1 text-sm"
        />
        <button
          onClick={handleAddMember}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleSave}
        className="btn-primary w-full"
      >
        Save Changes
      </motion.button>
    </div>
  );
};
