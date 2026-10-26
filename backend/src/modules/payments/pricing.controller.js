const pool = require('../../config/database');
const { isUuid } = require('../../shared/validation');
const { dateError, rentalDays } = require('../../../../shared/rental-dates.js');
const { rentalQuote } = require('../../shared/rental-quote');
exports.calculatePricingHandler = async (req,res) => {
  const { listing_id, start_date, end_date, rental_days, delivery_type = 'SELF_PICKUP' } = req.body;
  if (!isUuid(listing_id)) return res.status(400).json({ error:'Choose a valid listing.' });
  if (!['STANDARD','DELIVERY','SELF_PICKUP','NONE'].includes(delivery_type)) return res.status(400).json({error:'Choose pickup or delivery.'});
  const days = start_date !== undefined || end_date !== undefined ? rentalDays(start_date,end_date) : rental_days;
  const error = start_date !== undefined || end_date !== undefined ? dateError(start_date,end_date) : '';
  if (error || !Number.isInteger(days) || days<1 || days>366) return res.status(400).json({error:error || 'Choose between 1 and 366 rental days.'});
  try {
    const { rows } = await pool.query('SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL AND COALESCE(is_active,true)',[listing_id]);
    if (!rows[0]) return res.status(404).json({error:'Listing unavailable.'});
    const delivery = ['STANDARD','DELIVERY'].includes(delivery_type);
    if (delivery && !rows[0].delivery_available) return res.status(400).json({error:'This item is available for pickup only.'});
    res.json(rentalQuote(rows[0],days,delivery,require('../direct-upi/service').enabled()));
  } catch { res.status(503).json({error:'Could not load your quote. Please retry.'}); }
};
