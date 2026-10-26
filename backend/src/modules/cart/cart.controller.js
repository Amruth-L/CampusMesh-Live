const { dateError, rentalDays } = require('../../../../shared/rental-dates.js');
const { isUuid } = require('../../shared/validation');
const { rentalQuote } = require('../../shared/rental-quote');
const pool = require('../../config/database');

exports.addToCart = async (req, res) => {
  const {
    item_id,
    start_date,
    end_date,
    delivery_mode = 'SELF_PICKUP',
    delivery_requested = false,
    drop_location_id = null,
  } = req.body;
  const user_id = req.user.id;

  if (typeof delivery_mode !== 'string' || delivery_mode.length > 30 || (drop_location_id !== null && typeof drop_location_id !== 'string'))
    return res.status(400).json({error:'Choose a valid delivery mode and campus location.'});

  if (!item_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'item_id, start_date, and end_date are required.' });
  }

  const invalidDates = dateError(start_date,end_date);
  if (!isUuid(item_id) || invalidDates || rentalDays(start_date,end_date)>366 || typeof delivery_requested !== 'boolean') return res.status(400).json({error:invalidDates || 'Choose a valid item and delivery option (up to 366 days).'});
  try {
    // 1. Fetch listing details to verify existence and get rent price
    const listingRes = await pool.query('SELECT * FROM listings WHERE id = $1 AND deleted_at IS NULL', [item_id]);
    if (listingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    const listing = listingRes.rows[0];

    // Don't let users rent their own items
    if (listing.owner_id === user_id) {
      return res.status(400).json({ error: 'You cannot add your own listings to the cart.' });
    }

    const days = rentalDays(start_date,end_date);
    if (delivery_requested && (!listing.delivery_available || !drop_location_id || !(await pool.query('SELECT id FROM campus_locations WHERE id=$1',[drop_location_id])).rowCount)) {
      return res.status(400).json({ error: 'Choose an available campus drop location for delivery.' });
    }

    // 3. Calculate subtotal
    const price_per_day = parseFloat(listing.rent_price || 0);
    const quote = rentalQuote(listing,days,delivery_requested,require('../direct-upi/service').enabled());
    const subtotal = quote.rentalFee;

    // 4. Insert or update cart
    const cartRes = await pool.query(
      `INSERT INTO cart (user_id, item_id, start_date, end_date, days, price_per_day, subtotal, delivery_mode, delivery_requested, drop_location_id, delivery_charge, platform_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id, item_id)
       DO UPDATE SET
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         days = EXCLUDED.days,
         price_per_day = EXCLUDED.price_per_day,
         subtotal = EXCLUDED.subtotal,
         delivery_mode = EXCLUDED.delivery_mode,
         delivery_requested = EXCLUDED.delivery_requested,
         drop_location_id = EXCLUDED.drop_location_id,
         delivery_charge = EXCLUDED.delivery_charge,
         platform_fee = EXCLUDED.platform_fee,
         created_at = NOW()
       RETURNING *`,
      [
        user_id,
        item_id,
        start_date,
        end_date,
        days,
        price_per_day,
        subtotal,
        delivery_mode,
        !!delivery_requested,
        drop_location_id,
        quote.deliveryFee,
        quote.platformFee,
      ],
    );
    await pool.query(
      "INSERT INTO listing_interactions(listing_id,user_id,interaction_type) VALUES($1,$2,'CART')",
      [item_id, user_id],
    );

    res.status(201).json({
      message: 'Item added to cart successfully.',
      cartItem: cartRes.rows[0],
    });
  } catch (error) {
    console.error('[CartController] addToCart error:', error.message);
    res.status(500).json({ error: 'Failed to add item to cart.' });
  }
};

