import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDigest } from './digest.js';

const state = {
  people: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Ben' }],
  works: [
    { id: 'w1', title: 'Fresh', date: '2026-10', doi: '10.1/fresh' },
    { id: 'w2', title: 'Old news', date: '2020' },
    { id: 'w3', title: 'Joint', url: 'https://example.org/j' },
  ],
  events: [
    { work_id: 'w1', observed_at: '2026-10-29T10:00:00Z', people_ids: ['p1'] },
    { work_id: 'w2', observed_at: '2026-09-01T10:00:00Z', people_ids: ['p1'] },
    { work_id: 'w3', observed_at: '2026-10-30T10:00:00Z', people_ids: ['p1', 'p2'] },
    { work_id: 'missing', observed_at: '2026-10-30T10:00:00Z', people_ids: [] },
  ],
};

test('lists only outputs observed after the last visit, newest first', () => {
  const { count, markdown } = buildDigest(state, '2026-10-01T00:00:00Z');
  assert.equal(count, 2);
  assert.ok(markdown.indexOf('Joint') < markdown.indexOf('Fresh'));
  assert.ok(!markdown.includes('Old news'));
  assert.ok(markdown.includes('Ada, Ben') && markdown.includes('https://doi.org/10.1/fresh'));
});

test('without a previous visit every observed output is listed', () => {
  assert.equal(buildDigest(state, null).count, 3);
  assert.equal(buildDigest({}, null).count, 0);
});
