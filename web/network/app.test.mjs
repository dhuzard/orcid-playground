import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, dateLabel, feedEntries, groupWorks } from './app.js';

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
