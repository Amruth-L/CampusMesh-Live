const { createHmac } = require('node:crypto');
let nextCleanup = 0;
function requestLimit({ scope, limit, seconds, user = false, db = require('../config/database') }) {
  return async (req, res, next) => {
    try {
      const identity = user ? req.user?.id : req.ip;
      if (!identity) return res.status(401).json({ error: 'Sign in to continue.' });
      const bucket = createHmac('sha256', process.env.JWT_SECRET)
        .update(`${scope}:${identity}`)
        .digest('hex');
      const { rows } = await db.query(
        `INSERT INTO request_rate_limits(bucket,attempts,expires_at)
        VALUES($1,1,NOW()+$2*INTERVAL '1 second') ON CONFLICT(bucket) DO UPDATE SET
        attempts=CASE WHEN request_rate_limits.expires_at<=NOW() THEN 1 ELSE request_rate_limits.attempts+1 END,
        expires_at=CASE WHEN request_rate_limits.expires_at<=NOW() THEN NOW()+$2*INTERVAL '1 second' ELSE request_rate_limits.expires_at END
        RETURNING attempts,GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::int AS retry`,
        [bucket, seconds],
      );
      if (Date.now() >= nextCleanup) {
        nextCleanup = Date.now() + 60000;
        await db.query('DELETE FROM request_rate_limits WHERE expires_at<NOW()');
      }
      if (rows[0].attempts > limit)
        return res
          .set('Retry-After', String(rows[0].retry))
          .status(429)
          .json({ error: 'Too many requests. Please wait before trying again.', retryAfter: rows[0].retry });
      next();
    } catch {
      res.status(503).json({ error: 'This service is temporarily unavailable. Please retry shortly.' });
    }
  };
}
module.exports = { requestLimit };
