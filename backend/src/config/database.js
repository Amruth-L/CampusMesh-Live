const pg = require('pg');
const { Pool } = pg;

// The schema stores timestamps without a timezone while the database session
// runs in UTC. node-postgres otherwise interprets them in the host timezone,
// which can make a valid courier route look expired to the matcher.
pg.types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (error) => {
  console.error('[database] Unexpected idle client error', error);
});

module.exports = pool;
