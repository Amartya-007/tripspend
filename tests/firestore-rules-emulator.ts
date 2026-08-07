import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const projectId = 'tripspend-rules-test';

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  const tripId = 'trip-alpha';
  const expiredTripId = 'trip-expired';
  const settlementId = 'member-a|member-b|5000';
  const expenseId = 'expense-alpha';
  const historyId = 'history-alpha';

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, `trips/${tripId}`), {
      createdBy: 'uid-creator',
      members: ['uid-creator', 'uid-a', 'uid-b'],
      identityMap: {
        'uid-a': 'member-a',
        'uid-b': 'member-b',
      },
      updatedAt: '2026-04-10T00:00:00.000Z',
    });

    await setDoc(doc(db, `trips/${tripId}/settlements/${settlementId}`), {
      from: 'member-a',
      to: 'member-b',
      amount: 50,
      fromUserId: 'uid-a',
      toUserId: null,
      status: 'pending',
      creatorOverride: false,
      fromMemberActive: true,
      toMemberActive: true,
      updatedAt: '2026-04-10T00:00:00.000Z',
    });

    await setDoc(doc(db, `trips/${tripId}/expenses/${expenseId}`), {
      id: expenseId,
      description: 'Test expense',
      amount: 50,
      payerId: 'member-a',
    });

    await setDoc(doc(db, `trips/${tripId}/settlementHistory/${historyId}`), {
      status: 'pending',
      createdAt: '2026-04-10T00:00:00.000Z',
    });

    await setDoc(doc(db, `trips/${expiredTripId}`), {
      createdBy: 'uid-creator',
      members: ['uid-creator'],
      inviteActive: true,
      inviteExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  const senderDb = testEnv.authenticatedContext('uid-a').firestore();
  const receiverDb = testEnv.authenticatedContext('uid-b').firestore();
  const creatorDb = testEnv.authenticatedContext('uid-creator').firestore();
  const outsiderDb = testEnv.authenticatedContext('uid-outsider').firestore();

  await assertFails(getDoc(doc(outsiderDb, `trips/${tripId}`)));
  // Self-scoped list queries (array-contains: request.auth.uid) are how the
  // app actually queries /trips (see useTripSync.ts) and are provably safe --
  // Firestore can verify the rule from the query shape alone, so this must
  // succeed, just with zero results since uid-outsider is in no trip.
  await (async () => {
    const snap = await assertSucceeds(getDocs(query(collection(outsiderDb, 'trips'), where('members', 'array-contains', 'uid-outsider'))));
    assert.equal(snap.empty, true, 'outsider self-scoped list should return zero trips');
  })();
  // Querying array-contains with someone ELSE's uid is the actual attack this
  // rule needs to block -- Firestore can't prove the rule from the query
  // shape when the filter value doesn't match request.auth.uid, so it must
  // deny the list outright rather than silently filtering.
  await assertFails(getDocs(query(collection(outsiderDb, 'trips'), where('members', 'array-contains', 'uid-creator'))));
  await assertFails(getDoc(doc(outsiderDb, `trips/${tripId}/expenses/${expenseId}`)));
  await assertFails(getDoc(doc(outsiderDb, `trips/${tripId}/settlements/${settlementId}`)));
  await assertFails(getDoc(doc(outsiderDb, `trips/${tripId}/settlementHistory/${historyId}`)));
  await assertFails(updateDoc(doc(outsiderDb, `trips/${expiredTripId}`), {
    members: ['uid-creator', 'uid-outsider'],
    updatedAt: '2026-07-28T00:00:00.000Z',
  }));

  await assertFails(setDoc(doc(senderDb, 'trips/trip-malformed-setup'), {
    createdBy: 'uid-a',
    members: ['uid-a'],
    setup: {
      peopleCount: 999,
      budgetPerPerson: 0,
      totalBudget: 0,
      startDate: '2026-04-10',
      endDate: '2026-04-11',
      lockPreviousDays: false,
    },
  }));

  // Negative test: creating settlement with status 'paid' must fail
  await assertFails(setDoc(doc(senderDb, `trips/${tripId}/settlements/s-new`), {
    from: 'member-a',
    to: 'member-b',
    amount: 10,
    fromUserId: 'uid-a',
    toUserId: null,
    status: 'paid',
    creatorOverride: false,
  }));

  // Negative test: member trying to overwrite trip createdBy or members array must fail
  await assertFails(updateDoc(doc(senderDb, `trips/${tripId}`), {
    createdBy: 'uid-a',
  }));

  // Negative test: outsider cannot list or read trip subcollections
  await assertFails(updateDoc(doc(outsiderDb, `trips/${tripId}`), {
    name: 'Hacked Trip',
  }));

  // Invalid: status unchanged, flags changed, not creator Path 0, and no transition path.
  await assertFails(updateDoc(doc(senderDb, `trips/${tripId}/settlements/${settlementId}`), {
    fromMemberActive: false,
    updatedAt: '2026-04-10T00:01:00.000Z',
  }));

  // Valid Path 1: sender marks pending -> paid.
  await assertSucceeds(updateDoc(doc(senderDb, `trips/${tripId}/settlements/${settlementId}`), {
    status: 'paid',
    fromUserId: 'uid-a',
    toUserId: null,
    creatorOverride: false,
    updatedAt: '2026-04-10T00:02:00.000Z',
  }));

  // Invalid: receiver cannot retract paid -> pending (forbidden transition actor).
  await assertFails(updateDoc(doc(receiverDb, `trips/${tripId}/settlements/${settlementId}`), {
    status: 'pending',
    fromUserId: 'uid-a',
    toUserId: null,
    creatorOverride: false,
    updatedAt: '2026-04-10T00:03:00.000Z',
  }));

  // Valid Path 0: creator can perform flag-only update.
  await assertSucceeds(updateDoc(doc(creatorDb, `trips/${tripId}/settlements/${settlementId}`), {
    fromMemberActive: false,
    toMemberActive: true,
    status: 'paid',
    fromUserId: 'uid-a',
    toUserId: null,
    creatorOverride: false,
    updatedAt: '2026-04-10T00:04:00.000Z',
  }));

  // ── New: create must pin members to exactly [caller] ──────────────────────
  await assertFails(setDoc(doc(senderDb, 'trips/trip-extra-member'), {
    createdBy: 'uid-a',
    members: ['uid-a', 'uid-b'],
    setup: null,
  }));
  await assertSucceeds(setDoc(doc(senderDb, 'trips/trip-solo-create'), {
    createdBy: 'uid-a',
    members: ['uid-a'],
    setup: null,
  }));

  // ── New: creator-only invite revoke/reactivate ─────────────────────────────
  // Non-creator cannot flip inviteActive.
  await assertFails(updateDoc(doc(senderDb, `trips/${tripId}`), {
    inviteActive: false,
    updatedAt: '2026-04-10T00:05:00.000Z',
  }));
  // Creator can revoke (only inviteActive/updatedAt change).
  await assertSucceeds(updateDoc(doc(creatorDb, `trips/${tripId}`), {
    inviteActive: false,
    updatedAt: '2026-04-10T00:06:00.000Z',
  }));
  // Creator can reactivate with a fresh expiry.
  await assertSucceeds(updateDoc(doc(creatorDb, `trips/${tripId}`), {
    inviteActive: true,
    inviteExpiresAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: '2026-04-10T00:07:00.000Z',
  }));
  // The invite-control path cannot smuggle in other field changes.
  await assertFails(updateDoc(doc(creatorDb, `trips/${tripId}`), {
    inviteActive: false,
    name: 'Renamed via invite control',
    updatedAt: '2026-04-10T00:08:00.000Z',
  }));

  // ── New: creator-only member removal actually revokes access ───────────────
  // Non-creator cannot remove another member.
  await assertFails(updateDoc(doc(senderDb, `trips/${tripId}`), {
    members: ['uid-creator', 'uid-b'],
    updatedAt: '2026-04-10T00:09:00.000Z',
  }));
  // Creator can remove exactly one member and clear their identity-map entry.
  await assertSucceeds(updateDoc(doc(creatorDb, `trips/${tripId}`), {
    members: ['uid-creator', 'uid-b'],
    identityMap: { 'uid-b': 'member-b' },
    updatedAt: '2026-04-10T00:10:00.000Z',
  }));
  // Removed member has lost access.
  await assertFails(getDoc(doc(senderDb, `trips/${tripId}`)));
  // Creator cannot remove themself through this path.
  await assertFails(updateDoc(doc(creatorDb, `trips/${tripId}`), {
    members: ['uid-b'],
    updatedAt: '2026-04-10T00:11:00.000Z',
  }));

  await testEnv.cleanup();
  console.log('PASS Firestore emulator rules transitions and active-flag guard');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
