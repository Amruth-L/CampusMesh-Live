const closedStatuses = new Set(['COMPLETED', 'RENTAL_COMPLETED', 'DEPOSIT_REFUNDED', 'CANCELLED', 'REJECTED', 'EXPIRED']);

// Use rental state, not delivery completion or the API's legacy phase label.
// An accepted direct-UPI rental can still be awaiting its first payment.
export function ownerRequestGroup(request) {
  if (closedStatuses.has(request.status) || request.owner_response === 'REJECTED') return 'history';
  if (request.return_actionable || request.status?.startsWith('RETURN_') || request.deposit_status === 'REFUND_PENDING' || request.delivery?.task_type === 'RENTAL_RETURN') return 'returns';
  if (request.actionable || (request.owner_response !== 'ACCEPTED' && ['OWNER_PENDING', 'RENTAL_PAYMENT_COMPLETED'].includes(request.status))) return 'new';
  return 'accepted';
}

export function ownerRequestStatus(request) {
  const group = ownerRequestGroup(request);
  if (group === 'history') {
    if (request.owner_response === 'REJECTED' || request.status === 'REJECTED') return 'Rejected';
    if (request.status === 'CANCELLED') return 'Cancelled';
    if (request.status === 'EXPIRED') return 'Expired';
    return 'Rental completed';
  }
  if (group === 'new') return request.actionable ? 'Awaiting your decision' : 'Request processing';
  if (request.return_actionable) return 'Return needs approval';
  if (request.deposit_status === 'REFUND_PENDING') return 'Deposit refund pending';
  if (group === 'returns') {
    if (request.deposit_status === 'REFUNDED') return 'Refund confirmed · closing return';
    if (request.delivery?.status === 'COMPLETED' || request.status === 'RETURN_PENDING') return 'Return inspection / settlement';
    return 'Return in progress';
  }
  if (['BOOKING_PAYMENT_PENDING', 'BOOKING_REQUESTED'].includes(request.status)) return 'Accepted · rent payment pending';
  if (['DEPOSIT_PENDING', 'WAITING_FOR_DEPOSIT'].includes(request.status)) return 'Accepted · deposit pending';
  if (['RENTAL_ACTIVE', 'ACTIVE'].includes(request.status)) return 'Rental active';
  const deliveryStatus = request.delivery?.status;
  if (deliveryStatus === 'COMPLETED') return 'Delivered · rental ongoing';
  if (['ARRIVED_AT_DESTINATION', 'DELIVERY_PAYMENT_PENDING'].includes(deliveryStatus)) return 'Handover / delivery payment';
  if (deliveryStatus === 'IN_TRANSIT') return 'Item in transit';
  if (deliveryStatus === 'ARRIVED_AT_PICKUP') return 'Ready for pickup';
  if (deliveryStatus === 'COURIER_ASSIGNED') return 'Courier assigned';
  if (['MATCHING_COURIER', 'NO_COURIER_AVAILABLE'].includes(request.status)) return 'Finding a courier';
  return 'Accepted · handover pending';
}

export function ownerRequestNextAction(request) {
  if (request.actionable) return 'Accept or reject this request.';
  if (request.return_actionable) return 'Accept the return and confirm where the item should arrive.';
  if (ownerRequestGroup(request) === 'history') return 'View the rental and payment history.';
  if (request.deposit_status === 'REFUND_PENDING') return 'Open the refund details to send it or check the renter’s confirmation.';
  if (request.payment_method === 'DIRECT_UPI' && ['BOOKING_PAYMENT_PENDING', 'DEPOSIT_PENDING'].includes(request.status)) return 'Open the payment details. Confirm receipt only after the money reaches your account.';
  if (ownerRequestGroup(request) === 'accepted' && ['ACTIVE', 'RENTAL_ACTIVE'].includes(request.status)) return 'The renter has your item. Track the return date below.';
  return request.next_action || 'Open the rental to see the next step.';
}
