// Access rules for private team workspaces (firestore.rules), run in the Firestore emulator.
// Each user id is an ORCID iD, as minted by the planned token-exchange function.
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

const ADA = '0000-0002-1825-0097';   // coordinator
const BEN = '0000-0001-5109-3700';   // invited, then member
const EVE = '0000-0003-4820-7951';   // outsider who knows the team id
const TEAM = 'team-1';
const disclosure = () => ({ version: 'v1', acceptedAt: serverTimestamp() });

let env;
const as = orcid => (orcid ? env.authenticatedContext(orcid) : env.unauthenticatedContext()).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-orcid-playground',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

async function createTeam(db = as(ADA), orcid = ADA) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'teams', TEAM), { name: 'WellFAIR', description: '', createdBy: orcid, createdAt: serverTimestamp(), coordinators: [orcid] });
  batch.set(doc(db, 'teams', TEAM, 'members', orcid), { orcid, teamName: 'WellFAIR', status: 'active', invitedBy: orcid, invitedAt: serverTimestamp(), disclosure: disclosure() });
  return batch.commit();
}
const invite = (orcid = BEN, db = as(ADA)) => setDoc(doc(db, 'teams', TEAM, 'members', orcid),
  { orcid, teamName: 'WellFAIR', status: 'invited', invitedBy: ADA, invitedAt: serverTimestamp(), disclosure: null });
const accept = (orcid = BEN) => updateDoc(doc(as(orcid), 'teams', TEAM, 'members', orcid), { status: 'active', disclosure: disclosure() });

describe('creating a team', () => {
  test('a signed-in researcher creates a team and is its only coordinator', async () => {
    await assertSucceeds(createTeam());
  });
  test('signed-out users and non-ORCID user ids cannot create teams', async () => {
    await assertFails(createTeam(as(null), ADA));
    await assertFails(createTeam(env.authenticatedContext('not-an-orcid').firestore(), 'not-an-orcid'));
  });
  test('nobody can create a team in someone else\'s name or without their own membership', async () => {
    await assertFails(createTeam(as(EVE), ADA));
    const db = as(ADA);
    await assertFails(setDoc(doc(db, 'teams', TEAM), { name: 'X', description: '', createdBy: ADA, createdAt: serverTimestamp(), coordinators: [ADA] }));
  });
});

describe('reading', () => {
  beforeEach(() => createTeam());
  test('knowing the team id or a member\'s iD grants nothing', async () => {
    await assertFails(getDoc(doc(as(EVE), 'teams', TEAM)));
    await assertFails(getDoc(doc(as(EVE), 'teams', TEAM, 'members', ADA)));
    await assertFails(getDoc(doc(as(null), 'teams', TEAM)));
  });
  test('an invitee sees only their own invitation until they accept', async () => {
    await invite();
    await assertSucceeds(getDoc(doc(as(BEN), 'teams', TEAM, 'members', BEN)));
    await assertSucceeds(getDocs(query(collectionGroup(as(BEN), 'members'), where('orcid', '==', BEN))));
    await assertFails(getDoc(doc(as(BEN), 'teams', TEAM)));
    await assertFails(getDocs(query(collectionGroup(as(EVE), 'members'), where('orcid', '==', BEN))));
    await accept();
    await assertSucceeds(getDoc(doc(as(BEN), 'teams', TEAM)));
  });
});

describe('membership', () => {
  beforeEach(async () => { await createTeam(); await invite(); });
  test('only the invitee can accept, and only with a recorded disclosure', async () => {
    await assertFails(updateDoc(doc(as(ADA), 'teams', TEAM, 'members', BEN), { status: 'active', disclosure: disclosure() }));
    await assertFails(updateDoc(doc(as(BEN), 'teams', TEAM, 'members', BEN), { status: 'active' }));
    await assertSucceeds(accept());
  });
  test('a coordinator cannot add someone as already active, and members cannot invite', async () => {
    await assertFails(setDoc(doc(as(ADA), 'teams', TEAM, 'members', EVE),
      { orcid: EVE, teamName: 'WellFAIR', status: 'active', invitedBy: ADA, invitedAt: serverTimestamp(), disclosure: null }));
    await accept();
    await assertFails(invite(EVE, as(BEN)));
  });
  test('an outsider cannot join by writing their own membership', async () => {
    await assertFails(setDoc(doc(as(EVE), 'teams', TEAM, 'members', EVE),
      { orcid: EVE, teamName: 'WellFAIR', status: 'active', invitedBy: EVE, invitedAt: serverTimestamp(), disclosure: disclosure() }));
  });
  test('members can leave or decline; coordinators can remove members', async () => {
    await assertSucceeds(deleteDoc(doc(as(BEN), 'teams', TEAM, 'members', BEN)));
    await invite();
    await assertSucceeds(deleteDoc(doc(as(ADA), 'teams', TEAM, 'members', BEN)));
  });
  test('the last coordinator cannot leave or be removed, keeping the team owned', async () => {
    await assertFails(deleteDoc(doc(as(ADA), 'teams', TEAM, 'members', ADA)));
    await assertFails(updateDoc(doc(as(ADA), 'teams', TEAM), { coordinators: [] }));
  });
  test('coordinators can only promote active members', async () => {
    await assertFails(updateDoc(doc(as(ADA), 'teams', TEAM), { coordinators: [ADA, BEN] }));
    await accept();
    await assertSucceeds(updateDoc(doc(as(ADA), 'teams', TEAM), { coordinators: [ADA, BEN] }));
    await assertFails(updateDoc(doc(as(BEN), 'teams', TEAM), { coordinators: [ADA, BEN, EVE] }));
  });
});

