const auth = require('../../middleware/authMiddleware');
const { createAccountService } = require('./payout-accounts');
// Banking setup is checked before a live job is accepted. Existing active jobs
// can always be finished; changing payout setup never strands an item in transit.
module.exports = (req, res, next) => {
  if (req.method !== 'POST' || !/^\/[^/]+\/(accept|claim)$/.test(req.path)) return next();
  return auth(req, res, async () => {
    try {
      const deliveryId = req.path.split('/')[1];
      const direct = (await require('../../config/database').query(`SELECT r.payment_method FROM delivery_requests d JOIN rentals r ON r.id=d.rental_id WHERE d.id=$1`,[deliveryId])).rows[0]?.payment_method==='DIRECT_UPI';
      if (direct) {
        const profile = await require('../direct-upi/service').createService().profile(req.user.id);
        if (!profile) return res.status(409).json({error:'Save your UPI ID in Payments before accepting direct-payment deliveries.'});
        return next();
      }
      await createAccountService().assertRecipients([req.user.id]);
      next();
    } catch (error) {
      res
        .status(error.status || 503)
        .json({ error: error.message || 'Complete payout setup before accepting this live delivery.' });
    }
  });
};
