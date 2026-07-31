import { useCallback, useMemo } from 'react';
import { MemberRecord, MemberRegistry, TripSetup } from '../utils/calculations';
import { getDisplayName } from '../utils/memberDisplay';
import { enqueueOp } from '../utils/offlineQueue';
import {
  addMemberToRegistry,
  canRemoveMember,
  canRenameMember,
  getActiveMemberCount,
  isValidMemberName,
  removeMemberFromRegistry,
  restoreMemberInRegistry,
  renameMemberInRegistry,
  createMemberId,
} from '../utils/memberManagementCore';

interface UseMemberRegistryInput {
  setup: TripSetup | null;
  saveSetup: (setup: TripSetup) => void | boolean | Promise<void | boolean>;
  isCollaborative: boolean;
  userUid: string | null;
  tripCreatorUid: string | null;
  identityMap: Record<string, string>;
  tripId?: string | null;
  removeMemberUid?: (tripId: string, memberUid: string) => Promise<boolean>;
}

interface UseMemberRegistryOutput {
  members: MemberRecord[];
  activeMembers: MemberRecord[];
  registry: MemberRegistry;
  addMember: (name: string) => Promise<MemberRecord | null>;
  renameMember: (memberId: string, newName: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  restoreMember: (memberId: string) => Promise<void>;
  getDisplayName: (memberId: string, includeInactive?: boolean) => string;
  getMemberById: (memberId: string) => MemberRecord | undefined;
  canRename: (memberId: string) => boolean;
  canRemove: (memberId: string) => boolean;
  isMigrated: boolean;
}

const trimName = (value: string) => value.trim();

export function useMemberRegistry({
  setup,
  saveSetup,
  isCollaborative,
  userUid,
  tripCreatorUid,
  identityMap,
  tripId = null,
  removeMemberUid,
}: UseMemberRegistryInput): UseMemberRegistryOutput {
  const registry = useMemo(() => setup?.memberRegistry ?? {}, [setup?.memberRegistry]);
  const members = useMemo(() => Object.values(registry).sort((left, right) => left.joinedAt.localeCompare(right.joinedAt)), [registry]);
  const activeMembers = useMemo(() => members.filter((member) => member.isActive), [members]);
  const isMigrated = Boolean(setup?.memberRegistry);

  const persist = useCallback(async (nextSetup: TripSetup, op?: Parameters<typeof enqueueOp>[1]) => {
    if (tripId && op) {
      enqueueOp(tripId, op);
    }
    await saveSetup(nextSetup);
  }, [saveSetup, tripId]);

  const canRename = useCallback((memberId: string) => {
    return canRenameMember({ isCollaborative, userUid, tripCreatorUid, identityMap }, memberId);
  }, [identityMap, isCollaborative, tripCreatorUid, userUid]);

  const canRemove = useCallback((memberId: string) => {
    return canRemoveMember({ isCollaborative, userUid, tripCreatorUid, identityMap, activeMemberCount: getActiveMemberCount(registry) }, memberId);
  }, [identityMap, isCollaborative, registry, tripCreatorUid, userUid]);

  const getMemberById = useCallback((memberId: string) => registry[memberId], [registry]);

  const applyRegistryChange = useCallback(async (nextRegistry: MemberRegistry, op?: Parameters<typeof enqueueOp>[1]) => {
    if (!setup) return;
    const nextSetup: TripSetup = {
      ...setup,
      memberRegistry: nextRegistry,
      participants: undefined,
      peopleCount: Object.values(nextRegistry).filter((member) => member.isActive).length,
    };
    await persist(nextSetup, op);
  }, [persist, setup]);

  const addMember = useCallback(async (name: string) => {
    if (!setup) return null;
    const trimmed = trimName(name);
    if (!isValidMemberName(trimmed)) {
      throw new Error('Name must be between 1 and 50 characters.');
    }

    const joinedAt = new Date().toISOString();
    const memberId = createMemberId();
    const { member, registry: nextRegistry } = addMemberToRegistry(registry, trimmed, joinedAt, memberId);
    await applyRegistryChange(nextRegistry, {
      type: 'add',
      memberId,
      name: trimmed,
      timestamp: member.joinedAt,
    });

    return member;
  }, [applyRegistryChange, registry, setup]);

  const renameMember = useCallback(async (memberId: string, newName: string) => {
    if (!setup) return;
    if (!canRename(memberId)) {
      throw new Error('You do not have permission to rename this member.');
    }
    const current = registry[memberId];
    if (!current) return;

    const trimmed = trimName(newName);
    if (!isValidMemberName(trimmed)) {
      throw new Error('Name must be between 1 and 50 characters.');
    }

    if (current.name === trimmed) return;

    await applyRegistryChange(renameMemberInRegistry(registry, memberId, trimmed), {
      type: 'rename',
      memberId,
      newName: trimmed,
      timestamp: new Date().toISOString(),
    });
  }, [applyRegistryChange, canRename, registry, setup]);

  const removeMember = useCallback(async (memberId: string) => {
    if (!setup) return;
    if (!canRemove(memberId)) {
      throw new Error('You do not have permission to remove this member.');
    }
    const current = registry[memberId];
    if (!current || !current.isActive) return;

    const leftAt = new Date().toISOString();
    await applyRegistryChange(removeMemberFromRegistry(registry, memberId, leftAt), {
      type: 'remove',
      memberId,
      timestamp: leftAt,
    });

    // The registry change above only affects display/settlement state. If this
    // member had actually joined the cloud trip (has a uid mapped to them) and
    // the caller is the trip creator, also revoke their real Firestore access —
    // otherwise a "removed" member keeps full read/write access to the trip.
    if (isCollaborative && tripId && removeMemberUid && userUid && tripCreatorUid === userUid) {
      const memberUid = Object.entries(identityMap).find(([, mappedId]) => mappedId === memberId)?.[0];
      if (memberUid && memberUid !== userUid) {
        await removeMemberUid(tripId, memberUid);
      }
    }
  }, [applyRegistryChange, canRemove, registry, setup, isCollaborative, tripId, removeMemberUid, userUid, tripCreatorUid, identityMap]);

  const restoreMember = useCallback(async (memberId: string) => {
    if (!setup) return;
    const current = registry[memberId];
    if (!current) return;

    const restoredAt = new Date().toISOString();
    await applyRegistryChange(restoreMemberInRegistry(registry, memberId), {
      type: 'restore',
      memberId,
      timestamp: restoredAt,
    });
  }, [applyRegistryChange, registry, setup]);

  const getDisplayNameForMember = useCallback((memberId: string, includeInactive = false) => {
    if (!setup?.memberRegistry) return memberId;
    return getDisplayName(memberId, setup.memberRegistry, includeInactive);
  }, [setup?.memberRegistry]);

  return {
    members,
    activeMembers,
    registry,
    addMember,
    renameMember,
    removeMember,
    restoreMember,
    getDisplayName: getDisplayNameForMember,
    getMemberById,
    canRename,
    canRemove,
    isMigrated,
  };
}
