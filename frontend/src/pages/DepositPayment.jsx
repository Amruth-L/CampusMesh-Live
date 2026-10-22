import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { openRazorpayCheckout } from '../utils/RazorpayService';
import PaymentSummary from '../components/PaymentSummary';

const API_BASE = API_BASE_URL;

export default function DepositPayment() {
  const { id } = useParams(); // Booking/Rental ID
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const fetchBookingDetails = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${API_BASE}/api/rentals/${id}/status`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch booking details.');

        if(data.rental?.payment_method==='DIRECT_UPI'){navigate(`/rent-details/${id}`,{replace:true});return;}
        setBooking(data.rental);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBookingDetails();
  }, [id]);

  const handlePayment = async () => {
    if (!booking) return;
    setPaying(true);
    setError('');
    const token = localStorage.getItem('token');

    try {
      // Create Razorpay Order on Backend for Security Deposit only
      const orderRes = await fetch(`${API_BASE}/api/payment/create-deposit-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ booking_id: id })
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error || 'Failed to create deposit order.');

      if (orderData.already_paid) {
        navigate(`/rent-details/${id}`);
        return;
      }
      const razorpayKey = orderData.razorpay_key;
      if (!razorpayKey || !orderData.order_id || orderData.simulated) throw new Error('Online payments are not configured.');

      const razorpayOptions = {
        key: razorpayKey,
        amount: Number(orderData.amount || booking.deposit_amount),
        description: `Security Deposit for: ${booking.listing_title}`,
        prefill: {
          name: user?.name,
          email: user?.email
        },
        handler: async (resp) => {
          try {
            const verifyRes = await fetch(`${API_BASE}/api/payment/verify-deposit`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                booking_id: id,
                gateway_order_id: resp.gateway_order_id || orderData.order_id,
                gateway_payment_id: resp.gateway_payment_id,
                gateway_signature: resp.gateway_signature
              })
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData.error || 'Signature verification failed.');


            navigate(`/rent-details/${id}`, { state: { justBooked: true } });
          } catch (vErr) {
            navigate('/payment-failed', {
              state: { error: vErr.message, retryPath: `/deposit-payment/${id}` }
            });
          }
        },
        modalDismissHandler: () => {
          setPaying(false);
        }
      };

      if (!orderData.simulated) {
        razorpayOptions.order_id = orderData.order_id;
      }

      await openRazorpayCheckout(razorpayOptions);
    } catch (err) {
      setError(err.message);
      setPaying(false);
      navigate('/payment-failed', {
        state: { error: err.message, retryPath: `/deposit-payment/${id}` }
      });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-mesh-700">
        <div className="size-12 animate-spin rounded-full border-4 border-mesh-100 border-t-mesh-600" />
        <p className="mt-5">Loading deposit details...</p>
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
          🔒 Pay Refundable Security Deposit
        </h1>

        <div className="space-y-4">
          <strong>💡 Owner Accepted Your Booking Request!</strong><br />
          To secure the item and enable the pickup QR code, you must submit the refundable security deposit.
        </div>

        {/* Info Card */}
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

        {/* Payment Summary focusing on Security Deposit */}
        <PaymentSummary
          dailyPrice={parseFloat(booking.rental_fee) / booking.rental_days}
          days={booking.rental_days}
          rentalFee={booking.rental_fee}
          deliveryFee={booking.delivery_fee}
          platformFee={booking.platform_fee}
          totalAmount={booking.booking_amount}
          depositAmount={booking.deposit_amount}
          showDepositOnly={true}
        />

        {error && <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-600">⚠️ {error}</div>}

        {/* Pay Button */}
        <div className="mt-6">
          <button
            onClick={handlePayment}
            disabled={paying}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-mesh-600 px-5 font-bold text-white hover:bg-mesh-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {paying ? 'Launching Payment Gateway...' : `Pay Security Deposit ${formatCurrency(booking.deposit_amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const formatCurrency = (n) => `₹${parseFloat(n || 0).toFixed(2)}`;
