import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateSettlement, type Expense, type MemberRegistry, type TripData } from '../src/utils/calculations';
import { buildDisplayNameMap, getDisplayName } from '../src/utils/memberDisplay';
import { buildSettlementWritePayload, canActOnSettlement, canRemoveMember, canRenameMember, claimMemberIdentity, createMemberRecord, getActiveMemberCount, getMyMemberId, isObserver, isValidMemberName, addMemberToRegistry, removeMemberFromRegistry, renameMemberInRegistry, restoreMemberInRegistry } from '../src/utils/memberManagementCore';
import { dequeueAll, clearQueue, enqueueOp, type MemberOp } from '../src/utils/offlineQueue';
import { migrateLegacyParticipants } from '../src/utils/migration';

const localStore = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return localStore.has(key) ? localStore.get(key)! : null;
    },
    setItem(key: string, value: string) {
      localStore.set(key, String(value));
    },
    removeItem(key: string) {
      localStore.delete(key);
    },
    clear() {
      localStore.clear();
    },
  },
});

const tests: Array<{ name: string; run: () => void }> = [];

const test = (name: string, run: () => void) => {
  tests.push({ name, run });
};

const property = (name: string, iterations: number, run: (iteration: number) => void) => {
  test(name, () => {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      run(iteration);
    }
  });
};

const seeded = (seed: number) => {
  let current = seed >>> 0;
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 0x100000000;
  };
};

const randomString = (next: () => number, length: number) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += chars[Math.floor(next() * chars.length)];
  }
  return value;
};

const memberRegistryFromNames = (entries: Array<{ id: string; name: string; joinedAt: string; isActive?: boolean }>) => {
  const registry: MemberRegistry = {};
  entries.forEach((entry) => {
    registry[entry.id] = {
      memberId: entry.id,
      name: entry.name,
      isActive: entry.isActive ?? true,
      joinedAt: entry.joinedAt,
    };
  });
  return registry;
};

test('Property 1: Member ID stability through mutations', () => {
  const original = addMemberToRegistry({}, 'Alice', '2024-01-01T00:00:00.000Z', 'member-a');
  const renamed = renameMemberInRegistry(original.registry, 'member-a', 'Alicia');
  const removed = removeMemberFromRegistry(renamed, 'member-a', '2024-01-02T00:00:00.000Z');
  const restored = restoreMemberInRegistry(removed, 'member-a');

  assert.equal(restored['member-a'].memberId, 'member-a');
  assert.equal(restored['member-a'].name, 'Alicia');
  assert.equal(restored['member-a'].isActive, true);
  assert.equal(restored['member-a'].leftAt, undefined);
});

test('Property 2: New member record shape', () => {
  const record = createMemberRecord('  Nova  ', '2024-03-03T12:00:00.000Z', 'member-x');
  assert.deepEqual(record, {
    memberId: 'member-x',
    name: 'Nova',
    isActive: true,
    joinedAt: '2024-03-03T12:00:00.000Z',
  });
});

property('Property 3: Duplicate names produce distinct member IDs', 25, (iteration) => {
  const name = `Sam ${iteration % 3}`.trim();
  const first = addMemberToRegistry({}, name, `2024-01-0${(iteration % 5) + 1}T00:00:00.000Z`, `member-${iteration}-a`);
  const second = addMemberToRegistry(first.registry, name, `2024-01-0${(iteration % 5) + 2}T00:00:00.000Z`, `member-${iteration}-b`);
  assert.notEqual(first.member.memberId, second.member.memberId);
  assert.equal(Object.keys(second.registry).length, 2);
});

test('Property 4: Rename preserves all fields except name', () => {
  const registry = memberRegistryFromNames([
    { id: 'member-a', name: 'Alex', joinedAt: '2024-01-01T00:00:00.000Z', isActive: true },
  ]);
  registry['member-a'].color = 'blue';
  const renamed = renameMemberInRegistry(registry, 'member-a', 'Alexis');
  assert.deepEqual(renamed['member-a'], {
    memberId: 'member-a',
    name: 'Alexis',
    isActive: true,
    joinedAt: '2024-01-01T00:00:00.000Z',
    color: 'blue',
  });
});

