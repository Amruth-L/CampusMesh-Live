import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalPaymentTiming } from '../src/lib/rental-payment-timing.js';

test('direct UPI quotes make the post-acceptance amount primary while keeping today at zero', () => {
  assert.deepEqual(
    rentalPaymentTiming({
      paymentMethod: 'DIRECT_UPI',
      rentalFee: 60,
      securityDeposit: 200,
      payNow: 0,
      payAfterAcceptance: 260,
      payAfterHandover: 10,
    }),
    {
      direct: true,
      payNow: 0,
      dueAfterAcceptance: 260,
      dueAfterHandover: 10,
      primaryLabel: 'Due after acceptance',
      primaryAmount: 260,
    },
  );
});

test('gateway quotes keep the immediate amount primary', () => {
  const result = rentalPaymentTiming({ paymentMethod: 'RAZORPAY', totalAmount: 63, payNow: 63 });
  assert.equal(result.primaryLabel, 'Pay now');
  assert.equal(result.primaryAmount, 63);
  assert.equal(result.dueAfterHandover, 0);
});
