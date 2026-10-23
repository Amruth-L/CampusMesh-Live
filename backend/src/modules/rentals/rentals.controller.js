const pool = require('../../config/database');
const { ensureOutboundDelivery } = require('../delivery/delivery-request.service');
const { emitUser } = require('../../shared/realtime');
const paymentService = require('../payments/payment.service');
const { submittedRentalSql, bookingPaymentReceivedSql } = require('./booking-state');

// POST /api/rentals/book
exports.bookRental = async (req, res) => {
  const borrower_id = req.user.id;
  const { listing_id, start_date, end_date, delivery_requested = false, drop_location_id = null } = req.body;

  if (!listing_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'listing_id, start_date, and end_date are required.' });
  }
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(start_date) || !validDate(end_date)) {
    return res.status(400).json({ error: 'Choose valid rental dates in YYYY-MM-DD format.' });
  }
  if (typeof delivery_requested !== 'boolean') {
    return res.status(400).json({ error: 'delivery_requested must be true or false.' });
  }
  const destination = delivery_requested ? drop_location_id : null;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize draft creation for a listing: two simultaneous checkout retries
    // must observe the same committed rental instead of both inserting one.
    const listingRes = await client.query('SELECT * FROM listings WHERE id = $1 FOR NO KEY UPDATE', [listing_id]);
    const listing = listingRes.rows[0];
    if (!listing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Listing not found.' });
    }
    if (listing.owner_id === borrower_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You cannot rent your own listing.' });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start < today || end < start) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: start < today ? 'start_date cannot be in the past.' : 'end_date cannot be before start_date.' });
    }
    if (delivery_requested && (!listing.delivery_available || !destination)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Choose an available campus drop location for delivery.' });
    }

    const direct = require('../direct-upi/service').enabled();
    if (direct) {
      const priorCart = await client.query(`SELECT id FROM pending_orders WHERE user_id=$1
        AND COALESCE((booking_data->>'completed')::boolean,false)=false
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(booking_data->'items','[]'::jsonb)) item WHERE item->>'listing_id'=$2) LIMIT 1`, [borrower_id,listing_id]);
      if (priorCart.rowCount) throw Object.assign(new Error('An earlier Razorpay checkout for this item needs reconciliation. Check its payment confirmation or contact support before making a direct UPI payment.'), {status:409});
      const priorPayment = await client.query(`SELECT r.id FROM rentals r JOIN payments p ON p.rental_id=r.id
        WHERE r.borrower_id=$1 AND r.listing_id=$2 AND r.payment_method='RAZORPAY'
        AND r.status NOT IN ('CANCELLED','COMPLETED','DEPOSIT_REFUNDED')
        AND NOT(r.end_date<$3 OR r.start_date>$4) AND p.status IN ('PENDING','PAID') LIMIT 1`, [borrower_id,listing_id,start_date,end_date]);
      if (priorPayment.rowCount) throw Object.assign(new Error('Open your existing Razorpay rental and check payment confirmation before starting another payment for these dates.'), {status:409});
    }
    if (direct && !listing.is_active) throw Object.assign(new Error('This listing is no longer available.'), {status:409});
    if (direct && delivery_requested) {
      const locations = await client.query('SELECT id FROM campus_locations WHERE id=ANY($1::text[])', [[listing.pickup_location_id, destination]]);
      const known = new Set(locations.rows.map(row=>row.id));
      if (!known.has(listing.pickup_location_id) || !known.has(destination)) throw Object.assign(new Error('The lender must set a valid pickup point and you must choose a valid drop-off before requesting delivery.'), {status:409});
    }
    if (direct && Number(listing.rent_price || listing.price || 0)<=0) throw Object.assign(new Error('This item needs a positive rental price before requesting it.'),{status:409});
    if (direct && listing.demo_slug) throw Object.assign(new Error('Choose a student-listed item. Sample items cannot request real payments.'), {status:409});
    // Preserve the quote and any payment order already attached to a draft.
    // Never recycle a paid record, or another borrower's/destination's checkout.
    const existing = await client.query(
      `SELECT r.* FROM rentals r
       WHERE r.listing_id=$1 AND r.borrower_id=$2
         AND r.start_date=$3 AND r.end_date=$4
         AND r.delivery_requested=$5 AND r.drop_location_id IS NOT DISTINCT FROM $6::text
         AND r.status IN ('BOOKING_PAYMENT_PENDING','BOOKING_REQUESTED','OWNER_PENDING')
         AND r.payment_method=$7
         AND r.payment_status='PENDING' AND r.owner_response='PENDING'
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.rental_id=r.id AND p.status='PAID')
       ORDER BY r.created_at DESC, r.id DESC LIMIT 1 FOR UPDATE OF r`,
      [listing_id, borrower_id, start_date, end_date, delivery_requested, destination, direct ? 'DIRECT_UPI' : 'RAZORPAY'],
    );
    // Check after acquiring the draft lock: payment recovery may have made it
    // paid while this checkout was waiting. Do not create a replacement draft.
    const conflictRes = await client.query(
      `SELECT r.id FROM rentals r
       WHERE r.listing_id = $1
         AND r.status NOT IN ('CANCELLED', 'COMPLETED', 'DEPOSIT_REFUNDED')
         AND ${submittedRentalSql('r')}
         AND r.id IS DISTINCT FROM $4::uuid
         AND NOT (r.end_date < $2 OR r.start_date > $3)`,
      [listing_id, start_date, end_date, existing.rows[0]?.id || null],
    );
    if (conflictRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'These rental dates conflict with an existing booking.' });
    }

    let rental = existing.rows[0];
    const reused = Boolean(rental);
    if (!rental) {
      const rental_days = Math.ceil((end - start) / 86400000) + 1;
      const { calculatePricing } = require('../../shared/pricing-engine');
      const pricing = calculatePricing({
        dailyRent: listing.rent_price || listing.price || 0,
        days: rental_days,
        deliveryType: delivery_requested ? 'STANDARD' : 'SELF_PICKUP',
        ownerLocation: listing.location || '',
        itemValue: listing.price || 0,
        customDeposit: listing.deposit,
      });
      const result = await client.query(
        `INSERT INTO rentals (
          listing_id, borrower_id, owner_id, start_date, end_date, rental_days,
          rental_fee, delivery_fee, platform_fee, booking_amount, deposit_amount,
          status, booking_status, deposit_status, payment_status, owner_response, delivery_requested, drop_location_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          'BOOKING_PAYMENT_PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING', $12, $13)
        RETURNING *`,
        [listing_id, borrower_id, listing.owner_id, start_date, end_date, rental_days,
          pricing.rentalFee, pricing.deliveryFee, pricing.platformFee, pricing.totalAmount,
          pricing.securityDeposit, delivery_requested, destination],
      );
      rental = result.rows[0];
      await client.query(
        `INSERT INTO transaction_events (rental_id, event_type, actor_user_id, metadata)
         VALUES ($1, 'BOOKING_CREATED', $2, $3)`,
        [rental.id, borrower_id, { deliveryRequested: delivery_requested }],
      );
    }
    if (direct && !reused) {
      rental = (await client.query("UPDATE rentals SET payment_method='DIRECT_UPI',status='OWNER_PENDING',platform_fee=0,booking_amount=rental_fee WHERE id=$1 RETURNING *", [rental.id])).rows[0];
    }
    await client.query('COMMIT');
    if (direct) emitUser(listing.owner_id, 'rental:status', { rental_id:rental.id });
    res.status(reused ? 200 : 201).json({
      rental,
      reused,
      breakdown: Object.fromEntries(
        ['rental_fee', 'delivery_fee', 'platform_fee', 'booking_amount', 'deposit_amount', 'rental_days']
          .map((key) => [key, Number(rental[key])]),
      ),
      listing: {
        title: listing.title,
        image_url: listing.image_url,
        category: listing.category,
        condition: listing.condition,
        location: listing.location,
      },
    });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    console.error('[RentalController] bookRental error:', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to create rental booking.' });
  } finally {
    client?.release();
  }
};

