const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('../config/database');
const seedCatalog = require('./catalog');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT id FROM users WHERE email='studenta@dbit.co.in'");
    if (!rows[0]) throw new Error('Create the demo owner before seeding the catalog.');
    await seedCatalog(client, rows[0].id);
    await client.query('COMMIT');
    console.log('[catalog] 30 demo listings ready; five per category. Existing rental IDs preserved.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
