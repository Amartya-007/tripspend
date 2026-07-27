import { MemberRegistry } from './calculations';

const toMillis = (value?: string) => {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSortedMembers = (registry: MemberRegistry, includeInactive = false) => {
  return Object.values(registry)
    .filter((member) => includeInactive || member.isActive)
    .sort((left, right) => {
      const leftTime = toMillis(left.joinedAt);
      const rightTime = toMillis(right.joinedAt);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.memberId.localeCompare(right.memberId);
    });
};

export const getDisplayName = (
  memberId: string,
  registry: MemberRegistry,
  includeInactive = false
): string => {
  const member = registry[memberId];
  if (!member) return memberId;
  if (!includeInactive && !member.isActive) return member.name;

  const members = getSortedMembers(registry, includeInactive);
  const sameName = members.filter((entry) => entry.name === member.name);
  if (sameName.length <= 1) {
    return member.name;
  }

  const suffixIndex = sameName.findIndex((entry) => entry.memberId === memberId);
  return `${member.name} #${suffixIndex >= 0 ? suffixIndex + 1 : 1}`;
};

export const buildDisplayNameMap = (
  registry: MemberRegistry,
  includeInactive = false
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const memberId of Object.keys(registry)) {
    result[memberId] = getDisplayName(memberId, registry, includeInactive);
  }
  return result;
};
