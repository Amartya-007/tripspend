import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'tripspend-rules-test';

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  const tripId = 'trip-alpha';
  const settlementId = 'member-a|member-b|5000';

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
  });

  const senderDb = testEnv.authenticatedContext('uid-a').firestore();
  const receiverDb = testEnv.authenticatedContext('uid-b').firestore();
  const creatorDb = testEnv.authenticatedContext('uid-creator').firestore();
  const outsiderDb = testEnv.authenticatedContext('uid-outsider').firestore();

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

  await testEnv.cleanup();
  console.log('PASS Firestore emulator rules transitions and active-flag guard');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
