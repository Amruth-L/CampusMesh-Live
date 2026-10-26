const { calculatePricing } = require('./pricing-engine');
function rentalQuote(listing, days, deliveryRequested, direct) {
  const quote = calculatePricing({
    dailyRent: Number(listing.rent_price),
    days,
    deliveryType: deliveryRequested ? 'STANDARD' : 'SELF_PICKUP',
    itemValue: Number(listing.price),
    customDeposit: Number(listing.deposit),
  });
  // The lender's saved delivery charge is the quote, including an explicit zero.
  quote.deliveryFee = deliveryRequested ? Number(listing.delivery_charge || 0) : 0;
  quote.platformFee = direct ? 0 : quote.platformFee;
  quote.totalAmount = Number(
    (quote.rentalFee + (direct ? 0 : quote.deliveryFee + quote.platformFee)).toFixed(2),
  );
  return {
    ...quote,
    days,
    paymentMethod: direct ? 'DIRECT_UPI' : 'RAZORPAY',
    payNow: direct ? 0 : quote.totalAmount,
    payAfterAcceptance: direct
      ? Number((quote.rentalFee + quote.securityDeposit).toFixed(2))
      : quote.securityDeposit,
    payAfterHandover: direct ? quote.deliveryFee : 0,
  };
}
module.exports = { rentalQuote };
