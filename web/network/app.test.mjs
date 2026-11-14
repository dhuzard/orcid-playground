import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, dateLabel, feedEntries, feedItems, feedTopics, scopeIds, groupSuggestions, sinceLastVisit, nextVisit, foldKey, groupWorks, parseOrcidList, groupRoute, addRoute, bookmarklet, removalImpact, allTags, openActions, handoffRoute, knownPerson, workspaceSummary, sampleMessage, guideSteps, sampleRemoval, defaultHandoffGroup } from './app.js';

test('external links reject executable and relative URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', '/api/state', '', null]) assert.equal(safeUrl(value), null);
  assert.equal(safeUrl('https://orcid.org/0000-0002-1825-0097'), 'https://orcid.org/0000-0002-1825-0097');
});

test('publication dates retain their source precision', () => {
  assert.equal(dateLabel('2024'), '2024');
  assert.equal(dateLabel('2024-01'), 'Jan 2024');
  assert.equal(dateLabel('2024-01-03'), 'Jan 3, 2024');
  assert.equal(dateLabel('bad input'), 'Date unavailable');
});

const data = {
  people: [{ id: 'a', following: true }, { id: 'b', following: true }, { id: 'c', following: false }],
  works: [{ id: 'shared', people_ids: ['a', 'b'], date: '2020' }, { id: 'other', people_ids: ['c'], date: '2025' }],
  events: [
    { work_id: 'shared', people_ids: ['a'], observed_at: '2026-01-01' },
    { work_id: 'shared', people_ids: ['b'], observed_at: '2026-01-02' },
    { work_id: 'other', people_ids: ['c'], observed_at: '2026-01-03' },
    { work_id: 'missing', people_ids: ['a'], observed_at: '2026-01-03' }
  ]
};

test('feed filters follows, merges shared updates, and uses observed date', () => {
  const entries = feedEntries(data);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].work.id, 'shared');
  assert.equal(entries[0].event.observed_at, '2026-01-02');
});

test('group bibliography includes shared works only once', () => {
  assert.deepEqual(groupWorks(data, ['a', 'b']).map(w => w.id), ['shared']);
  assert.deepEqual(groupWorks(data, []).map(w => w.id), []);
});

test('bulk roster parses pasted Markdown, HTML spaces, URL and bare ID duplicates', () => {
  const result = parseOrcidList('[0000-0001-5616-7692](https://orcid.org/0000-0001-5616-7692) &#x20;\n0000-0003-4820-7951; [colleague](https://orcid.org/0000-0002-3709-5504) &#32;,0000-0001-5616-7692');
  assert.equal(result.overLimit, false);
  assert.deepEqual(result.entries.map(e => [e.id, e.valid]), [
    ['0000-0001-5616-7692', true], ['0000-0003-4820-7951', true], ['0000-0002-3709-5504', true]
  ]);
});

test('bulk roster validates checksums, X check digits and exact ORCID URLs', () => {
  const result = parseOrcidList('https://orcid.org/0000-0002-1825-0097/ 0000-0002-1825-0098 0000-0002-1694-233x https://evil.example/0000-0002-1825-0097 https://orcid.org.evil.example/0000-0002-1825-0097 junk');
  assert.deepEqual(result.entries.map(e => e.valid), [true, false, true, false, false, false]);
  assert.equal(result.entries[2].id, '0000-0002-1694-233X');
});

test('bulk limit counts unique entries and rejects oversized batches before import', () => {
  assert.equal(parseOrcidList('0000-0002-1825-0097 '.repeat(70)).overLimit, false);
  assert.equal(parseOrcidList(Array.from({ length: 50 }, (_, i) => `invalid-${i}`).join('\n')).overLimit, false);
  assert.equal(parseOrcidList(Array.from({ length: 51 }, (_, i) => `invalid-${i}`).join('\n')).overLimit, true);
  assert.deepEqual(parseOrcidList('  &#x20; '), { entries: [], overLimit: false });
});

test('group routes restore a selected group and tolerate malformed hashes', () => {
  assert.deepEqual(groupRoute('#groups/abc-123'), { view: 'groups', id: 'abc-123' });
  assert.deepEqual(groupRoute('#groups'), { view: 'groups', id: null });
  assert.deepEqual(groupRoute('#groups/%invalid'), { view: 'groups', id: null });
  assert.deepEqual(groupRoute('#people'), { view: 'people', id: null });
  assert.deepEqual(groupRoute('#nonsense'), { view: 'feed', id: null });
  assert.deepEqual(groupRoute('#contacts?add=0000-0002-1825-0097'), { view: 'contacts', id: null });
});

