import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { ArrowLeft, Check, Lock, Plus, RotateCcw, Trash2, UserCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { TripSetup, Expense, calculateSettlement } from '../utils/calculations.ts';
import { formatCurrency } from '../utils/cn';
import { MAX_PARTICIPANT_NAME_LENGTH } from '../utils/constants.ts';
import { validateText, sanitize } from '../utils/validation.ts';
import { firestore } from '../lib/firebase';
import { useMemberRegistry } from '../hooks/useMemberRegistry.ts';
import { buildDisplayNameMap } from '../utils/memberDisplay';

interface GroupMemberManagerProps {
  setup: TripSetup | null;
  expenses?: Expense[];
  onUpdate: (setup: TripSetup) => void | Promise<void>;
  isCollaborative: boolean;
  userUid: string | null;
  tripCreatorUid: string | null;
  identityMap: Record<string, string>;
  tripId?: string | null;
}

type PendingRemoval = {
  memberId: string;
  name: string;
  balance: number;
  pendingTransfers: number;
  pendingAmount: number;
};

const ACTIVE_BG = ['bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-violet-100 text-violet-700'];

export const GroupMemberManager: React.FC<GroupMemberManagerProps> = ({
  setup,
  expenses = [],
  onUpdate,
  isCollaborative,
  userUid,
  tripCreatorUid,
  identityMap,
  tripId = null,
}) => {
  const navigate = useNavigate();
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newMember, setNewMember] = useState('');
  const [editError, setEditError] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const {
    members,
    activeMembers,
    registry,
    addMember,
    renameMember,
    removeMember,
    restoreMember,
    canRename,
    canRemove,
  } = useMemberRegistry({
    setup,
    saveSetup: onUpdate,
    isCollaborative,
    userUid,
    tripCreatorUid,
    identityMap,
    tripId,
  });

  const displayNames = useMemo(() => buildDisplayNameMap(registry, true), [registry]);
  const claimedMemberIds = useMemo(() => new Set(Object.values(identityMap || {})), [identityMap]);
  const settlement = useMemo(() => calculateSettlement(setup, expenses), [setup, expenses]);

  const goBack = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleAddMember = useCallback(async () => {
    const trimmed = sanitize(newMember);
    const validation = validateText(trimmed, MAX_PARTICIPANT_NAME_LENGTH, 'Name');
    if (validation) {
      setEditError(validation);
      return;
    }

    try {
      await addMember(trimmed);
      setNewMember('');
      setEditError('');
    } catch (error) {
      setEditError((error as Error)?.message || 'Could not add member.');
    }
  }, [addMember, newMember]);

  const openEdit = useCallback((memberId: string) => {
    const current = registry[memberId];
    if (!current) return;
    setEditingMemberId(memberId);
    setEditName(current.name);
    setEditError('');
  }, [registry]);

  const saveEdit = useCallback(async () => {
    if (!editingMemberId) return;
    const trimmed = sanitize(editName);
    const validation = validateText(trimmed, MAX_PARTICIPANT_NAME_LENGTH, 'Name');
    if (validation) {
      setEditError(validation);
      return;
    }

    try {
      await renameMember(editingMemberId, trimmed);
      setEditingMemberId(null);
      setEditError('');
    } catch (error) {
      setEditError((error as Error)?.message || 'Could not rename member.');
    }
  }, [editName, editingMemberId, renameMember]);

  const requestRemove = useCallback((memberId: string) => {
    if (!setup) return;
    const member = registry[memberId];
    if (!member) return;

    const balance = settlement.balances[memberId] ?? 0;
    const pendingTransfers = settlement.transfers.filter((transfer) => transfer.from === memberId || transfer.to === memberId);
    const pendingAmount = pendingTransfers.reduce((sum, transfer) => sum + transfer.amount, 0);

    if (Math.abs(balance) > 0.01 || pendingTransfers.length > 0) {
      setPendingRemoval({
        memberId,
        name: member.name,
        balance,
        pendingTransfers: pendingTransfers.length,
        pendingAmount,
      });
      return;
    }

    void removeMember(memberId).catch((error) => setEditError((error as Error)?.message || 'Could not remove member.'));
  }, [registry, removeMember, settlement.balances, settlement.transfers, setup]);

  const confirmRemove = useCallback(async () => {
    if (!pendingRemoval) return;

    try {
      await removeMember(pendingRemoval.memberId);
      if (isCollaborative && tripId && firestore) {
        const settlementsRef = collection(firestore, 'trips', tripId, 'settlements');
        const snap = await getDocs(settlementsRef);
        const batch = writeBatch(firestore);
        let ops = 0;
        const removedInactive = false;

        for (const settlementDoc of snap.docs) {
          const payload = settlementDoc.data() as Record<string, unknown>;
          if (payload.from !== pendingRemoval.memberId && payload.to !== pendingRemoval.memberId) continue;

          batch.update(settlementDoc.ref, {
            fromMemberActive: removedInactive,
            toMemberActive: removedInactive,
            updatedAt: new Date().toISOString(),
          });
          ops += 1;

          if (ops >= 100) {
            await batch.commit();
            ops = 0;
          }
        }

        if (ops > 0) {
          await batch.commit();
        }
      }
      setPendingRemoval(null);
    } catch (error) {
      setEditError((error as Error)?.message || 'Could not remove member.');
    }
  }, [isCollaborative, pendingRemoval, registry, removeMember, tripId]);

  const restore = useCallback((memberId: string) => {
    void restoreMember(memberId).catch((error) => setEditError((error as Error)?.message || 'Could not restore member.'));
  }, [restoreMember]);

  if (!setup) return null;

  const activeList = activeMembers;
  const inactiveList = members.filter((member) => !member.isActive);

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-center gap-3 page-header">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-subtitle">{activeList.length} active · {inactiveList.length} inactive</p>
        </div>
      </div>

      {editError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3 text-sm font-medium">
          {editError}
        </div>
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {activeList.map((member, idx) => {
            const isEditing = editingMemberId === member.memberId;
            const colorClass = ACTIVE_BG[idx % ACTIVE_BG.length];
            const isClaimed = claimedMemberIds.has(member.memberId);

            return (
              <motion.div
                key={member.memberId}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"
              >
                {isEditing ? (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base font-black flex-shrink-0 ${colorClass}`}>
                        {(editName[0] || member.name[0] || '?').toUpperCase()}
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveEdit();
                        }}
                        placeholder="Name"
                        maxLength={MAX_PARTICIPANT_NAME_LENGTH}
                        autoFocus
                        className="flex-1 px-3 py-2 rounded-xl border border-blue-300 ring-2 ring-inset ring-blue-400 bg-blue-50 text-sm font-semibold text-slate-800 focus:outline-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingMemberId(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">Cancel</button>
                      <button onClick={() => void saveEdit()} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" /> Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canRename(member.memberId)) return;
                      openEdit(member.memberId);
                    }}
                    className="w-full flex items-center gap-3 p-4 text-left"
                  >
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base font-black flex-shrink-0 ${colorClass}`}>
                      {(displayNames[member.memberId] || member.name)[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 text-sm truncate">{displayNames[member.memberId] || member.name}</p>
                        {isClaimed && <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">Joined {format(new Date(member.joinedAt), 'dd MMM yyyy')}</p>
                    </div>
                    {member.memberId === editingMemberId ? null : canRemove(member.memberId) && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); requestRemove(member.memberId); }}
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

      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <UserCircle2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={newMember}
              onChange={(event) => setNewMember(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleAddMember()}
              placeholder="Add new member..."
              maxLength={MAX_PARTICIPANT_NAME_LENGTH}
              className="input-field pl-10 text-sm"
            />
          </div>
          <button
            onClick={() => void handleAddMember()}
            className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-3xl p-4 text-sm text-amber-800">
        {pendingRemoval ? (
          <div className="space-y-3">
            <p className="font-bold">Removal warning for {pendingRemoval.name}</p>
            <p>Outstanding balance: {formatCurrency(Math.abs(pendingRemoval.balance))}</p>
            <p>{pendingRemoval.pendingTransfers} pending transfer{pendingRemoval.pendingTransfers === 1 ? '' : 's'} · {formatCurrency(pendingRemoval.pendingAmount)}</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={() => setPendingRemoval(null)} className="py-2.5 rounded-2xl bg-white text-amber-800 font-bold border border-amber-200">Cancel</button>
              <button onClick={() => void confirmRemove()} className="py-2.5 rounded-2xl bg-amber-600 text-white font-bold">Remove</button>
            </div>
          </div>
        ) : (
          <p>Select a member to rename, remove, or restore inactive members below.</p>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowInactive((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div>
            <p className="font-bold text-slate-900">Inactive members</p>
            <p className="text-xs text-slate-400">Members who left the trip are preserved here.</p>
          </div>
          {showInactive ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        <AnimatePresence>
          {showInactive && inactiveList.map((member, idx) => (
            <motion.div
              key={member.memberId}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-3 px-4 py-3 border-t border-slate-50"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center font-black text-sm flex-shrink-0">
                {(displayNames[member.memberId] || member.name)[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-500 text-sm truncate">{displayNames[member.memberId] || member.name}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">left</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Left {member.leftAt ? format(new Date(member.leftAt), 'dd MMM yyyy') : 'unknown date'}</p>
              </div>
              <button
                type="button"
                onClick={() => restore(member.memberId)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
