// Read committed workflow records. Voice never advances an order or confirms money.
// Only these fixed scripts reach Deepgram; names, UPI IDs and user text stay here.
const scripts = {
  BOOKING_CREATED:
    'A rental request was placed. Open rental details to check the next step. Payment and lender approval may still be needed.',
  OWNER_ACCEPTED:
    'The lender accepted the rental request. Open rental details to complete any payment or deposit still required.',
  OWNER_REJECTED:
    'The lender declined the rental request. Open rental details to check the cancellation and any refund status.',
  RENTAL_PAYMENT_COMPLETED:
    'The rental payment was confirmed. This does not confirm item handover. Check rental details for the next step.',
  DEPOSIT_PAID:
    'The security deposit payment was confirmed. Check rental details for pickup or delivery instructions.',
  COURIER_MATCHING: 'CampusMesh is looking for a courier. Delivery is not assigned yet.',
  NO_COURIER_AVAILABLE:
    'No courier is available for this request yet. Check rental details for the available options.',
  COURIER_ASSIGNED:
    'A courier accepted this delivery. Open the delivery details to see the pickup and destination.',
  DELIVERY_GOING_TO_PICKUP:
    'The courier is on the way to collect the item. Check the delivery details for progress.',
  DELIVERY_ARRIVED_AT_PICKUP:
    'The courier arrived at the pickup point. Complete the condition photo and handover verification before moving the item.',
  PICKUP_VERIFIED: 'Pickup was verified. The item is now in transit.',
  DELIVERY_IN_TRANSIT: 'The courier collected the item and is on the way.',
  DELIVERY_ARRIVED_AT_DESTINATION:
    'The courier arrived at the destination. Check the item and complete the handover verification.',
  DELIVERY_VERIFIED:
    'The item handover was verified. Check the delivery fee status. A pending fee still needs recipient confirmation.',
  DELIVERY_PAYMENT_CONFIRMED: 'The courier confirmed the delivery fee. The delivery is now complete.',
  CONDITION_PHOTO_UPLOADED:
    'A condition photo was saved for this handover. You can review it in the delivery details.',
  DIRECT_RETURN_INITIATED:
    'A direct return was requested. Arrange the handover with the owner. The owner must inspect the item before the deposit refund.',
  RETURN_LOCATION_REQUESTED:
    'An item return was requested. The owner needs to confirm the return destination before a courier can accept.',
  RETURN_DESTINATION_CONFIRMED:
    'The owner confirmed the return destination. Available couriers can now review the return request.',
  RETURN_PICKUP_VERIFIED: 'Return pickup was verified. The item is on its way back to the owner.',
  RETURN_RECEIVED_VERIFIED:
    'Return handover was verified. The owner must inspect the item. This does not confirm that the deposit was refunded.',
  RETURN_CONFIRMED:
    'The owner confirmed the item inspection. Check rental details for the deposit refund and any remaining delivery fee.',
  EXTENSION_REQUESTED: 'A rental extension was requested. The lender needs to review it.',
  EXTENSION_ACCEPTED:
    'The lender accepted the rental extension. Check rental details for the updated due date and any additional fee.',
  EXTENSION_REJECTED: 'The lender declined the rental extension. The existing return date still applies.',
  RETURN_REMINDER_SENT:
    'The lender sent a return reminder. Please check the rental due date and arrange the return.',
  RENTAL_CLOSED:
    'The rental return is complete and its required refund and delivery payments are settled. You can review the receipts in Payments.',
  OFFER:
    'A delivery request is available for you. Open the delivery dashboard to review the locations and fee, then accept or decline.',
  WISH_OPEN: 'A new Wish Box request is available. Open Wish Box to review what is needed before accepting.',
  WISH_CHECKING: 'A student is checking a Wish Box request. Wait for the price quote before making payment.',
  WISH_QUOTED: 'A Wish Box price quote is ready. Review the total and accept or decline the deal.',
  WISH_PAYMENT_PENDING:
    'The Wish Box quote was accepted. Payment still needs to be completed before collection.',
  WISH_IN_DELIVERY:
    'The Wish Box payment was confirmed and the delivery task is ready. Open Wish Box for collection and delivery progress.',
  WISH_COMPLETED: 'The Wish Box handover was verified and the request is complete.',
  WISH_CANCELLED: 'The Wish Box request was cancelled. Open its details to review the status.',
  REFUND_PENDING:
    'A refund is pending with the payment provider. It is not confirmed as credited to the bank yet.',
  REFUND_UNKNOWN: 'The refund is awaiting provider confirmation. Check its status before trying again.',
  REFUND_PROCESSED:
    'The payment provider processed the refund. Your bank may take additional time to credit it.',
  REFUND_FAILED: 'The payment provider reported a refund failure. Open rental details and contact support.',
  REFUND_NO_REFUND:
    'The return inspection recorded no refundable deposit. Review the damage deduction in rental details.',
  DUE_4: 'A rented item is due in four days. Check My rentals and plan its return.',
  DUE_1: 'A rented item is due tomorrow. Please arrange its return or request an extension.',
  DUE_0: 'A rented item is due today. Please arrange its return or check with the lender.',
  DUE_OVERDUE: 'A rented item is overdue. Open My rentals and arrange its return with the lender.',
};

