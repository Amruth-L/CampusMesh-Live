import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPayments, paymentAction, paymentNeedsAction } from '../src/lib/payment-actions.js';

test('unpaid requests offer Pay only to the payer', () => {
  const p = { payer_id: 'borrower', status: 'PENDING' };
  assert.equal(paymentAction(p, 'borrower').kind, 'pay');
  assert.equal(paymentAction(p, 'owner').kind, 'waiting');
  assert.equal(paymentNeedsAction(p, 'owner'), false);
});

test('reported transfers ask the recipient to confirm, never the sender to pay twice', () => {
  const p = { payer_id: 'borrower', status: 'REPORTED' };
  assert.equal(paymentAction(p, 'owner').kind, 'confirm');
  assert.equal(paymentAction(p, 'borrower').kind, 'waiting');
});

test('deposit refunds reverse payer and recipient roles', () => {
  const p = { kind: 'DEPOSIT_REFUND', payer_id: 'owner', status: 'PENDING' };
  assert.equal(paymentAction(p, 'owner').kind, 'pay');
  assert.equal(paymentAction({ ...p, status: 'REPORTED' }, 'borrower').kind, 'confirm');
});

test('confirmed receipts go to history and actionable payments precede waiting entries', () => {
  const entries = [
    { id: 'old', payer_id: 'me', status: 'CONFIRMED' },
    { id: 'waiting', payer_id: 'me', status: 'REPORTED' },
    { id: 'delivery', payer_id: 'me', status: 'PENDING' },
    { id: 'refund', payer_id: 'other', status: 'REPORTED' },
  ];
  const grouped = groupPayments(entries, 'me');
  assert.deepEqual(grouped.active.map(p => p.id), ['delivery', 'refund', 'waiting']);
  assert.deepEqual(grouped.history.map(p => p.id), ['old']);
  assert.equal(entries[0].id, 'old');
});

test('disputed payments never offer another payment action', () => {
  const p = { payer_id: 'me', status: 'DISPUTED' };
  assert.equal(paymentAction(p, 'me').kind, 'dispute');
  assert.equal(paymentNeedsAction(p, 'me'), true);
  assert.equal(paymentAction(p, 'recipient').kind, 'confirm');
});
