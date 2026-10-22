// These rows are obligations, not a wallet or proof of bank credit. Keep the
// captured source and its mode so test/legacy balances cannot become live payouts.
async function syncLedger(db, userId = null) {
  await db.query(
    `INSERT INTO payout_intents(source_key,user_id,kind,rental_id,payment_id,gateway_mode,amount_paise)
    SELECT 'lender:'||r.id,r.owner_id,'LENDER',r.id,p.id,p.gateway_mode,
      ROUND(LEAST(r.rental_fee,GREATEST(0,p.amount-r.delivery_fee-r.platform_fee))*100)::bigint
    FROM rentals r JOIN listings l ON l.id=r.listing_id
    JOIN payments p ON p.rental_id=r.id AND p.payment_type='RENTAL' AND p.status='PAID'
    WHERE ($1::uuid IS NULL OR r.owner_id=$1) AND l.demo_slug IS NULL AND r.owner_id<>r.borrower_id
      AND r.status='COMPLETED' AND r.payment_status='FULLY_PAID'
      AND EXISTS(SELECT 1 FROM transaction_events e WHERE e.rental_id=r.id AND e.event_type='RETURN_CONFIRMED')
      AND LEAST(r.rental_fee,GREATEST(0,p.amount-r.delivery_fee-r.platform_fee))>0
      AND NOT EXISTS(SELECT 1 FROM payments other WHERE other.rental_id=r.id AND other.payment_type='RENTAL' AND other.status='PAID' AND other.id<>p.id)
    ON CONFLICT(source_key) DO NOTHING`,
    [userId],
  );
  await db.query(
    `INSERT INTO payout_intents(source_key,user_id,kind,rental_id,delivery_id,payment_id,gateway_mode,amount_paise,status,reason)
    SELECT 'courier:'||d.id,d.courier_id,CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_COURIER' ELSE 'COURIER' END,
      r.id,d.id,p.id,COALESCE(p.gateway_mode,(SELECT funded.gateway_mode FROM payments funded WHERE funded.rental_id=r.id AND funded.payment_type='RENTAL' AND funded.status='PAID' LIMIT 1),'legacy'),ROUND(d.courier_earning*100)::bigint,
      CASE WHEN p.id IS NULL THEN 'AWAITING_FUNDING' ELSE 'AWAITING_SETUP' END,
      CASE WHEN p.id IS NULL THEN 'No captured payment funds this delivery fee.' END
    FROM delivery_requests d JOIN rentals r ON r.id=d.rental_id JOIN listings l ON l.id=r.listing_id
    LEFT JOIN payments p ON p.rental_id=r.id AND p.status='PAID' AND p.payment_type=CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_DELIVERY' ELSE 'RENTAL' END
    WHERE ($1::uuid IS NULL OR d.courier_id=$1) AND d.courier_id IS NOT NULL AND l.demo_slug IS NULL
      AND r.payment_method='RAZORPAY' AND d.task_type IN ('RENTAL_OUTBOUND','RENTAL_RETURN') AND d.status IN ('COMPLETED','DELIVERED')
      AND d.delivery_verified_at IS NOT NULL AND d.courier_earning>0 AND r.payment_status='FULLY_PAID'
      AND d.courier_id<>r.borrower_id AND d.courier_id<>r.owner_id
      AND EXISTS(SELECT 1 FROM handover_verifications h WHERE h.delivery_id=d.id
        AND h.stage=CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_RECEIVED' ELSE 'DELIVERY' END AND h.status='USED')
      AND (p.id IS NULL OR d.courier_earning<=CASE WHEN d.task_type='RENTAL_RETURN' THEN p.amount ELSE r.delivery_fee END)
    ON CONFLICT(source_key) DO NOTHING`,
    [userId],
  );
  await db.query(
    `INSERT INTO payout_intents(source_key,user_id,kind,delivery_id,wish_payment_id,gateway_mode,amount_paise)
    SELECT 'wish:'||w.id,d.courier_id,'WISH_REIMBURSEMENT',d.id,p.id,p.gateway_mode,p.amount_paise
    FROM wish_requests w JOIN delivery_requests d ON d.id=w.delivery_id JOIN wish_payments p ON p.wish_id=w.id AND p.quote_id=w.current_quote_id
    WHERE ($1::uuid IS NULL OR d.courier_id=$1) AND d.courier_id IS NOT NULL AND d.courier_id<>w.requester_id
      AND w.status='COMPLETED' AND d.status='COMPLETED' AND d.delivery_verified_at IS NOT NULL AND p.status='PAID'
      AND EXISTS(SELECT 1 FROM handover_verifications h WHERE h.delivery_id=d.id AND h.stage='DELIVERY' AND h.status='USED')
    ON CONFLICT(source_key) DO NOTHING`,
    [userId],
  );
}
module.exports = { syncLedger };
