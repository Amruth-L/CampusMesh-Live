const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { validateProfile } = require('../src/modules/direct-upi/service');
test('UPI details require ownership acknowledgement and reject injected URI parameters', () => {
  assert.throws(() => validateProfile({ upi_id: 'user@bank&am=1', payee_name: 'Test', confirm: true }));
  assert.throws(() => validateProfile({ upi_id: 'user@bank', payee_name: 'Test' }));
  assert.deepEqual(validateProfile({ upi_id: ' USER@BANK ', payee_name: 'Test Student', confirm: true }), {
    upi_id: 'user@bank',
    payee_name: 'Test Student',
  });
});
test(
  'direct rental lifecycle with manual receipt, privacy and no gateway money records',
  { skip: process.env.EVIDENCE_E2E !== '1', timeout: 120000 },
  async (t) => {
    const db = require('../src/config/database');
    const scope = (await db.query('SELECT current_schema() s,current_schemas(false) scopes')).rows[0];
    assert(scope.s.startsWith('qa_') && !scope.scopes.includes('public'));
    const service = require('../src/modules/direct-upi/service').createService({
      db,
      notify: () => {},
      match: async () => {},
      onConfirmed: () => {},
    });
    const [owner, renter, courier, outsider] = Array.from({ length: 4 }, randomUUID);
    let r;
    try {
      for (const id of [owner, renter, courier, outsider])
        await db.query(
          "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Fixture student',$2,true)",
          [id, id + '@dbit.co.in'],
        );
      const listing = (
        await db.query(
          "INSERT INTO listings(owner_id,title,description,category,price,rent_price) VALUES($1,'UPI fixture','Test only','Electronics',500,50) RETURNING id",
          [owner],
        )
      ).rows[0].id;
      await t.test(
        'booking retries reuse one request and accepted unpaid requests stay visible',
        async () => {
          const previous = process.env.DIRECT_UPI_ENABLED;
          process.env.DIRECT_UPI_ENABLED = 'true';
          const controller = require('../src/modules/rentals/rentals.controller');
          const invoke = async (fn, req) => {
            const res = {
              code: 200,
              status(n) {
                this.code = n;
                return this;
              },
              json(data) {
                this.data = data;
                return this;
              },
            };
            await fn(req, res);
            return res;
          };
          try {
            const start = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
            const req = {
              user: { id: renter },
              body: { listing_id: listing, start_date: start, end_date: start },
            };
            const [a, b] = await Promise.all([
              invoke(controller.bookRental, req),
              invoke(controller.bookRental, req),
            ]);
            assert([200, 201].includes(a.code), JSON.stringify(a.data));
            assert([200, 201].includes(b.code), JSON.stringify(b.data));
            assert.equal(a.data.rental.id, b.data.rental.id);
            assert.equal(a.data.rental.payment_method, 'DIRECT_UPI');
            assert.equal(a.data.breakdown.platform_fee, 0);
            const requests = await invoke(controller.getOwnerRequests, { user: { id: owner }, query: {} });
            assert(requests.data.requests.some((x) => x.id === a.data.rental.id && x.actionable));
            await service.profile(owner, {
              upi_id: 'owner@bank',
              payee_name: 'Owner Fixture',
              confirm: true,
            });
            await service.respond(a.data.rental.id, owner, 'ACCEPTED');
            const accepted = await invoke(controller.getOwnerRequests, { user: { id: owner }, query: {} });
            assert(accepted.data.requests.some((x) => x.id === a.data.rental.id));
            const duplicate = await invoke(controller.bookRental, req);
            assert.equal(duplicate.code, 409, 'accepted request must not be recreated');
            await db.query('DELETE FROM upi_profiles WHERE user_id=$1', [owner]);
          } finally {
            if (previous === undefined) delete process.env.DIRECT_UPI_ENABLED;
            else process.env.DIRECT_UPI_ENABLED = previous;
          }
        },
      );
      r = (
        await db.query(
          `INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,payment_method,status)
   VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,100,100,200,'DIRECT_UPI','OWNER_PENDING') RETURNING *`,
          [listing, owner, renter],
        )
      ).rows[0];
      await t.test('acceptance requires recipient setup and no stranger can act', async () => {
        await assert.rejects(service.respond(r.id, owner, 'ACCEPTED'), /save their UPI/);
        await service.profile(owner, { upi_id: 'owner@bank', payee_name: 'Owner Fixture', confirm: true });
        await assert.rejects(service.respond(r.id, outsider, 'ACCEPTED'), (e) => e.status === 403);
        await service.respond(r.id, owner, 'ACCEPTED');
        await service.respond(r.id, owner, 'ACCEPTED');
        assert.equal((await service.list(renter, r.id)).length, 1);
        assert.equal((await service.list(outsider, r.id)).length, 0);
      });
      let rentalPayment;
      await t.test('reporting is not payment confirmation; recipient snapshots survive edits', async () => {
        rentalPayment = (await service.list(renter, r.id))[0];
        assert(new URL(rentalPayment.uri).searchParams.get('am') === '100.00');
        await service.profile(owner, { upi_id: 'changed@bank', payee_name: 'Changed name', confirm: true });
        assert.equal((await service.list(renter, r.id))[0].upi_id, 'owner@bank');
        await assert.rejects(
          service.act(rentalPayment.id, owner, 'confirm', { confirm: true }),
          /Wait for the payer/,
        );
        await service.act(rentalPayment.id, renter, 'report', { reference: '123456789012', confirm: true });
        assert.equal(
          (await db.query('SELECT payment_status FROM rentals WHERE id=$1', [r.id])).rows[0].payment_status,
          'PENDING',
        );
        await assert.rejects(
          service.act(rentalPayment.id, renter, 'confirm', { confirm: true }),
          (e) => e.status === 403,
        );
        await service.act(rentalPayment.id, owner, 'dispute', { confirm: true });
        await assert.rejects(
          service.act(rentalPayment.id, renter, 'report', { reference: '123456789013', confirm: true }),
          /already reported/,
        );
      });
      await t.test('receipt confirmation is idempotent and deposit gates pickup', async () => {
        await Promise.all([
          service.act(rentalPayment.id, owner, 'confirm', { confirm: true }),
          service.act(rentalPayment.id, owner, 'confirm', { confirm: true }),
        ]);
        let rental = (await db.query('SELECT * FROM rentals WHERE id=$1', [r.id])).rows[0];
        assert.equal(rental.status, 'DEPOSIT_PENDING');
        assert(!rental.qr_code_hash);
        const dep = (await service.list(renter, r.id)).find((p) => p.kind === 'DEPOSIT');
        assert.equal(dep.amount, 200);
        await assert.rejects(
          service.act(dep.id, renter, 'report', { reference: '123456789012', confirm: true }),
          /already recorded/,
        );
        await service.act(dep.id, renter, 'report', { reference: '123456789014', confirm: true });
        await service.act(dep.id, owner, 'confirm', { confirm: true });
        rental = (await db.query('SELECT * FROM rentals WHERE id=$1', [r.id])).rows[0];
        assert.equal(rental.status, 'QR_GENERATED');
        assert.equal(rental.payment_status, 'FULLY_PAID');
        assert(rental.qr_code_hash);
        assert.equal((await db.query('SELECT * FROM payments WHERE rental_id=$1', [r.id])).rowCount, 0);
        await assert.rejects(
          require('../src/modules/payments/payment.service').createRentalOrder(r.id, renter),
          /direct UPI/,
        );
      });
      await t.test(
        'courier earns separately only after verified handover; never creates Route payouts',
        async () => {
          await service.profile(courier, {
            upi_id: 'courier@bank',
            payee_name: 'Courier Fixture',
            confirm: true,
          });
          const d = (
            await db.query(
              `INSERT INTO delivery_requests(rental_id,courier_id,seller_id,customer_id,pickup_location,task_type,status,courier_earning)
    VALUES($1,$2,$3,$4,'Library','RENTAL_OUTBOUND','COMPLETED',10) RETURNING id`,
              [r.id, courier, owner, renter],
            )
          ).rows[0].id;
          assert(!(await service.list(courier)).length);
          await db.query('UPDATE delivery_requests SET delivery_verified_at=NOW() WHERE id=$1', [d]);
          assert(!(await service.list(courier)).length);
          await db.query(
            `INSERT INTO handover_verifications(delivery_id,stage,otp_hash,credential_hash,shown_to_user_id,expires_at,status)
    VALUES($1,'DELIVERY','fixture','fixture',$2,NOW(),'USED')`,
            [d, renter],
          );
          const p = (await service.list(courier))[0];
          assert.equal(p.amount, 10);
          assert.equal(p.payer_id, renter);
          assert.equal(p.uri, null);
          await require('../src/modules/payouts/payout-ledger').syncLedger(db);
          assert.equal(
            (await db.query('SELECT * FROM payout_intents WHERE rental_id=$1', [r.id])).rowCount,
            0,
          );
        },
      );
      await t.test('zero-deposit delivery unlocks only after receipt and preserves the full courier fee', async () => {
        for (const id of ['upi-pickup','upi-drop']) await db.query("INSERT INTO campus_locations(id,building_id,building_name,x,y) VALUES($1,'qa','Fixture',0,0)",[id]);
        await db.query("UPDATE listings SET pickup_location_id='upi-pickup',delivery_available=true WHERE id=$1",[listing]);
        const row=(await db.query(`INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,delivery_fee,delivery_requested,drop_location_id,payment_method,status)
          VALUES($1,$2,$3,CURRENT_DATE+50,CURRENT_DATE+51,2,100,100,0,10,true,'upi-drop','DIRECT_UPI','OWNER_PENDING') RETURNING *`,[listing,owner,renter])).rows[0];
        await service.respond(row.id,owner,'ACCEPTED');
        const payment=(await service.list(renter,row.id))[0];
        assert.equal((await db.query('SELECT 1 FROM delivery_requests WHERE rental_id=$1',[row.id])).rowCount,0);
        await service.act(payment.id,renter,'report',{reference:'123456789016',confirm:true});
        await service.act(payment.id,owner,'confirm',{confirm:true});
        const rental=(await db.query('SELECT * FROM rentals WHERE id=$1',[row.id])).rows[0];
        assert.equal(rental.status,'MATCHING_COURIER');
        assert.equal(rental.deposit_status,'NOT_REQUIRED');
        assert.equal(rental.payment_status,'FULLY_PAID');
        const delivery=(await db.query('SELECT * FROM delivery_requests WHERE rental_id=$1',[row.id])).rows[0];
        assert.equal(Number(delivery.courier_earning),10);
        assert.equal((await service.list(renter,row.id)).length,1);
      });
      await t.test('return does not claim a refund; renter must confirm actual receipt', async () => {
        await assert.rejects(service.complete(r.id, owner, {}), /physical return/);
        await db.query("UPDATE rentals SET status='RETURN_PENDING' WHERE id=$1", [r.id]);
        await assert.rejects(service.complete(r.id, owner, { damage_amount: 1 }), /Damage deductions/);
        await assert.rejects(service.complete(r.id, renter, {}), e => e.status === 403);
        await service.complete(r.id, owner, {});
        await service.complete(r.id, owner, {});
        let state = (await db.query('SELECT * FROM rentals WHERE id=$1', [r.id])).rows[0];
        assert.equal(state.status, 'RETURN_PENDING');
        assert.equal(state.completed_at, null);
        assert.equal((await db.query("SELECT 1 FROM transaction_events WHERE rental_id=$1 AND event_type='RETURN_CONFIRMED'", [r.id])).rowCount, 1);
        await assert.rejects(service.prepare(r.id, owner), /save their UPI/);
        await service.profile(renter, { upi_id: 'renter@bank', payee_name: 'Renter Fixture', confirm: true });
        await service.prepare(r.id, owner);
        await service.prepare(r.id, renter);
        const p = (await service.list(owner, r.id)).find((p) => p.kind === 'DEPOSIT_REFUND');
        assert.equal(p.amount, 200);
        assert.equal(
          (await db.query('SELECT deposit_status FROM rentals WHERE id=$1', [r.id])).rows[0].deposit_status,
          'REFUND_PENDING',
        );
        await assert.rejects(service.act(p.id, renter, 'confirm', { confirm: true }), /Wait for the payer/);
        await assert.rejects(service.act(p.id, owner, 'confirm', { confirm: true }), e => e.status === 403);
        await service.act(p.id, owner, 'report', { reference: '123456789015', confirm: true });
        await service.act(p.id, renter, 'dispute', { confirm: true });
        state = (await db.query('SELECT * FROM rentals WHERE id=$1', [r.id])).rows[0];
        assert.equal(state.status, 'RETURN_PENDING');
        assert.equal(state.deposit_status, 'REFUND_PENDING');
        assert.equal(state.completed_at, null);
        await assert.rejects(service.act(p.id, outsider, 'confirm', { confirm: true }), e => e.status === 404);
        await Promise.all([service.act(p.id, renter, 'confirm', { confirm: true }), service.act(p.id, renter, 'confirm', { confirm: true })]);
        state = (await db.query('SELECT * FROM rentals WHERE id=$1', [r.id])).rows[0];
        assert.equal(state.status, 'COMPLETED');
        assert(state.completed_at);
        assert.equal((await db.query("SELECT 1 FROM direct_upi_events WHERE payment_id=$1 AND action='CONFIRM'", [p.id])).rowCount, 1);
        assert.equal(
          (await db.query('SELECT deposit_status FROM rentals WHERE id=$1', [r.id])).rows[0].deposit_status,
          'REFUNDED',
        );
      });
      await t.test('return approval prepares the refund when UPI exists; zero deposits close without payment', async () => {
        for (const amount of [200, 0]) {
          const row = (await db.query(`INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,payment_method,status)
            VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,100,100,$4,'DIRECT_UPI','RETURN_PENDING') RETURNING *`, [listing,owner,renter,amount])).rows[0];
          await service.complete(row.id,owner,{});
          const state = (await db.query('SELECT * FROM rentals WHERE id=$1',[row.id])).rows[0];
          assert.equal(state.status, amount ? 'RETURN_PENDING' : 'COMPLETED');
          const refunds=(await service.list(owner,row.id)).filter(p=>p.kind==='DEPOSIT_REFUND');
          assert.equal(refunds.length,amount ? 1 : 0);
          if (amount) assert.equal(refunds[0].recipient_id,renter);
        }
      });
      await t.test('migration reopens only unsettled direct refunds and is repeatable', async () => {
        const row=(await db.query(`INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,booking_amount,deposit_amount,payment_method,status,deposit_status,completed_at)
          VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,100,100,200,'DIRECT_UPI','COMPLETED','REFUND_PENDING',NOW()) RETURNING *`,[listing,owner,renter])).rows[0];
        const sql=await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../src/db/migrations/019_return_refund_completion.sql'),'utf8');
        await db.query(sql); await db.query(sql);
        assert.equal((await db.query('SELECT status FROM rentals WHERE id=$1',[row.id])).rows[0].status,'RETURN_PENDING');
        assert.equal((await db.query('SELECT status FROM rentals WHERE id=$1',[r.id])).rows[0].status,'COMPLETED');
      });
    } finally {
      await db.end();
    }
  },
);
