const { createHmac, randomUUID } = require('node:crypto');
const { fail } = require('./payout-config');
const { recipientVerification } = require('./payout-verification');

// SDK 2.x does not forward Idempotency-Key for accounts.create. Use the
// documented composite endpoint with an abortable request instead.
async function createRecipient(payload, key, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw fail('Payment service is not configured.', 503);
  const response = await fetchImpl('https://api.razorpay.com/v2/accounts', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    // Never echo provider descriptions: they can contain PAN/bank values.
    const routeDisabled = /^route feature not enabled for the merchant\.?$/i.test(String(body?.error?.description || '').trim());
    const messages = {
      400: 'Razorpay rejected bank onboarding. Contact CampusMesh support to check the rejected field and merchant permissions before resubmitting.',
      401: 'Razorpay authentication failed. CampusMesh support must check the payment configuration.',
      403: 'Razorpay has not permitted recipient onboarding for this merchant. Contact CampusMesh support.',
      409: 'Razorpay reports an existing account or conflicting setup request. Support must reconcile it before you try different details.',
      429: 'Razorpay is busy. Wait a minute and retry with the same details.',
    };
    const error = fail(routeDisabled
      ? 'Razorpay Route is not enabled for CampusMesh. Bank onboarding is unavailable until Razorpay approves marketplace payouts. Changing your bank details will not resolve this.'
      : messages[response.status] || 'Razorpay could not confirm setup. Retry with the same details.', !routeDisabled && response.status === 400 ? 400 : 503);
    if (routeDisabled) error.code = 'ROUTE_NOT_ENABLED';
    error.definitiveRejection = [400, 422].includes(response.status);
    throw error;
  }
  return body;
}

function onboardingPayload(user, mode, body) {
  const name = String(body.beneficiary_name || '').trim().replace(/\s+/g, ' ');
  const number = String(body.account_number || '').trim();
  const confirm = String(body.account_number_confirmation || '').trim();
  const ifsc = String(body.ifsc || '').trim().toUpperCase();
  const pan = String(body.pan || '').trim().toUpperCase();
  let phone = String(body.phone || '').replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(phone)) phone = '+91' + phone;
  if (!user.email_verified) throw fail('Verify your campus email before setting up bank payouts.', 403);
  if (name.length < 4 || name.length > 120) throw fail('Enter your full legal name as shown on your PAN and bank account.', 400);
  if (!/^\d{9,18}$/.test(number) || number !== confirm) throw fail('Enter your bank account number twice. Both entries must match.', 400);
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw fail('Enter a valid 11-character IFSC code.', 400);
  if (!/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/.test(pan)) throw fail('Enter your individual PAN. Business accounts need assisted onboarding.', 400);
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw fail('Enter your Indian mobile number with +91.', 400);
  if (body.confirm !== true || body.tnc_accepted !== true) throw fail('Confirm account ownership and accept Razorpay’s terms to submit.', 400);
  return {
    type: 'route', tnc_accepted: true,
    reference_id: `campusmesh_${mode}_${user.id}`,
    legal_business_name: name, business_type: 'individual', email: user.email, phone,
    legal_info: { pan },
    settlement_accounts: [{ method: 'bank_account', bank_account: {
      account_number: number, beneficiary_name: name, code_type: 'ifsc', code: ifsc, currency: 'INR', is_default: true,
    } }],
  };
}

