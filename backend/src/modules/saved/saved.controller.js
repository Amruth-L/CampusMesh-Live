const pool = require('../../config/database');

// GET /api/wishlist - Fetch user's wishlist items with listing and owner details
exports.getWishlist = async (req, res) => {
  const user_id = req.user.id;

  try {
    const result = await pool.query(
      `SELECT 
         w.id as wishlist_id, w.created_at as saved_at,
         l.id, l.title, l.description, l.price, l.category, l.image_url, l.condition,
         l.rent_price, l.deposit, l.location, l.delivery_available, l.delivery_charge, l.pickup_time,
         u.name as owner_name, u.email as owner_email
       FROM wishlist w
       JOIN listings l ON w.item_id = l.id
       JOIN users u ON l.owner_id = u.id
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC`,
      [user_id],
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[WishlistController] getWishlist error:', error.message);
    res.status(500).json({ error: 'Failed to fetch wishlist items.' });
  }
};

// POST /api/wishlist/toggle - Toggle save item
exports.toggleWishlist = async (req, res) => {
  const user_id = req.user.id;
  const item_id = req.body.item_id ? String(req.body.item_id).trim() : null;

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required.' });
  }

  try {
    // Check if item exists in listings
    const listingCheck = await pool.query('SELECT id FROM listings WHERE id = $1', [item_id]);
    if (listingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    // Check if already in wishlist
    const checkRes = await pool.query('SELECT id FROM wishlist WHERE user_id = $1 AND item_id = $2', [
      user_id,
      item_id,
    ]);

    if (checkRes.rows.length > 0) {
      // Remove from wishlist
      await pool.query('DELETE FROM wishlist WHERE user_id = $1 AND item_id = $2', [user_id, item_id]);
      return res.json({ message: 'Item removed from wishlist.', saved: false, item_id });
    } else {
      // Add to wishlist
      await pool.query('INSERT INTO wishlist (user_id, item_id) VALUES ($1, $2)', [user_id, item_id]);
      await pool.query(
        "INSERT INTO listing_interactions(listing_id,user_id,interaction_type) VALUES($1,$2,'SAVE')",
        [item_id, user_id],
      );
      return res.status(201).json({ message: 'Item saved to wishlist.', saved: true, item_id });
    }
  } catch (error) {
    console.error('[WishlistController] toggleWishlist error:', error.message);
    res.status(500).json({ error: 'Failed to toggle wishlist item.' });
  }
};

// DELETE /api/wishlist/:itemId - Remove item from wishlist
exports.removeFromWishlist = async (req, res) => {
  const user_id = req.user.id;
  const itemId = req.params.itemId ? String(req.params.itemId).trim() : null;

  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required.' });
  }

  try {
    await pool.query('DELETE FROM wishlist WHERE user_id = $1 AND (item_id = $2 OR id = $2)', [
      user_id,
      itemId,
    ]);
    res.json({ message: 'Item removed from wishlist.', saved: false });
  } catch (error) {
    console.error('[WishlistController] removeFromWishlist error:', error.message);
    res.status(500).json({ error: 'Failed to remove wishlist item.' });
  }
};

