// Operator-only provisioning. This never initiates a transfer. Create the
// recipient and complete required KYC in Razorpay first; do not use chat for bank details.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const db = require('../src/config/database');
const gateway = require('../src/config/razorpay');
const { modeFor, providerRead } = require('../src/modules/payouts/payout-config');
const { recipientVerification } = require('../src/modules/payouts/payout-verification');
async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => args[args.indexOf('--' + name) + 1];
  const email = args.includes('--user') ? arg('user') : '';
  const account = args.includes('--account') ? arg('account') : '';
  const productId = args.includes('--product') ? arg('product') : '';
  const mode = modeFor();
  if (args.includes('--list-requests')) {
    const rows = (
      await db.query(
        "SELECT u.email,a.status,a.requested_at FROM payout_accounts a JOIN users u ON u.id=a.user_id WHERE a.gateway_mode=$1 AND a.status IN ('REQUESTED','PENDING','NEEDS_ATTENTION') ORDER BY a.requested_at",
        [mode],
      )
    ).rows;
    console.log(JSON.stringify({ mode, requests: rows }));
    return;
  }
  if (!email || !/^acc_[A-Za-z0-9]+$/.test(account) || !/^acc_prd_[A-Za-z0-9]+$/.test(productId) || !mode)
    throw Error(
      'Usage: node scripts/link-payout-account.js --user college-email --account acc_ID --product acc_prd_ID',
    );
  const user = (await db.query('SELECT id,email_verified FROM users WHERE LOWER(email)=LOWER($1)', [email]))
    .rows[0];
  if (!user?.email_verified) throw Error('A verified CampusMesh recipient is required.');
  const providerAccount = await providerRead(() => gateway.accounts.fetch(account));
  const product = await providerRead(() => gateway.products.fetch(account, productId));
  if (
    providerAccount.id !== account ||
    providerAccount.email?.toLowerCase() !== email.toLowerCase() ||
    product.id !== productId ||
    product.product_name !== 'route' ||
    (product.merchant_id && product.merchant_id !== account)
  )
    throw Error('Provider account, verified campus email and Route product must match.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const existing = (
      await client.query(
        'SELECT bank_update_pending,onboarding_method FROM payout_accounts WHERE user_id=$1 AND gateway_mode=$2 FOR UPDATE',
        [user.id, mode],
      )
    ).rows[0];
    if (existing?.bank_update_pending && !args.includes('--resolve-bank-update'))
      throw Error(
        'A bank change needs manual review. Verify the provider result before using --resolve-bank-update.',
      );
    const pending = await client.query(
      "SELECT id FROM payout_intents WHERE user_id=$1 AND gateway_mode=$2 AND status IN ('SUBMITTING','PENDING','TRANSFERRED','REVIEW_REQUIRED')",
      [user.id, mode],
    );
    if (pending.rowCount)
      throw Error('Resolve outstanding transfers before linking or changing this account.');
    const method = Array.isArray(product.active_configuration?.settlement_accounts) || existing?.onboarding_method === 'composite' ? 'composite' : 'operator';
    const verified = recipientVerification(product, method === 'composite');
    await client.query(
      `INSERT INTO payout_accounts(user_id,gateway_mode,account_id,product_id,status,bank_last4,beneficiary_name,verified_at,onboarding_method)
      VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='ACTIVE' THEN NOW() END,$8)
      ON CONFLICT(user_id,gateway_mode) DO UPDATE SET account_id=$3,product_id=$4,status=$5,
      bank_last4=$6,beneficiary_name=$7,verified_at=CASE WHEN $5='ACTIVE' THEN NOW() END,
      bank_update_pending=FALSE,onboarding_method=$8,revision=payout_accounts.revision+1,updated_at=NOW()`,
      [
        user.id,
        mode,
        account,
        productId,
        verified.status,
        verified.bankLast4,
        verified.beneficiaryName,
        method,
      ],
    );
    await client.query(
      "INSERT INTO payout_audit(user_id,action,metadata) VALUES($1,'OPERATOR_LINKED_RECIPIENT',$2)",
      [user.id, { mode, account_id: account, product_id: productId }],
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify({ linked: true, mode, status: verified.status, transfersInitiated: 0 }),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Provider verification failed. No account was linked.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.end());