test('add links only pre-fill Contacts and are bounded', () => {
  assert.equal(addRoute('#contacts?add=0000-0002-1825-0097'), '0000-0002-1825-0097');
  assert.equal(addRoute('#contacts?add=https%3A%2F%2Forcid.org%2F0000-0002-1825-0097'), 'https://orcid.org/0000-0002-1825-0097');
  assert.equal(addRoute('#contacts'), null);
  assert.equal(addRoute('#contacts?add='), null);
  assert.equal(addRoute('#groups?add=0000-0002-1825-0097'), null);
  assert.equal(addRoute('#feed'), null);
  assert.equal(addRoute(`#contacts?add=${'9'.repeat(5000)}`).length, 2000);
});

test('the bookmarklet opens this app with the iD from an ORCID record address only', () => {
  const href = bookmarklet('https://example.test/network/');
  assert.ok(href.startsWith('javascript:'));
  const run = (hostname, pathname) => {
    const calls = { opened: [], alerts: [] };
    new Function('location', 'window', 'alert', decodeURIComponent(href.slice('javascript:'.length)))(
      { hostname, pathname }, { open: (url, name) => calls.opened.push([url, name]) }, text => calls.alerts.push(text));
    return calls;
  };
  assert.deepEqual(run('orcid.org', '/0000-0002-1694-233x').opened, [['https://example.test/network/#contacts?add=0000-0002-1694-233X', 'orcid-network']]);
  assert.deepEqual(run('www.orcid.org', '/0000-0002-1825-0097/print').opened, [['https://example.test/network/#contacts?add=0000-0002-1825-0097', 'orcid-network']]);
  for (const [hostname, pathname] of [['orcid.org', '/my-orcid'], ['orcid.org.evil.example', '/0000-0002-1825-0097'], ['example.org', '/0000-0002-1825-0097'], ['orcid.org', '/0000-0002-1825-00971']]) {
    const calls = run(hostname, pathname);
    assert.deepEqual(calls.opened, []);
    assert.equal(calls.alerts.length, 1);
  }
});

test('contexts are counted by tag, most used first', () => {
  const contacts = { a: { tags: ['FENS 2026', 'Neuro'] }, b: { tags: ['FENS 2026'] }, c: { tags: [] } };
  assert.deepEqual(allTags(contacts), [['FENS 2026', 2], ['Neuro', 1]]);
  assert.deepEqual(allTags(undefined), []);
});

test('open follow-ups are ordered by due date, undated last, and respect the filter', () => {
  const act = (id, status, due, created = '2026-01-01') => ({ id, status, due_date: due, created_at: created, title: id });
  const contacts = {
    a: { actions: [act('late', 'open', '2026-09-01'), act('finished', 'done', '2026-01-01'), act('none', 'open', '')] },
    b: { actions: [act('soon', 'open', '2026-08-01')] },
    c: { actions: [act('hidden', 'open', '2026-01-01')] }
  };
  assert.deepEqual(openActions(contacts, ['a', 'b']).map(x => x.action.id), ['soon', 'late', 'none']);
});

const circle = {
  people: [
    { id: 'a', name: 'Ada', following: true, keywords: ['Open Science', 'imaging'] },
    { id: 'b', name: 'Ben', following: true, keywords: ['open science '] },
    { id: 'c', name: 'Cy', following: false, keywords: ['imaging'] }
  ],
  works: [
    { id: 'w1', title: 'Shared paper', type: 'journal-article', date: '2024-05', people_ids: ['a', 'b'] },
    { id: 'w2', title: 'Ada tool', type: 'software', date: '2025', people_ids: ['a'] },
    { id: 'w3', title: 'Undated data', type: 'data-set', date: '', people_ids: ['b', 'c'] },
    { id: 'w4', title: 'Second shared', type: 'journal-article', date: '2023', people_ids: ['a', 'b', 'b'] }
  ],
  events: [
    { work_id: 'w2', people_ids: ['a'], observed_at: '2026-03-01T00:00:00Z' },
    { work_id: 'w3', people_ids: ['c'], observed_at: '2026-04-01T00:00:00Z' },
    { work_id: 'w1', people_ids: ['a', 'b'], observed_at: '2026-02-01T00:00:00Z' }
  ],
  groups: [{ id: 'g', name: 'Imaging club', member_ids: ['a', 'c'] }],
  contacts: { b: { tags: ['FENS'] }, c: { tags: ['fens'] } }
};
const ids = items => items.map(({ work }) => work.id);

