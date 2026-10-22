import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { canPayRental, rentalVerificationPayload, validateRentalOrder } from '../lib/rental-checkout';
import { openRazorpayCheckout } from '../utils/RazorpayService';
import TestPaymentNotice from '../components/TestPaymentNotice';
import PaymentSummary from '../components/PaymentSummary';

const API_BASE = API_BASE_URL;

export default function RentalPayment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const receiptKey = `campusmesh:rental-payment:${user?.id}:${id}`;

  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testMode, setTestMode] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const payingRef = useRef(false);
  const receiptRef = useRef(null);
  const autoStartedRef = useRef(false);
  const autoStartBlockedRef = useRef(false);
  const startCheckoutRef = useRef(Boolean(location.state?.startCheckout));

  const request = useCallback(async (path, body) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not check your payment. Please try again.');
    return data;
  }, []);

  const clearReceipt = useCallback(() => {
    receiptRef.current = null;
    try { sessionStorage.removeItem(receiptKey); } catch { /* Memory still protects this checkout if storage is unavailable. */ }
  }, [receiptKey]);

  const showDetails = useCallback((justBooked = false) => {
    clearReceipt();
    navigate(`/rent-details/${id}`, { replace: true, state: { justBooked } });
  }, [clearReceipt, id, navigate]);

  const reconcilePayment = useCallback(() => request('/api/payment/reconcile-rental', { booking_id: id }), [id, request]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBooking(null);
    autoStartBlockedRef.current = false;
    receiptRef.current = null;
    try {
      const receipt = JSON.parse(sessionStorage.getItem(receiptKey) || 'null');
      if (receipt && typeof receipt === 'object') receiptRef.current = receipt;
    } catch { /* No saved callback is available; the provider status check is still required. */ }
    setConfirmationPending(Boolean(receiptRef.current));

    const fetchBookingDetails = async () => {
      try {
        const snapshot = await request(`/api/rentals/${id}/status`);
        if (cancelled) return;
        if (!snapshot.rental) throw new Error('Could not load this booking.');
        setBooking(snapshot.rental);
        if (!canPayRental(snapshot) || snapshot.rental.borrower_id !== user?.id) {
          showDetails();
          return;
        }

        // Recover a captured payment even if the browser lost its success callback.
        const result = await reconcilePayment();
        if (cancelled) return;
        if (result.paid) {
          showDetails(true);
          return;
        }
        if (result.pending || result.awaiting_capture) {
          autoStartBlockedRef.current = true;
          setConfirmationPending(true);
          setError('Your payment is still processing. Do not pay again. Check payment confirmation shortly.');
        }
      } catch (err) {
        if (cancelled) return;
        autoStartBlockedRef.current = true;
        setConfirmationPending(true);
        setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBookingDetails();
    return () => { cancelled = true; };
  }, [id, receiptKey, reconcilePayment, request, showDetails, user?.id]);

  const handlePayment = useCallback(async () => {
    if (!booking || payingRef.current) return;
    payingRef.current = true;
    setPaying(true);
    setError('');
    const releaseCheckout = () => {
      payingRef.current = false;
      setPaying(false);
    };
    const verifyReceipt = async () => {
      await request('/api/payment/verify-rental', rentalVerificationPayload(id, receiptRef.current));
      showDetails(true);
    };

    try {
      // A reload, retry or second tab must never create another charge before checking the first.
      const result = await reconcilePayment();
      if (result.paid) {
        showDetails(true);
        return;
      }
      if (result.pending || result.awaiting_capture) {
        setConfirmationPending(true);
        throw new Error('Your payment is still processing. Do not pay again. Check payment confirmation shortly.');
      }
      if (receiptRef.current) {
        await verifyReceipt();
        return;
      }

      const snapshot = await request(`/api/rentals/${id}/status`);
      if (!canPayRental(snapshot) || snapshot.rental.borrower_id !== user?.id) {
        showDetails();
        return;
      }
      setBooking(snapshot.rental);
      setConfirmationPending(false);
      const orderData = await request('/api/payment/create-rental-order', { booking_id: id });
      if (orderData.already_paid) {
        showDetails(true);
        return;
      }
      validateRentalOrder(orderData);
      setTestMode(orderData.razorpay_key.startsWith('rzp_test_'));

      await openRazorpayCheckout({
        key: orderData.razorpay_key,
        order_id: orderData.order_id,
        amount: Number(orderData.amount),
        currency: orderData.currency || 'INR',
        name: 'CampusMesh',
        description: `Rental: ${snapshot.rental.listing_title}`,
        prefill: { name: user?.name, email: user?.email },
        handler: async (response) => {
          // Retain only the signed gateway receipt, scoped to this account and booking.
          // Retrying confirmation uses this receipt and never launches another payment.
          receiptRef.current = {
            expected_order_id: orderData.order_id,
            gateway_order_id: response.gateway_order_id,
            gateway_payment_id: response.gateway_payment_id,
            gateway_signature: response.gateway_signature,
          };
          try { sessionStorage.setItem(receiptKey, JSON.stringify(receiptRef.current)); } catch { /* Keep the in-memory receipt. */ }
          setConfirmationPending(true);
          try {
            await verifyReceipt();
          } catch {
            try {
              const checked = await reconcilePayment();
              if (checked.paid) {
                showDetails(true);
                return;
              }
            } catch { /* Preserve the receipt for a later confirmation attempt. */ }
            setError('Your payment confirmation is pending. Do not pay again. Retry payment confirmation or check your rental details.');
            releaseCheckout();
          }
        },
        modalDismissHandler: (gatewayError) => {
          if (gatewayError) {
            setError(gatewayError.reason === 'international_transaction_not_allowed'
              ? 'Razorpay rejected an international card. In Test Mode, choose Netbanking and Success, or use the domestic test card shown below.'
              : 'The payment did not complete. You can retry inside the payment window, or close it to check this booking.');
            return; // Razorpay keeps its window open on payment.failed; keep the in-flight guard.
          }
          if (receiptRef.current) return; // Confirmation is already running after a successful callback.
          releaseCheckout();
          setError('Checkout closed. Your booking is saved; retrying will check this same payment first.');
        },
      });
    } catch (err) {
      setError(err.message);
      // The next click always checks the provider before allowing another checkout.
      setConfirmationPending(true);
      releaseCheckout();
    }
  }, [booking, id, receiptKey, reconcilePayment, request, showDetails, user?.id, user?.name, user?.email]);

  useEffect(() => {
    if (loading || !booking || !startCheckoutRef.current || autoStartedRef.current) return;
    autoStartedRef.current = true;
    // Remove auto-start from browser history so a refresh never reopens the gateway.
    navigate(location.pathname, { replace: true, state: null });
    if (!autoStartBlockedRef.current) handlePayment();
  }, [booking, handlePayment, loading, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-mesh-700">
        <div className="size-12 animate-spin rounded-full border-4 border-mesh-100 border-t-mesh-600" />
        <p className="mt-5">Loading payment checkout...</p>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-red-600">
        <span className="text-3xl">⚠️</span>
        <p>{error}</p>
        <button onClick={() => navigate(-1)} className="mt-4 inline-flex h-11 items-center justify-center rounded-xl border border-ink/10 bg-white px-5 font-semibold text-ink hover:bg-ink/5">Go Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="[max-width:800px] [margin:0_auto]">
        <h1 className="[font-size:2.25rem] font-extrabold [margin-bottom:24px] [color:var(--text-dark)] [letter-spacing:-0.025em] [background:linear-gradient(135deg,_var(--text-dark)_40%,_var(--primary-color)_100%)] [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] [background-clip:text]">
          Confirm & Pay Rental Charges
        </h1>

        {/* Listing Info Card */}
        <div className="hover:[box-shadow:var(--shadow-md)] ">
          {booking.listing_image && (
            <img src={booking.listing_image} alt={booking.listing_title} className="[width:90px] [height:90px] [border-radius:var(--radius-md)] object-cover [background-color:#f3f4f6] [border:1px_solid_var(--border-color)]" />
          )}
          <div className="flex flex-col [gap:6px]">
            <span className="[background-color:rgba(16,_185,_129,_0.08)] [color:var(--primary-color)] [font-size:0.75rem] font-bold [padding:3px_10px] [border-radius:99px] [align-self:flex-start] uppercase [letter-spacing:0.05em] [border:1px_solid_rgba(16,_185,_129,_0.15)]">{booking.listing_category}</span>
            <h3 className="[font-size:1.25rem] font-bold [color:var(--text-dark)] m-0 [line-height:1.3]">{booking.listing_title}</h3>
            <p className="[font-size:0.85rem] [color:var(--text-muted)]">📍 Pickup Location: {booking.listing_location}</p>
          </div>
        </div>

        {/* Reusable Payment Breakdown Summary */}
        <PaymentSummary
          dailyPrice={parseFloat(booking.rental_fee) / booking.rental_days}
          days={booking.rental_days}
          rentalFee={booking.rental_fee}
          deliveryFee={booking.delivery_fee}
          platformFee={booking.platform_fee}
          totalAmount={booking.booking_amount}
          depositAmount={booking.deposit_amount}
        />

        {testMode && <TestPaymentNotice />}
        {error && <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-600">⚠️ {error}</div>}

        <p className="mt-4 text-sm leading-6 text-ink/65">Your booking and rental dates are saved. If money was debited, check payment confirmation instead of paying again.</p>

        {/* Pay Button */}
        <div className="mt-6">
          <button
            onClick={handlePayment}
            disabled={paying}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-mesh-600 px-5 font-bold text-white hover:bg-mesh-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paying ? 'Checking payment…' : confirmationPending ? 'Retry payment confirmation' : `Proceed to Pay ${formatCurrency(booking.booking_amount)}`}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/rent-details/${id}`)}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-ink/10 bg-white px-5 font-semibold text-ink hover:bg-ink/5"
          >
            View rental details
          </button>
        </div>
      </div>
    </div>
  );
}

const formatCurrency = (n) => `₹${parseFloat(n || 0).toFixed(2)}`;
