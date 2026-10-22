import React from 'react';

const formatCurrency = (n) => `₹${parseFloat(n || 0).toFixed(2)}`;

export default function PaymentSummary({
  dailyPrice,
  days,
  rentalFee,
  deliveryFee,
  platformFee,
  totalAmount,
  depositAmount,
  showDepositOnly = false
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="mb-5 border-b border-ink/10 pb-3 text-lg font-bold text-ink">
        {showDepositOnly ? '🔒 Security Deposit breakdown' : '💳 Payment Breakdown'}
      </h3>

      {!showDepositOnly ? (
        <div className="flex flex-col gap-3 text-sm text-ink/60">
          <div className="flex items-center justify-between gap-4">
            <span>Daily Rent</span>
            <span className="font-semibold text-ink">{formatCurrency(dailyPrice)} × {days} day{days > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Rental Fee</span>
            <span className="font-semibold text-mesh-700">{formatCurrency(rentalFee)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Delivery Fee</span>
            <span className="font-semibold text-ink">{deliveryFee > 0 ? formatCurrency(deliveryFee) : 'Free (Pickup)'}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span>Platform Fee</span>
            <span className="font-semibold text-ink">{formatCurrency(platformFee)}</span>
          </div>
          <hr className="my-2 border-0 border-t border-ink/10" />
          <div className="flex items-center justify-between gap-4 pt-2 text-lg font-extrabold text-ink">
            <span>Total Booking Amount</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
        </div>
      ) : null}

      {depositAmount > 0 && (
        <div className={`${showDepositOnly ? '' : 'mt-6'} rounded-xl border border-mesh-200 bg-mesh-50 p-4`}>
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-mesh-700">
            🔒 Security Deposit (Refundable)
          </div>
          <div className="mb-3 text-2xl font-extrabold text-ink">
            {formatCurrency(depositAmount)}
          </div>
          <p className="mb-2 text-sm leading-6 text-ink/60">
            This is collected {showDepositOnly ? 'now' : 'only after the owner accepts your request'} and is held securely.
          </p>
          <p className="m-0 text-sm font-semibold leading-6 text-mesh-700">
            ✅ 100% fully refundable upon undamaged return of the item.
          </p>
        </div>
      )}
    </div>
  );
}
