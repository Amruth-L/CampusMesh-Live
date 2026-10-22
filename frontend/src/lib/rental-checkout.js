const unpaidRentalStates = new Set(['BOOKING_PAYMENT_PENDING', 'BOOKING_REQUESTED']);
const paidRentalStates = new Set(['PAID', 'RENTAL_PAID', 'FULLY_PAID']);

export function canPayRental({ rental, payments = [] } = {}) {
  return Boolean(rental && unpaidRentalStates.has(rental.status)
    && !paidRentalStates.has(rental.payment_status)
    && !payments.some(payment => payment.payment_type === 'RENTAL' && payment.status === 'PAID'));
}

export function validateRentalOrder(order) {
  if (order?.simulated === true) {
    throw new Error('Online payment is not configured for this environment. No payment was taken. Please contact CampusMesh support.');
  }
  if (!/^order_[A-Za-z0-9]+$/.test(order?.order_id || '') || !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(order?.razorpay_key || '')) {
    throw new Error('The payment provider did not return a valid checkout. No payment was taken. Please try again.');
  }
  if (!Number.isFinite(Number(order.amount)) || Number(order.amount) <= 0 || (order.currency && order.currency !== 'INR')) {
    throw new Error('The payment amount could not be confirmed. Please check your booking before trying again.');
  }
  return order;
}

export function rentalVerificationPayload(bookingId, receipt) {
  if (!receipt || receipt.gateway_order_id !== receipt.expected_order_id
    || !/^order_[A-Za-z0-9]+$/.test(receipt.gateway_order_id || '')
    || !/^pay_[A-Za-z0-9]+$/.test(receipt.gateway_payment_id || '')
    || !/^[a-f0-9]{64}$/i.test(receipt.gateway_signature || '')) {
    throw new Error('Payment confirmation details are incomplete. Do not pay again. Check your rental details or contact support.');
  }
  return {
    booking_id: bookingId,
    gateway_order_id: receipt.gateway_order_id,
    gateway_payment_id: receipt.gateway_payment_id,
    gateway_signature: receipt.gateway_signature,
  };
}
