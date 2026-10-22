const test = require('node:test');
const assert = require('node:assert/strict');
const { recipientVerification } = require('../src/modules/payouts/payout-verification');
const { createRecipient, onboardingPayload } = require('../src/modules/payouts/route-onboarding');

const product = (verification = 'pending') => ({ activation_status: 'activated', active_configuration: {
  settlement_accounts: [{ method: 'bank_account', active: true, verification_status: verification,
    bank_account: { account_number: 'XXXXXXXX56', beneficiary_name: 'Fixture Student', is_default: true } }],
} });
test('activated Route product is not a verified bank; pending, failed, missing and non-default destinations fail closed', () => {
  assert.equal(recipientVerification(product(), true).status, 'PENDING');
  assert.equal(recipientVerification(product('failed'), true).status, 'NEEDS_ATTENTION');
  assert.equal(recipientVerification({ activation_status: 'activated' }, true).status, 'PENDING');
  const inactive = product('verified'); inactive.active_configuration.settlement_accounts[0].active = false;
  assert.equal(recipientVerification(inactive, true).status, 'PENDING');
  const nonDefault = product('verified'); nonDefault.active_configuration.settlement_accounts[0].bank_account.is_default = false;
  assert.equal(recipientVerification(nonDefault, true).status, 'PENDING');
  assert.deepEqual(recipientVerification(product('verified'), true), { status: 'ACTIVE', bankLast4: '56', beneficiaryName: 'Fixture Student' });
});
test('legacy product requires actual bank configuration and is never a fallback for composite onboarding', () => {
  const legacy = { activation_status: 'activated', active_configuration: { settlements: { account_number: '1234567890', beneficiary_name: 'Fixture' } } };
  assert.equal(recipientVerification(legacy).status, 'ACTIVE');
  assert.equal(recipientVerification(legacy, true).status, 'PENDING');
  assert.equal(recipientVerification({ activation_status: 'activated' }).status, 'PENDING');
});
test('onboarding transport forwards the persisted idempotency key and never leaks provider error details', async () => {
  let sent;
  const options = { env: { RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'fixture' }, fetchImpl: async (url, init) => {
    sent = { url, init }; return { ok: true, json: async () => ({ id: 'acc_fixture' }) };
  } };
  await createRecipient({ type: 'route' }, 'fixed-attempt-key', options);
  assert.equal(sent.url, 'https://api.razorpay.com/v2/accounts');
  assert.equal(sent.init.headers['Idempotency-Key'], 'fixed-attempt-key');
  assert.equal(sent.init.method, 'POST');
  options.fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { description: 'private account 123456789012 and PAN AAAPA1234A' } }) });
  await assert.rejects(createRecipient({}, 'fixed-attempt-key', options), (error) => {
    assert.equal(error.definitiveRejection, true);
    assert(!JSON.stringify(error).includes('123456789012'));
    assert(!error.message.includes('AAAPA1234A'));
    return true;
  });
});
test('onboarding uses the authenticated email and validates consent, matching bank numbers and individual PAN', () => {
  const user = { id: 'fixture', email: 'fixture@dbit.co.in', email_verified: true };
  const input = { beneficiary_name: 'Fixture Student', account_number: '123456789012', account_number_confirmation: '123456789012', pan: 'AAAPA1234A', ifsc: 'sbin0001234', phone: '9876543210', confirm: true, tnc_accepted: true, email: 'attacker@example.invalid' };
  assert.equal(onboardingPayload(user, 'live', input).email, user.email);
  assert.equal(onboardingPayload(user, 'live', input).phone, '+919876543210');
  for (const bad of [{ confirm: false }, { tnc_accepted: false }, { account_number_confirmation: '123456789013' }, { pan: 'AAACA1234A' }, { ifsc: 'invalid' }]) {
    assert.throws(() => onboardingPayload(user, 'live', { ...input, ...bad }), (error) => error.status === 400);
  }
  assert.throws(() => onboardingPayload({ ...user, email_verified: false }, 'live', input), (error) => error.status === 403);
});