describe('entries (roles, contributions, notes, requests, outputs)', () => {
  beforeEach(async () => { await createTeam(); await invite(); await accept(); });
  const entry = (author, subject = author, text = 'Leads WP2') => ({ kind: 'role', subject, text, author, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  test('active members read and write their own entries; outsiders and invitees cannot', async () => {
    await assertSucceeds(setDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), entry(BEN)));
    await assertSucceeds(getDoc(doc(as(ADA), 'teams', TEAM, 'entries', 'e1')));
    await assertFails(getDoc(doc(as(EVE), 'teams', TEAM, 'entries', 'e1')));
    await assertFails(setDoc(doc(as(EVE), 'teams', TEAM, 'entries', 'e2'), entry(EVE)));
  });
  test('nobody writes as someone else or edits another member\'s entry', async () => {
    await assertFails(setDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), entry(ADA)));
    await setDoc(doc(as(ADA), 'teams', TEAM, 'entries', 'e1'), entry(ADA, BEN));
    await assertFails(updateDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), { text: 'changed' }));
  });
  test('a member can delete what others wrote about them', async () => {
    await setDoc(doc(as(ADA), 'teams', TEAM, 'entries', 'e1'), entry(ADA, BEN));
    await assertSucceeds(deleteDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1')));
  });
  test('entries are typed and bounded', async () => {
    await assertFails(setDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), { ...entry(BEN), kind: 'salary' }));
    await assertFails(setDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), { ...entry(BEN), text: 'x'.repeat(5001) }));
    await assertFails(setDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1'), { ...entry(BEN), extra: true }));
  });
  test('after leaving, a former member reads nothing', async () => {
    await setDoc(doc(as(ADA), 'teams', TEAM, 'entries', 'e1'), entry(ADA));
    await deleteDoc(doc(as(BEN), 'teams', TEAM, 'members', BEN));
    await assertFails(getDoc(doc(as(BEN), 'teams', TEAM, 'entries', 'e1')));
    await assertFails(getDoc(doc(as(BEN), 'teams', TEAM)));
  });
});

describe('after a team is deleted', () => {
  test('former members can clear their leftover membership, outsiders cannot', async () => {
    await createTeam(); await invite(); await accept();
    await env.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(), 'teams', TEAM)));
    await assertFails(deleteDoc(doc(as(EVE), 'teams', TEAM, 'members', BEN)));
    await assertSucceeds(deleteDoc(doc(as(BEN), 'teams', TEAM, 'members', BEN)));
    await assertSucceeds(deleteDoc(doc(as(ADA), 'teams', TEAM, 'members', ADA)));
  });
});

describe('personal synced workspace', () => {
  const part = (orcid, data = 'H4sI') => ({ data, index: 0, count: 1, sha256: 'x', updatedAt: serverTimestamp(), device: 'test' });
  test('only the owner reads and writes their workspace', async () => {
    await assertSucceeds(setDoc(doc(as(ADA), 'users', ADA, 'workspace', 'chunk-0'), part(ADA)));
    await assertSucceeds(getDoc(doc(as(ADA), 'users', ADA, 'workspace', 'chunk-0')));
    await assertFails(getDoc(doc(as(EVE), 'users', ADA, 'workspace', 'chunk-0')));
    await assertFails(setDoc(doc(as(EVE), 'users', ADA, 'workspace', 'chunk-0'), part(ADA)));
    await assertFails(getDoc(doc(as(null), 'users', ADA, 'workspace', 'chunk-0')));
  });
  test('workspace parts are bounded and typed', async () => {
    await assertFails(setDoc(doc(as(ADA), 'users', ADA, 'workspace', 'chunk-0'), part(ADA, 'x'.repeat(900001))));
    await assertFails(setDoc(doc(as(ADA), 'users', ADA, 'workspace', 'chunk-0'), { ...part(ADA), extra: 1 }));
  });
});
