export const paymentNames = {
  RENTAL: 'Rent', DEPOSIT: 'Security deposit', DELIVERY: 'Delivery',
  RETURN_DELIVERY: 'Return delivery', DEPOSIT_REFUND: 'Deposit refund',
};

export function paymentAction(payment, userId) {
  const payer = payment.payer_id === userId;
  if (payment.status === 'CONFIRMED') return { kind: 'receipt', label: 'View receipt', status: 'Receipt confirmed', priority: 3 };
  if (!payer && ['REPORTED', 'DISPUTED'].includes(payment.status)) return { kind: 'confirm', label: 'Confirm receipt', status: 'Check your bank', priority: 0 };
  if (payer && payment.status === 'PENDING') return { kind: 'pay', label: 'Pay now', status: 'Payment due', priority: 0 };
  if (payment.status === 'DISPUTED') return { kind: 'dispute', label: 'View issue', status: 'Not received · do not pay again', priority: 1 };
  return { kind: 'waiting', label: 'View details', status: payer ? 'Sent · awaiting confirmation' : 'Waiting for payment', priority: 2 };
}

export function paymentNeedsAction(payment, userId) {
  return paymentAction(payment, userId).priority < 2;
}

export function groupPayments(payments, userId) {
  const active = payments.filter((payment) => payment.status !== 'CONFIRMED');
  // Keep payment order stable within a priority so live updates do not shuffle forms.
  active.sort((a, b) => paymentAction(a, userId).priority - paymentAction(b, userId).priority);
  return { active, history: payments.filter((payment) => payment.status === 'CONFIRMED') };
}