const transactionTypes = Object.keys(scripts).filter(
  (key) => !/^(WISH_|REFUND_|DUE_|OFFER$|RENTAL_CLOSED$)/.test(key),
);
const paymentNames = {
  RENTAL: 'rental payment',
  DEPOSIT: 'security deposit',
  DELIVERY: 'delivery fee',
  RETURN_DELIVERY: 'return delivery fee',
  DEPOSIT_REFUND: 'deposit refund',
};

function scriptFor(row) {
  if (row.source === 'upi') {
    const name = paymentNames[row.payment_kind];
    if (!name) return null;
    if (row.event_type === 'REPORT')
      return row.role === 'recipient'
        ? `The payer reported sending your ${name}. Check your bank or UPI app, then confirm receipt in CampusMesh. It is not confirmed yet.`
        : `Your ${name} was reported as sent. Wait for the recipient to confirm receipt. Do not pay again while confirmation is pending.`;
    if (row.event_type === 'CONFIRM')
      return `The recipient confirmed receiving the ${name}. ${['DELIVERY', 'RETURN_DELIVERY'].includes(row.payment_kind) ? 'This delivery is now complete.' : 'Open payment details to review the receipt.'}`;
    if (row.event_type === 'DISPUTE')
      return `The recipient could not confirm the ${name}. Check payment details and resolve the difference before paying again.`;
    return null;
  }
  const text = scripts[row.event_type];
  if (!text) return null;
  // The same milestone belongs to distinct outbound and return journeys.
  return row.task_type === 'RENTAL_RETURN' &&
    [
      'COURIER_ASSIGNED',
      'DELIVERY_GOING_TO_PICKUP',
      'DELIVERY_ARRIVED_AT_PICKUP',
      'DELIVERY_ARRIVED_AT_DESTINATION',
      'CONDITION_PHOTO_UPLOADED',
      'DELIVERY_PAYMENT_CONFIRMED',
    ].includes(row.event_type)
    ? `Return delivery update. ${text}`
    : text;
}

