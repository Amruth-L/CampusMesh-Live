// Progress is derived from recorded checkpoints, not from a rental being active.
export function deliveryProgress(rental = {}, delivery = {}) {
  const d = delivery || {};
  const returning = d.task_type === 'RENTAL_RETURN';
  const direct = (d.payment_method || rental.payment_method) === 'DIRECT_UPI';
  const used = stage => d.handovers?.some(h => h.stage === stage && h.status === 'USED');
  const pickup = Boolean(d.pickup_verified_at || d.pickup_handover_status === 'USED' || used(returning ? 'RETURN_PICKUP' : 'PICKUP'));
  const handover = Boolean(d.delivery_verified_at || d.delivery_handover_status === 'USED' || used(returning ? 'RETURN_RECEIVED' : 'DELIVERY'));
  const arrived = Boolean(d.arrived_destination_at || handover || d.status === 'ARRIVED_AT_DESTINATION');
  const feeRequired = direct && Number(d.courier_earning ?? d.delivery_fee ?? rental.delivery_fee) > 0;
  const feeConfirmed = d.fee_status === 'CONFIRMED';
  const accepted = Boolean((d.courier?.id || d.courier_id) && d.accepted_at);
  const payments = rental.payment_status === 'FULLY_PAID';
  const approved = rental.owner_response === 'ACCEPTED';
  const step = (key, label, done, instruction, completedText = 'Confirmed') => ({ key, label, done, instruction, completedText });
  const approval = step('approval', 'Lender approval', approved, 'The lender needs to accept your rental request.');
  const payment = step('rental-payment', 'Rental & deposit', payments,
    rental.payment_status === 'RENTAL_PAID' ? 'Pay the security deposit and wait for the lender to confirm receipt.' : 'Complete the rental payment and any required deposit.',
    Number(rental.deposit_amount) > 0 ? 'Payments confirmed' : 'Paid · no deposit');
  const steps = returning ? [step('destination', 'Return location', Boolean(d.destination_location_id && ['RETURN_MATCHING', 'RETURN_COURIER_ASSIGNED', 'COURIER_ASSIGNED', 'GOING_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'RETURN_IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERY_PAYMENT_PENDING', 'COMPLETED'].includes(d.status)), 'The lender must confirm where to receive the returned item.')] : direct ? [approval, payment] : [
    step('booking', 'Booking payment', ['RENTAL_PAID', 'FULLY_PAID'].includes(rental.payment_status), 'Complete your booking payment.'),
    approval,
    step('deposit', 'Security deposit', payments, 'Pay the required deposit before courier matching.', Number(rental.deposit_amount) > 0 ? 'Deposit confirmed' : 'Not required'),
  ];
  steps.push(
    step('courier', 'Courier accepted', accepted, 'Waiting for an available delivery student to accept.'),
    step('pickup', returning ? 'Return pickup' : 'Item pickup', pickup,
      d.status === 'ARRIVED_AT_PICKUP' ? 'The courier uploads the condition photo and verifies the pickup QR or OTP.' : 'The courier is heading to the pickup point.', 'Pickup verified'),
    step('transit', 'In transit', arrived,
      returning ? 'The courier is bringing the item back to the lender.' : 'The courier is bringing the item to the borrower.', 'Destination reached'),
    step('handover', returning ? 'Owner handover' : 'Item handover', handover,
      'The courier uploads the arrival photo and verifies the receiver’s QR or OTP.', 'Handover verified'),
  );
  if (feeRequired) steps.push(step('fee', 'Delivery fee', feeConfirmed,
    d.fee_status === 'REPORTED' ? 'Payment reported. Waiting for the courier to check their bank and confirm receipt. Do not pay again.'
      : d.fee_status === 'DISPUTED' ? 'The courier has disputed receipt. Resolve the transaction with them before continuing.'
        : 'The borrower pays the delivery fee, reports the transaction, and the courier confirms receipt.', 'Courier confirmed receipt'));
  steps.push(step('complete', returning ? 'Return delivered' : 'Delivered',
    handover && (!feeRequired || feeConfirmed) && d.status === 'COMPLETED',
    'Waiting for delivery completion to be recorded.', returning ? 'Return delivery complete' : 'Delivery complete'));
  // Do not draw a green connector through an unconfirmed earlier checkpoint.
  let reachedPending = false;
  const stopped = ['CANCELLED', 'FAILED'].includes(d.status) || rental.status === 'CANCELLED';
  const items = steps.map(s => {
    const done = !reachedPending && s.done;
    const current = !done && !reachedPending && !stopped;
    if (!done) reachedPending = true;
    return { ...s, done, current, state: done ? 'complete' : current ? 'current' : 'pending' };
  });
  const current = items.find(s => s.current);
  const finished = items.every(s => s.done);
  return {
    steps: items, current, finished, returning,
    title: returning ? 'Return delivery progress' : 'Delivery progress',
    summary: stopped ? 'This delivery is stopped. Completed checkpoints are retained below.'
      : finished ? returning ? 'Return delivery complete. Owner inspection and deposit refund are tracked separately.' : 'Delivery complete. The rental is active; the item still needs to be returned by its due date.'
        : current?.instruction,
  };
}
