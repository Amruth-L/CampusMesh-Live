-- Refresh only unreported requests. Keep the former account so a payer who
-- already used its QR can report the correct destination without paying twice.
ALTER TABLE direct_upi_payments ADD COLUMN recipient_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE direct_upi_payments ADD COLUMN recipient_history JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE direct_upi_payments p
SET recipient_history=p.recipient_history || jsonb_build_array(jsonb_build_object(
      'revision',p.recipient_revision,'upi_id',p.upi_id,'payee_name',p.payee_name,'changed_at',NOW())),
    recipient_revision=p.recipient_revision+1,upi_id=up.upi_id,payee_name=up.payee_name
FROM upi_profiles up
WHERE up.user_id=p.recipient_id AND p.status='PENDING'
  AND (p.upi_id<>up.upi_id OR p.payee_name<>up.payee_name);
