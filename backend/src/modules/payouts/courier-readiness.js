const auth = require('../../middleware/authMiddleware');
const { createAccountService } = require('./payout-accounts');
// Banking setup is checked before a live job is accepted. Existing active jobs
// can always be finished; changing payout setup never strands an item in transit.
module.exports = (req, res, next) => {
  if (req.method !== 'POST' || !/^\/[^/]+\/(accept|claim)$/.test(req.path)) return next();
  return auth(req, res, async () => {
    try {
      await createAccountService().assertRecipients([req.user.id]);
      next();
    } catch (error) {
      res
        .status(error.status || 503)
        .json({ error: error.message || 'Complete payout setup before accepting this live delivery.' });
    }
  });
};
