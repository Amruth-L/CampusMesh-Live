const { createHmac } = require('node:crypto');
// Shared PostgreSQL counters work across API instances. Pair limits prevent one
// IP from locking an account out for everybody; the IP budget limits spraying.
function loginThrottle(db, { windowSeconds = 900, pairLimit = 10, ipLimit = 300 } = {}) {
  return async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const hash = (value) => createHmac('sha256', process.env.JWT_SECRET).update(value).digest('hex');
    const pair = hash(`pair:${req.ip}:${email}`),
      ip = hash(`ip:${req.ip}`);
    try {
      let retry = 0;
      for (const [bucket, limit] of [
        [ip, ipLimit],
        [pair, pairLimit],
      ]) {
        const { rows } = await db.query(
          `INSERT INTO login_attempt_limits(bucket,attempts,expires_at)
          VALUES($1,1,NOW()+$2*INTERVAL '1 second') ON CONFLICT(bucket) DO UPDATE SET
          attempts=CASE WHEN login_attempt_limits.expires_at<=NOW() THEN 1 ELSE login_attempt_limits.attempts+1 END,
          expires_at=CASE WHEN login_attempt_limits.expires_at<=NOW() THEN NOW()+$2*INTERVAL '1 second' ELSE login_attempt_limits.expires_at END
          RETURNING attempts, CEIL(EXTRACT(EPOCH FROM expires_at-NOW()))::int AS retry`,
          [bucket, windowSeconds],
        );
        if (rows[0].attempts > limit) {
          retry = rows[0].retry;
          break;
        }
      }
      await db.query('DELETE FROM login_attempt_limits WHERE expires_at<NOW()');
      if (retry)
        return res
          .set('Retry-After', String(retry))
          .status(429)
          .json({
            error: 'Too many sign-in attempts. Wait a few minutes or use account recovery.',
            retryAfter: retry,
          });
      req.clearLoginAttempts = () => db.query('DELETE FROM login_attempt_limits WHERE bucket=$1', [pair]);
      next();
    } catch {
      res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' });
    }
  };
}
module.exports = { loginThrottle };
