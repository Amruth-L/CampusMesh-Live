const express = require('express');
const pool = require('../../config/database');
const storage = require('./photo-storage');
const router = express.Router();

// Listing photos are visible to marketplace visitors. S3 itself stays private;
// only photos still attached to a listing receive a short-lived download URL.
router.get('/:owner/:file', async (req, res) => {
  if (!storage.PHOTO_PATH.test(req.path.replace(/^\//, '/api/photos/')))
    return res.status(404).json({ error: 'Photo not found.' });
  try {
    const { origin } = storage.storageConfig();
    const url = `${origin}/api/photos/${req.params.owner}/${req.params.file}`;
    const attached = await pool.query(
      'SELECT id FROM listings WHERE image_url=$1 OR image_urls @> ARRAY[$1]::text[] LIMIT 1', [url]);
    if (!attached.rowCount) return res.status(404).json({ error: 'Photo not found.' });
    const target = await storage.downloadUrl(url);
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).redirect(302, target);
  } catch (error) {
    console.error('[photos] download failed', error.name);
    res.status(503).json({ error: 'Photo temporarily unavailable.' });
  }
});
module.exports = router;