property('Property 5: Member lifecycle operations never modify expenses', 20, (iteration) => {
  const expenses: Expense[] = [{
    id: `expense-${iteration}`,
    amount: 120,
    category: 'Food',
    date: '2024-01-01T00:00:00.000Z',
    paidBy: 'member-a',
    participants: ['member-a'],
  }];
  const original = JSON.parse(JSON.stringify(expenses)) as Expense[];
  const registry = addMemberToRegistry({}, 'Taylor', '2024-01-01T00:00:00.000Z', 'member-a').registry;
  const renamed = renameMemberInRegistry(registry, 'member-a', 'Taylor 2');
  const removed = removeMemberFromRegistry(renamed, 'member-a', '2024-01-02T00:00:00.000Z');
  restoreMemberInRegistry(removed, 'member-a');
  assert.deepEqual(expenses, original);
});

property('Property 6: Name validation boundary', 40, (iteration) => {
  const next = seeded(iteration + 7);
  const short = randomString(next, 1 + (iteration % 10));
  const fifty = randomString(next, 50);
  const fiftyOne = `${fifty}x`;
  assert.equal(isValidMemberName(''), false);
  assert.equal(isValidMemberName('   '), false);
  assert.equal(isValidMemberName(short), true);
  assert.equal(isValidMemberName(`  ${short}  `), true);
  assert.equal(isValidMemberName(fifty), true);
  assert.equal(isValidMemberName(fiftyOne), false);
});

test('Property 7: Soft-delete sets isActive false and records leftAt', () => {
  const registry = addMemberToRegistry({}, 'Jordan', '2024-01-01T00:00:00.000Z', 'member-a').registry;
  const removed = removeMemberFromRegistry(registry, 'member-a', '2024-01-04T00:00:00.000Z');
  assert.equal(removed['member-a'].isActive, false);
  assert.equal(removed['member-a'].leftAt, '2024-01-04T00:00:00.000Z');
});

test('Property 8: Last active member cannot be removed', () => {
  const registry = addMemberToRegistry({}, 'Jordan', '2024-01-01T00:00:00.000Z', 'member-a').registry;
  assert.equal(canRemoveMember({ isCollaborative: false, userUid: null, tripCreatorUid: null, identityMap: {}, activeMemberCount: getActiveMemberCount(registry) }, 'member-a'), false);
});

test('Property 9: Remove-then-restore round trip', () => {
  const registry = addMemberToRegistry({}, 'Jordan', '2024-01-01T00:00:00.000Z', 'member-a').registry;
  const removed = removeMemberFromRegistry(registry, 'member-a', '2024-01-04T00:00:00.000Z');
  const restored = restoreMemberInRegistry(removed, 'member-a');
  assert.equal(restored['member-a'].isActive, true);
  assert.equal(restored['member-a'].leftAt, undefined);
});

test('Property 10: Inactive members remain visible in settlement calculation', () => {
  const registry = memberRegistryFromNames([
    { id: 'member-a', name: 'Active', joinedAt: '2024-01-01T00:00:00.000Z', isActive: true },
    { id: 'member-b', name: 'Inactive', joinedAt: '2024-01-02T00:00:00.000Z', isActive: false },
  ]);
  const tripData: TripData = {
    setup: {
      peopleCount: 2,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      memberRegistry: registry,
    },
    expenses: [{
      id: 'expense-a',
      amount: 100,
      category: 'Food',
      date: '2024-01-01T00:00:00.000Z',
      paidBy: 'member-a',
      participants: ['member-a', 'member-b'],
    }],
  };
  const settlement = calculateSettlement(tripData.setup, tripData.expenses);
  assert.ok(Object.prototype.hasOwnProperty.call(settlement.balances, 'member-b'));
  assert.equal(settlement.balances['member-b'], -50);
});

test('Property 11: Settlement documents include active-flag fields', () => {
  const paid = buildSettlementWritePayload({
    transfer: { from: 'member-a', to: 'member-b', amount: 45 },
    status: 'paid',
    fromUserId: 'uid-a',
    toUserId: null,
    fromMemberActive: false,
    toMemberActive: true,
    creatorOverride: true,
    note: '  settled on behalf  ',
    proofImage: 'data:image/png;base64,abc',
    proofName: 'proof.png',
    nowIso: '2024-01-05T00:00:00.000Z',
  });
  assert.equal(paid.fromMemberActive, false);
  assert.equal(paid.toMemberActive, true);
  assert.equal(paid.creatorOverride, true);
  assert.equal(paid.creatorOverrideAt, '2024-01-05T00:00:00.000Z');
  assert.equal(paid.note, 'settled on behalf');

  const completed = buildSettlementWritePayload({
    transfer: { from: 'member-a', to: 'member-b', amount: 45 },
    status: 'completed',
    fromUserId: null,
    toUserId: 'uid-b',
    fromMemberActive: true,
    toMemberActive: false,
    creatorOverride: false,
    nowIso: '2024-01-06T00:00:00.000Z',
  });
  assert.equal(completed.fromMemberActive, true);
  assert.equal(completed.toMemberActive, false);
  assert.equal((completed as { completedAt?: string }).completedAt, '2024-01-06T00:00:00.000Z');
});