function createOnboardingService({ db, config, submit = createRecipient, fingerprint = (payload) => {
  if (!process.env.RAZORPAY_KEY_SECRET) throw fail('Payment service is not configured.', 503);
  return createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(JSON.stringify(payload)).digest('hex');
} }) {
  return async function onboard(userId, body) {
    const settings = config();
    if (!settings.configured) throw fail(settings.message, 503);
    const user = (await db.query('SELECT id,email,email_verified FROM users WHERE id=$1', [userId])).rows[0];
    if (!user) throw fail('Account not found.', 404);
    const payload = onboardingPayload(user, settings.mode, body);
    const hash = fingerprint(payload);
    const client = await db.connect();
    let row;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO payout_accounts(user_id,gateway_mode,status,requested_at)
        VALUES($1,$2,'REQUESTED',NOW()) ON CONFLICT(user_id,gateway_mode) DO NOTHING`, [userId, settings.mode]);
      row = (await client.query('SELECT * FROM payout_accounts WHERE user_id=$1 AND gateway_mode=$2 FOR UPDATE', [userId, settings.mode])).rows[0];
      if (row.account_id || row.product_id) throw fail('Your recipient is already linked. Refresh its verification instead.');
      if (row.onboarding_busy_until && new Date(row.onboarding_busy_until) > new Date()) throw fail('Your setup is being submitted. Wait a moment before retrying.');
      if (row.onboarding_hash && row.onboarding_hash !== hash) throw fail('A previous submission is awaiting confirmation. Retry the exact same details or contact support before changing them.');
      row.onboarding_key ||= randomUUID();
      await client.query(`UPDATE payout_accounts SET onboarding_method='composite',onboarding_key=$1,onboarding_hash=$2,
        onboarding_busy_until=NOW()+INTERVAL '30 seconds',onboarding_submitted_at=COALESCE(onboarding_submitted_at,NOW()),
        status='PENDING',updated_at=NOW() WHERE id=$3`, [row.onboarding_key, hash, row.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    let remote;
    try {
      remote = await submit(payload, row.onboarding_key);
    } catch (error) {
      await db.query(`UPDATE payout_accounts SET onboarding_busy_until=NULL,
        onboarding_key=CASE WHEN $1 THEN NULL ELSE onboarding_key END,
        onboarding_hash=CASE WHEN $1 THEN NULL ELSE onboarding_hash END,
        status=CASE WHEN $1 THEN 'REQUESTED' ELSE 'PENDING' END,updated_at=NOW()
        WHERE id=$2 AND onboarding_key=$3 AND account_id IS NULL`, [error.definitiveRejection === true, row.id, row.onboarding_key]);
      throw error.status ? error : fail('Setup confirmation was interrupted. Retry with the same details; no duplicate account will be requested.', 503);
    }
    const product = remote?.product_config;
    if (!/^acc_[A-Za-z0-9]+$/.test(remote?.id || '') || remote.type !== 'route' || remote.reference_id !== payload.reference_id ||
      remote.email?.toLowerCase() !== user.email.toLowerCase() || !/^acc_prd_[A-Za-z0-9]+$/.test(product?.id || '') || product.product_name !== 'route' ||
      (product.merchant_id && product.merchant_id !== remote.id)) {
      throw fail('Razorpay’s response needs reconciliation. Retry the same details or contact support.', 503);
    }
    const verified = recipientVerification(product, true);
    const stored = await db.query(`UPDATE payout_accounts SET account_id=$1,product_id=$2,status=$3,bank_last4=$4,beneficiary_name=$5,
      verified_at=CASE WHEN $3='ACTIVE' THEN NOW() ELSE NULL END,onboarding_busy_until=NULL,
      revision=revision+1,updated_at=NOW() WHERE id=$6 AND onboarding_key=$7 AND account_id IS NULL RETURNING *`,
    [remote.id, product.id, verified.status, verified.bankLast4, verified.beneficiaryName, row.id, row.onboarding_key]);
    if (!stored.rowCount) throw fail('Your setup changed while submitting. Refresh the payout page.');
    await db.query("INSERT INTO payout_audit(user_id,action,metadata) VALUES($1,'RECIPIENT_ONBOARDED',$2)",
      [userId, { mode: settings.mode, account_id: remote.id, termsAccepted: true }]);
    return stored.rows[0];
  };
}
module.exports = { createRecipient, onboardingPayload, createOnboardingService };
