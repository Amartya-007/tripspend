import { MemberRecord, MemberRegistry } from './calculations';

const toIsoTime = (value?: string) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const createMemberId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `member_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

export const normalizeMemberName = (value: string) => value.trim();

export const isValidMemberName = (value: string) => {
  const trimmed = normalizeMemberName(value);
  return trimmed.length >= 1 && trimmed.length <= 50;
};

export const createMemberRecord = (name: string, joinedAt = new Date().toISOString(), memberId = createMemberId()): MemberRecord => ({
  memberId,
  name: normalizeMemberName(name),
  isActive: true,
  joinedAt,
});

export const addMemberToRegistry = (
  registry: MemberRegistry,
  name: string,
  joinedAt = new Date().toISOString(),
  memberId = createMemberId()
) => {
  const member = createMemberRecord(name, joinedAt, memberId);
  return {
    member,
    registry: {
      ...registry,
      [member.memberId]: member,
    },
  };
};

export const renameMemberInRegistry = (
  registry: MemberRegistry,
  memberId: string,
  newName: string
) => {
  const current = registry[memberId];
  if (!current) return registry;
  return {
    ...registry,
    [memberId]: {
      ...current,
      name: normalizeMemberName(newName),
    },
  };
};

export const removeMemberFromRegistry = (
  registry: MemberRegistry,
  memberId: string,
  leftAt = new Date().toISOString()
) => {
  const current = registry[memberId];
  if (!current) return registry;
  return {
    ...registry,
    [memberId]: {
      ...current,
      isActive: false,
      leftAt,
    },
  };
};

export const restoreMemberInRegistry = (
  registry: MemberRegistry,
  memberId: string
) => {
  const current = registry[memberId];
  if (!current) return registry;
  return {
    ...registry,
    [memberId]: {
      ...current,
      isActive: true,
      leftAt: undefined,
    },
  };
};

export const getActiveMemberCount = (registry: MemberRegistry) => Object.values(registry).filter((member) => member.isActive).length;

export const getMyMemberId = (identityMap: Record<string, string>, userUid: string | null) => {
  if (!userUid) return null;
  return identityMap[userUid] ?? null;
};

export const isObserver = (identityMap: Record<string, string>, userUid: string | null) => {
  if (!userUid) return true;
  return !identityMap[userUid];
};

export const canActOnSettlement = (
  myMemberId: string | null,
  transfer: SettlementWriteTransfer,
  isCollaborative: boolean
) => {
  if (!isCollaborative) return true;
  if (!myMemberId) return false;
  return myMemberId === transfer.from || myMemberId === transfer.to;
};

export interface CollaborativePermissionContext {
  isCollaborative: boolean;
  userUid: string | null;
  tripCreatorUid: string | null;
  identityMap: Record<string, string>;
}

export const canRenameMember = (
  context: CollaborativePermissionContext,
  memberId: string
) => {
  if (!context.isCollaborative) return true;
  if (!context.userUid) return false;
  if (context.tripCreatorUid && context.userUid === context.tripCreatorUid) return true;
  return context.identityMap[context.userUid] === memberId;
};

export const canRemoveMember = (
  context: CollaborativePermissionContext & { activeMemberCount: number },
  memberId: string
) => {
  if (context.activeMemberCount <= 1) return false;
  if (!context.isCollaborative) return true;
  if (!context.userUid) return false;
  if (context.tripCreatorUid && context.userUid === context.tripCreatorUid) return true;
  return context.identityMap[context.userUid] === memberId;
};

export const claimMemberIdentity = (
  identityMap: Record<string, string>,
  userUid: string,
  memberId: string
) => {
  const currentMemberId = identityMap[userUid] ?? null;
  if (currentMemberId === memberId) return identityMap;
  if (currentMemberId && currentMemberId !== memberId) {
    throw new Error('This account is already claimed by another member.');
  }

  const alreadyClaimed = Object.entries(identityMap).some(([uid, claimedMemberId]) => uid !== userUid && claimedMemberId === memberId);
  if (alreadyClaimed) {
    throw new Error('This member slot is already claimed.');
  }

  return {
    ...identityMap,
    [userUid]: memberId,
  };
};

export interface SettlementWriteTransfer {
  from: string;
  to: string;
  amount: number;
}

export interface BuildSettlementWritePayloadInput {
  transfer: SettlementWriteTransfer;
  status: 'paid' | 'completed';
  fromUserId?: string | null;
  toUserId?: string | null;
  fromMemberActive: boolean;
  toMemberActive: boolean;
  creatorOverride: boolean;
  note?: string | null;
  proofImage?: string | null;
  proofName?: string | null;
  nowIso?: string;
}

export const buildSettlementWritePayload = ({
  transfer,
  status,
  fromUserId,
  toUserId,
  fromMemberActive,
  toMemberActive,
  creatorOverride,
  note,
  proofImage,
  proofName,
  nowIso = new Date().toISOString(),
}: BuildSettlementWritePayloadInput) => ({
  from: transfer.from,
  to: transfer.to,
  amount: transfer.amount,
  fromUserId: fromUserId ?? null,
  toUserId: toUserId ?? null,
  status,
  fromMemberActive,
  toMemberActive,
  creatorOverride,
  ...(creatorOverride ? { creatorOverrideAt: nowIso } : {}),
  note: note?.trim() || null,
  proofImage: proofImage || null,
  proofName: proofName || null,
  ...(status === 'paid' ? { paidAt: nowIso } : { completedAt: nowIso }),
  updatedAt: nowIso,
});

export const sortMembersByJoinOrder = (registry: MemberRegistry, includeInactive = false) => {
  return Object.values(registry)
    .filter((member) => includeInactive || member.isActive)
    .sort((left, right) => {
      const leftTime = toIsoTime(left.joinedAt);
      const rightTime = toIsoTime(right.joinedAt);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.memberId.localeCompare(right.memberId);
    });
};
