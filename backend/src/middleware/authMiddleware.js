const { authenticateToken } = require('../security/session');

const createAuthMiddleware = (db) => async (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = await authenticateToken(token, db);
    res.set('Cache-Control', 'no-store');
    next();
  } catch (error) {
    res
      .status(error.status || 503)
      .json({ error: error.status ? error.message : 'We could not check your session. Please retry.' });
  }
};

module.exports = createAuthMiddleware();
module.exports.withDatabase = createAuthMiddleware;
