import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, dateLabel, feedEntries, groupWorks, parseOrcidList, groupRoute } from './app.js';

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
});