// POST /api/rentals/respond
exports.respondToBooking = async (req, res) => {
  const owner_id = req.user.id;
  const { rental_id, response } = req.body;

  if (!rental_id || !['ACCEPTED', 'REJECTED'].includes(response)) {
    return res.status(400).json({ error: 'rental_id and response (ACCEPTED or REJECTED) are required.' });
  }

  const method = (await pool.query('SELECT payment_method FROM rentals WHERE id=$1', [rental_id])).rows[0]?.payment_method;
  if (method === 'DIRECT_UPI') {
    try { return res.json(await require('../direct-upi/service').createService().respond(rental_id,owner_id,response)); }
    catch(e) { return res.status(e.status || 503).json({error:e.status?e.message:'Could not respond to request.'}); }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rentalRes = await client.query('SELECT * FROM rentals WHERE id = $1 FOR UPDATE', [rental_id]);
    if (!rentalRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rental not found.' });
    }
    const rental = rentalRes.rows[0];

    if (rental.owner_id !== owner_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the listing owner can respond to this booking.' });
    }
    if (!['OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED'].includes(rental.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot respond: rental is in status "${rental.status}".` });
    }

    const paid = await client.query(
      `SELECT id FROM payments WHERE rental_id=$1 AND payment_type='RENTAL'
       AND status='PAID' AND amount >= $2 LIMIT 1`,
      [rental_id, rental.booking_amount],
    );
    if (!paid.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The renter must complete the booking payment before you can respond.' });
    }

    if (response === 'REJECTED') {
      await client.query(
        `UPDATE rentals SET status='CANCELLED', booking_status='CANCELLED',
         owner_response='REJECTED', owner_responded_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [rental_id],
      );
      await client.query(
        `UPDATE delivery_requests SET status='CANCELLED', updated_at=NOW()
         WHERE rental_id=$1 AND courier_id IS NULL
           AND status IN ('WAITING_FOR_DEPOSIT','MATCHING_COURIER','NO_COURIER_AVAILABLE','AVAILABLE')`,
        [rental_id],
      );
      await client.query(
        `UPDATE delivery_offers SET status='EXPIRED', responded_at=NOW()
         WHERE delivery_id IN (SELECT id FROM delivery_requests WHERE rental_id=$1)
           AND status='PENDING'`,
        [rental_id],
      );
      await client.query(
        `INSERT INTO transaction_events (rental_id, event_type, actor_user_id)
         VALUES ($1, 'OWNER_REJECTED', $2)`,
        [rental_id, owner_id],
      );
      await client.query('COMMIT');
      const event = { rental_id, owner_id: rental.owner_id, renter_id: rental.borrower_id, status: 'CANCELLED' };
      try {
        emitUser(rental.borrower_id, 'rental:status', event);
        emitUser(rental.owner_id, 'rental:status', event);
      } catch { /* Cancellation committed; do not interrupt refund recovery. */ }
      let refund;
      try { refund = await require('../payments/refund.service').createRefundService().refundRejectedBooking(rental_id, owner_id); }
      catch { refund = { refund_status: 'REVIEW_REQUIRED', message: 'Booking rejected. Refund needs confirmation; open rental details to retry.' }; }
      return res.json({ message: 'Booking rejected. ' + refund.message, status: 'CANCELLED', refund });
    }

    const config = await client.query(
      "SELECT value FROM system_config WHERE key='deposit_timeout_minutes'",
    );
    const depositTimeoutMins = parseInt(config.rows[0]?.value || '30', 10);
    const deposit_deadline = new Date(Date.now() + depositTimeoutMins * 60 * 1000);

    await client.query(
      `UPDATE rentals SET status='DEPOSIT_PENDING', booking_status='CONFIRMED',
       owner_response='ACCEPTED', owner_responded_at=NOW(), deposit_deadline=$1, updated_at=NOW()
       WHERE id=$2`,
      [deposit_deadline, rental_id],
    );

    const delivery = await ensureOutboundDelivery(client, rental_id, 'WAITING_FOR_DEPOSIT');
    await client.query(
      `INSERT INTO transaction_events (rental_id, delivery_id, event_type, actor_user_id, metadata)
       VALUES ($1, $2, 'OWNER_ACCEPTED', $3, $4)`,
      [rental_id, delivery?.id || null, owner_id, { deliveryRequested: Boolean(rental.delivery_requested) }],
    );
    await client.query('COMMIT');

    const event = {
      rental_id,
      delivery_id: delivery?.id || null,
      owner_id: rental.owner_id,
      renter_id: rental.borrower_id,
      status: 'DEPOSIT_PENDING',
      delivery_status: delivery?.status || null,
    };
    emitUser(rental.borrower_id, 'rental:status', event);
    emitUser(rental.owner_id, 'rental:status', event);
    if (delivery) {
      emitUser(rental.borrower_id, 'delivery:created', { ...event, status: delivery.status });
      emitUser(rental.owner_id, 'delivery:created', { ...event, status: delivery.status });
    }

    res.json({
      message: 'Booking accepted. Borrower must pay security deposit before courier matching.',
      status: 'DEPOSIT_PENDING',
      delivery_id: delivery?.id || null,
      deposit_deadline,
      deposit_amount: rental.deposit_amount,
      deposit_timeout_minutes: depositTimeoutMins,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[RentalController] respondToBooking error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to respond to booking.' });
  } finally {
    client.release();
  }
};

const returns = require('./return.service');
exports.requestReturn = async (req, res) => {
  try { res.json(await returns.requestReturn(req.params.id,req.user.id,req.body.mode)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not request the return.' }); }
};
exports.confirmReturnDestination = async (req, res) => {
  try { res.json(await returns.confirmReturnDestination(req.params.id,req.user.id,req.body.location_id)); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not update the return destination.' }); }
};

// POST /api/rentals/:id/extend-request
exports.requestExtension = async (req, res) => {
  const borrower_id = req.user.id;
  const { id } = req.params;
  const { additional_days, reason } = req.body;

  const days = parseInt(additional_days, 10);
  if (!days || days < 1 || days > 60) {
    return res.status(400).json({ error: 'Please enter a valid number of days (1-60) to extend.' });
  }

  try {
    const rentalRes = await pool.query(
      `SELECT r.*, l.title as listing_title, l.rent_price as listing_daily_rate
       FROM rentals r
       JOIN listings l ON l.id = r.listing_id
       WHERE r.id = $1`,
      [id]
    );

    if (rentalRes.rows.length === 0) return res.status(404).json({ error: 'Rental not found.' });
    const rental = rentalRes.rows[0];

    if (rental.borrower_id !== borrower_id) {
      return res.status(403).json({ error: 'Only the borrower can request a rental extension.' });
    }
    if(rental.payment_method==='DIRECT_UPI') return res.status(409).json({error:'Paid extensions are not available for direct UPI rentals. Agree a return date with the lender and contact support.'});

    if (!['RENTAL_ACTIVE', 'MATCHING_COURIER', 'COURIER_ASSIGNED', 'GOING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'].includes(rental.status)) {
      return res.status(409).json({ error: 'Extensions can only be requested on active rentals.' });
    }

    const existingPending = await pool.query(
      `SELECT id FROM rental_extensions WHERE rental_id = $1 AND status = 'PENDING'`,
      [id]
    );
    if (existingPending.rows.length > 0) {
      return res.status(409).json({ error: 'An extension request is already awaiting owner approval.' });
    }

    const currentEndDate = new Date(rental.end_date);
    const newEndDate = new Date(currentEndDate);
    newEndDate.setDate(newEndDate.getDate() + days);

    const dailyRate = Number(rental.listing_daily_rate) || (Number(rental.rental_fee) / Number(rental.rental_days || 1));
    const additionalFee = Number((dailyRate * days).toFixed(2));

    const insertRes = await pool.query(
      `INSERT INTO rental_extensions (
         rental_id, borrower_id, owner_id, additional_days, old_end_date, new_end_date, additional_fee, status, reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8) RETURNING *`,
      [id, borrower_id, rental.owner_id, days, currentEndDate.toISOString().slice(0, 10), newEndDate.toISOString().slice(0, 10), additionalFee, reason || null]
    );

    await pool.query(
      `INSERT INTO transaction_events (rental_id, event_type, actor_user_id, metadata)
       VALUES ($1, 'EXTENSION_REQUESTED', $2, $3)`,
      [id, borrower_id, { additional_days: days, additional_fee: additionalFee, new_end_date: newEndDate }]
    );

    emitUser(rental.owner_id, 'rental:extension_requested', {
      rental_id: id,
      extension: insertRes.rows[0],
      listing_title: rental.listing_title,
    });
    emitUser(rental.owner_id, 'rental:status', { rental_id: id });
    emitUser(borrower_id, 'rental:status', { rental_id: id });

    res.status(201).json({
      message: `Extension request for ${days} additional day(s) submitted to the owner.`,
      extension: insertRes.rows[0],
    });
  } catch (error) {
    console.error('[RentalController] requestExtension error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to request extension.' });
  }
};

// POST /api/rentals/:id/extend-respond
exports.respondExtension = async (req, res) => {
  const owner_id = req.user.id;
  const { id } = req.params;
  const { extension_id, decision } = req.body;

  if (!['ACCEPTED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: "Decision must be either 'ACCEPTED' or 'REJECTED'." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const extRes = await client.query(
      `SELECT e.*, r.owner_id, r.borrower_id, r.rental_fee, r.rental_days, r.booking_amount, l.title as listing_title
       FROM rental_extensions e
       JOIN rentals r ON r.id = e.rental_id
       JOIN listings l ON l.id = r.listing_id
       WHERE e.id = $1 AND e.rental_id = $2 FOR UPDATE`,
      [extension_id, id]
    );

    if (extRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Extension request not found.' });
    }

    const ext = extRes.rows[0];
    if (ext.owner_id !== owner_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the listing owner can respond to extension requests.' });
    }

    if (ext.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This extension request is already ${ext.status.toLowerCase()}.` });
    }

    if (decision === 'ACCEPTED') {
      await client.query(
        `UPDATE rental_extensions SET status = 'ACCEPTED', responded_at = NOW() WHERE id = $1`,
        [extension_id]
      );

      const newDays = Number(ext.rental_days) + Number(ext.additional_days);
      const newFee = Number(ext.rental_fee) + Number(ext.additional_fee);
      const newBookingAmount = Number(ext.booking_amount) + Number(ext.additional_fee);

      await client.query(
        `UPDATE rentals SET
           end_date = $1,
           rental_days = $2,
           rental_fee = $3,
           booking_amount = $4,
           updated_at = NOW()
         WHERE id = $5`,
        [ext.new_end_date, newDays, newFee, newBookingAmount, id]
      );

      await client.query(
        `INSERT INTO transaction_events (rental_id, event_type, actor_user_id, metadata)
         VALUES ($1, 'EXTENSION_ACCEPTED', $2, $3)`,
        [id, owner_id, { extension_id, additional_days: ext.additional_days, new_end_date: ext.new_end_date, additional_fee: ext.additional_fee }]
      );

      await client.query('COMMIT');

      emitUser(ext.borrower_id, 'rental:extension_responded', {
        rental_id: id,
        decision: 'ACCEPTED',
        additional_days: ext.additional_days,
        new_end_date: ext.new_end_date,
      });
      emitUser(ext.borrower_id, 'rental:status', { rental_id: id });
      emitUser(owner_id, 'rental:status', { rental_id: id });

      return res.json({
        message: `Extension accepted! Rental extended by ${ext.additional_days} days to ${ext.new_end_date}.`,
        decision: 'ACCEPTED',
        new_end_date: ext.new_end_date,
      });
    } else {
      await client.query(
        `UPDATE rental_extensions SET status = 'REJECTED', responded_at = NOW() WHERE id = $1`,
        [extension_id]
      );

      await client.query(
        `INSERT INTO transaction_events (rental_id, event_type, actor_user_id, metadata)
         VALUES ($1, 'EXTENSION_REJECTED', $2, $3)`,
        [id, owner_id, { extension_id }]
      );

      await client.query('COMMIT');

      emitUser(ext.borrower_id, 'rental:extension_responded', {
        rental_id: id,
        decision: 'REJECTED',
      });
      emitUser(ext.borrower_id, 'rental:status', { rental_id: id });
      emitUser(owner_id, 'rental:status', { rental_id: id });

      return res.json({
        message: 'Extension request was declined.',
        decision: 'REJECTED',
      });
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[RentalController] respondExtension error:', error.message);
    res.status(500).json({ error: 'Failed to respond to extension request.' });
  } finally {
    client.release();
  }
};

// POST /api/rentals/:id/send-reminder
exports.sendReminder = async (req, res) => {
  const owner_id = req.user.id;
  const { id } = req.params;

  try {
    const rentalRes = await pool.query(
      `SELECT r.*, l.title as listing_title, ou.name as owner_name
       FROM rentals r
       JOIN listings l ON l.id = r.listing_id
       JOIN users ou ON ou.id = r.owner_id
       WHERE r.id = $1`,
      [id]
    );

    if (rentalRes.rows.length === 0) return res.status(404).json({ error: 'Rental not found.' });
    const rental = rentalRes.rows[0];

    if (rental.owner_id !== owner_id) {
      return res.status(403).json({ error: 'Only the owner can send a return reminder.' });
    }

    await pool.query(
      `INSERT INTO transaction_events (rental_id, event_type, actor_user_id, metadata)
       VALUES ($1, 'RETURN_REMINDER_SENT', $2, $3)`,
      [id, owner_id, { sent_at: new Date() }]
    );

    emitUser(rental.borrower_id, 'rental:reminder', {
      rental_id: id,
      title: 'Rental Return Reminder',
      message: `${rental.owner_name} sent a friendly reminder that "${rental.listing_title}" is due for return.`,
      due_date: rental.end_date,
    });

    res.json({ message: 'Return reminder successfully sent to borrower.' });
  } catch (error) {
    console.error('[RentalController] sendReminder error:', error.message);
    res.status(500).json({ error: 'Failed to send reminder.' });
  }
};

exports.getHistory = async (req, res) => {
  const rental = await pool.query('SELECT * FROM rentals WHERE id=$1 AND (borrower_id=$2 OR owner_id=$2)', [
    req.params.id,
    req.user.id,
  ]);
  if (!rental.rows[0]) return res.status(404).json({ error: 'Rental not found.' });
  const { rows } = await pool.query(
    'SELECT * FROM transaction_events WHERE rental_id=$1 ORDER BY created_at',
    [req.params.id],
  );
  res.json(rows);
};

// GET /api/rentals/:id/status
exports.getRentalStatus = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(404).json({ error: 'Rental not found.' });
  }

  try {
    const rentalRes = await pool.query(
      `
      SELECT r.*,
        l.title as listing_title, l.image_url as listing_image, (l.demo_slug IS NOT NULL) AS is_demo,
        l.category as listing_category, l.location as listing_location,
        bu.name as borrower_name, bu.email as borrower_email,
        ou.name as owner_name, ou.email as owner_email
      FROM rentals r
      LEFT JOIN listings l ON r.listing_id = l.id
      LEFT JOIN users bu ON r.borrower_id = bu.id
      LEFT JOIN users ou ON r.owner_id = ou.id
      WHERE r.id = $1
    `,
      [id],
    );

    if (rentalRes.rows.length === 0) {
      return res.status(404).json({ error: 'Rental not found.' });
    }

    const rental = rentalRes.rows[0];

    // Only owner or borrower can see rental details
    if (rental.borrower_id !== user_id && rental.owner_id !== user_id) {
      return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }

    // Compute time remaining on deposit deadline if applicable
    let deposit_seconds_remaining = null;
    if (rental.status === 'DEPOSIT_PENDING' && rental.deposit_deadline) {
      deposit_seconds_remaining = Math.max(
        0,
        Math.floor((new Date(rental.deposit_deadline) - Date.now()) / 1000),
      );

      // A read must not cancel a paid booking or race a late capture callback.
      // An expired deadline blocks new payment creation; existing captures are reconciled.

    }

    // Fetch related payments
    const paymentsRes = await pool.query(
      'SELECT id, payment_type, amount, status, created_at FROM payments WHERE rental_id = $1 ORDER BY created_at ASC',
      [id],
    );

    // Fetch extensions
    const extRes = await pool.query(
      'SELECT * FROM rental_extensions WHERE rental_id = $1 ORDER BY created_at DESC',
      [id],
    );

    // Fetch refund if any
    const refundRes = await pool.query(
      'SELECT * FROM refunds WHERE rental_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id],
    );

    const returnState = rental.payment_method === 'DIRECT_UPI' ? await require('./return-workflow').returnWorkflow(pool,rental) : null;
    const now = new Date();
    const rentalEndDate = new Date(rental.end_date);
    const isOverdue = !returnState?.inspected && rental.deposit_status !== 'REFUND_PENDING' && rentalEndDate < now && !['COMPLETED', 'CANCELLED', 'DEPOSIT_REFUNDED'].includes(rental.status);
    const overdueDays = isOverdue
      ? Math.max(1, Math.ceil((now.getTime() - rentalEndDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    res.json({
      rental: {
        ...rental,
        return_workflow: returnState,
        is_overdue: isOverdue,
        overdue_days: overdueDays,
      },
      payments: paymentsRes.rows,
      extensions: extRes.rows,
      pending_extension: extRes.rows.find((x) => x.status === 'PENDING') || null,
      refund: refundRes.rows[0] || null,
      deposit_seconds_remaining,
      qr_available: rental.status === 'QR_GENERATED' && !!rental.qr_code_hash,
    });
  } catch (error) {
    console.error('[RentalController] getRentalStatus error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rental status.' });
  }
};

// GET /api/rentals/my-rentals
exports.getMyRentals = async (req, res) => {
  const user_id = req.user.id;
  try {
    const res_ = await pool.query(
      `
      SELECT r.*, COALESCE(r.outbound_delivery_id, r.return_delivery_id) AS delivery_id,
        l.title as listing_title, l.image_url as listing_image, l.category as listing_category,
        ou.name as owner_name
      FROM rentals r
      LEFT JOIN listings l ON r.listing_id = l.id
      LEFT JOIN users ou ON r.owner_id = ou.id
      WHERE r.borrower_id = $1
      ORDER BY r.created_at DESC
    `,
      [user_id],
    );
    res.json(res_.rows);
  } catch (error) {
    console.error('[RentalController] getMyRentals error:', error.message);
    res.status(500).json({ error: 'Failed to fetch rentals.' });
  }
};

// GET /api/rentals/my-listings-requests
exports.getOwnerRequests = async (req, res) => {
  const owner_id = req.user.id;
  try {
    const result = await pool.query(
      `
      SELECT r.*,
        ${bookingPaymentReceivedSql('r')} AS rental_fee_paid,
        l.title AS listing_title, l.image_url AS listing_image, l.category AS listing_category,
        l.pickup_location_id AS listing_pickup_location_id,
        bu.name AS borrower_name, bu.email AS borrower_email, bu.hostel AS borrower_hostel,
        ou.name AS owner_name,
        pickup.building_name AS pickup_building_name, pickup.floor_name AS pickup_floor_name,
        pickup.room_name AS pickup_room_name,
        dropoff.building_name AS drop_building_name, dropoff.floor_name AS drop_floor_name,
        dropoff.room_name AS drop_room_name,
        dr.id AS delivery_id, dr.status AS delivery_status, dr.task_type AS delivery_task_type, dr.courier_id,
        dr.pickup_location AS delivery_pickup_location, dr.drop_location AS delivery_drop_location,
        dr.pickup_location_id AS delivery_pickup_location_id,
        dr.destination_location_id AS delivery_destination_location_id,
        dr.courier_earning, dr.match_score, dr.accepted_at AS delivery_accepted_at,
        dr.updated_at AS delivery_updated_at,
        courier.name AS courier_name, courier.hostel AS courier_hostel
      FROM rentals r
      LEFT JOIN listings l ON r.listing_id = l.id
      LEFT JOIN users bu ON r.borrower_id = bu.id
      LEFT JOIN users ou ON r.owner_id = ou.id
      LEFT JOIN campus_locations pickup ON pickup.id = l.pickup_location_id
      LEFT JOIN campus_locations dropoff ON dropoff.id = r.drop_location_id
      LEFT JOIN LATERAL (
        SELECT d.*
        FROM delivery_requests d
        WHERE d.rental_id = r.id
        ORDER BY CASE WHEN d.id=r.return_delivery_id THEN 0 ELSE 1 END, d.created_at DESC
        LIMIT 1
      ) dr ON TRUE
      LEFT JOIN users courier ON courier.id = dr.courier_id
      WHERE r.owner_id = $1
        AND ${submittedRentalSql('r')}
      ORDER BY r.created_at DESC
      `,
      [owner_id],
    );

    const locationLabel = (building, floor, room) => [building, floor, room].filter(Boolean).join(' · ');
    const requests = result.rows.map((row) => {
      const actionable = (row.rental_fee_paid || row.payment_method === 'DIRECT_UPI') && ['OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED'].includes(row.status);
      const activeRental = ['DEPOSIT_PENDING', 'MATCHING_COURIER', 'NO_COURIER_AVAILABLE', 'COURIER_ASSIGNED', 'RENTAL_ACTIVE', 'RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED', 'RETURN_IN_TRANSIT'].includes(row.status);
      const completedRental = ['COMPLETED', 'DEPOSIT_REFUNDED'].includes(row.status);
      const delivery = row.delivery_id ? {
        id: row.delivery_id,
        task_type: row.delivery_task_type,
        status: row.delivery_status,
        pickup: {
          id: row.delivery_pickup_location_id || row.listing_pickup_location_id,
          label: row.delivery_pickup_location || locationLabel(row.pickup_building_name, row.pickup_floor_name, row.pickup_room_name),
        },
        destination: {
          id: row.delivery_destination_location_id || row.drop_location_id,
          label: row.delivery_drop_location || locationLabel(row.drop_building_name, row.drop_floor_name, row.drop_room_name),
        },
        courier: row.courier_id ? { id: row.courier_id, name: row.courier_name, hostel: row.courier_hostel } : null,
        payout: row.courier_earning,
        match_score: row.match_score,
        accepted_at: row.delivery_accepted_at,
        updated_at: row.delivery_updated_at,
      } : null;

      let blocked_by = null;
      let next_action = 'View rental details';
      if (row.delivery_status === 'RETURN_LOCATION_PENDING') {
        next_action = 'Confirm or change the return destination';
      } else if (actionable) {
        next_action = 'Review and respond to this booking';
      } else if (['BOOKING_PAYMENT_PENDING', 'BOOKING_REQUESTED', 'OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED'].includes(row.status)) {
        blocked_by = row.rental_fee_paid ? 'PAYMENT_RECONCILIATION' : 'BOOKING_PAYMENT';
        next_action = row.rental_fee_paid ? 'Payment recorded; checking the booking status' : 'Waiting for the renter to complete booking payment';
      } else if (row.status === 'DEPOSIT_PENDING') {
        blocked_by = 'DEPOSIT';
        next_action = 'Waiting for renter to pay the refundable deposit';
      } else if (row.status === 'MATCHING_COURIER' || row.status === 'NO_COURIER_AVAILABLE') {
        next_action = row.status === 'NO_COURIER_AVAILABLE' ? 'Waiting for an available courier to accept' : 'Searching for an online courier';
      } else if (row.delivery_status === 'COURIER_ASSIGNED') {
        next_action = 'Courier assigned; waiting for pickup';
      } else if (row.delivery_status === 'ARRIVED_AT_PICKUP') {
        next_action = 'Show the secure pickup QR or OTP to the courier';
      } else if (row.delivery_status === 'ARRIVED_AT_DESTINATION') {
        next_action = 'Waiting for delivery confirmation';
      } else if (row.deposit_status === 'REFUND_PENDING') {
        next_action = 'Send the deposit refund; wait for renter receipt confirmation';
      } else if (row.status === 'RETURN_PENDING') {
        next_action = 'Inspect the returned item and approve the deposit refund';
      } else if (completedRental) {
        next_action = 'Rental completed';
      } else if (row.delivery_status === 'COMPLETED') {
        next_action = row.delivery_task_type === 'RENTAL_RETURN' ? 'Inspect the returned item' : 'Item delivered; rental is active';
      }

      if (row.payment_method==='DIRECT_UPI' && !actionable && ['BOOKING_PAYMENT_PENDING','DEPOSIT_PENDING'].includes(row.status)) next_action='Open details to pay or confirm direct UPI receipt';
      return {
        id: row.id,
        payment_method: row.payment_method,
        status: row.status,
        listing_id: row.listing_id,
        listing_title: row.listing_title,
        listing_image: row.listing_image,
        listing_category: row.listing_category,
        borrower_id: row.borrower_id,
        borrower_name: row.borrower_name,
        borrower_email: row.borrower_email,
        borrower_hostel: row.borrower_hostel,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        start_date: row.start_date,
        end_date: row.end_date,
        rental_days: row.rental_days,
        rental_fee: row.rental_fee,
        delivery_fee: row.delivery_fee,
        platform_fee: row.platform_fee,
        booking_amount: row.booking_amount,
        deposit_amount: row.deposit_amount,
        delivery_requested: row.delivery_requested,
        drop_location_id: row.drop_location_id,
        drop_location_label: locationLabel(row.drop_building_name, row.drop_floor_name, row.drop_room_name),
        payment_status: row.payment_status,
        booking_status: row.booking_status,
        deposit_status: row.deposit_status,
        owner_response: row.owner_response,
        created_at: row.created_at,
        updated_at: row.updated_at,
        delivery,
        blocked_by,
        next_action,
        actionable,
        return_actionable: row.delivery_status === 'RETURN_LOCATION_PENDING',
        phase: actionable || row.delivery_status === 'RETURN_LOCATION_PENDING' ? 'PENDING' : activeRental ? 'ACTIVE' : completedRental ? 'COMPLETED' : 'HISTORY',
      };
    });

    res.json({
      requests,
      summary: {
        pending: requests.filter((request) => request.phase === 'PENDING').length,
        active: requests.filter((request) => request.phase === 'ACTIVE').length,
        completed: requests.filter((request) => request.phase === 'COMPLETED').length,
        total: requests.length,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[RentalController] getOwnerRequests error:', error.message);
    res.status(500).json({ error: 'Failed to fetch owner requests.' });
  }
};

// POST /api/rentals/:id/complete
exports.confirmReturn = async (req, res) => {
  const owner_id = req.user.id;
  const { id } = req.params;
  const { damage_description, damage_amount } = req.body;

  try {
    const method = (await pool.query('SELECT payment_method FROM rentals WHERE id=$1',[id])).rows[0]?.payment_method;
    if (method==='DIRECT_UPI') return res.json(await require('../direct-upi/service').createService().complete(id,owner_id,req.body));
    const result = await paymentService.refundDeposit(id, damage_amount, damage_description, owner_id);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[RentalController] confirmReturn error:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to confirm return.' });
  }
};

