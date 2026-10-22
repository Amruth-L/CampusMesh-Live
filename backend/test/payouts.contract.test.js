const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test(
  'recipient onboarding, funded payouts and safe bank settlement in isolated schema',
  { skip: process.env.EVIDENCE_E2E !== '1', timeout: 180000 },
  async (t) => {
    const db = require('../src/config/database');
    const schema = (await db.query('SELECT current_schema() s,current_schemas(false) scopes')).rows[0];
    assert(schema.s.startsWith('qa_') && !schema.scopes.includes('public'));
    const [owner, courier, borrower, stranger] = Array.from({ length: 4 }, randomUUID);
    const products = new Map(),
      paid = new Map(),
      remoteTransfers = new Map();
    let creates = 0,
      loseResponse = false,
      allowProvider = true,
      bankEdits = 0;
    const config = () => ({
      mode: 'test',
      configured: allowProvider,
      enabled: allowProvider,
      approved: allowProvider,
      message: 'Fixture payout service',
    });
    const gateway = {
      products: {
        fetch: async (id, product) => ({ ...products.get(product) }),
        edit: async (id, product, body) => {
          bankEdits++;
          products.get(product).active_configuration = { settlements: body.settlements };
          return products.get(product);
        },
      },
      payments: {
        fetch: async (id) => ({ ...paid.get(id) }),
        transfer: async (id, body) => {
          creates++;
          const x = body.transfers[0];
          const row = {
            id: 'trf_' + randomUUID().replaceAll('-', ''),
            source: id,
            recipient: x.account,
            amount: x.amount,
            currency: 'INR',
            status: 'processed',
            settlement_status: 'pending',
            notes: x.notes,
            amount_reversed: 0,
          };
          remoteTransfers.set(row.id, row);
          if (loseResponse) throw Error('Response lost after transfer creation');
          return { items: [row] };
        },
      },
      transfers: {
        all: async (args) => ({
          items: [...remoteTransfers.values()].filter((row) => row.source === args.payment_id),
        }),
        fetch: async (id) => ({ ...remoteTransfers.get(id) }),
      },
    };
    const service = require('../src/modules/payouts/payout-service').createPayoutService({
      db,
      gateway,
      config,
    });
    const accounts = service.accounts;
    let rental, task, paymentId;
    async function link(user, suffix) {
      const product = 'acc_prd_' + suffix,
        account = 'acc_' + suffix;
      products.set(product, {
        id: product,
        product_name: 'route',
        merchant_id: account,
        activation_status: 'activated',
        active_configuration: {
          settlements: { account_number: '123456789012', beneficiary_name: 'Fixture recipient' },
        },
      });
      await db.query(
        "INSERT INTO payout_accounts(user_id,gateway_mode,account_id,product_id,status) VALUES($1,'test',$2,$3,'PENDING')",
        [user, account, product],
      );
      return accounts.refresh(user);
    }
    try {
      for (const id of [owner, courier, borrower, stranger])
        await db.query(
          "INSERT INTO users(id,name,email,email_verified) VALUES($1,'Payout fixture',$2,TRUE)",
          [id, id + '@dbit.co.in'],
        );
      const listing = (
        await db.query(
          "INSERT INTO listings(owner_id,title,description,category,rent_price,deposit) VALUES($1,'Fixture item','Test only','Electronics',100,500) RETURNING id",
          [owner],
        )
      ).rows[0].id;
      rental = (
        await db.query(
          `INSERT INTO rentals(listing_id,owner_id,borrower_id,start_date,end_date,rental_days,rental_fee,delivery_fee,platform_fee,booking_amount,deposit_amount,status,payment_status)
      VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+1,2,200,20,10,230,500,'RENTAL_ACTIVE','FULLY_PAID') RETURNING id`,
          [listing, owner, borrower],
        )
      ).rows[0].id;
      const providerPayment = 'pay_' + randomUUID().replaceAll('-', '');
      paymentId = (
        await db.query(
          "INSERT INTO payments(rental_id,payment_type,amount,status,transaction_id,gateway_mode) VALUES($1,'RENTAL',230,'PAID',$2,'test') RETURNING id",
          [rental, providerPayment],
        )
      ).rows[0].id;
      paid.set(providerPayment, {
        id: providerPayment,
        status: 'captured',
        captured: true,
        amount: 23000,
        currency: 'INR',
        amount_refunded: 0,
      });
      task = (
        await db.query(
          `INSERT INTO delivery_requests(rental_id,listing_id,courier_id,seller_id,customer_id,pickup_location,task_type,status,courier_earning,delivery_fee)
      VALUES($1,$2,$3,$4,$5,'Library','RENTAL_OUTBOUND','COMPLETED',14,20) RETURNING id`,
          [rental, listing, courier, owner, borrower],
        )
      ).rows[0].id;
      await t.test(
        'completed status alone is insufficient; no provider call while setup is inactive',
        async () => {
          assert.equal((await service.summary(courier)).items.length, 0);
          allowProvider = false;
          assert.equal((await service.tick()).skipped, true);
          assert.equal(creates, 0);
          allowProvider = true;
        },
      );
      await t.test('recipient setup is idempotent and bank details are masked', async () => {
        await Promise.all([accounts.request(courier), accounts.request(courier)]);
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM payout_accounts WHERE user_id=$1', [courier])).rows[0]
            .n,
          1,
        );
        await db.query('DELETE FROM payout_accounts WHERE user_id=$1', [courier]);
        const safe = await link(courier, 'courier');
        assert.equal(safe.status, 'ACTIVE');
        assert.equal(safe.bankLast4, '9012');
        assert(!JSON.stringify(safe).includes('123456789012'));
        await link(owner, 'owner');
      });
      await t.test(
        'only verified handovers accrue courier earnings and deposits are never included',
        async () => {
          await db.query('UPDATE delivery_requests SET delivery_verified_at=NOW() WHERE id=$1', [task]);
          await db.query(
            "INSERT INTO handover_verifications(delivery_id,stage,credential_hash,otp_hash,shown_to_user_id,expires_at,status) VALUES($1,'DELIVERY','fixture','fixture',$2,NOW(),'USED')",
            [task, borrower],
          );
          const first = await service.summary(courier);
          await service.summary(courier);
          assert.equal(first.items.length, 1);
          assert.equal(first.items[0].amount, 14);
          assert.equal(first.totals.awaiting, 14);
          assert.equal((await service.summary(owner)).items.length, 0);
        },
      );
      let intent;
      await t.test(
        'concurrent dispatch creates one transfer and never calls it bank-settled early',
        async () => {
          intent = (await service.summary(courier)).items[0].id;
          await Promise.all([service.dispatch(intent), service.dispatch(intent)]);
          assert.equal(creates, 1);
          const row = (await service.summary(courier)).items[0];
          assert.equal(row.status, 'TRANSFERRED');
          assert.equal(row.settled_at, null);
          assert.equal((await service.summary(courier)).totals.settled, 0);
          await assert.rejects(service.reconcile(intent, stranger), (e) => e.status === 404);
          await assert.rejects(
            accounts.updateBank(courier, {
              beneficiary_name: 'Fixture',
              account_number: '1234567890',
              ifsc: 'SBIN0001234',
              confirm: true,
            }),
            (e) => e.status === 409,
          );
          assert.equal(bankEdits, 0);
        },
      );
      await t.test(
        'provider settlement confirmation is required, repeated refresh cannot duplicate money',
        async () => {
          const remote = [...remoteTransfers.values()][0];
          remote.settlement_status = 'settled';
          remote.recipient_settlement_id = 'setl_fixture';
          assert.equal((await service.reconcile(intent, courier)).status, 'SETTLED');
          await service.reconcile(intent, courier);
          assert.equal(creates, 1);
          assert.equal((await service.summary(courier)).totals.settled, 14);
        },
      );
      await t.test('bank change validates input and stores only masked provider output', async () => {
        await assert.rejects(
          accounts.updateBank(courier, {
            beneficiary_name: 'x',
            account_number: 'wrong',
            ifsc: 'bad',
            confirm: true,
          }),
          (e) => e.status === 400,
        );
        await accounts.updateBank(courier, {
          beneficiary_name: 'Fixture recipient',
          account_number: '987654321012',
          ifsc: 'SBIN0001234',
          confirm: true,
        });
        const row = await accounts.get(courier);
        assert.equal(row.bank_last4, '1012');
        assert.equal(row.status, 'ACTIVE');
        assert.equal(bankEdits, 1);
        assert(!JSON.stringify(row).includes('987654321012'));
      });
      let lender;
      await t.test(
        'owner inspection releases the funded rental fee once; lost response stays review-required',
        async () => {
          await db.query("UPDATE rentals SET status='COMPLETED' WHERE id=$1", [rental]);
          await db.query(
            "INSERT INTO transaction_events(rental_id,event_type,actor_user_id) VALUES($1,'RETURN_CONFIRMED',$2)",
            [rental, owner],
          );
          lender = (await service.summary(owner)).items[0].id;
          assert.equal((await service.summary(owner)).items[0].amount, 200);
          loseResponse = true;
          assert.equal((await service.dispatch(lender)).status, 'REVIEW_REQUIRED');
          loseResponse = false;
          assert.equal(creates, 2);
          await service.dispatch(lender);
          assert.equal(creates, 2);
          assert.equal((await service.reconcile(lender, owner)).status, 'TRANSFERRED');
          assert.equal(creates, 2);
        },
      );
      await t.test(
        'mismatched provider amount cannot mark settlement, and reversal remains visible',
        async () => {
          const remote = [...remoteTransfers.values()].find((x) => x.notes.campusmesh_payout_id === lender);
          remote.amount++;
          await assert.rejects(service.reconcile(lender, owner));
          remote.amount--;
          const courierTransfer = [...remoteTransfers.values()].find(
            (x) => x.notes.campusmesh_payout_id === intent,
          );
          courierTransfer.amount_reversed = 100;
          assert.equal((await service.reconcile(intent, courier)).status, 'REVERSED');
        },
      );
      await t.test('unfunded return fees and historical payments never dispatch', async () => {
        const returned = (
          await db.query(
            `INSERT INTO delivery_requests(rental_id,courier_id,seller_id,customer_id,pickup_location,task_type,status,courier_earning,delivery_verified_at)
        VALUES($1,$2,$3,$4,'Library','RENTAL_RETURN','COMPLETED',14,NOW()) RETURNING id`,
            [rental, courier, borrower, owner],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO handover_verifications(delivery_id,stage,credential_hash,otp_hash,shown_to_user_id,expires_at,status) VALUES($1,'RETURN_RECEIVED','x','x',$2,NOW(),'USED')",
          [returned, owner],
        );
        const item = (await service.summary(courier)).items.find((x) => x.kind === 'RETURN_COURIER');
        assert.equal(item.status, 'AWAITING_FUNDING');
        assert.equal((await service.dispatch(item.id)).skipped, true);
        assert.equal(creates, 2);
        await db.query("UPDATE payments SET gateway_mode='legacy' WHERE id=$1", [paymentId]);
        await assert.rejects(
          service.dispatch(
            (
              await db.query(
                "INSERT INTO payout_intents(source_key,user_id,kind,payment_id,rental_id,gateway_mode,amount_paise) VALUES($1,$2,'LENDER',$3,$4,'test',100) RETURNING id",
                ['historical:' + randomUUID(), owner, paymentId, rental],
              )
            ).rows[0].id,
          ),
        );
      });
      await t.test(
        'an uncertain bank update blocks verification and does not expose full details',
        async () => {
          const original = gateway.products.edit;
          gateway.products.edit = async () => {
            throw Error('Lost response');
          };
          await assert.rejects(
            accounts.updateBank(courier, {
              beneficiary_name: 'Fixture recipient',
              account_number: '123456789012',
              ifsc: 'SBIN0001234',
              confirm: true,
            }),
            (e) => e.status === 503,
          );
          await assert.rejects(accounts.refresh(courier), (e) => e.status === 409);
          assert.equal((await accounts.get(courier)).bank_update_pending, true);
          assert.equal((await accounts.get(courier)).status, 'PENDING');
          gateway.products.edit = original;
        },
      );
      await t.test('live checkout fails before payment creation without active recipient setup', async () => {
        const live = require('../src/modules/payouts/payout-accounts').createAccountService({
          db,
          gateway,
          config: () => ({ ...config(), mode: 'live' }),
        });
        await assert.rejects(live.assertRecipients([owner]), (e) => e.status === 409);
        const disabled = require('../src/modules/payouts/payout-accounts').createAccountService({
          db,
          gateway,
          config: () => ({ ...config(), mode: 'live', configured: false }),
        });
        await assert.rejects(disabled.assertRecipients([owner]), (e) => e.status === 503);
      });
    } finally {
      await db.end();
    }
  },
);
