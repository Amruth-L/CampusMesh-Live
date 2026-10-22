const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');

test('recipient onboarding is durable, private and retry-safe in an isolated schema', { skip: process.env.EVIDENCE_E2E !== '1', timeout: 120000 }, async (t) => {
  const db = require('../src/config/database');
  const scope = (await db.query('SELECT current_schema() s,current_schemas(false) scopes')).rows[0];
  assert(scope.s.startsWith('qa_') && !scope.scopes.includes('public'));
  const ids = Array.from({ length: 5 }, randomUUID);
  const config = () => ({ mode: 'live', configured: true });
  const input = { beneficiary_name: 'Fixture Student', account_number: '123456789012', account_number_confirmation: '123456789012', pan: 'AAAPA1234A', ifsc: 'SBIN0001234', phone: '+919876543210', confirm: true, tnc_accepted: true };
  const cache = new Map(), products = new Map();
  let requests = 0, creates = 0, loseResponse = false, rejectInput = false;
  const submit = async (payload, key) => {
    requests++;
    if (rejectInput) throw Object.assign(new Error('Rejected fixture'), { status: 400, definitiveRejection: true });
    if (!cache.has(key)) {
      creates++;
      const remote = { id: 'acc_' + randomUUID().replaceAll('-', ''), type: 'route', email: payload.email, reference_id: payload.reference_id,
        product_config: { id: 'acc_prd_' + randomUUID().replaceAll('-', ''), product_name: 'route', activation_status: 'activated',
          active_configuration: { settlement_accounts: [{ method: 'bank_account', active: true, verification_status: 'pending', bank_account: { account_number: 'XXXXXXXX12', beneficiary_name: payload.legal_business_name, is_default: true } }] } } };
      remote.product_config.merchant_id = remote.id;
      cache.set(key, remote); products.set(remote.product_config.id, remote.product_config);
    }
    if (loseResponse) throw Error('Lost response');
    return cache.get(key);
  };
  const fingerprint = (payload) => createHmac('sha256', 'fixture-private-secret').update(JSON.stringify(payload)).digest('hex');
  const gateway = { products: { fetch: async (_account, id) => products.get(id) } };
  const accounts = require('../src/modules/payouts/payout-accounts').createAccountService({ db, config, gateway, submit, fingerprint });
  try {
    for (const id of ids) await db.query("INSERT INTO users(id,name,email,email_verified) VALUES($1,'Fixture recipient',$2,TRUE)", [id, id + '@dbit.co.in']);
    await t.test('previous setup requests now reach bank verification without becoming active early', async () => {
      await accounts.request(ids[0]);
      assert.equal((await accounts.onboard(ids[0], input)).status, 'PENDING');
      assert.equal(creates, 1);
      assert.equal((await accounts.refresh(ids[0])).status, 'PENDING');
      await assert.rejects(accounts.assertRecipients([ids[0]]), (error) => error.status === 409);
      const row = await accounts.get(ids[0]);
      assert(!JSON.stringify(row).includes(input.account_number));
      assert(!JSON.stringify(row).includes(input.pan));
      products.get(row.product_id).active_configuration.settlement_accounts[0].verification_status = 'verified';
      const safe = await accounts.refresh(ids[0]);
      assert.equal(safe.status, 'ACTIVE'); assert.equal(safe.bankLast4, '12');
      assert.equal(safe.canOnboard, false); assert.equal(safe.canRefresh, true);
      assert(!JSON.stringify(safe).includes('onboarding_hash'));
      await accounts.assertRecipients([ids[0]]);
    });
    await t.test('a lost response reuses the exact provider request; changed data cannot create a second recipient', async () => {
      loseResponse = true;
      await assert.rejects(accounts.onboard(ids[1], input));
      const before = creates;
      const row = await accounts.get(ids[1]);
      await assert.rejects(accounts.onboard(ids[1], { ...input, beneficiary_name: 'Changed Student' }), (error) => error.status === 409);
      loseResponse = false;
      await accounts.onboard(ids[1], input);
      assert.equal(creates, before);
      assert.equal((await accounts.get(ids[1])).onboarding_key, row.onboarding_key);
    });
    await t.test('parallel submissions serialize with one provider recipient', async () => {
      const before = creates;
      const results = await Promise.allSettled([accounts.onboard(ids[2], input), accounts.onboard(ids[2], input)]);
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(creates, before + 1);
    });
    await t.test('definitive rejection permits corrected input while consent failures never reach provider', async () => {
      const before = requests;
      await assert.rejects(accounts.onboard(ids[3], { ...input, tnc_accepted: false }));
      assert.equal(requests, before);
      rejectInput = true;
      await assert.rejects(accounts.onboard(ids[3], input));
      assert.equal((await accounts.get(ids[3])).onboarding_key, null);
      rejectInput = false;
      await accounts.onboard(ids[3], { ...input, beneficiary_name: 'Corrected Student' });
    });
    await t.test('disabled provider and unverified user cannot submit', async () => {
      const before = requests;
      await db.query('UPDATE users SET email_verified=FALSE WHERE id=$1', [ids[4]]);
      await assert.rejects(accounts.onboard(ids[4], input), (error) => error.status === 403);
      const disabled = require('../src/modules/payouts/payout-accounts').createAccountService({ db, config: () => ({ configured: false, message: 'Disabled' }), submit });
      await assert.rejects(disabled.onboard(ids[4], input), (error) => error.status === 503);
      assert.equal(requests, before);
    });
  } finally { await db.end(); }
});
