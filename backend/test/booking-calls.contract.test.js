const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
test(
  'booking calls deduplicate, preserve preferences, expire, and recheck four-day reminders',
  { skip: process.env.BOOKING_CALLS_E2E !== '1' },
  async () => {
    require('dotenv').config({ quiet: true });
    const pool = require('../src/config/database');
    const { createCallService, localTime } = require('../src/modules/calls/call.service');
    const ids = [randomUUID(), randomUUID()],
      [owner, user] = ids,
      listing = randomUUID(),
      rental = randomUUID();
    const today = localTime().day;
    let sends = 0;
    const scoped = (target) => (sql, args) => {
      if (sql.startsWith('SELECT * FROM call_preferences WHERE phone_verified_at')) {
        sql += ' AND user_id=$1';
        args = [user];
      }
      if (sql.startsWith("SELECT * FROM automated_calls WHERE status='QUEUED'")) {
        sql = sql.replace('ORDER BY', 'AND user_id=$1 ORDER BY');
        args = [user];
      }
      if (sql.startsWith("UPDATE automated_calls SET status='UNKNOWN'")) {
        sql += ' AND user_id=$1';
        args = [user];
      }
      return target.query(sql, args);
    };
    const db = {
      query: scoped(pool),
      connect: async () => {
        const c = await pool.connect();
        return { query: scoped(c), release: () => c.release() };
      },
    };
    const service = createCallService({
      db,
      clock: () => new Date(today + 'T06:00:00Z'),
      settings: () => ({
        live: true,
        trial: true,
        enabled: true,
        sid: 'AC' + '1'.repeat(32),
        token: 'fixture',
        from: '+15005550006',
        base: 'https://example.invalid',
      }),
      recommend: async () => [],
      providerFactory: () => ({
        calls: {
          create: async (request) => {
            assert.deepEqual(Object.keys(request).sort(), ['from','statusCallback','to','url']);
            assert.match(request.url, /\/voice\?expires=\d+&signature=[a-f0-9]{64}$/);
            sends++;
            return { sid: 'CA' + '2'.repeat(32) };
          },
        },
      }),
    });
    const prefs = {
      phone_e164: '+15005550009',
      welcome_enabled: false,
      booking_enabled: true,
      reminders_enabled: true,
      recommendations_enabled: false,
    };
    try {
      for (const id of ids)
        await pool.query('INSERT INTO users(id,name,email,email_verified) VALUES($1,$2,$3,TRUE)', [
          id,
          'QA booking',
          `qa-booking-${id}@dbit.co.in`,
        ]);
      await pool.query(
        "INSERT INTO listings(id,owner_id,title,description,category,rent_price) VALUES($1,$2,'QA calculator','fixture','Electronics',25)",
        [listing, owner],
      );
      await pool.query(
        "INSERT INTO rentals(id,listing_id,borrower_id,owner_id,start_date,end_date,rental_days,rental_fee,booking_amount,status,payment_status) VALUES($1,$2,$3,$4,$5,$5::date+4,5,125,125,'QR_GENERATED','PENDING')",
        [rental, listing, user, owner, today],
      );
      await service.updatePreferences(user, prefs);
      await pool.query('UPDATE call_preferences SET phone_verified_at=NOW() WHERE user_id=$1', [user]);
      assert.equal((await service.enqueue()).queued, 0, 'Unpaid rentals do not call');
      await pool.query(
        "UPDATE rentals SET payment_status='FULLY_PAID',booking_confirmed_at=NOW() WHERE id=$1",
        [rental],
      );
      assert.equal((await service.enqueue()).queued, 1);
      assert.equal((await service.enqueue()).queued, 0);
      await service.updatePreferences(user, prefs);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::int n FROM automated_calls WHERE user_id=$1 AND status='QUEUED'",
            [user],
          )
        ).rows[0].n,
        1,
        'Saving unchanged preferences keeps confirmation',
      );
      await Promise.all([service.dispatchOne(), service.dispatchOne()]);
      assert.equal(sends, 1);
      let job = (await pool.query('SELECT * FROM automated_calls WHERE user_id=$1', [user])).rows[0];
      assert.match(job.script, /Thank you for booking/);
      assert.match(
        await service.voice(job.id, { CallSid: job.provider_sid }, 'voice'),
        /Thank you for placing an order/,
      );
      assert.doesNotMatch(
        await service.voice(job.id, { CallSid: job.provider_sid }, 'voice'),
        /QA calculator/,
      );
      await pool.query("UPDATE rentals SET status='CANCELLED' WHERE id=$1", [rental]);
      assert.equal(await service.eligible(job, await service.preferences(user), db), false);
      await pool.query(
        "UPDATE rentals SET status='RENTAL_ACTIVE',booking_confirmed_at=NOW()-INTERVAL '2 days' WHERE id=$1",
        [rental],
      );
      assert.equal(
        await service.eligible(job, await service.preferences(user), db),
        false,
        'Old confirmations expire',
      );
      assert.equal((await service.enqueue()).queued, 1, 'Four-day reminder is discovered');
      job = (
        await pool.query("SELECT * FROM automated_calls WHERE user_id=$1 AND kind='DUE_REMINDER'", [user])
      ).rows[0];
      assert.match(job.script, /due in 4 days/);
      assert.equal(await service.eligible(job, await service.preferences(user), db), true);
      await pool.query('UPDATE rentals SET end_date=end_date+1 WHERE id=$1', [rental]);
      assert.equal(
        await service.eligible(job, await service.preferences(user), db),
        false,
        'Extension invalidates old reminder',
      );
      await pool.query("UPDATE rentals SET end_date=end_date-1,status='RETURN_IN_TRANSIT' WHERE id=$1", [
        rental,
      ]);
      assert.equal(
        await service.eligible(job, await service.preferences(user), db),
        false,
        'Return already handed to courier needs no call',
      );
      await service.updatePreferences(user, { ...prefs, booking_enabled: false, reminders_enabled: false });
      assert.equal((await service.enqueue()).queued, 0);
    } finally {
      await pool.query('DELETE FROM rentals WHERE id=$1', [rental]);
      await pool.query('DELETE FROM listings WHERE id=$1', [listing]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
      await pool.end();
    }
  },
);
