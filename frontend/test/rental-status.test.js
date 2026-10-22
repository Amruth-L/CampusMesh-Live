import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRentalFilter, rentalProgress } from '../src/lib/rental-status.js';
test('active rentals and pending handovers stay visible in Active', () => {
  for (const status of ['RENTAL_ACTIVE', 'ACTIVE', 'MATCHING_COURIER', 'RETURN_IN_TRANSIT']) assert.equal(matchesRentalFilter(status, 'Active'), true);
  assert.equal(matchesRentalFilter('COMPLETED', 'Active'), false);
});
test('Requested includes booking and owner approval states', () => {
  for (const status of ['BOOKING_REQUESTED', 'OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED']) assert.equal(matchesRentalFilter(status, 'Requested'), true);
  assert.equal(matchesRentalFilter('RENTAL_ACTIVE', 'Requested'), false);
});

const progressStates = (rental) => Object.fromEntries(rentalProgress(rental).steps.map(step => [step.id, step.state]));

test('rental fee payment completes only Payment and waits for owner approval', () => {
  const rental = { status: 'RENTAL_PAYMENT_COMPLETED', payment_status: 'RENTAL_PAID', deposit_status: 'PENDING', owner_response: 'PENDING' };
  assert.deepEqual(progressStates(rental), { payment: 'complete', approval: 'current', deposit: 'pending', handover: 'pending', return: 'pending' });
  assert.equal(rentalProgress(rental).awaitingOwner, true);
  assert.match(rentalProgress(rental).message, /no item handover yet/);
});

test('owner approval and fully paid bookings do not complete physical handover', () => {
  assert.deepEqual(progressStates({ status: 'DEPOSIT_PENDING', payment_status: 'RENTAL_PAID', owner_response: 'ACCEPTED' }), {
    payment: 'complete', approval: 'complete', deposit: 'current', handover: 'pending', return: 'pending',
  });
  for (const status of ['QR_GENERATED', 'MATCHING_COURIER', 'COURIER_ASSIGNED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION']) {
    const steps = progressStates({ status, payment_status: 'FULLY_PAID', deposit_status: 'HELD' });
    assert.equal(steps.deposit, 'complete');
    assert.equal(steps.handover, 'current', status);
    assert.equal(steps.return, 'pending', status);
  }
});

test('confirmed delivery completes Handover and return remains pending until confirmed', () => {
  assert.deepEqual(progressStates({ status: 'RENTAL_ACTIVE', payment_status: 'FULLY_PAID' }), {
    payment: 'complete', approval: 'complete', deposit: 'complete', handover: 'complete', return: 'pending',
  });
  for (const status of ['RETURN_PENDING', 'RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED', 'RETURN_IN_TRANSIT']) {
    assert.equal(progressStates({ status }).handover, 'complete');
    assert.equal(progressStates({ status }).return, 'current');
  }
  assert.ok(Object.values(progressStates({ status: 'COMPLETED', completed_at: '2026-10-16T10:00:00Z' })).every(state => state === 'complete'));
});

test('unpaid, stopped, unknown or refunded bookings never invent physical handover', () => {
  assert.equal(progressStates({ status: 'BOOKING_PAYMENT_PENDING' }).payment, 'current');
  for (const status of ['CANCELLED', 'REJECTED', 'UNRECOGNIZED', 'DEPOSIT_REFUNDED']) {
    const result = rentalProgress({ status, payment_status: 'FULLY_PAID', deposit_status: 'REFUNDED' });
    assert.equal(result.steps.find(step => step.id === 'handover').state, 'pending', status);
    assert.equal(result.steps.find(step => step.id === 'return').state, 'pending', status);
    assert.equal(result.steps.some(step => step.state === 'current'), false, status);
  }
});
