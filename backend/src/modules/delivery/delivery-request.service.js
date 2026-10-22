const labelLocation = (location) =>
  [location?.building_name, location?.floor_name, location?.room_name].filter(Boolean).join(' · ');

async function ensureOutboundDelivery(client, rentalId, requestedStatus = 'WAITING_FOR_DEPOSIT') {
  const details = await client.query(
    `SELECT r.*, l.title, l.pickup_location_id AS listing_pickup_location_id,
            p.id AS pickup_id, p.building_name AS pickup_building_name,
            p.floor_name AS pickup_floor_name, p.room_name AS pickup_room_name,
            d.id AS drop_id, d.building_name AS drop_building_name,
            d.floor_name AS drop_floor_name, d.room_name AS drop_room_name
     FROM rentals r
     JOIN listings l ON l.id = r.listing_id
     LEFT JOIN campus_locations p ON p.id = l.pickup_location_id
     LEFT JOIN campus_locations d ON d.id = r.drop_location_id
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [rentalId],
  );
  const rental = details.rows[0];
  if (!rental) throw Object.assign(new Error('Rental not found.'), { status: 404 });
  if (!rental.delivery_requested && Number(rental.delivery_fee) <= 0) return null;
  if (!rental.pickup_id || !rental.drop_id) {
    throw Object.assign(new Error('Pickup and drop-off must be explicit campus locations.'), { status: 422 });
  }

  const pickupLocation = {
    id: rental.pickup_id,
    building_name: rental.pickup_building_name,
    floor_name: rental.pickup_floor_name,
    room_name: rental.pickup_room_name,
  };
  const dropLocation = {
    id: rental.drop_id,
    building_name: rental.drop_building_name,
    floor_name: rental.drop_floor_name,
    room_name: rental.drop_room_name,
  };

  const existing = await client.query(
    `SELECT * FROM delivery_requests
     WHERE rental_id=$1 AND task_type='RENTAL_OUTBOUND'
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE`,
    [rentalId],
  );

  let delivery;
  if (existing.rows[0]) {
    const current = existing.rows[0];
    const canAdvance = ['WAITING_FOR_DEPOSIT', 'MATCHING_COURIER', 'NO_COURIER_AVAILABLE'].includes(current.status);
    const nextStatus = canAdvance ? requestedStatus : current.status;
    const updated = await client.query(
      `UPDATE delivery_requests
       SET listing_id=$1, customer_id=$2, seller_id=$3,
           pickup_location=$4, drop_location=$5,
           pickup_location_id=$6, destination_location_id=$7,
           item_description=$8, delivery_fee=$9, courier_earning=$10,
           status=$11, updated_at=NOW()
       WHERE id=$12
       RETURNING *`,
      [
        rental.listing_id,
        rental.borrower_id,
        rental.owner_id,
        labelLocation(pickupLocation),
        labelLocation(dropLocation),
        pickupLocation.id,
        dropLocation.id,
        rental.title,
        rental.delivery_fee,
        Number(rental.delivery_fee) * 0.7,
        nextStatus,
        current.id,
      ],
    );
    delivery = updated.rows[0];
  } else {
    const created = await client.query(
      `INSERT INTO delivery_requests
       (rental_id, listing_id, customer_id, seller_id, pickup_location, drop_location,
        pickup_location_id, destination_location_id, task_type, item_description,
        delivery_fee, courier_earning, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RENTAL_OUTBOUND',$9,$10,$11,$12)
       RETURNING *`,
      [
        rental.id,
        rental.listing_id,
        rental.borrower_id,
        rental.owner_id,
        labelLocation(pickupLocation),
        labelLocation(dropLocation),
        pickupLocation.id,
        dropLocation.id,
        rental.title,
        rental.delivery_fee,
        Number(rental.delivery_fee) * 0.7,
        requestedStatus,
      ],
    );
    delivery = created.rows[0];
  }

  await client.query(
    'UPDATE rentals SET outbound_delivery_id=$1, updated_at=NOW() WHERE id=$2',
    [delivery.id, rentalId],
  );
  return delivery;
}

module.exports = { ensureOutboundDelivery };
