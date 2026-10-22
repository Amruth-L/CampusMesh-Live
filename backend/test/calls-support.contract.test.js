/* global fetch */
const test = require('node:test');
const { URLSearchParams } = require('node:url');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Opt-in, disposable DB records. Provider calls are always injected fakes.
test(
  'call consent, deduplication, concurrency, cancellation and private support',
  {
    skip: process.env.INTELLIGENCE_E2E !== '1',
  },
  async () => {
    require('dotenv').config({ quiet: true });
    const pool = require('../src/config/database');
    const jwt = require('jsonwebtoken');
    const { createCallService, localTime } = require('../src/modules/calls/call.service');
    const { accountContext, answer } = require('../src/modules/support/support.service');
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const [owner, borrower, stranger] = ids;
    const listing = randomUUID(),
      rental = randomUUID();
    const today = localTime().day;
    const clock = () => new Date(today + 'T06:00:00Z'); // 11:30 IST
    const settings = () => ({
      live: true,
      enabled: true,
      sid: 'AC' + '1'.repeat(32),
      token: 'fixture-only',
      from: '+15005550006',
      base: 'https://example.invalid',
    });
    let sends = 0,
      webhookServer;
    const envNames = [
      'CALLS_MODE',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_FROM_NUMBER',
      'PUBLIC_API_URL',
    ];
    const oldEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]]));
    const fakeProvider = () => ({
      calls: {
        create: async () => {
          sends++;
          return { sid: 'CA' + '2'.repeat(32) };
        },
      },
    });
    const service = createCallService({
      db: pool,
      settings,
      clock,
      providerFactory: fakeProvider,
      recommend: async () => [],
    });
    const request = async (user, path, body, method = body ? 'POST' : 'GET') => {
      const r = await fetch('http://localhost:3003/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + jwt.sign({ id: user }, process.env.JWT_SECRET, { expiresIn: '10m' }),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    };
    try {
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int n FROM automated_calls WHERE status IN ('QUEUED','DISPATCHING')",
          )
        ).rows[0].n,
        0,
        'Use an idle call queue for the fixture test',
      );
      assert.equal(
        (
          await pool.query(
            'SELECT COUNT(*)::int n FROM call_preferences WHERE phone_verified_at IS NOT NULL AND (reminders_enabled OR recommendations_enabled)',
          )
        ).rows[0].n,
        0,
        'Do not enqueue real user calls',
      );
      for (const id of ids)
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          'QA Intelligence',
          `qa-intelligence-${id}@dbit.co.in`,
        ]);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price) VALUES($1,$2,'Private QA calculator','Fixture','Electronics',25)",
        [listing, owner],
      );
      await pool.query(
        "INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,rental_fee,booking_amount,status,payment_status) VALUES($1,$2,$3,$4,$5::date-1,$5,2,50,50,'RENTAL_ACTIVE','FULLY_PAID')",
        [rental, listing, borrower, owner, today],
      );
      assert.equal((await service.preferences(borrower)).reminders_enabled, false);
      await service.updatePreferences(borrower, {
        phone_e164: '+15005550009',
        reminders_enabled: true,
        recommendations_enabled: false,
      });
      assert.equal((await service.enqueue()).queued, 0, 'Unverified phones never enqueue');
      await pool.query('UPDATE call_preferences SET phone_verified_at=NOW() WHERE user_id=$1', [borrower]);
      assert.equal((await service.enqueue()).queued, 1);
      assert.equal((await service.enqueue()).queued, 0, 'Repeated ticks are deduplicated');
      let job = (await pool.query('SELECT * FROM automated_calls WHERE user_id=$1', [borrower])).rows[0];
      await pool.query(
        "INSERT INTO automated_calls(user_id,rental_id,kind,dedupe_key,payload,script) SELECT user_id,rental_id,kind,dedupe_key||':duplicate-fixture',payload,script FROM automated_calls WHERE id=$1",
        [job.id],
      );
      await Promise.all([service.dispatchOne(), service.dispatchOne()]);
      assert.equal(sends, 1, 'Concurrent workers respect the per-user cap');
      job = (await pool.query("SELECT * FROM automated_calls WHERE user_id=$1 AND status='SENT'", [borrower]))
        .rows[0];
      // Exercise the real signature-verifying routes locally; app.js starts no worker.
      Object.assign(process.env, {
        CALLS_MODE: 'live',
        TWILIO_ACCOUNT_SID: settings().sid,
        TWILIO_AUTH_TOKEN: settings().token,
        TWILIO_FROM_NUMBER: settings().from,
        PUBLIC_API_URL: settings().base,
      });
      const app = require('../src/app');
      webhookServer = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => webhookServer.once('listening', resolve));
      const twilio = require('twilio');
      const webhook = async (kind, body, signed = true) => {
        const path = `/api/calls/webhooks/${job.id}/${kind}`;
        return fetch(`http://127.0.0.1:${webhookServer.address().port}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Twilio-Signature': signed
              ? twilio.getExpectedTwilioSignature(settings().token, settings().base + path, body)
              : 'invalid',
          },
          body: new URLSearchParams(body),
        });
      };
      assert.equal((await webhook('voice', { CallSid: job.provider_sid }, false)).status, 403);
      const signedVoice = await webhook('voice', { CallSid: job.provider_sid });
      assert.equal(signedVoice.status, 200);
      assert.match(await signedVoice.text(), /Press 1/);
      const intro = await service.voice(job.id, { CallSid: job.provider_sid }, 'voice');
      assert.match(intro, /Press 1/);
      assert.doesNotMatch(intro, /Private QA calculator/, 'Voicemail gets no rental details');
      const script = await service.voice(job.id, { CallSid: job.provider_sid, Digits: '1' }, 'answer');
      assert.match(script, /Private QA calculator/);
      await service.voice(job.id, { CallSid: job.provider_sid, Digits: '9' }, 'answer');
      assert.equal(
        (await webhook('status', { CallSid: job.provider_sid, CallStatus: 'completed', SequenceNumber: '3' }))
          .status,
        204,
      );
      await webhook('status', { CallSid: job.provider_sid, CallStatus: 'ringing', SequenceNumber: '1' });
      assert.equal(
        (await pool.query('SELECT status FROM automated_calls WHERE id=$1', [job.id])).rows[0].status,
        'COMPLETED',
        'Delayed callbacks cannot regress final status',
      );

      assert.equal((await service.preferences(borrower)).reminders_enabled, false);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int n FROM automated_calls WHERE user_id=$1 AND status='QUEUED'",
            [borrower],
          )
        ).rows[0].n,
        0,
      );
      await service.updatePreferences(borrower, {
        phone_e164: '+15005550008',
        reminders_enabled: true,
        recommendations_enabled: false,
      });
      assert.equal(
        (await service.preferences(borrower)).phone_verified_at,
        null,
        'Changed number must be verified again',
      );
      await pool.query('UPDATE call_preferences SET phone_verified_at=NOW() WHERE user_id=$1', [borrower]);
      await pool.query('UPDATE rentals SET end_date=end_date+1 WHERE id=$1', [rental]);
      await service.enqueue();
      await pool.query("UPDATE rentals SET status='COMPLETED',completed_at=NOW() WHERE id=$1", [rental]);
      assert.equal((await service.dispatchOne()).cancelled, true, 'Returned rental cancels queued reminders');
      assert.equal(sends, 1);
      const foreign = await accountContext(stranger);
      assert.equal(foreign.rentals.length, 0);
      assert.equal((await accountContext(borrower)).rentals[0].id, rental);
      const reply = await answer(stranger, 'What is my rental status?', { allowAI: false });
      assert.doesNotMatch(reply.answer, /Private QA calculator/);
      assert.equal((await request(stranger, `/intelligence/rentals/${rental}/trust`)).status, 404);
      assert.equal((await request(owner, `/intelligence/rentals/${rental}/trust`)).status, 200);
      const overview = await request(borrower, '/intelligence/overview');
      assert.equal(overview.status, 200);
      assert.equal(overview.data.market.categories.length, 6);
      assert.equal(
        overview.data.market.categories.reduce((n, c) => n + c.daily.reduce((a, b) => a + b, 0), 0),
        0,
        'QA rentals excluded from demand',
      );
      assert.equal((await request(stranger, '/calls')).data.calls.length, 0);
      assert.equal((await request(borrower, '/calls/preview')).data.status.mode, 'preview');
      assert.equal((await request(borrower, '/calls/verify-phone', {})).status, 503);
      const badWebhook = await fetch(`http://localhost:3003/api/calls/webhooks/${job.id}/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'CallSid=CA' + '2'.repeat(32),
      });
      assert.equal(badWebhook.status, 403);
      const ticket = await request(borrower, '/support/tickets', {
        subject: 'QA request',
        details: 'A'.repeat(2500),
      });
      assert.equal(ticket.status, 201);
      assert.equal(
        (await pool.query('SELECT length(details)::int n FROM support_tickets WHERE id=$1', [ticket.data.id]))
          .rows[0].n,
        2500,
      );
      assert.equal((await request(stranger, '/support')).data.tickets.length, 0);
      console.log(
        'PASS call consent, verification, concurrent cap, opt-out, return cancellation, private support and API contracts; no external calls',
      );
    } finally {
      if (webhookServer) await new Promise((resolve) => webhookServer.close(resolve));
      for (const key of envNames) {
        if (oldEnv[key] === undefined) delete process.env[key];
        else process.env[key] = oldEnv[key];
      }
      await pool.query('DELETE FROM rentals WHERE id=$1', [rental]);
      await pool.query('DELETE FROM listings WHERE id=$1', [listing]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await pool.end();
    }
  },
);
