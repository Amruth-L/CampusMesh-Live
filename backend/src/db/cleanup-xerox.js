const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('../config/database');
const { deletePrivatePdf } = require('../modules/xerox/private-pdf-storage');

async function cleanup() {
  const days = Math.max(1, Number(process.env.XEROX_RETENTION_DAYS) || 7);
  const { rows } = await pool.query(
    `SELECT id,file_storage_path FROM xerox_requests
     WHERE status='COMPLETED' AND completed_at < NOW()-($1||' days')::interval
       AND (file_data IS NOT NULL OR file_storage_path IS NOT NULL)`,
    [String(days)],
  );
  for (const item of rows) {
    await deletePrivatePdf(item.file_storage_path);
    await pool.query('UPDATE xerox_requests SET file_data=NULL,file_storage_path=NULL WHERE id=$1', [item.id]);
  }
  console.log(`[xerox] Purged ${rows.length} retained document(s).`);
}

cleanup().catch(error => { console.error(error); process.exitCode=1; }).finally(()=>pool.end());
