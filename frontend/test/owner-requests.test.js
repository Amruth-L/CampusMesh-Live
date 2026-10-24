import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerRequestGroup, ownerRequestStatus } from '../src/lib/owner-requests.js';

test('accepted direct UPI requests remain ongoing before payment, despite legacy HISTORY phase', () => {
  const request = { owner_response: 'ACCEPTED', payment_method: 'DIRECT_UPI', status: 'BOOKING_PAYMENT_PENDING', phase: 'HISTORY' };
  assert.equal(ownerRequestGroup(request), 'accepted');
  assert.equal(ownerRequestStatus(request), 'Accepted · rent payment pending');
});

test('acceptance moves a new request into accepted rentals', () => {
  const request = { status: 'OWNER_PENDING', actionable: true, owner_response: 'PENDING' };
  assert.equal(ownerRequestGroup(request), 'new');
  assert.equal(ownerRequestGroup({ ...request, status: 'DEPOSIT_PENDING', actionable: false, owner_response: 'ACCEPTED' }), 'accepted');
});

test('completed delivery does not mark an active rental completed', () => {
  const request = { status: 'RENTAL_ACTIVE', delivery: { status: 'COMPLETED', task_type: 'RENTAL_OUTBOUND' } };
  assert.equal(ownerRequestGroup(request), 'accepted');
  assert.equal(ownerRequestStatus(request), 'Rental active');
});

test('return approval, inspection, refund and remaining return settlement stay visible', () => {
  for (const request of [
    { status: 'RENTAL_ACTIVE', return_actionable: true },
    { status: 'RETURN_PENDING', delivery: { status: 'COMPLETED', task_type: 'RENTAL_RETURN' } },
    { status: 'RETURN_PENDING', deposit_status: 'REFUND_PENDING' },
    { status: 'RETURN_PENDING', deposit_status: 'REFUNDED' },
  ]) assert.equal(ownerRequestGroup(request), 'returns');
});

test('closed rentals go to history even when their last delivery was a return', () => {
  for (const status of ['COMPLETED', 'CANCELLED', 'DEPOSIT_REFUNDED', 'REJECTED', 'EXPIRED']) {
    assert.equal(ownerRequestGroup({ status, owner_response: 'ACCEPTED', delivery: { task_type: 'RENTAL_RETURN' } }), 'history');
  }
});
