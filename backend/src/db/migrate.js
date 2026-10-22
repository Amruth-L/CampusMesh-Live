const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('../config/database');

const migrationsDirectory = path.join(__dirname, 'migrations');
const replacedSplitMigrations = [
  '001_core_users.sql',
  '002_marketplace_cart.sql',
  '003_rentals_payments.sql',
  '004_campus_delivery.sql',
  '005_handover_events.sql',
  '006_xerox_recommendations.sql',
  '007_indexes_constraints.sql',
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const filenames = (await fs.readdir(migrationsDirectory))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename),
    );
    for (const filename of filenames) {
      if (applied.has(filename)) continue;
      if (
        filename === '001_campusmesh.sql' &&
        replacedSplitMigrations.every((legacyFilename) => applied.has(legacyFilename))
      ) {
        await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
        console.log('[migrate] Consolidated migration already represented by the previous schema ledger.');
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
        await client.query('COMMIT');
        console.log(`[migrate] Applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        error.message = `${filename}: ${error.message}`;
        throw error;
      }
    }
    console.log('[migrate] Database is current.');
  } finally {
    client.release();
  }
}

if (require.main === module)
  migrate()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = migrate;