test('feed scope is everyone followed, a group, or a case-insensitive tag', () => {
  assert.deepEqual([...scopeIds(circle)], ['a', 'b']);
  assert.deepEqual([...scopeIds(circle, 'group:g')], ['a', 'c']);
  assert.deepEqual([...scopeIds(circle, 'tag:FENS')].sort(), ['b', 'c']);
  assert.deepEqual([...scopeIds(circle, 'group:missing')], []);
});

test('feed views: newly observed, by publication date with undated last, and together', () => {
  assert.deepEqual(ids(feedItems(circle)), ['w2', 'w1']);
  assert.deepEqual(ids(feedItems(circle, { scope: 'group:g' })), ['w3', 'w2', 'w1']);
  assert.deepEqual(ids(feedItems(circle, { view: 'published' })), ['w2', 'w1', 'w4', 'w3']);
  assert.ok(feedItems(circle, { view: 'published' }).every(item => item.event === null));
  // Duplicate ids on one output do not count as two people.
  assert.deepEqual(ids(feedItems(circle, { view: 'together' })), ['w1', 'w4']);
  assert.deepEqual(ids(feedItems(circle, { view: 'together', scope: 'tag:fens' })), ['w3']);
});

test('feed filters by output type and by keywords people list', () => {
  assert.deepEqual(ids(feedItems(circle, { view: 'published', type: 'journal-article' })), ['w1', 'w4']);
  assert.deepEqual(ids(feedItems(circle, { view: 'published', topic: 'imaging' })), ['w2', 'w1', 'w4']);
  assert.deepEqual(ids(feedItems(circle, { view: 'published', scope: 'group:g', topic: 'imaging' })), ['w2', 'w1', 'w4', 'w3']);
  assert.deepEqual(ids(feedItems(circle, { topic: 'unknown' })), []);
});

test('topics merge case and spacing, most listed first, within the scope', () => {
  assert.deepEqual(feedTopics(circle).map(t => [t.key, t.label, t.people_ids]), [['open science', 'Open Science', ['a', 'b']], ['imaging', 'imaging', ['a']]]);
  assert.deepEqual(feedTopics(circle, 'group:g').map(t => [t.key, t.people_ids]), [['imaging', ['a', 'c']], ['open science', ['a']]]);
});

test('group suggestions carry evidence and skip what is already grouped, tagged or dismissed', () => {
  const all = groupSuggestions(circle);
  assert.deepEqual(all.map(s => s.id), ['keyword:open science', 'pair:a|b']);
  assert.deepEqual(all[1].works.map(w => w.id), ['w1', 'w4']);
  assert.deepEqual(groupSuggestions(circle, '', ['pair:a|b']).map(s => s.id), ['keyword:open science']);
  // Ada and Cy share a group; Ben and Cy share a tag (case-insensitive); an existing tag name is taken.
  const grouped = groupSuggestions(circle, 'group:g');
  assert.deepEqual(grouped.map(s => s.id), ['keyword:imaging']);
  assert.deepEqual(groupSuggestions(circle, 'tag:fens').map(s => s.id), []);
  const tagged = { ...circle, contacts: { ...circle.contacts, a: { tags: ['Open science'] } } };
  assert.deepEqual(groupSuggestions(tagged).map(s => s.id), ['pair:a|b']);
});

test('since last visit counts new outputs per group, and nothing on a first visit', () => {
  assert.equal(sinceLastVisit(circle, null), null);
  assert.deepEqual(sinceLastVisit(circle, '2026-02-15T00:00:00Z'), { total: 1, groups: [{ id: 'g', name: 'Imaging club', count: 1 }] });
  assert.deepEqual(sinceLastVisit(circle, '2026-05-01T00:00:00Z'), { total: 0, groups: [] });
});

test('tag keys match the server: collapsed whitespace and Python-style case folding', () => {
  assert.equal(foldKey('  Open \t Science '), 'open science');
  assert.equal(foldKey('Straße'), foldKey('STRASSE'));
  const spaced = { ...circle, people: circle.people.map(p => ({ ...p, keywords: p.id === 'b' ? ['open  science'] : p.keywords })), contacts: { ...circle.contacts, c: { tags: ['Open Science'] } } };
  // The keyword is already a tag (after normalisation), so it is not suggested again.
  assert.deepEqual(groupSuggestions(spaced).map(s => s.id), ['pair:a|b']);
});

