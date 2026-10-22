const pool = require('../../config/database');
const razorpay = require('../../config/razorpay');
const { payoutConfig, fail, providerRead } = require('./payout-config');
const { recipientVerification } = require('./payout-verification');
const { createOnboardingService } = require('./route-onboarding');
const safeAccount = (row) =>
  row
    ? {
        status: row.status,
        beneficiaryName: row.beneficiary_name,
        bankLast4: row.bank_last4,
        requestedAt: row.requested_at,
        verifiedAt: row.verified_at,
        bankEditable: Boolean(row.account_id && row.product_id && !row.bank_update_pending),
        canRefresh: Boolean(row.account_id && row.product_id && !row.bank_update_pending),
        canOnboard: !row.account_id && !row.product_id,
        setupRetry: Boolean(row.onboarding_hash && !row.account_id),
        needsReview: Boolean(row.bank_update_pending || Boolean(row.account_id) !== Boolean(row.product_id)),
      }
    : { status: 'NOT_STARTED', bankEditable: false, canRefresh: false, canOnboard: true, setupRetry: false, needsReview: false };

function createAccountService({ db = pool, gateway = razorpay, config = payoutConfig, submit, fingerprint } = {}) {
  const onboardRecipient = createOnboardingService({ db, config, submit, fingerprint });
  const onboard = async (userId, body) => safeAccount(await onboardRecipient(userId, body));
  function settings() {
    const value = config();
    if (!value.mode) throw fail('Payment service is not configured.', 503);
    return value;
  }
  async function get(userId) {
    const { mode } = settings();
    return (
      await db.query('SELECT * FROM payout_accounts WHERE user_id=$1 AND gateway_mode=$2', [userId, mode])
    ).rows[0];
  }
  async function request(userId) {
    const { mode } = settings();
    const user = (await db.query('SELECT email_verified FROM users WHERE id=$1', [userId])).rows[0];
    if (!user?.email_verified) throw fail('Verify your campus email before requesting bank payouts.', 403);
    await db.query(
      `INSERT INTO payout_accounts(user_id,gateway_mode,status,requested_at) VALUES($1,$2,'REQUESTED',NOW())
      ON CONFLICT(user_id,gateway_mode) DO UPDATE SET requested_at=COALESCE(payout_accounts.requested_at,NOW()),
      status=CASE WHEN payout_accounts.status='NOT_STARTED' THEN 'REQUESTED' ELSE payout_accounts.status END,updated_at=NOW()`,
      [userId, mode],
    );
    return safeAccount(await get(userId));
  }
  async function refresh(userId) {
    if (!config().configured) throw fail(config().message, 503);
    const row = await get(userId);
    if (!row?.account_id || !row.product_id)
      throw fail(
        'Your recipient account must be linked after provider onboarding. Contact CampusMesh support.',
      );
    if (row.bank_update_pending)
      throw fail('A bank update needs provider review. Contact support before requesting another change.');
    const product = await providerRead(() => gateway.products.fetch(row.account_id, row.product_id));
    if (
      product.id !== row.product_id ||
      product.product_name !== 'route' ||
      (product.merchant_id && product.merchant_id !== row.account_id)
    )
      throw fail('Recipient verification did not match the linked account.', 503);
    const verified = recipientVerification(product, row.onboarding_method === 'composite');
    const status = verified.status;
    await db.query(
      `UPDATE payout_accounts SET status=$1,bank_last4=$2,beneficiary_name=$3,
      verified_at=CASE WHEN $1='ACTIVE' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$4 AND revision=$5 AND NOT bank_update_pending`,
      [status, verified.bankLast4 || row.bank_last4, verified.beneficiaryName || row.beneficiary_name, row.id, row.revision],
    );
    return safeAccount(await get(userId));
  }
  async function updateBank(userId, body) {
    if (!config().configured) throw fail(config().message, 503);
    const account = String(body.account_number || '').trim();
    const ifsc = String(body.ifsc || '')
      .trim()
      .toUpperCase();
    const name = String(body.beneficiary_name || '').trim();
    if (
      !/^\d{9,18}$/.test(account) ||
      !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) ||
      name.length < 2 ||
      name.length > 120 ||
      body.confirm !== true
    )
      throw fail(
        'Enter the account-holder name, bank account number and valid IFSC, and confirm the details.',
        400,
      );
    let row = await get(userId);
    if (!row?.account_id || !row.product_id)
      throw fail('Complete recipient onboarding before adding bank details.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = (await client.query('SELECT * FROM payout_accounts WHERE id=$1 FOR UPDATE', [row.id]))
        .rows[0];
      row = locked;
      if (locked.bank_update_pending) throw fail('A bank update already needs review. Contact support.');
      const active = await client.query(
        `SELECT id FROM payout_intents WHERE user_id=$1 AND gateway_mode=$2
        AND status IN ('SUBMITTING','PENDING','TRANSFERRED','REVIEW_REQUIRED') LIMIT 1`,
        [userId, config().mode],
      );
      if (active.rowCount)
        throw fail('A transfer is awaiting confirmation. Contact support before changing the payout bank.');
      // Fail closed before the external change. Full bank details are sent to
      // Razorpay only and are never saved in CampusMesh or audit metadata.
      await client.query(
        "UPDATE payout_accounts SET status='PENDING',revision=revision+1,bank_update_pending=TRUE,verified_at=NULL,updated_at=NOW() WHERE id=$1",
        [row.id],
      );
      await client.query("INSERT INTO payout_audit(user_id,action) VALUES($1,'BANK_UPDATE_REQUESTED')", [
        userId,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    try {
      await providerRead(() =>
        gateway.products.edit(row.account_id, row.product_id, {
          ...(row.onboarding_method === 'composite'
            ? { settlement_accounts: [{ method: 'bank_account', bank_account: {
              account_number: account, code_type: 'ifsc', code: ifsc, beneficiary_name: name, currency: 'INR', is_default: true,
            } }] }
            : { settlements: { account_number: account, ifsc_code: ifsc, beneficiary_name: name } }),
        }),
      );
    } catch {
      throw fail('Bank update needs confirmation. Refresh verification status before retrying.', 503);
    }
    await db.query('UPDATE payout_accounts SET bank_update_pending=FALSE,revision=revision+1 WHERE id=$1', [
      row.id,
    ]);
    return refresh(userId);
  }
  async function assertRecipients(userIds, client = db) {
    const current = config();
    if (current.mode !== 'live') return;
    if (!current.configured)
      throw fail(
        'Live marketplace payments are awaiting payout-service activation. No new payment was started.',
        503,
      );
    const ids = [...new Set(userIds.filter(Boolean))];
    const result = await client.query(
      `SELECT user_id FROM payout_accounts WHERE user_id=ANY($1::uuid[]) AND gateway_mode='live'
      AND status='ACTIVE' AND account_id IS NOT NULL AND product_id IS NOT NULL AND verified_at>NOW()-INTERVAL '24 hours'`,
      [ids],
    );
    if (result.rowCount !== ids.length)
      throw fail('The recipient must complete bank payout verification before this live payment can start.');
  }
  return { get, request, onboard, refresh, updateBank, assertRecipients };
}
module.exports = { createAccountService, safeAccount };
