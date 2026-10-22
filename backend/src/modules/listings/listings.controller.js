const pool = require('../../config/database');
const photos = require('./photo-storage');
const { submittedRentalSql, bookingPaymentReceivedSql } = require('../rentals/booking-state');

const galleryOf = listing => [...new Set([listing.image_url, ...(listing.image_urls || [])].filter(Boolean))];
async function removeUnusedPhotos(urls) {
  for (const url of urls) {
    const key = photos.keyFor(url);
    if (!key) continue;
    try {
      const used = await pool.query('SELECT id FROM listings WHERE image_url=$1 OR image_urls @> ARRAY[$1]::text[] LIMIT 1', [url]);
      if (!used.rowCount) await photos.remove([key]);
    } catch (error) { console.error('[photos] cleanup deferred', error.name); }
  }
}

exports.createListing = async (req, res) => {
  let prepared;
  try {
    const {
      title,
      description,
      price,
      category,
      image_url,
      condition,
      rent_price,
      deposit,
      location,
      delivery_available,
      delivery_charge,
      pickup_time,
      image_urls,
      pickup_location_id,
    } = req.body;

    const owner_id = req.user.id;

    // Validation
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Product Title is required.' });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ error: 'Category is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required.' });
    }
    if (description.length > 500) {
      return res.status(400).json({ error: 'Description cannot exceed 500 characters.' });
    }
    if (!image_url && (!image_urls || image_urls.length === 0)) {
      return res.status(400).json({ error: 'At least one image is required.' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Pickup location is required.' });
    }

    const sellPrice = parseFloat(price) || 0;
    const rentPrice = parseFloat(rent_price) || 0;
    const securityDeposit = parseFloat(deposit) || 0;

    if (sellPrice <= 0 && rentPrice <= 0) {
      return res.status(400).json({ error: 'Either Selling Price or Rental Price must be provided.' });
    }
    if (sellPrice > 0 && securityDeposit > sellPrice) {
      return res.status(400).json({ error: 'Security deposit cannot exceed the selling price.' });
    }

    prepared = await photos.prepare({ ownerId: owner_id,
      images: image_urls?.length ? image_urls : [image_url], cover: image_url || image_urls?.[0] });

    const queryText = `
      INSERT INTO listings (
        title, description, price, category, image_url, owner_id,
        condition, rent_price, deposit, location, delivery_available, delivery_charge, pickup_time, image_urls, pickup_location_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    const values = [
      title.trim(),
      description.trim(),
      sellPrice,
      category.trim(),
      prepared.cover,
      owner_id,
      condition || 'Good',
      rentPrice,
      securityDeposit,
      location.trim(),
      !!delivery_available,
      parseFloat(delivery_charge) || 0,
      pickup_time || '5 min',
      prepared.images,
      pickup_location_id || null,
    ];

    const newListing = await pool.query(queryText, values);

    res.status(201).json(newListing.rows[0]);
  } catch (error) {
    // Check references before deleting: a lost DB response may follow a commit.
    if (prepared) await removeUnusedPhotos(prepared.images);
    console.error('[listing] create failed', error.name);
    res.status(error.photoError ? error.status : 500).json({ error: error.photoError ? error.message : 'Could not publish your listing. Please try again.' });
  }
};

exports.getListings = async (req, res) => {
  try {
    const listings = await pool.query(`
      WITH demand AS (
        SELECT r.listing_id, COUNT(*)::int AS paid_rentals_30d
        FROM rentals r JOIN users borrower ON borrower.id=r.borrower_id
        JOIN listings item ON item.id=r.listing_id
        WHERE r.created_at >= NOW()-INTERVAL '30 days'
          AND r.status NOT IN ('CANCELLED','REJECTED')
          AND r.borrower_id <> item.owner_id AND borrower.email NOT LIKE 'qa-%'
          AND item.demo_slug IS NULL AND ${bookingPaymentReceivedSql('r')}
        GROUP BY r.listing_id
      ), interest AS (
        SELECT i.listing_id, COUNT(DISTINCT i.user_id)::int AS viewers_7d
        FROM listing_interactions i JOIN users viewer ON viewer.id=i.user_id
        JOIN listings item ON item.id=i.listing_id
        WHERE i.created_at >= NOW()-INTERVAL '7 days' AND i.interaction_type='VIEW'
          AND i.user_id <> item.owner_id AND viewer.email NOT LIKE 'qa-%' AND item.demo_slug IS NULL
        GROUP BY i.listing_id
      )
      SELECT l.*, u.name as owner_name, u.email as owner_email,
        COALESCE(d.paid_rentals_30d,0) AS paid_rentals_30d, COALESCE(i.viewers_7d,0) AS viewers_7d
      FROM listings l
      JOIN users u ON l.owner_id = u.id
      LEFT JOIN demand d ON d.listing_id=l.id LEFT JOIN interest i ON i.listing_id=l.id
      WHERE COALESCE(l.is_active, TRUE) = TRUE
      ORDER BY l.created_at DESC
    `);
    res.json(listings.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Server Error' });
  }
};

exports.getMyListings = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.*, COUNT(r.id)::int AS request_count,
        COUNT(r.id) FILTER (WHERE r.status IN ('OWNER_PENDING','RENTAL_PAYMENT_COMPLETED')
          AND ${bookingPaymentReceivedSql('r')})::int AS pending_request_count
      FROM listings l LEFT JOIN rentals r ON r.listing_id=l.id AND ${submittedRentalSql('r')}
      WHERE l.owner_id=$1 GROUP BY l.id ORDER BY l.created_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) {
    console.error('[listing] getMyListings', error.message);
    res.status(500).json({ error: 'Failed to load your listings.' });
  }
};

exports.getAvailability = async (req, res) => {
  try {
    const exists = await pool.query('SELECT id FROM listings WHERE id=$1', [req.params.id]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Listing not found.' });
    const { rows } = await pool.query(
      `SELECT start_date,end_date FROM rentals r
      WHERE r.listing_id=$1 AND r.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DEPOSIT_REFUNDED')
      AND ${submittedRentalSql('r')}
      AND r.end_date >= CURRENT_DATE ORDER BY r.start_date`,
      [req.params.id],
    );
    res.json({ listing_id: req.params.id, blocked_ranges: rows });
  } catch (error) {
    console.error('[listing] getAvailability', error.message);
    res.status(500).json({ error: 'Failed to load availability.' });
  }
};

exports.recordView = async (req, res) => {
  const exists = await pool.query('SELECT id FROM listings WHERE id=$1', [req.params.id]);
  if (!exists.rowCount) return res.status(404).json({ error: 'Listing not found.' });
  const recent = await pool.query(
    `SELECT id FROM listing_interactions WHERE listing_id=$1 AND user_id=$2
    AND interaction_type='VIEW' AND created_at > NOW()-INTERVAL '30 minutes' LIMIT 1`,
    [req.params.id, req.user.id],
  );
  if (!recent.rowCount)
    await pool.query(
      "INSERT INTO listing_interactions(listing_id,user_id,interaction_type) VALUES ($1,$2,'VIEW')",
      [req.params.id, req.user.id],
    );
  res.status(204).end();
};

exports.getRecommendations = async (req, res) => {
  const recommendations = await require('../intelligence/intelligence.service').recommendations(req.user.id);
  res.json(recommendations.map(item => ({...item,explanation:item.reason,trend_score:item.score})));
};

exports.getListingById = async (req, res) => {
  const { id } = req.params;
  console.log(`[Backend Debug] GET /api/listings/:id request received for ID: "${id}"`);

  // Validate UUID format before querying PostgreSQL
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(id)) {
    console.warn(`[Backend Debug] Rejecting request: "${id}" is not a valid UUID.`);
    return res.status(400).json({ error: 'Invalid listing ID format.' });
  }

  try {
    console.log(`[Backend Debug] Executing database query for listing ID: "${id}"`);
    const listing = await pool.query(
      `
      SELECT l.*, u.name as owner_name, u.email as owner_email 
      FROM listings l 
      JOIN users u ON l.owner_id = u.id 
      WHERE l.id = $1
    `,
      [id],
    );

    if (listing.rows.length === 0) {
      console.log(`[Backend Debug] Query finished: Listing ID "${id}" not found in database.`);
      return res.status(404).json({ error: 'Listing not found.' });
    }

    console.log(`[Backend Debug] Listing found:`, listing.rows[0].title);
    res.json(listing.rows[0]);
  } catch (error) {
    console.error(`[Backend Debug] Database query failed:`, error.message || error);
    res.status(500).json({ error: 'Database query execution error.' });
  }
};

exports.updateListing = async (req, res) => {
  let prepared;
  try {
    const { id } = req.params;
    const { title, description, price, category, image_url, image_urls, is_active } = req.body;
    const owner_id = req.user.id;

    // Check if listing exists and belongs to user
    const listingCheck = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
    if (listingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listingCheck.rows[0].owner_id !== owner_id) {
      return res.status(403).json({ error: 'Forbidden: You can only edit your own listings' });
    }

    const current = listingCheck.rows[0];
    const previousPhotos = galleryOf(current);
    if (image_url !== undefined || image_urls !== undefined) {
      const images = image_urls !== undefined ? image_urls :
        image_url === current.image_url ? previousPhotos : [image_url, ...previousPhotos.filter(p => p !== current.image_url)].slice(0, 5);
      prepared = await photos.prepare({ ownerId: owner_id, images,
        cover: image_url ?? images[0], existing: previousPhotos });
    }
    const updatedListing = await pool.query(
      `UPDATE listings SET title=$1,description=$2,price=$3,category=$4,image_url=$5,is_active=$6,image_urls=$7,updated_at=NOW()
       WHERE id=$8 AND owner_id=$9 RETURNING *`,
      [
        title ?? current.title,
        description ?? current.description,
        price ?? current.price,
        category ?? current.category,
        prepared?.cover ?? current.image_url,
        is_active ?? current.is_active,
        prepared?.images ?? current.image_urls,
        id,
        owner_id,
      ],
    );

    if (!updatedListing.rowCount) {
      if (prepared) await removeUnusedPhotos(prepared.images);
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (prepared) await removeUnusedPhotos(previousPhotos.filter(p => !prepared.images.includes(p)));
    res.json(updatedListing.rows[0]);
  } catch (error) {
    if (prepared) await removeUnusedPhotos(prepared.images);
    console.error('[listing] update failed', error.name);
    res.status(error.photoError ? error.status : 500).json({ error: error.photoError ? error.message : 'Could not update your listing.' });
  }
};

exports.deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const owner_id = req.user.id;

    // Check if listing exists and belongs to user
    const listingCheck = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
    if (listingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (listingCheck.rows[0].owner_id !== owner_id) {
      return res.status(403).json({ error: 'Forbidden: You can only delete your own listings' });
    }

    await pool.query('DELETE FROM listings WHERE id = $1', [id]);
    await removeUnusedPhotos(galleryOf(listingCheck.rows[0]));

    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Server Error' });
  }
};

