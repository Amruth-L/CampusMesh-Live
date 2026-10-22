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

  if (!item_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'item_id, start_date, and end_date are required.' });
  }

  try {
    // 1. Fetch listing details to verify existence and get rent price
    const listingRes = await pool.query('SELECT * FROM listings WHERE id = $1', [item_id]);
    if (listingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    const listing = listingRes.rows[0];

    // Don't let users rent their own items
    if (listing.owner_id === user_id) {
      return res.status(400).json({ error: 'You cannot add your own listings to the cart.' });
    }

    // 2. Calculate days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const timeDiff = end.getTime() - start.getTime();
    if (start < new Date(new Date().toDateString()) || end < start) {
      return res.status(400).json({ error: 'Choose a valid present or future date range.' });
    }
    const days = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
    if (delivery_requested && (!listing.delivery_available || !drop_location_id)) {
      return res.status(400).json({ error: 'Choose an available campus drop location for delivery.' });
    }

    // 3. Calculate subtotal
    const price_per_day = parseFloat(listing.rent_price || 0);
    const subtotal = days * price_per_day;

    // 4. Insert or update cart
    const cartRes = await pool.query(
      `INSERT INTO cart (user_id, item_id, start_date, end_date, days, price_per_day, subtotal, delivery_mode, delivery_requested, drop_location_id, delivery_charge, platform_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (user_id, item_id)
       DO UPDATE SET
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         days = EXCLUDED.days,
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
        delivery_requested ? Number(listing.delivery_charge || 0) : 0,
        Math.max(5, Math.round(subtotal * 0.05)),
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
         c.id,c.item_id,c.start_date,c.end_date,c.days,c.price_per_day,c.subtotal,c.delivery_mode,
         c.delivery_requested,c.drop_location_id,c.delivery_charge,c.platform_fee,
         l.title, l.description, l.image_url, l.location, l.deposit, l.delivery_available, l.delivery_charge,
         u.name as owner_name
       FROM cart c
       JOIN listings l ON c.item_id = l.id
       JOIN users u ON l.owner_id = u.id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [user_id],
    );

    res.json(cartRes.rows.map(row=>require('../direct-upi/service').enabled()?{...row,platform_fee:0}:row));
  } catch (error) {
    console.error('[CartController] getCart error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve cart items.' });
  }
};

exports.updateCartDates = async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date } = req.body;
  const user_id = req.user.id;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required.' });
  }

  try {
    // 1. Fetch existing cart item to get price_per_day
    const cartCheck = await pool.query('SELECT * FROM cart WHERE id = $1 AND user_id = $2', [id, user_id]);
    if (cartCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }
    const cartItem = cartCheck.rows[0];

    // 2. Calculate days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const timeDiff = end.getTime() - start.getTime();
    if (end < start) return res.status(400).json({ error: 'end_date cannot be before start_date.' });
    const days = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;

    // 3. Recalculate subtotal
    const subtotal = days * parseFloat(cartItem.price_per_day);

    // 4. Update
    const updateRes = await pool.query(
      `UPDATE cart 
       SET start_date = $1, end_date = $2, days = $3, subtotal = $4, platform_fee = GREATEST(5, ROUND($4::numeric * 0.05)), created_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [start_date, end_date, days, subtotal, id, user_id],
    );

    res.json({
      message: 'Cart item updated successfully.',
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