test('Property 12: Rename permission rejects non-owner non-creator', () => {
  const canRename = canRenameMember({
    isCollaborative: true,
    userUid: 'uid-b',
    tripCreatorUid: 'uid-owner',
    identityMap: { 'uid-a': 'member-a' },
  }, 'member-a');
  assert.equal(canRename, false);
});

test('Property 13: Identity map forward uniqueness', () => {
  assert.throws(() => claimMemberIdentity({ 'uid-a': 'member-a' }, 'uid-a', 'member-b'));
  assert.deepEqual(claimMemberIdentity({}, 'uid-a', 'member-a'), { 'uid-a': 'member-a' });
});

test('Property 14: Identity map reverse uniqueness', () => {
  assert.throws(() => claimMemberIdentity({ 'uid-b': 'member-a' }, 'uid-a', 'member-a'));
});

test('Property 15: Observer has no send/receive permissions', () => {
  assert.equal(isObserver({}, 'uid-observer'), true);
  assert.equal(canActOnSettlement(null, { from: 'member-a', to: 'member-b', amount: 12 }, true), false);
});

test('Property 16: memberId-based identity distinguishes same-name members', () => {
  const registry = memberRegistryFromNames([
    { id: 'member-a', name: 'Alex', joinedAt: '2024-01-01T00:00:00.000Z', isActive: true },
    { id: 'member-b', name: 'Alex', joinedAt: '2024-01-02T00:00:00.000Z', isActive: true },
  ]);
  const displayNames = buildDisplayNameMap(registry, true);
  assert.equal(displayNames['member-a'], 'Alex #1');
  assert.equal(displayNames['member-b'], 'Alex #2');
  const identityMap = claimMemberIdentity({}, 'uid-a', 'member-a');
  const nextIdentityMap = claimMemberIdentity(identityMap, 'uid-b', 'member-b');
  assert.equal(getMyMemberId(nextIdentityMap, 'uid-a'), 'member-a');
  assert.equal(getMyMemberId(nextIdentityMap, 'uid-b'), 'member-b');
});

test('Property 17: Disambiguation labels are stable and distinct', () => {
  const registry = memberRegistryFromNames([
    { id: 'member-a', name: 'Alex', joinedAt: '2024-01-01T00:00:00.000Z' },
    { id: 'member-b', name: 'Alex', joinedAt: '2024-01-02T00:00:00.000Z' },
    { id: 'member-c', name: 'Priya', joinedAt: '2024-01-03T00:00:00.000Z' },
  ]);
  const first = buildDisplayNameMap(registry, true);
  const second = buildDisplayNameMap(registry, true);
  assert.deepEqual(first, second);
  assert.equal(first['member-a'], 'Alex #1');
  assert.equal(first['member-b'], 'Alex #2');
  assert.equal(first['member-c'], 'Priya');
  assert.equal(getDisplayName('member-a', registry, true), 'Alex #1');
});

test('Property 18: Disambiguation label removed after rename makes name unique', () => {
  const registry = memberRegistryFromNames([
    { id: 'member-a', name: 'Alex', joinedAt: '2024-01-01T00:00:00.000Z' },
    { id: 'member-b', name: 'Alex', joinedAt: '2024-01-02T00:00:00.000Z' },
  ]);
  const renamed = renameMemberInRegistry(registry, 'member-b', 'Jordan');
  const displayNames = buildDisplayNameMap(renamed, true);
  assert.equal(displayNames['member-a'], 'Alex');
  assert.equal(displayNames['member-b'], 'Jordan');
});

property('Property 19: Migration produces one registry entry per participant', 20, (iteration) => {
  const names = [`Alex-${iteration}`, `Sam-${iteration}`, `Alex-${iteration}`];
  const data: TripData = {
    setup: {
      peopleCount: names.length,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      participants: names,
    },
    expenses: [],
  };
  const migrated = migrateLegacyParticipants(data);
  assert.ok(migrated.setup?.memberRegistry);
  assert.equal(Object.keys(migrated.setup.memberRegistry).length, names.length);
});

