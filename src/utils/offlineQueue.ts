export type MemberOp =
  | { type: 'add'; memberId: string; name: string; timestamp: string }
  | { type: 'rename'; memberId: string; newName: string; timestamp: string }
  | { type: 'remove'; memberId: string; timestamp: string }
  | { type: 'restore'; memberId: string; timestamp: string };

const queueKey = (tripId: string) => `tripspend_member_queue_${tripId}`;

const readQueue = (tripId: string): MemberOp[] => {
  try {
    const raw = localStorage.getItem(queueKey(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed.filter(Boolean) as MemberOp[]) : [];
  } catch {
    return [];
  }
};

const saveQueue = (tripId: string, ops: MemberOp[]) => {
  localStorage.setItem(queueKey(tripId), JSON.stringify(ops));
};

export const enqueueOp = (tripId: string, op: MemberOp): void => {
  const next = [...readQueue(tripId), op];
  saveQueue(tripId, next);
};

export const dequeueAll = (tripId: string): MemberOp[] => {
  const next = readQueue(tripId).slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  clearQueue(tripId);
  return next;
};

export const clearQueue = (tripId: string): void => {
  localStorage.removeItem(queueKey(tripId));
};
