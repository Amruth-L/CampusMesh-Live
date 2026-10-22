const pool = require('../../config/database');
const { emitUser } = require('../../shared/realtime');
const { matchDelivery } = require('../delivery/matching.service');
const { routeFor } = require('../campus/campus.service');
const fail = (status, message) => Object.assign(new Error(message), { status });
const label = (location) =>
  [location.building_name, location.floor_name, location.room_name].filter(Boolean).join(' · ');

function notify(rental) {
  for (const user of [rental.owner_id, rental.borrower_id])
    emitUser(user, 'rental:status', { rental_id: rental.id });
}

// A rental lock makes repeated clicks return the same return request.
async function requestReturn(rentalId, userId, requestedMode) {
  const client = await pool.connect();
  let rental, delivery;
  try {
    await client.query('BEGIN');
    rental = (
      await client.query(
        `SELECT r.*, l.title, l.pickup_location_id FROM rentals r
      JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 FOR UPDATE OF r`,
        [rentalId],
      )
    ).rows[0];
    if (!rental) throw fail(404, 'Rental not found.');
    if (rental.borrower_id !== userId) throw fail(403, 'Only the borrower can request a return.');
    const mode = requestedMode || (rental.delivery_requested ? 'COURIER' : 'DIRECT');
    if (!['DIRECT', 'COURIER'].includes(mode)) throw fail(400, 'Choose direct or courier return.');
    if (
      rental.return_delivery_id &&
      ['RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED', 'RETURN_IN_TRANSIT'].includes(rental.status)
    ) {
      delivery = (
        await client.query('SELECT * FROM delivery_requests WHERE id=$1', [rental.return_delivery_id])
      ).rows[0];
      if (mode !== 'COURIER') throw fail(409, 'A courier return is already in progress.');
    } else if (rental.status === 'RETURN_PENDING' && mode === 'DIRECT') {
      delivery = { status: 'RETURN_PENDING', mode };
    } else {
      if (rental.status !== 'RENTAL_ACTIVE')
        throw fail(409, 'The rental must be active before a return can be requested.');
      if (mode === 'DIRECT') {
        await client.query("UPDATE rentals SET status='RETURN_PENDING',updated_at=NOW() WHERE id=$1", [
          rentalId,
        ]);
        delivery = { status: 'RETURN_PENDING', mode };
      } else {
        const locations = (
          await client.query('SELECT * FROM campus_locations WHERE id=ANY($1::text[])', [
            [rental.drop_location_id, rental.pickup_location_id],
          ])
        ).rows;
        const pickup = locations.find((x) => x.id === rental.drop_location_id);
        const destination = locations.find((x) => x.id === rental.pickup_location_id);
        if (!pickup || !destination)
          throw fail(422, 'Pickup and owner campus locations are required for a courier return.');
        const fee = Number(rental.delivery_fee) > 0 ? Number(rental.delivery_fee) : 15;
        delivery = (
          await client.query(
            `INSERT INTO delivery_requests
          (rental_id,listing_id,customer_id,seller_id,pickup_location,drop_location,pickup_location_id,destination_location_id,
           task_type,item_description,delivery_fee,courier_earning,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RENTAL_RETURN',$9,$10,$11,'RETURN_LOCATION_PENDING') RETURNING *`,
            [
              rentalId,
              rental.listing_id,
              rental.owner_id,
              rental.borrower_id,
              label(pickup),
              label(destination),
              pickup.id,
              destination.id,
              `Return: ${rental.title}`,
              fee,
              fee * (rental.payment_method==='DIRECT_UPI'?1:0.7),
            ],
          )
        ).rows[0];
        await client.query(
          "UPDATE rentals SET status='RETURN_MATCHING',return_delivery_id=$2,updated_at=NOW() WHERE id=$1",
          [rentalId, delivery.id],
        );
      }
      await client.query(
        `INSERT INTO transaction_events(rental_id,event_type,actor_user_id,metadata)
        VALUES($1,$2,$3,$4)`,
        [
          rentalId,
          mode === 'DIRECT' ? 'DIRECT_RETURN_INITIATED' : 'RETURN_LOCATION_REQUESTED',
          userId,
          { delivery_id: delivery.id, mode },
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  notify(rental);
  const response = { ...delivery };
  delete response.pickup_token;
  delete response.delivery_token;
  return response;
}

// A confirmed destination is shown on every offer. After acceptance it is locked:
// a courier must never be silently rerouted after agreeing to a job.
async function confirmReturnDestination(rentalId, ownerId, locationId) {
  const client = await pool.connect();
  let rental,
    delivery,
    removed = [];
  try {
    await client.query('BEGIN');
    rental = (await client.query('SELECT * FROM rentals WHERE id=$1', [rentalId])).rows[0];
    if (!rental) throw fail(404, 'Rental not found.');
    if (rental.owner_id !== ownerId) throw fail(403, 'Only the owner can choose the return destination.');
    delivery = (
      await client.query(
        "SELECT * FROM delivery_requests WHERE id=$1 AND task_type='RENTAL_RETURN' FOR UPDATE",
        [rental.return_delivery_id],
      )
    ).rows[0];
    if (
      !delivery ||
      delivery.courier_id ||
      !['RETURN_LOCATION_PENDING', 'RETURN_MATCHING'].includes(delivery.status)
    )
      throw fail(
        409,
        'The destination can only change before a courier accepts. Contact the courier if arrangements need to change.',
      );
    const locations = (
      await client.query('SELECT * FROM campus_locations WHERE id=ANY($1::text[])', [
        [locationId, delivery.pickup_location_id],
      ])
    ).rows;
    const destination = locations.find((x) => x.id === locationId);
    if (
      !destination ||
      !routeFor(
        locations.find((x) => x.id === delivery.pickup_location_id),
        destination,
      )
    )
      throw fail(422, 'Choose a reachable campus destination.');
    if (delivery.status === 'RETURN_MATCHING' && delivery.destination_location_id === locationId) {
      await client.query('COMMIT');
      return { message: 'This return destination is already confirmed.', delivery_id: delivery.id };
    }
    // Remove only unaccepted offers; couriers must review the revised destination.
    removed = (
      await client.query('DELETE FROM delivery_offers WHERE delivery_id=$1 RETURNING courier_id', [
        delivery.id,
      ])
    ).rows;
    await client.query(
      `UPDATE delivery_requests SET destination_location_id=$2,drop_location=$3,status='RETURN_MATCHING',
      declined_by='{}',updated_at=NOW() WHERE id=$1`,
      [delivery.id, locationId, label(destination)],
    );
    await client.query(
      `INSERT INTO transaction_events(rental_id,delivery_id,event_type,actor_user_id,metadata)
      VALUES($1,$2,'RETURN_DESTINATION_CONFIRMED',$3,$4)`,
      [
        rentalId,
        delivery.id,
        ownerId,
        { previous_location_id: delivery.destination_location_id, location_id: locationId },
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  for (const offer of removed)
    emitUser(offer.courier_id, 'delivery:offer-unavailable', { delivery_id: delivery.id });
  notify(rental);
  try {
    await matchDelivery(delivery.id);
  } catch (error) {
    console.error('[return] Matching deferred:', error.message);
  }
  return { message: 'Return destination saved. Online couriers can now accept.', delivery_id: delivery.id };
}
module.exports = { requestReturn, confirmReturnDestination };
