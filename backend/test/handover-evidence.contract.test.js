const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('isolated courier eligibility and private handover evidence', { skip: process.env.EVIDENCE_E2E !== '1' }, async t => {
  const pool = require('../src/config/database');
  const scope = (await pool.query('SELECT current_schema() s,current_schemas(false) schemas')).rows[0];
  assert(scope.s.startsWith('qa_') && !scope.schemas.includes('public'));
  const { getMeshScore, requireEligibleCourier } = require('../src/modules/delivery/mesh-score');
  const { createEvidenceService } = require('../src/modules/delivery/handover-evidence');
  const { issueCredential, verifyCredential } = require('../src/modules/delivery/handover.service');
  const ids = Array.from({ length: 4 }, randomUUID);
  const [courier, owner, borrower, stranger] = ids;
  const stored = new Map();
  let failUpload = false;
  const photos = {
    optimize: async image => Buffer.from(image),
    put: async (id, stage, body) => {
      if (failUpload) throw Object.assign(new Error('Storage unavailable'), { status: 503 });
      const key = `${id}/${stage}/${randomUUID()}`;
      stored.set(key, body); return key;
    },
    remove: async key => stored.delete(key),
    url: async key => `https://fixture.invalid/${key}`,
  };
  const evidence = createEvidenceService({ db: pool, photos });
  let task;
  try {
    for (const id of ids) await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [id, 'Evidence fixture', `${id}@dbit.co.in`]);
    task = (await pool.query(`INSERT INTO delivery_requests(courier_id,seller_id,customer_id,pickup_location,status)
      VALUES($1,$2,$3,'Library','ARRIVED_AT_PICKUP') RETURNING id`, [courier, owner, borrower])).rows[0].id;
    await t.test('new partner score and authorization', async () => {
      assert.equal((await getMeshScore(courier)).eligible, true);
      await assert.rejects(evidence.upload(task, stranger, 'PICKUP', 'image'), e => e.status === 403);
      await assert.rejects(evidence.list(task, stranger), e => e.status === 403);
      await assert.rejects(evidence.upload(task, courier, 'DELIVERY', 'image'), e => e.status === 409);
      assert.equal(stored.size, 0);
    });
    await t.test('a valid OTP cannot bypass missing pickup photos', async () => {
      const credential = await issueCredential(task, 'PICKUP', owner);
      await assert.rejects(verifyCredential(task, courier, { stage: 'PICKUP', method: 'OTP', value: credential.otp }), e => e.status === 409);
      failUpload = true;
      await assert.rejects(evidence.upload(task, courier, 'PICKUP', 'image'), e => e.status === 503);
      assert.equal((await evidence.list(task, owner)).length, 0);
      failUpload = false;
      const results = await Promise.all([evidence.upload(task, courier, 'PICKUP', 'image'), evidence.upload(task, courier, 'PICKUP', 'image')]);
      assert.equal(results[0].id, results[1].id);
      assert.equal(stored.size, 1);
      await evidence.upload(task, courier, 'PICKUP', 'second image');
      await evidence.upload(task, courier, 'PICKUP', 'third image');
      await assert.rejects(evidence.upload(task, courier, 'PICKUP', 'fourth image'), e => e.status === 409);
      await verifyCredential(task, courier, { stage: 'PICKUP', method: 'OTP', value: credential.otp });
      await assert.rejects(evidence.upload(task, courier, 'PICKUP', 'late photo'), e => e.status === 409);
    });
    await t.test('drop-off requires its own photo and participant verification', async () => {
      await pool.query("UPDATE delivery_requests SET status='ARRIVED_AT_DESTINATION' WHERE id=$1", [task]);
      const credential = await issueCredential(task, 'DELIVERY', borrower);
      await assert.rejects(verifyCredential(task, courier, { stage: 'DELIVERY', method: 'OTP', value: credential.otp }), e => e.status === 409);
      await evidence.upload(task, courier, 'DELIVERY', 'arrival image');
      await verifyCredential(task, courier, { stage: 'DELIVERY', method: 'OTP', value: credential.otp });
      assert.equal((await evidence.list(task, borrower)).length, 4);
      assert.equal((await getMeshScore(courier)).completed, 1);
    });
    await t.test('return pickup and return receipt each require separate evidence', async () => {
      const ret = (await pool.query(`INSERT INTO delivery_requests(courier_id,seller_id,customer_id,pickup_location,status,task_type)
        VALUES($1,$2,$3,'Hostel','ARRIVED_AT_PICKUP','RENTAL_RETURN') RETURNING id`, [courier, borrower, owner])).rows[0].id;
      for (const [stage, holder] of [['RETURN_PICKUP', borrower], ['RETURN_RECEIVED', owner]]) {
        const credential = await issueCredential(ret, stage, holder);
        await assert.rejects(verifyCredential(ret, courier, { stage, method: 'OTP', value: credential.otp }), e => e.status === 409);
        await evidence.upload(ret, courier, stage, stage);
        await verifyCredential(ret, courier, { stage, method: 'OTP', value: credential.otp });
      }
    });
    await t.test('failures affect established eligibility; declines and cancellations do not', async () => {
      for (let i = 0; i < 3; i++) await pool.query("INSERT INTO delivery_requests(courier_id,pickup_location,status) VALUES($1,'Library','FAILED')", [courier]);
      const before = await getMeshScore(courier);
      assert.equal(before.eligible, false);
      await assert.rejects(requireEligibleCourier(courier), e => e.status === 403);
      await pool.query("INSERT INTO delivery_requests(courier_id,pickup_location,status) VALUES($1,'Library','CANCELLED')", [courier]);
      assert.equal((await getMeshScore(courier)).score, before.score);
    });
  } finally {
    await pool.query('DELETE FROM handover_photos WHERE uploaded_by=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM transaction_events WHERE actor_user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM handover_verifications WHERE verified_by_user_id=ANY($1::uuid[]) OR shown_to_user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM delivery_requests WHERE courier_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
  }
});
