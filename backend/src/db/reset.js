const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('../config/database');
const migrate = require('./migrate');

const knownTables = [
  'schema_migrations',
  'transaction_events',
  'handover_verifications',
  'delivery_location_updates',
  'delivery_offers',
  'xerox_requests',
  'delivery_requests',
  'courier_route_availability',
  'campus_pathways',
  'campus_locations',
  'pending_orders',
  'refunds',
  'payments',
  'rentals',
  'listing_interactions',
  'wishlist',
  'cart',
  'listings',
  'system_config',
  'users',
];

async function reset() {
  const quoted = knownTables.map((name) => `"${name}"`).join(', ');
  await pool.query(`DROP TABLE IF EXISTS ${quoted} CASCADE`);
  console.log('[reset] Removed known CampusMesh tables.');
  await migrate();
}

reset()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
