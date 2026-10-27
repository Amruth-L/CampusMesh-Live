const jwt = require('jsonwebtoken');
const { isUuid } = require('../shared/validation');
const invalid = () =>
  Object.assign(new Error('Your session has ended. Please sign in again.'), { status: 403 });

async function authenticateToken(token, db = require('../config/database')) {
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (
      !isUuid(claims.id) ||
      !Number.isInteger(claims.session_version ?? 0) ||
      (claims.session_version ?? 0) < 0
    )
      throw invalid();
  } catch {
    throw invalid();
  }
  const { rows } = await db.query('SELECT id,auth_version,email_verified FROM users WHERE id=$1', [
    claims.id,
  ]);
  // Version-zero tokens from the preceding release remain usable until revoked.
  if (!rows[0] || rows[0].auth_version !== (claims.session_version ?? 0)) throw invalid();
  return claims;
}

function watchSocketSession(socket, claims, token, db, { checkPackets = true } = {}) {
  let checking;
  const check = () =>
    (checking ||= authenticateToken(token, db).finally(() => {
      checking = null;
    }));
  const disconnect = () => socket.disconnect(true);
  const poll = globalThis.setInterval(() => check().catch(disconnect), 30000);
  poll.unref?.();
  const expiry = claims.exp
    ? globalThis.setTimeout(disconnect, Math.max(0, Math.min(claims.exp * 1000 - Date.now(), 2147483647)))
    : null;
  expiry?.unref?.();
  if (checkPackets)
    socket.use((_packet, next) =>
      check()
        .then(() => next())
        .catch(disconnect),
    );
  socket.on('disconnect', () => {
    globalThis.clearInterval(poll);
    globalThis.clearTimeout(expiry);
  });
}
module.exports = { authenticateToken, watchSocketSession };
