const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreCandidate } = require('../src/modules/delivery/matching.service');

const future = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

const matchingRoute = (availableUntil = future(60)) => ({
  origin: 'library',
  destination: 'hostel',
  max_detour_meters: 250,
  available_until: availableUntil,
});

const delivery = { pickup: 'library', destination: 'hostel' };

test('scores a courier route that covers the delivery', () => {
  const result = scoreCandidate(matchingRoute(), delivery, 100);
  assert.ok(result);
  assert.equal(result.breakdown.routeOverlap, 45);
  assert.ok(result.score > 0);
});

test('rejects a route with no meaningful delivery overlap', () => {
  const result = scoreCandidate({
    origin: 'entrance',
    destination: 'cafeteria',
    max_detour_meters: 250,
    available_until: future(60),
  }, delivery, 100);
  assert.equal(result, null);
});

test('rejects a courier route that expires before handover completion', () => {
  const result = scoreCandidate(matchingRoute(-1), delivery, 100);
  assert.equal(result, null);
});
