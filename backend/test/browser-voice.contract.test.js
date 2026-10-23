/* global fetch */
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');

test(
  'browser voice uses real authenticated account context without saving transcripts',
  {
    skip: process.env.VOICE_E2E !== '1',
  },
  async () => {
    const pool = require('../src/config/database');
    const app = require('../src/app');
    const { agentSettings } = require('../src/modules/voice/deepgram.settings');
    const ids = [randomUUID(), randomUUID()];
    const listing = randomUUID(),
      rental = randomUUID();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const request = async (id, path, body, method = body ? 'POST' : 'GET') => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/voice${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, data: res.status === 204 ? null : await res.json() };
    };
    try {
      // Only run this contract in the disposable QA schema, never production.
      const { rows } = await pool.query('SELECT current_schema() AS schema');
      assert.match(rows[0].schema, /^qa_evidence_/);
      assert.ok(!process.env.OPENAI_API_KEY, 'Use no provider key in this no-charge fixture');
      for (const id of ids)
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          'QA browser voice',
          `qa-voice-${id}@dbit.co.in`,
        ]);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price) VALUES($1,$2,'QA private compass','Fixture','Electronics',20)",
        [listing, ids[0]],
      );
      await pool.query(
        "INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,rental_fee,booking_amount,status,payment_status) VALUES($1,$2,$3,$3,CURRENT_DATE,CURRENT_DATE+2,3,60,60,'RENTAL_ACTIVE','FULLY_PAID')",
        [rental, listing, ids[0]],
      );
      const capabilities = await request(ids[0], '/capabilities');
      assert.equal(capabilities.status, 200);
      assert.equal(capabilities.data.provider, 'deepgram');
      const mine = await agentSettings(ids[0], pool, 48000);
      const other = await agentSettings(ids[1], pool, 48000);
      assert.match(mine.agent.think.prompt, /QA private compass/);
      assert.doesNotMatch(other.agent.think.prompt, /QA private compass/);
      assert.ok(!mine.agent.think.prompt.includes(ids[0]));
      assert.equal(
        (await pool.query('SELECT COUNT(*)::int n FROM support_turns WHERE user_id=ANY($1::uuid[])', [ids]))
          .rows[0].n,
        0,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  },
);
