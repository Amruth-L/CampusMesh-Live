// Run explicitly on Supabase after configuring the same secret on the API.
// No secrets are embedded in cron commands or printed by this script.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const pool = require('../src/config/database');
async function install() {
  const secret = process.env.PAYOUTS_SCHEDULER_SECRET;
  const base = process.env.PAYOUTS_SCHEDULER_API_URL || process.env.PUBLIC_API_URL;
  if (!secret || secret.length < 32 || !/^https:\/\//.test(base || ''))
    throw Error('Configure the scheduler secret and HTTPS API URL first.');
  if (process.env.PAYOUTS_ENABLED !== 'true' || process.env.RAZORPAY_ROUTE_APPROVED !== 'true')
    throw Error('Activate the approved and funded payout service before installing its scheduler.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_net');
    for (const [name, value] of [
      ['campusmesh_payouts_secret', secret],
      ['campusmesh_payouts_url', base.replace(/\/$/, '')],
    ]) {
      const old = await c.query('SELECT id FROM vault.secrets WHERE name=$1', [name]);
      if (old.rowCount) await c.query('SELECT vault.update_secret($1,$2)', [old.rows[0].id, value]);
      else await c.query('SELECT vault.create_secret($1,$2)', [value, name]);
    }
    await c.query(`CREATE OR REPLACE FUNCTION public.campusmesh_payout_tick() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE request_id bigint;
    BEGIN
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='campusmesh_payouts_url') || '/api/payout-scheduler/tick',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='campusmesh_payouts_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 90000
      ) INTO request_id;
      RETURN request_id;
    END $$`);
    await c.query('REVOKE ALL ON FUNCTION public.campusmesh_payout_tick() FROM PUBLIC, anon, authenticated');
    await c.query(
      "SELECT cron.schedule('campusmesh-bank-payouts','*/15 * * * *','SELECT public.campusmesh_payout_tick()')",
    );
    await c.query('COMMIT');
    console.log(
      'Payout scheduler installed: every 15 minutes. Disabled or unapproved services never submit transfers.',
    );
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
install()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
