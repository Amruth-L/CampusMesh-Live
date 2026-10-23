-- Physical return approval is not confirmation that the renter received a refund.
-- Retain payment receipts and return events; keep unsettled direct refunds open.
UPDATE rentals r SET status='RETURN_PENDING',completed_at=NULL,updated_at=NOW()
WHERE r.payment_method='DIRECT_UPI' AND r.status='COMPLETED'
  AND r.deposit_status='REFUND_PENDING' AND r.deposit_amount>0
  AND NOT EXISTS (SELECT 1 FROM direct_upi_payments p
    WHERE p.rental_id=r.id AND p.kind='DEPOSIT_REFUND' AND p.status='CONFIRMED');
