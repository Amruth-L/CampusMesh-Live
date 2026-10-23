-- Preserve physical handover evidence, but stop presenting unpaid direct-UPI
-- delivery legs as completed. Never change payment receipts or bank records.
UPDATE delivery_requests d
SET status='DELIVERY_PAYMENT_PENDING', completed_at=NULL, updated_at=NOW()
FROM rentals r
WHERE r.id=d.rental_id AND r.payment_method='DIRECT_UPI'
  AND d.task_type IN ('RENTAL_OUTBOUND','RENTAL_RETURN')
  AND d.status IN ('COMPLETED','DELIVERED') AND d.delivery_verified_at IS NOT NULL
  AND d.courier_earning>0 AND d.courier_id IS NOT NULL
  AND d.courier_id<>r.borrower_id AND d.courier_id<>r.owner_id
  AND NOT EXISTS (
    SELECT 1 FROM direct_upi_payments p
    WHERE p.delivery_id=d.id AND p.recipient_id=d.courier_id
      AND p.kind=CASE WHEN d.task_type='RENTAL_RETURN' THEN 'RETURN_DELIVERY' ELSE 'DELIVERY' END
      AND p.status='CONFIRMED'
  );
