export default function TestPaymentNotice() {
  return (
    <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <strong>Test payment — no real money is collected</strong>
      <p>Choose Netbanking, select a bank, then choose Success on the test bank page.</p>
      <p>For Cards, use domestic test Visa <strong>4100 2800 0000 1007</strong>, any future expiry and a random 3-digit CVV. International test cards may be rejected.</p>
      <a className="font-semibold underline" href="https://razorpay.com/docs/payments/payments/test-card-details/" target="_blank" rel="noreferrer">Razorpay test payment guide</a>
    </div>
  );
}
