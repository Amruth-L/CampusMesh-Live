import { campusToday } from '../../../shared/rental-dates.js';
import { useRentalQuote } from '../hooks/useRentalQuote';
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Calendar, AlertTriangle, Lock, CheckCircle2, ClipboardList, MapPin, Info } from 'lucide-react';
import { API_BASE_URL } from '../lib/api';


const formatCurrency = (n) => {
  const parsed = Number(n);
  if (isNaN(parsed)) return '₹0.00';
  return `₹${parsed.toFixed(2)}`;
};

const today = campusToday;
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

export default function RentSummary() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const paramStart = queryParams.get('start_date');
  const paramEnd = queryParams.get('end_date');
  const rentalConfiguration = location.state || {};

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [startDate, setStartDate] = useState(paramStart || today());
  const [endDate, setEndDate] = useState(paramEnd || addDays(today(), 1));
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const quoteState = useRentalQuote(id,startDate,endDate,Boolean(rentalConfiguration.delivery_requested));
  const breakdown = quoteState.quote ? {...quoteState.quote,bookingAmount:quoteState.quote.totalAmount,depositAmount:quoteState.quote.securityDeposit} : null;


  useEffect(() => {
    const controller = new AbortController();
    const fetchListing = async () => {
      setLoading(true);setListing(null);setError('');
      try {
                  const token = localStorage.getItem('token');
          const res = await fetch(`${API_BASE_URL}/listings/${id}`, {
            headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
          });
          if (!res.ok) throw new Error('Failed to load listing');
          const data = await res.json();
          setListing(data);
      } catch (e) {
        if (!controller.signal.aborted) setError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchListing();
    return () => controller.abort();
  }, [id]);

  const handleBook = async (e) => {
    e.preventDefault();
    if (!breakdown || submittingRef.current || !Number.isFinite(Number(breakdown.bookingAmount)) || breakdown.bookingAmount <= 0) return;

    // The ref closes the double-click window before React updates the button.
    submittingRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/rentals/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          listing_id: id,
          start_date: startDate,
          end_date: endDate,
          delivery_requested: Boolean(rentalConfiguration.delivery_requested),
          drop_location_id: rentalConfiguration.drop_location_id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create rental request.');
      if (!data.rental?.id) throw new Error('Could not load your booking. Check My rentals before trying again.');

      // Keep every checkout retry on this booking, including dismissals and reloads.
      navigate(data.rental.payment_method==='DIRECT_UPI'?`/rent-details/${data.rental.id}`:`/rental-payment/${data.rental.id}`, {
        replace: true,
        state: { startCheckout: true },
      });
    } catch (err) {
      setError(err.message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center [min-height:80vh] [gap:20px] [color:var(--primary-color,_#10b981)] [font-size:1.1rem]">
        <div className="[width:48px] [height:48px] [border:4px_solid_rgba(16,_185,_129,_0.2)] [border-top-color:var(--primary-color,_#10b981)] [border-radius:50%] animate-spin" />
        <p>Loading item details...</p>
      </div>
    );
  }

  if (error && !listing) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 py-12 text-center text-lg text-red-600">
        <AlertTriangle size={32} className="mx-auto mb-3 block text-red-600" />
        <p>{error}</p>
        <button onClick={() => navigate(-1)} className="[background-color:var(--surface-color,_#ffffff)] [border:1px_solid_var(--border-color,_#e5e7eb)] [color:var(--text-dark,_#1f2937)] [padding:8px_20px] [border-radius:99px] cursor-pointer [font-size:0.9rem] font-medium [transition:background-color_0.2s_ease,border-color_0.2s_ease,transform_0.2s_ease] [margin-bottom:16px] [box-shadow:var(--shadow-sm)] inline-flex items-center [gap:6px] hover:[background-color:#f3f4f6] hover:[border-color:#d1d5db] hover:[transform:translateX(-2px)]">Go Back</button>
      </div>
    );
  }

  const isBtnDisabled = !breakdown || submitting || breakdown.bookingAmount <= 0 || Boolean(listing.demo_slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-7 sm:py-10">
      <div className="space-y-6">
        {/* Header */}
        <div className="[margin-bottom:32px]">
          <button className="[background-color:var(--surface-color,_#ffffff)] [border:1px_solid_var(--border-color,_#e5e7eb)] [color:var(--text-dark,_#1f2937)] [padding:8px_20px] [border-radius:99px] cursor-pointer [font-size:0.9rem] font-medium [transition:background-color_0.2s_ease,border-color_0.2s_ease,transform_0.2s_ease] [margin-bottom:16px] [box-shadow:var(--shadow-sm)] inline-flex items-center [gap:6px] hover:[background-color:#f3f4f6] hover:[border-color:#d1d5db] hover:[transform:translateX(-2px)]" onClick={() => navigate(-1)}>← Back</button>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Booking Summary</h1>
          <p className="[color:var(--text-muted,_#6b7280)] [font-size:0.95rem] m-0">Review your rental request and payment stages</p>
        </div>

        {listing.demo_slug && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 sm:text-sm">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p><strong>Demo listing.</strong> This sample has no real lender, so it can’t complete payment, delivery, or calls. Choose a student-listed item for the live flow.</p>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_420px]">
          {/* Left Column — Item Details & Date Picker */}
          <div className="space-y-4">
            {/* Item Card */}
            <div className="hover:[box-shadow:var(--shadow-md)]">
              {listing.image_url && (
                <img src={listing.image_url} alt={listing.title} className="[width:140px] [height:110px] [border-radius:12px] object-cover shrink-0 [border:1px_solid_var(--border-color,_#e5e7eb)]" />
              )}
              <div className="flex flex-col [gap:8px] justify-center">
                <span className="[background-color:rgba(16,_185,_129,_0.08)] [color:var(--primary-color,_#10b981)] [font-size:0.75rem] font-bold [padding:3px_10px] [border-radius:99px] [align-self:flex-start] uppercase [letter-spacing:0.05em] [border:1px_solid_rgba(16,_185,_129,_0.15)]">{listing.category}</span>
                <h2 className="[font-size:1.25rem] font-bold [color:var(--text-dark,_#1f2937)] m-0 [line-height:1.3]">{listing.title}</h2>
                <div className="flex [gap:12px] items-center">
                  <span className="shrink-0 whitespace-nowrap [font-size:0.8rem] [background-color:rgba(16,_185,_129,_0.08)] [color:var(--primary-color,_#10b981)] [padding:3px_10px] [border-radius:99px] font-semibold [border:1px_solid_rgba(16,_185,_129,_0.15)]">{listing.condition}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-ink/50">
                    <MapPin size={12} strokeWidth={2} /> {listing.location}
                  </span>
                </div>
                <div className="[font-size:0.9rem] [color:var(--text-muted,_#6b7280)] [margin-top:4px]">
                  Owner: <strong>{listing.owner_name}</strong>
                </div>
              </div>
            </div>

            {/* Date Selection */}
            <div className="space-y-4">
              <h3 className="flex items-center gap-1.5">
                <Calendar size={16} strokeWidth={2} /> Select Rental Period
              </h3>
              <form id="rental-form" onSubmit={handleBook} className="flex flex-col [gap:20px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col [gap:6px]">
                    <label htmlFor="start-date">Start Date</label>
                    <input
                      id="start-date" className="min-h-11 w-full min-w-0 rounded-lg border border-ink/20 bg-white px-3" required
                      type="date"
                      min={today()}
                      value={startDate}
                      onChange={(e) => {
                        const newStart = e.target.value;
                        setStartDate(newStart);
                        const sD = new Date(newStart);
                        const eD = new Date(endDate);
                        if (eD < sD) {
                          setEndDate(newStart);
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-col [gap:6px]">
                    <label htmlFor="end-date">End Date</label>
                    <input
                      id="end-date" className="min-h-11 w-full min-w-0 rounded-lg border border-ink/20 bg-white px-3" required
                      type="date"
                      min={startDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                {breakdown && (
                  <div className="inline-flex items-center gap-1 rounded-xl border border-dashed border-mesh-300 bg-mesh-50 px-4 py-3 text-center text-sm font-semibold text-mesh-700">
                    <Calendar size={12} strokeWidth={2} /> {breakdown.days} Day{breakdown.days > 1 ? 's' : ''} Rental
                  </div>
                )}
                {error && <div role="alert" className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"><AlertTriangle size={12} /> {error}</div>}
                
                <button
                  type="submit"
                  className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-mesh-600 px-5 text-sm font-extrabold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg disabled:pointer-events-none disabled:bg-ink/15 disabled:text-ink/35 disabled:shadow-none"
                  disabled={isBtnDisabled}
                >
                  {!breakdown ? 'Quote unavailable' : submitting ? 'Processing…' : breakdown?.paymentMethod==='DIRECT_UPI' ? 'Send request — pay after acceptance' : `Pay rental fee · ${breakdown ? formatCurrency(breakdown.bookingAmount) : '₹0.00'}`}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column — Breakdown & Security Deposit */}
          <div className="space-y-4">
            {/* Booking Summary Card */}
            <div className="[background-color:var(--surface-color,_#ffffff)] [border:1px_solid_var(--border-color,_#e5e7eb)] [border-radius:16px] [padding:28px] [box-shadow:var(--shadow-sm)] [transition:box-shadow_0.2s_ease] hover:[box-shadow:var(--shadow-md)]">
              <h3 className="mb-5 flex items-center gap-1.5 border-b border-ink/10 pb-3 text-lg font-bold text-ink">
                <ClipboardList size={16} strokeWidth={2} /> Booking Summary
              </h3>

              {breakdown ? (
                <div className="flex flex-col [gap:14px]">
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)]">
                    <span>Daily Rent</span>
                    <span>{formatCurrency(listing.rent_price || listing.rentPrice)}</span>
                  </div>
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)]">
                    <span>Rental Days</span>
                    <span>{breakdown.days} day{breakdown.days > 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)] [color:var(--text-dark,_#1f2937)] font-semibold">
                    <span>Rental Fee</span>
                    <span>{formatCurrency(breakdown.rentalFee)}</span>
                  </div>
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)]">
                    <span>{breakdown.paymentMethod==='DIRECT_UPI'?'Delivery — paid after handover':'Delivery Fee'}</span>
                    <span>{(listing.delivery_available || listing.deliveryAvailable) ? formatCurrency(breakdown.deliveryFee) : 'Free (Pickup)'}</span>
                  </div>
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)]">
                    <span>Platform Fee</span>
                    <span>{formatCurrency(breakdown.platformFee)}</span>
                  </div>
                  <div className="border-0 [border-top:1px_solid_var(--border-color,_#e5e7eb)] [margin:6px_0]" />
                  <div className="flex justify-between items-center [font-size:0.95rem] [color:var(--text-muted,_#6b7280)] [color:var(--text-dark,_#1f2937)] [font-size:1.15rem] font-extrabold [padding-top:8px]">
                    <span>{breakdown.paymentMethod==='DIRECT_UPI'?'Rental fee after acceptance':'Booking Total'}</span>
                    <span>{formatCurrency(breakdown.bookingAmount)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center [color:var(--text-muted,_#6b7280)] [padding:24px_0] [font-size:0.95rem]">
                  <p role="status">{quoteState.loading ? "Loading quote…" : quoteState.error}<button type="button" className="ml-2 underline" onClick={quoteState.retry}>Retry quote</button></p>
                </div>
              )}
            </div>

            {/* Security Deposit Card */}
            {breakdown && (
              <div className="space-y-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink/50">
                  <Lock size={15} strokeWidth={2} /> Security Deposit
                </h3>
                <div className="[font-size:1.75rem] font-extrabold [color:var(--text-dark,_#1f2937)] [margin-bottom:12px]">{formatCurrency(breakdown.depositAmount)}</div>
                <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium leading-6 text-amber-700">Pay the lender after acceptance.</p>
                <p className="m-0 flex items-center gap-1.5 rounded-lg border border-mesh-100 bg-mesh-50 px-3 py-2 text-sm font-medium leading-6 text-mesh-700">
                  <CheckCircle2 size={14} className="shrink-0 text-green-500" />
                  <span>Refund follows the lender’s return inspection.</span>
                </p>
              </div>
            )}

            <div className="[background-color:#f9fafb] [border:1px_solid_var(--border-color,_#e5e7eb)] [border-radius:12px] [padding:18px]">
              <h4 className="mb-2 flex items-center gap-1.5">
                <ClipboardList size={14} strokeWidth={2} /> Rental Policy
              </h4>
              <ul>
                <li>Owner must accept your booking request</li>
                {breakdown?.paymentMethod === 'DIRECT_UPI' ? <li>Pay rent and deposit after acceptance; the lender confirms receipt.</li> : <li>Check your accepted rental for its deposit deadline.</li>}
                <li>Use the handover QR or supported OTP with the recipient.</li>
                <li>{breakdown?.paymentMethod === 'DIRECT_UPI' ? 'Lender inspects the return and sends your refund; confirm receipt after checking your bank.' : 'Deposit refund follows return inspection.'}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
