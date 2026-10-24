const fail = (status, message) => Object.assign(new Error(message), { status });

// Lock the listing against new bookings while removing it from the marketplace.
// Never cascade a deletion through rental, payment or delivery history.
async function deleteListing(db, id, ownerId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const listing = (await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!listing) throw fail(404, 'Listing not found.');
    if (listing.owner_id !== ownerId) throw fail(403, 'You can only delete your own listings.');
    if (listing.deleted_at) {
      await client.query('COMMIT');
      return { archived: true, photos: [] };
    }
    const { rows } = await client.query(`SELECT
      EXISTS(SELECT 1 FROM rentals WHERE listing_id=$1)
      OR EXISTS(SELECT 1 FROM delivery_requests WHERE listing_id=$1)
      OR EXISTS(SELECT 1 FROM pending_orders WHERE EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(booking_data->'items','[]'::jsonb)) item
        WHERE item->>'listing_id'=$1::text)) AS referenced`, [id]);
    const archived = rows[0].referenced;
    if (archived) {
      await client.query('UPDATE listings SET deleted_at=NOW(),is_active=FALSE,updated_at=NOW() WHERE id=$1', [id]);
    } else {
      await client.query('DELETE FROM listings WHERE id=$1', [id]);
    }
    await client.query('COMMIT');
    return { archived, photos: archived ? [] : [...new Set([listing.image_url, ...(listing.image_urls || [])].filter(Boolean))] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { deleteListing };
