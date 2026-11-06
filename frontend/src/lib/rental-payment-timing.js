const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Keep payment-stage labels and amounts consistent wherever a rental quote is shown.
export function rentalPaymentTiming(quote) {
  const direct = quote?.paymentMethod === 'DIRECT_UPI';
  const rent = amount(quote?.rentalFee);
  const deposit = amount(quote?.securityDeposit);
  const payNow = amount(quote?.payNow ?? quote?.totalAmount);
  const dueAfterAcceptance = direct
    ? amount(quote?.payAfterAcceptance ?? rent + deposit)
    : payNow;
  const dueAfterHandover = direct ? amount(quote?.payAfterHandover) : 0;

  return {
    direct,
    payNow,
    dueAfterAcceptance,
    dueAfterHandover,
    primaryLabel: direct ? 'Due after acceptance' : 'Pay now',
    primaryAmount: direct ? dueAfterAcceptance : payNow,
  };
}
