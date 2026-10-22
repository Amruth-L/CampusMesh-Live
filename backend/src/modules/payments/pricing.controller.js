const pool = require('../../config/database');
const { calculatePricing } = require('../../shared/pricing-engine');

exports.calculatePricingHandler = async (req, res) => {
  try {
    const {
      listing_id,
      daily_rent,
      rental_days,
      start_date,
      end_date,
      delivery_type,
      owner_location,
      renter_location,
      distance_km,
      item_value,
      custom_deposit
    } = req.body;

    let rent = parseFloat(daily_rent);
    let itemPrice = parseFloat(item_value);
    let ownerLoc = owner_location || '';
    let itemDeposit = custom_deposit;

    // Calculate days if dates are passed
    let days = parseInt(rental_days, 10);
    if ((!days || isNaN(days)) && start_date && end_date) {
      const s = new Date(start_date);
      const e = new Date(end_date);
      const diff = e.getTime() - s.getTime();
      days = Math.max(1, Math.ceil(diff / (1000 * 3600 * 24)));
    }
    if (!days || isNaN(days)) days = 1;

    // If listing_id is provided, look up listing from DB for default rates
    if (listing_id) {
      const listingRes = await pool.query('SELECT * FROM listings WHERE id = $1', [listing_id]);
      if (listingRes.rows.length > 0) {
        const listing = listingRes.rows[0];
        if (isNaN(rent)) rent = parseFloat(listing.rent_price || listing.price || 0);
        if (isNaN(itemPrice)) itemPrice = parseFloat(listing.price || 0);
        if (!ownerLoc) ownerLoc = listing.location || '';
        if (itemDeposit === undefined || itemDeposit === null) itemDeposit = parseFloat(listing.deposit || 0);
      }
    }

    const breakdown = calculatePricing({
      dailyRent: rent || 0,
      days,
      deliveryType: delivery_type,
      ownerLocation: ownerLoc,
      renterLocation: renter_location || '',
      distance: distance_km,
      itemValue: itemPrice || 0,
      customDeposit: itemDeposit
    });

    return res.status(200).json(breakdown);
  } catch (error) {
    console.error('[PricingController] Calculation Error:', error.message);
    return res.status(500).json({ error: 'Failed to calculate pricing breakdown.' });
  }
};

