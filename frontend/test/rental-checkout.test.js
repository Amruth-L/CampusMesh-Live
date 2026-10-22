import test from 'node:test';
import assert from 'node:assert/strict';
import { canPayRental, rentalVerificationPayload, validateRentalOrder } from '../src/lib/rental-checkout.js';

const pending = { status: 'BOOKING_PAYMENT_PENDING', payment_status: 'PENDING' };
const order = { order_id: 'order_checkout123', razorpay_key: 'rzp_test_account123', amount: '635.00', currency: 'INR', simulated: false };
const receipt = { expected_order_id: order.order_id, gateway_order_id: order.order_id, gateway_payment_id: 'pay_captured123', gateway_signature: 'a'.repeat(64) };

test('only unpaid booking drafts can launch rental checkout', () => {
  assert.equal(canPayRental({ rental: pending }), true);
  assert.equal(canPayRental({ rental: { ...pending, status: 'BOOKING_REQUESTED' } }), true);
  for (const status of ['RENTAL_PAYMENT_COMPLETED', 'OWNER_PENDING', 'DEPOSIT_PENDING', 'CANCELLED', 'COMPLETED']) {
    assert.equal(canPayRental({ rental: { ...pending, status } }), false, status);
  }
  assert.equal(canPayRental({}), false);
});

test('recorded rental payment blocks another payment even with stale draft status', () => {
  for (const payment_status of ['PAID', 'RENTAL_PAID', 'FULLY_PAID']) {
    assert.equal(canPayRental({ rental: { ...pending, payment_status } }), false);
  }
  assert.equal(canPayRental({ rental: pending, payments: [{ payment_type: 'RENTAL', status: 'PAID' }] }), false);
  assert.equal(canPayRental({ rental: pending, payments: [{ payment_type: 'RENTAL', status: 'PENDING' }] }), true);
});

test('real checkout requires a server-issued order, key and positive INR amount', () => {
  assert.equal(validateRentalOrder(order), order);
  assert.throws(() => validateRentalOrder({ ...order, order_id: undefined }), /valid checkout/);
  assert.throws(() => validateRentalOrder({ ...order, razorpay_key: undefined }), /valid checkout/);
  assert.throws(() => validateRentalOrder({ ...order, razorpay_key: 'SIMULATION_MODE' }), /valid checkout/);
  for (const amount of [0, -5, 'not a number', Infinity]) {
    assert.throws(() => validateRentalOrder({ ...order, amount }), /amount/);
  }
  assert.throws(() => validateRentalOrder({ ...order, currency: 'USD' }), /amount/);
});

test('simulation never opens real checkout or invents a payment confirmation', () => {
  assert.throws(() => validateRentalOrder({ ...order, simulated: true, order_id: 'sim_order_123' }), /No payment was taken/);
  assert.throws(() => validateRentalOrder({ ...order, order_id: 'sim_order_123' }), /valid checkout/);
});

test('confirmation retries reuse the signed receipt for the same provider order', () => {
  const payload = rentalVerificationPayload('rental123', receipt);
  assert.deepEqual(payload, {
    booking_id: 'rental123',
    gateway_order_id: receipt.gateway_order_id,
    gateway_payment_id: receipt.gateway_payment_id,
    gateway_signature: receipt.gateway_signature,
  });
  assert.deepEqual(rentalVerificationPayload('rental123', receipt), payload);
});

test('incomplete, mismatched or fake receipts cannot verify a payment', () => {
  for (const invalid of [
    null,
    { ...receipt, gateway_order_id: 'order_other' },
    { ...receipt, gateway_payment_id: undefined },
    { ...receipt, gateway_signature: undefined },
    { ...receipt, gateway_signature: 'sim_sig' },
    { ...receipt, gateway_payment_id: 'sim_payment' },
  ]) {
    assert.throws(() => rentalVerificationPayload('rental123', invalid), /Do not pay again/);
  }
});