test('Property 20: Migration is idempotent', () => {
  const data: TripData = {
    setup: {
      peopleCount: 1,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      memberRegistry: {
        'member-a': {
          memberId: 'member-a',
          name: 'Alex',
          isActive: true,
          joinedAt: '2024-01-01T00:00:00.000Z',
        },
      },
    },
    expenses: [],
  };
  assert.strictEqual(migrateLegacyParticipants(data), data);
});

property('Property 21: Migration reference validity', 15, (iteration) => {
  const names = ['Alex', 'Sam', 'Alex', 'Priya'];
  const data: TripData = {
    setup: {
      peopleCount: names.length,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      participants: names,
    },
    expenses: [{
      id: `expense-${iteration}`,
      amount: 90,
      category: 'Food',
      date: '2024-01-01T00:00:00.000Z',
      paidBy: 'Alex',
      participants: ['Alex', 'Sam'],
      splitMap: { Alex: 45, Sam: 45 },
    }],
  };
  const migrated = migrateLegacyParticipants(data);
  const registryKeys = new Set(Object.keys(migrated.setup?.memberRegistry || {}));
  migrated.expenses.forEach((expense) => {
    assert.ok(registryKeys.has(expense.paidBy));
    expense.participants?.forEach((participant) => assert.ok(registryKeys.has(participant)));
  });
});

test('Property 22: Migration removes legacy participants array', () => {
  const data: TripData = {
    setup: {
      peopleCount: 2,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      participants: ['Alex', 'Sam'],
    },
    expenses: [],
  };
  const migrated = migrateLegacyParticipants(data);
  assert.equal(migrated.setup?.participants, undefined);
  assert.ok(migrated.setup?.memberRegistry);
});

test('Property 23: Migration failure preserves original data', () => {
  const original: TripData = {
    setup: {
      peopleCount: 1,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      lockPreviousDays: false,
      participants: ['Alex'],
    },
    expenses: [],
  };
  const failing = {
    setup: original.setup,
    expenses: {
      map() {
        throw new Error('boom');
      },
    },
  } as unknown as TripData;
  assert.strictEqual(migrateLegacyParticipants(failing), failing);
});

test('Property 24: Offline queue flush preserves operation order', () => {
  clearQueue('trip-a');
  const ops: MemberOp[] = [
    { type: 'rename', memberId: 'member-a', newName: 'Third', timestamp: '2024-01-03T00:00:00.000Z' },
    { type: 'rename', memberId: 'member-a', newName: 'First', timestamp: '2024-01-01T00:00:00.000Z' },
    { type: 'rename', memberId: 'member-a', newName: 'Second', timestamp: '2024-01-02T00:00:00.000Z' },
  ];
  ops.forEach((op) => enqueueOp('trip-a', op));
  const flushed = dequeueAll('trip-a');
  assert.deepEqual(flushed.map((op) => op.timestamp), [
    '2024-01-01T00:00:00.000Z',
    '2024-01-02T00:00:00.000Z',
    '2024-01-03T00:00:00.000Z',
  ]);
  assert.deepEqual(dequeueAll('trip-a'), []);
});

test('Property 25: Last-write-wins conflict resolution', () => {
  const initial = memberRegistryFromNames([
    { id: 'member-a', name: 'Alex', joinedAt: '2024-01-01T00:00:00.000Z' },
  ]);
  const operations = [
    { timestamp: '2024-01-01T01:00:00.000Z', newName: 'Alex One' },
    { timestamp: '2024-01-01T02:00:00.000Z', newName: 'Alex Two' },
  ];
  const resolved = operations
    .slice()
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .reduce((registry, operation) => renameMemberInRegistry(registry, 'member-a', operation.newName), initial);
  assert.equal(resolved['member-a'].name, 'Alex Two');
});

const rulesPath = path.join(process.cwd(), 'firestore.rules');

test('Firestore rules keep the settlement transition structure', () => {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  assert.match(rules, /allow update: if isTripMember\(tripId\)/);
  assert.match(rules, /Path 0: Creator flag-only update/);
  assert.match(rules, /Path 7: Creator fallback — completed → pending/);
  assert.match(rules, /identityMapForwardUnique\(\)/);
});

let failed = 0;
for (const entry of tests) {
  try {
    entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
  console.error(`\n${failed} test(s) failed.`);
} else {
  console.log(`\n${tests.length} tests passed.`);
}
