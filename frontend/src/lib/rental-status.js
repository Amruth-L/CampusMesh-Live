export function matchesRentalFilter(status, filter) {
  if (filter === 'All') return true;
  if (filter === 'Requested') return ['BOOKING_PAYMENT_PENDING', 'BOOKING_REQUESTED', 'RENTAL_PAYMENT_COMPLETED', 'OWNER_PENDING', 'DEPOSIT_PENDING', 'OWNER_ACCEPTED', 'WAITING_FOR_DEPOSIT'].includes(status);
  if (filter === 'Active') return ['ACTIVE', 'RENTAL_ACTIVE', 'DEPOSIT_PAID', 'DELIVERY_PENDING', 'DELIVERY_IN_PROGRESS', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'MATCHING_COURIER', 'NO_COURIER_AVAILABLE', 'COURIER_ASSIGNED', 'IN_TRANSIT', 'RETURN_PENDING', 'RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED'].includes(status);
  return filter === 'Completed' && ['COMPLETED', 'RENTAL_COMPLETED', 'DEPOSIT_REFUNDED'].includes(status);
}

// Payment and deposit settlement are not evidence of physical handover.
export function rentalProgress(rental) {
  const status = String(rental.status || '').toUpperCase();
  const stopped = ['CANCELLED', 'REJECTED'].includes(status);
  const returned = !stopped && (
    ['COMPLETED', 'RENTAL_COMPLETED', 'RETURN_RECEIVED'].includes(status) ||
    (status === 'DEPOSIT_REFUNDED' && Boolean(rental.completed_at))
  );
  const returning = ['RETURN_REQUESTED', 'RETURN_PENDING', 'RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED', 'RETURN_IN_TRANSIT'].includes(status);
  const handedOver = returned || returning || ['ACTIVE', 'RENTAL_ACTIVE'].includes(status);
  const arrangingHandover = ['QR_GENERATED', 'DEPOSIT_PAID', 'DELIVERY_PENDING', 'DELIVERY_IN_PROGRESS', 'MATCHING_COURIER', 'NO_COURIER_AVAILABLE', 'COURIER_ASSIGNED', 'GOING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION'].includes(status);
  const depositPaid = handedOver || arrangingHandover || ['HELD', 'PAID', 'REFUNDED'].includes(rental.deposit_status);
  const approved = depositPaid || rental.owner_response === 'ACCEPTED' || ['OWNER_ACCEPTED', 'DEPOSIT_PENDING', 'WAITING_FOR_DEPOSIT'].includes(status);
  const direct = rental.payment_method === 'DIRECT_UPI';
  const paid = (!direct && approved) || status === 'RENTAL_PAYMENT_COMPLETED' || ['PAID', 'RENTAL_PAID', 'FULLY_PAID'].includes(rental.payment_status);
  const awaitingOwner = ['RENTAL_PAYMENT_COMPLETED', 'OWNER_PENDING'].includes(status);
  const awaitingPayment = ['BOOKING_PAYMENT_PENDING', 'BOOKING_REQUESTED'].includes(status);
  const awaitingDeposit = ['OWNER_ACCEPTED', 'DEPOSIT_PENDING', 'WAITING_FOR_DEPOSIT'].includes(status);
  const current = stopped || returned ? null
    : awaitingPayment && !paid ? 'payment'
      : awaitingOwner && !approved ? 'approval'
        : awaitingDeposit && !depositPaid ? 'deposit'
          : arrangingHandover ? 'handover'
            : returning ? 'return' : null;
  const steps = [
    ...(direct ? [['approval', 'Owner approval', approved], ['payment', 'Receipt confirmed', paid]] : [['payment', 'Payment', paid], ['approval', 'Owner approval', approved]]),
    ['deposit', 'Deposit', depositPaid],
    ['handover', 'Handover', handedOver],
    ['return', 'Return', returned],
  ].map(([id, label, complete]) => ({ id, label, state: complete ? 'complete' : current === id ? 'current' : 'pending' }));
  const message = direct && rental.deposit_status === 'REFUND_PENDING' ? 'Item return approved. The lender must refund the deposit and the renter must confirm receipt before this rental closes.'
    : direct && awaitingOwner && !approved ? 'Request sent. Wait for lender acceptance before paying.'
    : direct && awaitingPayment && !paid ? 'Lender accepted. Pay directly and wait for their receipt confirmation.'
    : stopped ? 'This request has ended. No further handover is scheduled.'
    : returned ? 'Return confirmed. This rental is complete.'
      : returning ? 'Return in progress. It will be complete after the item is received and confirmed.'
        : handedOver ? 'Item handover confirmed. Your rental is active; return is still pending.'
          : arrangingHandover ? 'Payment and deposit received. Item handover is still pending.'
            : awaitingDeposit ? 'Owner approved. Pay the deposit before item handover.'
              : awaitingOwner && paid ? 'Rental fee received. Waiting for owner approval; no item handover yet.'
                : awaitingPayment ? 'Complete the rental payment to submit your request to the owner.'
                  : 'Open Details to check the latest status. Payment alone does not confirm item handover.';
  return { steps, message, awaitingOwner: awaitingOwner && (paid || direct) && !approved };
}

// Physical return and bank receipt are distinct checkpoints in direct UPI rentals.
export function returnSettlementProgress(rental, refund) {
  const ownerApproved = rental.return_workflow?.inspected || ['REFUND_PENDING', 'REFUNDED'].includes(rental.deposit_status) || rental.status === 'COMPLETED';
  const required = Number(rental.deposit_amount) > 0;
  const receipt = rental.deposit_status === 'REFUNDED' && refund?.status === 'CONFIRMED';
  const steps = [
    ['requested', 'Return requested', true],
    ...(rental.return_workflow?.courier_return ? [
      ['accepted', 'Owner accepted return', rental.return_workflow.accepted],
      ['received', 'Item returned to owner', rental.return_workflow.received],
    ] : []),
    ['inspection', 'Owner received & inspected', ownerApproved],
    ...(required ? [
      ['sent', 'Owner sent refund', ['REPORTED', 'DISPUTED', 'CONFIRMED'].includes(refund?.status)],
      ['receipt', 'Renter confirmed receipt', receipt],
    ] : []),
    ...(rental.return_workflow?.courier_return ? [['courier-fee', 'Return courier fee settled', rental.return_workflow.delivery_settled]] : []),
    ['closed', 'Rental closed', rental.status === 'COMPLETED' && (!required || receipt)],
  ];
  let pending = false;
  return steps.map(([key, label, evidence]) => {
    const done = !pending && evidence;
    const current = !pending && !done;
    if (!done) pending = true;
    return { key, label, done, current };
  });
}
