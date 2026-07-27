import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { arrayUnion, doc, onSnapshot, query, collection, where, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const projectId = 'tripspend-invite-edge';

async function waitFor(predicate, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for condition');
}

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  const code = '222222';

  const dbA = testEnv.authenticatedContext('uid-a').firestore();
  const dbB = testEnv.authenticatedContext('uid-b').firestore();
  const dbC = testEnv.authenticatedContext('uid-c').firestore();

  await assertSucceeds(setDoc(doc(dbA, `trips/${code}`), {
    name: 'Race Trip',
    createdBy: 'uid-a',
    members: ['uid-a'],
    setup: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  let aSawBC = false;
  let bSawTrip = false;

  const unsubA = onSnapshot(query(collection(dbA, 'trips'), where('members', 'array-contains', 'uid-a')), (snap) => {
    const found = snap.docs.find((d) => d.id === code);
    if (!found) return;
    const members = (found.data().members ?? []) as string[];
    if (members.includes('uid-b') && members.includes('uid-c')) aSawBC = true;
  });

  const unsubB = onSnapshot(query(collection(dbB, 'trips'), where('members', 'array-contains', 'uid-b')), (snap) => {
    if (snap.docs.some((d) => d.id === code)) bSawTrip = true;
  });

  // Concurrent joins
  const [r1, r2] = await Promise.allSettled([
    assertSucceeds(updateDoc(doc(dbB, `trips/${code}`), { members: arrayUnion('uid-b'), updatedAt: serverTimestamp() })),
    assertSucceeds(updateDoc(doc(dbC, `trips/${code}`), { members: arrayUnion('uid-c'), updatedAt: serverTimestamp() })),
  ]);

  assert.equal(r1.status, 'fulfilled');
  assert.equal(r2.status, 'fulfilled');

  const final = await assertSucceeds(getDoc(doc(dbA, `trips/${code}`)));
  const members = (final.data()?.members ?? []) as string[];
  assert.equal(members.includes('uid-b'), true);
  assert.equal(members.includes('uid-c'), true);

  await waitFor(() => aSawBC && bSawTrip, 8000);

  unsubA();
  unsubB();
  await testEnv.cleanup();

  console.log('PASS concurrent joins + listener propagation');
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
