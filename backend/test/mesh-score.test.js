const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMeshScore } = require('../src/modules/delivery/mesh-score');
const { currentPhotoStage } = require('../src/modules/delivery/handover-evidence');

test('new verified couriers are eligible without an invented perfect score', () => {
  const result = evaluateMeshScore({ email_verified: true });
  assert.equal(result.score, null);
  assert.equal(result.eligible, true);
  assert.equal(result.provisional, true);
  assert.equal(evaluateMeshScore({ email_verified: false, completed: 20 }).eligible, false);
});
test('established delivery history gates new assignments at the documented threshold', () => {
  assert.equal(evaluateMeshScore({ email_verified: true, completed: 4, failed: 1 }).eligible, true);
  assert.equal(evaluateMeshScore({ email_verified: true, completed: 2, failed: 3 }).eligible, false);
  assert.equal(evaluateMeshScore({ email_verified: true, completed: 3, failed: 3 }).score, 50);
  assert.equal(evaluateMeshScore({ email_verified: true, completed: 1, failed: 3 }).provisional, true);
});
test('condition evidence follows outbound and return custody stages', () => {
  assert.equal(currentPhotoStage({ status: 'IN_TRANSIT' }), null);
  assert.equal(currentPhotoStage({ status: 'ARRIVED_AT_PICKUP', task_type: 'RENTAL_RETURN' }), 'RETURN_PICKUP');
  assert.equal(currentPhotoStage({ status: 'RETURN_IN_TRANSIT', task_type: 'RENTAL_RETURN' }), 'RETURN_RECEIVED');
  assert.equal(currentPhotoStage({ status: 'ARRIVED_AT_DESTINATION' }), 'DELIVERY');
  assert.equal(currentPhotoStage({ status: 'COMPLETED' }), null);
});
