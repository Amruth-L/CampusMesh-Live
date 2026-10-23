// Participant-only facts for the return screen. No bank details are disclosed.
async function returnWorkflow(db,r) {
  const result=await db.query(`SELECT
    EXISTS(SELECT 1 FROM upi_profiles p WHERE p.user_id=$2) AS refund_account_ready,
    EXISTS(SELECT 1 FROM transaction_events e WHERE e.rental_id=$1 AND e.event_type='RETURN_CONFIRMED') AS inspected,
    EXISTS(SELECT 1 FROM transaction_events e WHERE e.rental_id=$1 AND e.event_type='RETURN_DESTINATION_CONFIRMED') AS accepted,
    d.status AS delivery_status,d.delivery_verified_at,
    EXISTS(SELECT 1 FROM handover_verifications h WHERE h.delivery_id=d.id AND h.stage='RETURN_RECEIVED' AND h.status='USED') AS handover_verified
    FROM rentals r LEFT JOIN delivery_requests d ON d.id=r.return_delivery_id WHERE r.id=$1`,[r.id,r.borrower_id]);
  const f=result.rows[0] || {};
  const courier=Boolean(r.return_delivery_id);
  const inspected=Boolean(f.inspected);
  const received=courier ? Boolean(f.delivery_verified_at && f.handover_verified) : inspected;
  const deliverySettled=!courier || f.delivery_status==='COMPLETED';
  return {
    requested:r.status.startsWith('RETURN_') || inspected,
    courier_return:courier,
    accepted:courier ? Boolean(f.accepted) : inspected,
    received,inspected,delivery_settled:deliverySettled,
    refund_account_ready:Boolean(f.refund_account_ready),
    can_inspect:r.status==='RETURN_PENDING' && !inspected && (!courier || received),
    next_action:!received && courier ? f.accepted ? 'WAIT_FOR_RETURN_DELIVERY' : 'ACCEPT_RETURN'
      : !inspected ? 'INSPECT_ITEM'
        : Number(r.deposit_amount)>0 && r.deposit_status!=='REFUNDED' ? f.refund_account_ready ? 'REFUND_DEPOSIT' : 'ADD_REFUND_UPI'
          : !deliverySettled ? 'SETTLE_RETURN_DELIVERY_FEE' : 'COMPLETE',
  };
}
module.exports={returnWorkflow};
