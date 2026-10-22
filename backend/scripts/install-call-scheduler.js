// Run explicitly on Supabase after configuring the same secret on the API.
// No secrets are embedded in cron commands or printed by this script.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const pool = require('../src/config/database');
async function install() {
  const secret = process.env.CALLS_SCHEDULER_SECRET;
  const base = process.env.CALLS_SCHEDULER_API_URL || process.env.PUBLIC_API_URL;
  if (!secret || secret.length < 32 || !/^https:\/\//.test(base || ''))
    throw Error('Configure the scheduler secret and HTTPS API URL first.');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_net');
    for (const [name, value] of [
      ['campusmesh_calls_secret', secret],
      ['campusmesh_calls_url', base.replace(/\/$/, '')],
    ]) {
      const old = await c.query('SELECT id FROM vault.secrets WHERE name=$1', [name]);
      if (old.rowCount) await c.query('SELECT vault.update_secret($1,$2)', [old.rows[0].id, value]);
      else await c.query('SELECT vault.create_secret($1,$2)', [value, name]);
    }
    await c.query(`CREATE OR REPLACE FUNCTION public.campusmesh_call_tick() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE request_id bigint; local_now timestamp := now() AT TIME ZONE 'Asia/Kolkata';
    BEGIN
      IF local_now::time < time '09:00' OR local_now::time >= time '19:00' THEN RETURN NULL; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.call_preferences WHERE phone_verified_at IS NOT NULL AND (login_calls_enabled OR welcome_enabled OR booking_enabled OR reminders_enabled OR recommendations_enabled)) THEN RETURN NULL; END IF;
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='campusmesh_calls_url') || '/api/call-scheduler/tick',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='campusmesh_calls_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 90000
      ) INTO request_id;
      RETURN request_id;
    END $$`);
    await c.query('REVOKE ALL ON FUNCTION public.campusmesh_call_tick() FROM PUBLIC, anon, authenticated');
    await c.query(
      "SELECT cron.schedule('campusmesh-automated-calls','*/15 * * * *','SELECT public.campusmesh_call_tick()')",
    );
    await c.query('COMMIT');
    console.log(
      'Call scheduler installed: every 15 minutes during 09:00–19:00 India time; no outbound request without opted-in verified users.',
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
