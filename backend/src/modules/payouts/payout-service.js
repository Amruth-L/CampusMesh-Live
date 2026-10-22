const pool = require('../../config/database');
const razorpay = require('../../config/razorpay');
const { payoutConfig, fail, providerRead } = require('./payout-config');
const { createAccountService, safeAccount } = require('./payout-accounts');
const { syncLedger } = require('./payout-ledger');
const { recipientVerification } = require('./payout-verification');
const rupees = (value) => Number(value || 0) / 100;

function createPayoutService({ db = pool, gateway = razorpay, config = payoutConfig } = {}) {
  const accounts = createAccountService({ db, gateway, config });
  async function transaction(fn) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function summary(userId) {
    await syncLedger(db, userId);
    const settings = config();
    const rows = (
      await db.query(
        `SELECT i.id,i.kind,i.gateway_mode,i.amount_paise,i.status,i.reason,i.created_at,i.updated_at,
      i.gateway_transfer_id,i.settlement_id,i.settled_at,COALESCE(l.title,d.item_description,'Rental') AS title
      FROM payout_intents i LEFT JOIN rentals r ON r.id=i.rental_id LEFT JOIN listings l ON l.id=r.listing_id
      LEFT JOIN delivery_requests d ON d.id=i.delivery_id WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 100`,
        [userId],
      )
    ).rows;
    const totals = (
      await db.query(
        `SELECT COALESCE(SUM(amount_paise) FILTER(WHERE status='SETTLED'),0) AS settled,
      COALESCE(SUM(amount_paise) FILTER(WHERE status IN ('SUBMITTING','PENDING','TRANSFERRED')),0) AS processing,
      COALESCE(SUM(amount_paise) FILTER(WHERE status NOT IN ('SETTLED','SUBMITTING','PENDING','TRANSFERRED','REVERSED')),0) AS awaiting,
      COALESCE(SUM(amount_paise) FILTER(WHERE gateway_mode='legacy'),0) AS legacy
      FROM payout_intents WHERE user_id=$1 AND gateway_mode=$2`,
        [userId, settings.mode || 'legacy'],
      )
    ).rows[0];
    return {
      service: settings,
      account: safeAccount(await accounts.get(userId)),
      totals: {
        settled: rupees(totals.settled),
        processing: rupees(totals.processing),
        awaiting: rupees(totals.awaiting),
      },
      items: rows.map((row) => ({ ...row, amount: rupees(row.amount_paise), amount_paise: undefined })),
      policy:
        'Lender payouts become eligible after the owner confirms return. Delivery payouts require verified handover and a captured payment funding the fee. Wish Box reimbursements include the item cost.',
    };
  }

  async function applyTransfer(client, intent, remote) {
    const amount = Number(intent.amount_paise),
      state = remote?.status || remote?.transfer_status;
    if (
      !remote ||
      !/^trf_[A-Za-z0-9]+$/.test(remote.id || '') ||
      remote.source !== intent.gateway_payment_id ||
      remote.recipient !== intent.account_id ||
      Number(remote.amount) !== amount ||
      remote.currency !== 'INR' ||
      remote.notes?.campusmesh_payout_id !== intent.id ||
      (intent.gateway_transfer_id && remote.id !== intent.gateway_transfer_id) ||
      !['created', 'pending', 'processed', 'failed', 'reversed', 'partially_reversed'].includes(state)
    )
      throw fail('Transfer response did not match the recorded payout.', 503);
    let status =
      state === 'processed'
        ? 'TRANSFERRED'
        : state === 'failed'
          ? 'FAILED'
          : ['reversed', 'partially_reversed'].includes(state)
            ? 'REVERSED'
            : 'PENDING';
    if (Number(remote.amount_reversed || 0) > 0) status = 'REVERSED';
    if (
      status !== 'REVERSED' &&
      remote.settlement_status === 'settled' &&
      /^setl_/.test(remote.recipient_settlement_id || '') &&
      state === 'processed'
    )
      status = 'SETTLED';
    // Reversals override settlement; stale pending events never erase bank settlement.
    if (intent.status === 'SETTLED' && !['REVERSED', 'SETTLED'].includes(status)) status = 'SETTLED';
    if (intent.status === 'REVERSED') status = 'REVERSED';
    await client.query(
      `UPDATE payout_intents SET gateway_transfer_id=$1,status=$2,settlement_id=$3,
      settled_at=CASE WHEN $2='SETTLED' THEN COALESCE(settled_at,NOW()) ELSE settled_at END,
      reason=$4,updated_at=NOW() WHERE id=$5`,
      [
        remote.id,
        status,
        remote.recipient_settlement_id || null,
        status === 'FAILED'
          ? 'Razorpay reported a failed transfer. Contact support.'
          : status === 'REVERSED'
            ? 'The transfer was reversed; support review is required.'
            : null,
        intent.id,
      ],
    );
    if (status !== intent.status)
      await client.query('INSERT INTO payout_audit(user_id,payout_id,action,metadata) VALUES($1,$2,$3,$4)', [
        intent.user_id,
        intent.id,
        status,
        { transfer_id: remote.id },
      ]);
    return { status };
  }

  async function sourceFor(client, intent) {
    const row = intent.payment_id
      ? (await client.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [intent.payment_id])).rows[0]
      : (await client.query('SELECT * FROM wish_payments WHERE id=$1 FOR UPDATE', [intent.wish_payment_id]))
          .rows[0];
    if (!row || row.status !== 'PAID' || row.gateway_mode !== config().mode)
      throw fail('This earning is not backed by a verified payment in the active mode.');
    const id = intent.payment_id ? row.transaction_id : row.gateway_payment_id;
    if (!/^pay_[A-Za-z0-9]+$/.test(id || '')) throw fail('The captured payment reference is missing.');
    if (
      intent.payment_id &&
      (await client.query('SELECT id FROM refunds WHERE payment_id=$1 LIMIT 1', [row.id])).rowCount
    )
      throw fail('This source payment has a refund request. Support must review it.');
    return { id, row };
  }

  async function dispatch(id) {
    if (!config().configured) return { skipped: true };
    // Persist SUBMITTING before the external mutation. A crashed/ambiguous
    // submission is reconciled by notes; it is NEVER blindly sent again.
    const prepared = await transaction(async (client) => {
      const intent = (await client.query('SELECT * FROM payout_intents WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (
        !intent ||
        intent.gateway_mode !== config().mode ||
        !['AWAITING_SETUP', 'READY'].includes(intent.status)
      )
        return null;
      const account = (
        await client.query('SELECT * FROM payout_accounts WHERE user_id=$1 AND gateway_mode=$2 FOR UPDATE', [
          intent.user_id,
          intent.gateway_mode,
        ])
      ).rows[0];
      if (
        !account ||
        account.status !== 'ACTIVE' ||
        account.bank_update_pending ||
        !account.verified_at ||
        Date.now() - new Date(account.verified_at) > 86400000
      ) {
        await client.query(
          "UPDATE payout_intents SET reason='Recipient bank verification is required before transfer.',updated_at=NOW() WHERE id=$1",
          [id],
        );
        return null;
      }
      const source = await sourceFor(client, intent);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['payout-source:' + source.id]);
      const paid = await providerRead(() => gateway.payments.fetch(source.id));
      const all = (await providerRead(() => gateway.transfers.all({ payment_id: source.id, count: 100 })))
        .items;
      if (!Array.isArray(all) || all.length >= 100) throw fail('Transfer history needs support review.');
      if (all.some((x) => x.notes?.campusmesh_payout_id === intent.id))
        throw fail('An existing transfer needs reconciliation.');
      const product = await providerRead(() =>
        gateway.products.fetch(account.account_id, account.product_id),
      );
      if (
        product.id !== account.product_id ||
        product.product_name !== 'route' ||
        (product.merchant_id && product.merchant_id !== account.account_id) ||
        recipientVerification(product, account.onboarding_method === 'composite').status !== 'ACTIVE'
      )
        throw fail('Recipient bank verification is no longer active.');
      const allocated = all.reduce((sum, t) => sum + Number(t.amount || 0), 0);
      if (
        paid.id !== source.id ||
        paid.status !== 'captured' ||
        paid.captured !== true ||
        paid.currency !== 'INR' ||
        Number(paid.amount_refunded || 0) > 0 ||
        allocated + Number(intent.amount_paise) > Number(paid.amount)
      )
        throw fail('The captured payment cannot fund this payout.');
      // A cart charge funds several rentals; serialize other payouts from the
      // same provider payment even if they reference different local rows.
      const pending = await client.query(
        `SELECT id FROM payout_intents WHERE gateway_payment_id=$1 AND id<>$2
        AND status IN ('SUBMITTING','REVIEW_REQUIRED') LIMIT 1`,
        [source.id, intent.id],
      );
      if (pending.rowCount) throw fail('Another transfer from this payment needs confirmation.');
      await client.query(
        "UPDATE payout_intents SET status='SUBMITTING',account_id=$1,gateway_payment_id=$2,dispatched_at=NOW(),updated_at=NOW() WHERE id=$3",
        [account.account_id, source.id, intent.id],
      );
      await client.query("INSERT INTO payout_audit(user_id,payout_id,action) VALUES($1,$2,'SUBMITTING')", [
        intent.user_id,
        intent.id,
      ]);
      return {
        ...intent,
        account_id: account.account_id,
        gateway_payment_id: source.id,
        status: 'SUBMITTING',
      };
    });
    if (!prepared) return { skipped: true };
    let remote;
    try {
      // Do not attach RazorpayX's payout idempotency header to Route: Route
      // does not document support for it. One attempt + reconciliation is safer.
      const value = await providerRead(() =>
        gateway.payments.transfer(prepared.gateway_payment_id, {
          transfers: [
            {
              account: prepared.account_id,
              amount: Number(prepared.amount_paise),
              currency: 'INR',
              on_hold: false,
              notes: { campusmesh_payout_id: prepared.id },
            },
          ],
        }),
      );
      if (value.items?.length !== 1) throw fail('Unexpected transfer result.');
      remote = value.items[0];
      return await transaction(async (client) => {
        const row = (await client.query('SELECT * FROM payout_intents WHERE id=$1 FOR UPDATE', [id])).rows[0];
        return applyTransfer(client, row, remote);
      });
    } catch {
      await db.query(
        "UPDATE payout_intents SET status='REVIEW_REQUIRED',reason='Transfer response is uncertain. Check provider status before any retry.',updated_at=NOW() WHERE id=$1 AND status='SUBMITTING'",
        [id],
      );
      return { status: 'REVIEW_REQUIRED' };
    }
  }

  async function reconcile(id, userId = null) {
    const value = config();
    if (!value.configured) throw fail(value.message, 503);
    return transaction(async (client) => {
      const row = (await client.query('SELECT * FROM payout_intents WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row || (userId && row.user_id !== userId)) throw fail('Payout not found.', 404);
      if (row.gateway_mode !== value.mode) throw fail('This record belongs to a different payment mode.');
      if (!row.gateway_payment_id || !row.account_id) return { status: row.status };
      let remote;
      if (row.gateway_transfer_id)
        remote = await providerRead(() => gateway.transfers.fetch(row.gateway_transfer_id));
      else {
        const list = await providerRead(() =>
          gateway.transfers.all({ payment_id: row.gateway_payment_id, count: 100 }),
        );
        const matches = list.items?.filter((item) => item.notes?.campusmesh_payout_id === row.id);
        if (matches?.length !== 1) return { status: row.status, reviewRequired: true };
        remote = matches[0];
      }
      return applyTransfer(client, row, remote);
    });
  }
  async function tick() {
    if (!config().configured) return { skipped: true };
    // A global non-blocking DB lock spans external dispatches, avoiding parallel
    // workers racing cart allocations or draining the pool with nested queries.
    const lock = await db.connect();
    let acquired = false;
    try {
      acquired = (
        await lock.query("SELECT pg_try_advisory_lock(hashtext('campusmesh:payout-worker')) AS locked")
      ).rows[0].locked;
      if (!acquired) return { busy: true };
      const recipients = (
        await db.query(
          `SELECT user_id FROM payout_accounts WHERE gateway_mode=$1 AND account_id IS NOT NULL
        AND NOT bank_update_pending AND (verified_at IS NULL OR verified_at<NOW()-INTERVAL '12 hours') ORDER BY updated_at LIMIT 3`,
          [config().mode],
        )
      ).rows;
      for (const row of recipients) {
        try {
          await accounts.refresh(row.user_id);
        } catch {
          /* Dispatch remains blocked until fresh verification. */
        }
      }
      await syncLedger(db);
      const rows = (
        await db.query(
          `SELECT id,status FROM payout_intents WHERE gateway_mode=$1
        AND status IN ('AWAITING_SETUP','READY','SUBMITTING','PENDING','TRANSFERRED','REVIEW_REQUIRED')
        ORDER BY updated_at LIMIT 10`,
          [config().mode],
        )
      ).rows;
      let processed = 0;
      for (const row of rows) {
        try {
          await (['AWAITING_SETUP', 'READY'].includes(row.status) ? dispatch(row.id) : reconcile(row.id));
          processed++;
        } catch {
          await db.query(
            "UPDATE payout_intents SET reason='Payout is waiting for recipient or provider review.',updated_at=NOW() WHERE id=$1",
            [row.id],
          );
        }
      }
      return { processed };
    } finally {
      if (acquired) await lock.query("SELECT pg_advisory_unlock(hashtext('campusmesh:payout-worker'))");
      lock.release();
    }
  }
  async function onWebhook(event) {
    if (!config().configured) return;
    if (event.event.startsWith('product.route.')) {
      const product = event.payload?.merchant_product?.entity;
      const row = (
        await db.query(
          'SELECT user_id FROM payout_accounts WHERE account_id=$1 AND product_id=$2 AND gateway_mode=$3',
          [product?.merchant_id, product?.id, config().mode],
        )
      ).rows[0];
      if (row) await accounts.refresh(row.user_id);
    } else if (event.event.startsWith('transfer.')) {
      const transfer = event.payload?.transfer?.entity;
      const row = (
        await db.query('SELECT id FROM payout_intents WHERE gateway_transfer_id=$1 OR id::text=$2', [
          transfer?.id,
          transfer?.notes?.campusmesh_payout_id || '',
        ])
      ).rows[0];
      if (row) await reconcile(row.id);
    } else if (event.event === 'settlement.processed') {
      // Re-fetch each known transfer. A parent-account settlement is not proof
      // that every recipient received money.
      const rows = (
        await db.query(
          "SELECT id FROM payout_intents WHERE gateway_mode=$1 AND status IN ('PENDING','TRANSFERRED') ORDER BY updated_at LIMIT 25",
          [config().mode],
        )
      ).rows;
      for (const row of rows) await reconcile(row.id);
    }
  }
  return { summary, dispatch, reconcile, tick, onWebhook, accounts };
}
module.exports = { createPayoutService };