test('outputs with very many people in scope do not produce pair suggestions', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, following: true, keywords: [] }));
  const big = { people: many, works: [{ id: 'consortium', people_ids: many.map(p => p.id) }], events: [], groups: [], contacts: {} };
  assert.deepEqual(groupSuggestions(big), []);
  const small = { ...big, works: [{ id: 'paper', people_ids: ['p0', 'p1', 'p2'] }] };
  assert.equal(groupSuggestions(small).length, 3);
});

test('since last visit follows the scope and filters the feed shows', () => {
  const since = '2026-02-15T00:00:00Z';
  assert.equal(sinceLastVisit(circle, since, { scope: 'group:g' }).total, 2);
  assert.equal(sinceLastVisit(circle, since, { scope: 'group:g', type: 'software' }).total, 1);
  assert.equal(sinceLastVisit(circle, since, { view: 'published' }).total, 1);
});

test('the previous visit survives reloads within a session and moves on afterwards', () => {
  assert.deepEqual(nextVisit(null, '2026-03-01T10:00:00Z'), { seen: '2026-03-01T10:00:00Z', previous: null });
  const first = { seen: '2026-03-01T10:00:00Z', previous: '2026-02-20T09:00:00Z' };
  assert.deepEqual(nextVisit(first, '2026-03-01T10:10:00Z'), { seen: '2026-03-01T10:10:00Z', previous: '2026-02-20T09:00:00Z' });
  assert.deepEqual(nextVisit(first, '2026-03-02T08:00:00Z'), { seen: '2026-03-02T08:00:00Z', previous: '2026-03-01T10:00:00Z' });
  assert.deepEqual(nextVisit({ seen: 'garbage', previous: 42 }, '2026-03-02T08:00:00Z'), { seen: '2026-03-02T08:00:00Z', previous: null });
});

test('removing someone lists only outputs nobody else here lists, their groups and contact record', () => {
  const data = {
    works: [
      { id: 'solo', people_ids: ['a'], saved: true }, { id: 'solo2', people_ids: ['a'], saved: false },
      { id: 'shared', people_ids: ['a', 'b'], saved: true }, { id: 'other', people_ids: ['b'], saved: true }
    ],
    groups: [{ name: 'Lab', member_ids: ['a', 'b'] }, { name: 'Other', member_ids: ['b'] }],
    contacts: { a: { tags: ['FENS'] } }
  };
  assert.deepEqual(removalImpact(data, 'a'), { outputs: 2, saved: 1, groups: ['Lab'], contact: true });
  assert.deepEqual(removalImpact(data, 'b'), { outputs: 1, saved: 1, groups: ['Lab', 'Other'], contact: false });
  assert.deepEqual(removalImpact({ works: [], groups: [] }, 'x'), { outputs: 0, saved: 0, groups: [], contact: false });
});

// ---- Guided first-run journeys and Explore handoffs (#56) ----

test('Explore handoffs: Save as contact and Add to group carry one valid iD, and nothing else does', () => {
  assert.deepEqual(handoffRoute('#contacts?save=0000-0002-1825-0097'), { intent: 'contact', raw: '0000-0002-1825-0097', id: '0000-0002-1825-0097', valid: true });
  assert.deepEqual(handoffRoute('#groups?add=https%3A%2F%2Forcid.org%2F0000-0002-1825-0097'), { intent: 'group', raw: 'https://orcid.org/0000-0002-1825-0097', id: '0000-0002-1825-0097', valid: true });
  // A bad check digit, two iDs or junk are shown as invalid, never imported.
  for (const bad of ['0000-0002-1825-0098', '0000-0002-1825-0097 0000-0001-5109-3700', '<script>']) {
    const route = handoffRoute(`#contacts?save=${encodeURIComponent(bad)}`);
    assert.equal(route.valid, false, bad);
    assert.equal(route.id, '');
  }
  assert.equal(handoffRoute(`#contacts?save=${'1'.repeat(5000)}`).raw.length, 200);
  // The bookmarklet's #contacts?add= keeps its own meaning (the "I just met people" list).
  for (const hash of ['#contacts?add=0000-0002-1825-0097', '#contacts', '#groups', '#groups/abc', '#people?save=0000-0002-1825-0097', '#contacts?save=']) assert.equal(handoffRoute(hash), null, hash);
  assert.equal(groupRoute('#groups?add=0000-0002-1825-0097').view, 'groups');
  assert.equal(groupRoute('#contacts?save=0000-0002-1825-0097').view, 'contacts');
});

const real = { id: '0000-0002-1825-0097', orcid: '0000-0002-1825-0097', demo: false };
const sample = { id: 'demo-ada', orcid: null, demo: true };