exports.getCart = async (req, res) => {
  const user_id = req.user.id;

  try {
    const cartRes = await pool.query(
      `SELECT 
         c.id,c.item_id,c.start_date::text,c.end_date::text,c.days,c.price_per_day,c.subtotal,c.delivery_mode,
         c.delivery_requested,c.drop_location_id,c.delivery_charge,c.platform_fee,
         l.title, l.description, l.image_url, l.location, l.deposit, l.delivery_available, l.delivery_charge, l.rent_price, l.price,
         u.name as owner_name
       FROM cart c
       JOIN listings l ON c.item_id = l.id
       JOIN users u ON l.owner_id = u.id
       WHERE c.user_id = $1 AND l.deleted_at IS NULL
       ORDER BY c.created_at DESC`,
      [user_id],
    );

    res.json(cartRes.rows.map(row => {
      const quote = rentalQuote(row,rentalDays(row.start_date,row.end_date),row.delivery_requested,require('../direct-upi/service').enabled());
      return {...row,quote,days:quote.days,price_per_day:Number(row.rent_price),subtotal:quote.rentalFee,platform_fee:quote.platformFee,delivery_charge:quote.deliveryFee};
    }));
  } catch (error) {
    console.error('[CartController] getCart error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve cart items.' });
  }
};

exports.updateCartDates = async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date } = req.body;
  const user_id = req.user.id;
  if ((req.body.delivery_requested !== undefined && typeof req.body.delivery_requested !== 'boolean') ||
    (req.body.drop_location_id != null && typeof req.body.drop_location_id !== 'string'))
    return res.status(400).json({error:'Choose a valid delivery option and campus location.'});

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required.' });
  }

  const invalidDates = dateError(start_date,end_date);
  if (!isUuid(id) || invalidDates || rentalDays(start_date,end_date)>366) return res.status(400).json({error:invalidDates || 'Choose valid cart dates (up to 366 days).'});
  try {
    // 1. Fetch existing cart item to get price_per_day
    const cartCheck = await pool.query('SELECT * FROM cart WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (cartCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }
    const cartItem = cartCheck.rows[0];
    const delivery = req.body.delivery_requested ?? cartItem.delivery_requested;
    const destination = delivery ? req.body.drop_location_id ?? cartItem.drop_location_id : null;

    const days = rentalDays(start_date,end_date);
    const listing = (await pool.query('SELECT * FROM listings WHERE id=$1 AND deleted_at IS NULL',[cartItem.item_id])).rows[0];
    if (!listing) return res.status(404).json({error:'Listing unavailable.'});
    if (delivery && (!listing.delivery_available || !destination || !(await pool.query('SELECT id FROM campus_locations WHERE id=$1',[destination])).rowCount))
      return res.status(400).json({error:'Choose an available campus drop location for delivery.'});
    const quote = rentalQuote(listing,days,delivery,require('../direct-upi/service').enabled());
    const subtotal = quote.rentalFee;
    // 4. Update
    const updateRes = await pool.query(
      `UPDATE cart 
       SET start_date = $1, end_date = $2, days = $3, subtotal = $4, platform_fee = $7, price_per_day=$8, delivery_charge=$9, delivery_requested=$10,drop_location_id=$11, created_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [start_date, end_date, days, subtotal, id, user_id,quote.platformFee,Number(listing.rent_price),quote.deliveryFee,delivery,destination],
    );

    res.json({
      message: 'Cart item updated successfully.',
      quote,
      cartItem: require('../direct-upi/service').enabled()?{...updateRes.rows[0],platform_fee:0}:updateRes.rows[0],
    });
  } catch (error) {
    console.error('[CartController] updateCartDates error:', error.message);
    res.status(500).json({ error: 'Failed to update cart dates.' });
  }
};

exports.removeFromCart = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;
  if (!isUuid(id)) return res.status(400).json({error:'Invalid cart item ID.'});

  try {
    const deleteRes = await pool.query('DELETE FROM cart WHERE id = $1 AND user_id = $2 RETURNING *', [
      id,
      user_id,
    ]);
    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }

    res.json({ message: 'Item removed from cart.' });
  } catch (error) {
    console.error('[CartController] removeFromCart error:', error.message);
    res.status(500).json({ error: 'Failed to remove item from cart.' });
  }
};