// Every branch uses the authenticated user, not an ID supplied by the browser.
// CAST timestamp WITHOUT TIME ZONE as UTC: these legacy columns are written in UTC.
const feedSql = `WITH feed AS (
  SELECT 'event:'||e.id AS id, 'transaction'::text AS source, e.event_type,
    e.rental_id, e.delivery_id, d.wish_request_id AS wish_id, e.created_at AT TIME ZONE 'UTC' AS occurred_at,
    d.task_type, NULL::text AS payment_kind, NULL::text AS role
  FROM transaction_events e LEFT JOIN rentals r ON r.id=e.rental_id
    LEFT JOIN listings l ON l.id=r.listing_id LEFT JOIN delivery_requests d ON d.id=e.delivery_id
  WHERE e.event_type=ANY($3::text[]) AND (r.id IS NULL OR l.demo_slug IS NULL)
    AND ($1 IN (r.borrower_id,r.owner_id) OR $1 IN (d.courier_id,d.customer_id,d.seller_id))
    AND e.created_at AT TIME ZONE 'UTC'>=$2
    -- Direct UPI has its own payment record. Do not announce the same fee twice.
    AND NOT (e.event_type='DELIVERY_PAYMENT_CONFIRMED' AND EXISTS(
      SELECT 1 FROM direct_upi_payments p WHERE p.delivery_id=e.delivery_id
        AND p.kind IN ('DELIVERY','RETURN_DELIVERY') AND $1 IN (p.payer_id,p.recipient_id)))
    -- Skip progress that has already been superseded while playback was blocked.
    AND (e.event_type<>'COURIER_MATCHING' OR d.status IN ('MATCHING_COURIER','RETURN_MATCHING'))
    AND (e.event_type<>'NO_COURIER_AVAILABLE' OR d.status='NO_COURIER_AVAILABLE')
    AND (e.event_type<>'DELIVERY_GOING_TO_PICKUP' OR d.status='GOING_TO_PICKUP')
    AND (e.event_type<>'DELIVERY_ARRIVED_AT_PICKUP' OR d.status='ARRIVED_AT_PICKUP')
    AND (e.event_type NOT IN ('PICKUP_VERIFIED','RETURN_PICKUP_VERIFIED','DELIVERY_IN_TRANSIT') OR d.status IN ('IN_TRANSIT','RETURN_IN_TRANSIT'))
    AND (e.event_type<>'DELIVERY_ARRIVED_AT_DESTINATION' OR d.status='ARRIVED_AT_DESTINATION')
    AND (e.event_type<>'RETURN_REMINDER_SENT' OR r.status='RENTAL_ACTIVE')
  UNION ALL
  SELECT 'upi:'||e.id,'upi',e.action,p.rental_id,p.delivery_id,NULL,e.created_at,
    d.task_type,p.kind,CASE WHEN p.recipient_id=$1 THEN 'recipient' ELSE 'payer' END
  FROM direct_upi_events e JOIN direct_upi_payments p ON p.id=e.payment_id
    JOIN rentals r ON r.id=p.rental_id JOIN listings l ON l.id=r.listing_id
    LEFT JOIN delivery_requests d ON d.id=p.delivery_id
  WHERE $1 IN (p.payer_id,p.recipient_id) AND l.demo_slug IS NULL AND e.created_at>=$2
    AND e.action IN ('REPORT','CONFIRM','DISPUTE')
    -- Do not replay an obsolete reported/disputed state after receipt was confirmed.
    AND (e.action='CONFIRM' OR (e.action='REPORT' AND p.status='REPORTED') OR (e.action='DISPUTE' AND p.status='DISPUTED'))
  UNION ALL
  SELECT 'offer:'||o.id||':'||EXTRACT(EPOCH FROM o.offered_at),'offer','OFFER',d.rental_id,d.id,d.wish_request_id,
    o.offered_at AT TIME ZONE 'UTC',d.task_type,NULL,NULL
  FROM delivery_offers o JOIN delivery_requests d ON d.id=o.delivery_id
    LEFT JOIN listings l ON l.id=d.listing_id
  WHERE o.courier_id=$1 AND o.status='PENDING' AND o.expires_at>NOW() AND d.courier_id IS NULL
    AND d.status IN ('AVAILABLE','MATCHING_COURIER','RETURN_MATCHING','NO_COURIER_AVAILABLE')
    AND l.demo_slug IS NULL AND o.offered_at AT TIME ZONE 'UTC'>=$2
    AND EXISTS(SELECT 1 FROM courier_route_availability a WHERE a.courier_id=$1 AND a.is_active AND a.available_until>NOW())
  UNION ALL
  SELECT 'wish:'||w.id||':'||w.status||':'||EXTRACT(EPOCH FROM w.updated_at),'wish','WISH_'||w.status,
    NULL,w.delivery_id,w.id,w.updated_at,NULL,NULL,NULL
  FROM wish_requests w WHERE w.updated_at>=$2 AND
    ($1 IN (w.requester_id,w.courier_id) OR (w.status='OPEN' AND w.requester_id<>$1
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.wish_available)))
  UNION ALL
  SELECT 'refund:'||f.id||':'||f.refund_status,'refund','REFUND_'||f.refund_status,
    r.id,NULL,NULL,f.updated_at,NULL,NULL,NULL
  FROM refunds f JOIN rentals r ON r.id=f.rental_id JOIN listings l ON l.id=r.listing_id
  WHERE $1 IN (r.borrower_id,r.owner_id) AND r.payment_method='RAZORPAY' AND l.demo_slug IS NULL
    AND f.updated_at>=$2 AND f.refund_status IN ('PENDING','UNKNOWN','PROCESSED','FAILED','NO_REFUND')
  UNION ALL
  SELECT 'closed:'||r.id,'rental','RENTAL_CLOSED',r.id,NULL,NULL,r.updated_at AT TIME ZONE 'UTC',NULL,NULL,NULL
  FROM rentals r JOIN listings l ON l.id=r.listing_id
  WHERE $1 IN (r.borrower_id,r.owner_id) AND l.demo_slug IS NULL AND r.status='COMPLETED'
    AND r.updated_at AT TIME ZONE 'UTC'>=$2 AND r.payment_method='DIRECT_UPI'
    AND (r.deposit_amount=0 OR r.deposit_status='REFUNDED')
    AND NOT EXISTS(SELECT 1 FROM delivery_requests d WHERE d.rental_id=r.id AND d.status<>'COMPLETED')
    AND EXISTS(SELECT 1 FROM transaction_events e WHERE e.rental_id=r.id AND e.event_type='RETURN_CONFIRMED')
  UNION ALL
  SELECT 'due:'||r.id||':'||r.end_date||':'||((NOW() AT TIME ZONE 'Asia/Kolkata')::date),'due',
    CASE WHEN r.end_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date THEN 'DUE_OVERDUE'
      ELSE 'DUE_'||(r.end_date-(NOW() AT TIME ZONE 'Asia/Kolkata')::date) END,
    r.id,NULL,NULL,GREATEST((NOW() AT TIME ZONE 'Asia/Kolkata')::date::timestamp AT TIME ZONE 'Asia/Kolkata', r.updated_at AT TIME ZONE 'UTC'),NULL,NULL,NULL
  FROM rentals r JOIN listings l ON l.id=r.listing_id
  WHERE r.borrower_id=$1 AND r.status='RENTAL_ACTIVE' AND r.payment_status='FULLY_PAID' AND l.demo_slug IS NULL
    AND (r.end_date-(NOW() AT TIME ZONE 'Asia/Kolkata')::date IN (4,1,0) OR r.end_date<(NOW() AT TIME ZONE 'Asia/Kolkata')::date)
)
SELECT *, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_time FROM feed WHERE ($4::text IS NULL OR id=$4)
  AND ($5::timestamptz IS NULL OR (occurred_at,id)>($5,$6::text))
  ORDER BY occurred_at,id LIMIT 20`;

async function eventUpdates(db, user, after, eventId = null, position = null) {
  const { rows } = await db.query(feedSql, [
    user,
    after,
    transactionTypes,
    eventId,
    position?.[0] || null,
    position?.[1] || null,
  ]);
  return rows.flatMap((row) => {
    const text = scriptFor(row);
    return text
      ? [
          {
            id: row.id,
            kind: 'event',
            eventId: row.id,
            rentalId: row.rental_id,
            deliveryId: row.delivery_id,
            wishId: row.wish_id,
            occurredAt: row.position_time,
            text,
          },
        ]
      : [];
  });
}

module.exports = { eventUpdates, scriptFor, scripts, transactionTypes };
