const test = require('node:test');
const assert = require('node:assert/strict');
const { localTime, inCallWindow, reminderStage } = require('../src/modules/calls/call-policy');

test('call window opens at 9 am and closes at 7 pm in India', () => {
  assert.equal(inCallWindow(new Date('2026-10-16T03:29:59Z')), false);
  assert.equal(inCallWindow(new Date('2026-10-16T03:30:00Z')), true);
  assert.equal(inCallWindow(new Date('2026-10-16T13:29:59Z')), true);
  assert.equal(inCallWindow(new Date('2026-10-16T13:30:00Z')), false);
  assert.equal(localTime(new Date('2026-10-16T19:00:00Z')).day, '2026-10-17');
});
test('due stages use calendar days across months and years', () => {
  assert.equal(reminderStage('2027-01-02', '2026-12-29'), 'in 4 days');
  assert.equal(reminderStage('2027-01-01', '2026-12-31'), 'tomorrow');
  assert.equal(reminderStage('2026-10-16', '2026-10-16'), 'today');
  assert.equal(reminderStage('2026-10-15', '2026-10-16'), 'overdue');
  assert.equal(reminderStage('2026-10-14', '2026-10-16'), null);
  assert.equal(reminderStage('2026-10-18', '2026-10-16'), null);
});
