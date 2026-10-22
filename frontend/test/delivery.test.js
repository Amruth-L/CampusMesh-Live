import test from 'node:test';
import assert from 'node:assert/strict';
import { toLocalDateTime } from '../src/lib/delivery.js';

test('delivery availability round-trips local time across offsets and midnight', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Kolkata', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      const date = new Date('2026-10-14T23:45:00Z');
      assert.equal(new Date(toLocalDateTime(date)).toISOString(), date.toISOString(), zone);
    }
    process.env.TZ = 'Asia/Kolkata';
    assert.equal(toLocalDateTime(new Date('2026-10-14T23:45:00Z')), '2026-10-15T05:15');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