test('a handoff reuses the real record for an iD, never a sample person', () => {
  const data = { people: [sample, real], groups: [], contacts: {} };
  assert.equal(knownPerson(data, '0000-0002-1825-0097'), real);
  assert.equal(knownPerson(data, '0000-0001-5109-3700'), null);
});

test('the sample question counts your own network apart from the sample, and is skipped once loaded', () => {
  const empty = workspaceSummary({ people: [], groups: [], contacts: {} });
  assert.deepEqual(empty, { people: 0, sample_people: 0, contacts: 0, groups: 0, sample_groups: 0 });
  assert.match(sampleMessage(empty), /labelled sample[\s\S]*stored in this browser[\s\S]*labelled “Demo”[\s\S]*Remove sample data/);
  const mine = workspaceSummary({ people: [real], groups: [{ id: 'g1', member_ids: [real.id] }], contacts: { [real.id]: { tags: [], notes: [], actions: [] } } });
  assert.deepEqual(mine, { people: 1, sample_people: 0, contacts: 1, groups: 1, sample_groups: 0 });
  assert.match(sampleMessage(mine), /already holds your own network: 1 researcher, 1 contact and 1 group\. Nothing of yours is replaced or changed/);
  const mixed = workspaceSummary({ people: [real, sample], groups: [{ id: 'demo-open-science', member_ids: [sample.id] }], contacts: { 'demo-ada': { tags: [], notes: [], actions: [] } } });
  assert.deepEqual(mixed, { people: 1, sample_people: 1, contacts: 0, groups: 0, sample_groups: 1 });
  assert.equal(sampleMessage(mixed), null);
});

test('the Connect & Organize guide follows the workspace, step by step', () => {
  const contact = (over = {}) => ({ tags: [], met_on: '', notes: [], actions: [], ...over });
  const done = (data, pack) => guideSteps(data, pack).filter(s => s.done).map(s => s.id);
  assert.deepEqual(done({ people: [], groups: [], contacts: {} }), []);
  // The sample alone does not tick the group step: a contact has to be in a group.
  assert.deepEqual(done({ people: [sample], groups: [{ id: 'demo-open-science', member_ids: ['demo-ada'] }], contacts: {} }), ['person']);
  const full = {
    people: [sample], contacts: { 'demo-ada': contact({ tags: ['FENS 2026'], notes: [{ id: 'n' }], actions: [{ id: 'a' }] }) },
    groups: [{ id: 'g', member_ids: ['demo-ada'], selected_work_ids: ['w'] }],
  };
  assert.deepEqual(done(full), ['person', 'context', 'note', 'follow-up', 'group', 'curate']);
  assert.equal(done(full, true).length, 7);
  assert.ok(guideSteps(full).every(s => s.href.startsWith('#')));
});

test('Remove sample data keeps a sample group holding your own members or requests (review of #66)', () => {
  const people = [sample, real];
  const untouched = { id: 'demo-open-science', name: 'Open Science Circle · Demo', description: 'A fictional working group for trying the pilot.', member_ids: ['demo-ada'], requests: [] };
  assert.deepEqual(sampleRemoval({ people, groups: [untouched] }), { people: 1, deleted: 1, kept: [] });
  const withReal = { ...untouched, member_ids: ['demo-ada', real.id] };
  assert.deepEqual(sampleRemoval({ people, groups: [withReal] }), { people: 1, deleted: 0, kept: [{ id: 'demo-open-science', from: 'Open Science Circle · Demo', to: 'Open Science Circle' }] });
  const withRequest = { ...untouched, requests: [{ id: 'r' }] };
  assert.equal(sampleRemoval({ people, groups: [withRequest] }).kept.length, 1);
  // The user's own name or description is kept too, as in NetworkStore.remove_demo.
  assert.deepEqual(sampleRemoval({ people, groups: [{ ...untouched, name: 'Neuro consortium plan' }] }).kept.map(g => g.to), ['Neuro consortium plan']);
  assert.equal(sampleRemoval({ people, groups: [{ ...untouched, description: 'Notes for our lab' }] }).kept.length, 1);
});

test('Add to group never defaults to the sample group', () => {
  const sampleGroup = { id: 'demo-open-science', member_ids: [] };
  const mine = { id: 'g1', member_ids: [] };
  assert.equal(defaultHandoffGroup({ groups: [sampleGroup] }, null), '');
  assert.equal(defaultHandoffGroup({ groups: [sampleGroup, mine] }, null), 'g1');
  assert.equal(defaultHandoffGroup({ groups: [sampleGroup, { ...mine, member_ids: [real.id] }] }, real), '');
});
