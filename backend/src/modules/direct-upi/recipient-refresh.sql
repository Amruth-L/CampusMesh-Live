UPDATE direct_upi_payments p
SET recipient_history=p.recipient_history || jsonb_build_array(jsonb_build_object(
      'revision',p.recipient_revision,'upi_id',p.upi_id,'payee_name',p.payee_name,'changed_at',NOW())),
    recipient_revision=p.recipient_revision+1,upi_id=up.upi_id,payee_name=up.payee_name
FROM upi_profiles up
WHERE up.user_id=p.recipient_id AND p.status='PENDING'
  AND (p.upi_id<>up.upi_id OR p.payee_name<>up.payee_name)
  AND ($1::uuid IS NULL OR p.recipient_id=$1)
  AND ($2::uuid IS NULL OR p.payer_id=$2 OR p.recipient_id=$2)
  AND ($3::uuid IS NULL OR p.rental_id=$3)
RETURNING p.rental_id,p.payer_id,p.recipient_id;
