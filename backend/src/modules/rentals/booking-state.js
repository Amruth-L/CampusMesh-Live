// Checkout drafts are borrower-side work in progress. Keep any recorded payment
// visible for reconciliation, even when an older row still has a draft status.
function submittedRentalSql(alias = 'r') {
  return `(${alias}.payment_method='DIRECT_UPI'
    OR ${alias}.status NOT IN ('BOOKING_PAYMENT_PENDING','BOOKING_REQUESTED')
    OR ${alias}.payment_status IN ('PAID','RENTAL_PAID','FULLY_PAID')
    OR EXISTS (SELECT 1 FROM payments booking_payment
      WHERE booking_payment.rental_id=${alias}.id AND booking_payment.status='PAID'))`;
}

function bookingPaymentReceivedSql(alias = 'r') {
  return `EXISTS (SELECT 1 FROM payments booking_payment
    WHERE booking_payment.rental_id=${alias}.id AND booking_payment.payment_type='RENTAL'
      AND booking_payment.status='PAID' AND booking_payment.amount >= ${alias}.booking_amount)`;
}

module.exports = { submittedRentalSql, bookingPaymentReceivedSql };
