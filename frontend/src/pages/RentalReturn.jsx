import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';

const API_BASE = API_BASE_URL;
const formatCurrency = (n) => `₹${parseFloat(n || 0).toFixed(2)}`;

export default function RentalReturn() {
  const { rentalId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rental, setRental] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [isDamaged, setIsDamaged] = useState(false);
  const [damageDesc, setDamageDesc] = useState('');
  const [damageAmount, setDamageAmount] = useState('');

  useEffect(() => {
    const fetchRental = async () => {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(`${API_BASE}/api/rentals/${rentalId}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRental(data.rental);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchRental();
  }, [rentalId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isDamaged && !damageDesc.trim()) {
      setError('Please describe the damage.');
      return;
    }
    setSubmitting(true);
    setError('');
    const token = localStorage.getItem('token');
    try {
      const payload = {
        damage_description: isDamaged ? damageDesc : null,
        damage_amount: isDamaged ? parseFloat(damageAmount) || 0 : 0,
      };
      const res = await fetch(`${API_BASE}/api/rentals/${rentalId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSubmitted(data.message || "Return confirmed. Check the rental details for refund status.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center [min-height:80vh] [gap:20px] [color:#a78bfa]">
        <div className="[width:48px] [height:48px] [border:4px_solid_rgba(139,_92,_246,_0.2)] [border-top-color:#8b5cf6] [border-radius:50%] animate-spin" />
        <p>Loading rental info…</p>
      </div>
    );
  }

  if (error && !rental) {
    return <div className="flex flex-col items-center justify-center [min-height:70vh] [gap:16px] [color:#f87171] [font-size:1.1rem]"><span>⚠️</span><p>{error}</p></div>;
  }

  const isOwner = rental?.owner_id === user?.id;
  const deposit = parseFloat(rental?.deposit_amount || 0);
  const deduction = isDamaged ? (parseFloat(damageAmount) || 0) : 0;
  const estimatedRefund = Math.max(0, deposit - deduction);

  if (submitted) {
    return (
      <div className="space-y-4">
        <div className="[background:rgba(255,_255,_255,_0.05)] [border:1px_solid_rgba(16,_185,_129,_0.3)] [border-radius:24px] [padding:48px_40px] [max-width:480px] w-full text-center [backdrop-filter:blur(20px)] [box-shadow:0_0_60px_rgba(16,_185,_129,_0.12)]">
          <div className="[font-size:4rem] [margin-bottom:20px] block">🎉</div>
          <h2>Return Confirmed!</h2>
          <p className="[color:#9ca3af] [font-size:0.9rem] [line-height:1.6] [margin:0_0_28px]">
            {submitted}
          </p>
          <div className="flex flex-col [gap:4px] [background:rgba(16,_185,_129,_0.1)] [border:1px_solid_rgba(16,_185,_129,_0.3)] [border-radius:16px] [padding:20px] [margin-bottom:28px]">
            <span className="[font-size:0.75rem] [color:#34d399] uppercase [letter-spacing:1px]">Refund Amount</span>
            <span className="[font-size:2.4rem] font-extrabold [color:#f3f4f6]">{formatCurrency(estimatedRefund)}</span>
          </div>
          <button className="[background:linear-gradient(135deg,_#7c3aed,_#4f46e5)] [color:white] border-0 [padding:14px_32px] [border-radius:14px] [font-size:1rem] font-bold cursor-pointer [transition:all_0.25s] [box-shadow:0_4px_20px_rgba(124,_58,_237,_0.4)] hover:[transform:translateY(-2px)] hover:[box-shadow:0_8px_28px_rgba(124,_58,_237,_0.5)]" onClick={() => navigate('/owner-dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="[margin-bottom:32px]">
          <button className="[background:rgba(139,_92,_246,_0.15)] [border:1px_solid_rgba(139,_92,_246,_0.3)] [color:#a78bfa] [padding:8px_20px] [border-radius:99px] cursor-pointer [font-size:0.9rem] [transition:all_0.2s] [margin-bottom:16px] hover:[background:rgba(139,_92,_246,_0.28)] hover:[transform:translateX(-2px)]" onClick={() => navigate(-1)}>← Back</button>
          <h1 className="[font-size:2rem] font-extrabold [background:linear-gradient(135deg,_#fff_0%,_#a78bfa_100%)] [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] [background-clip:text] [margin:0_0_6px]">Return & Inspection</h1>
          <p className="[color:#9ca3af] [font-size:0.95rem] m-0">Inspect and refund.</p>
        </div>

        <div className="grid [grid-template-columns:1fr_340px] [gap:24px] [align-items:start] [grid-template-columns:1fr]">
          {/* Left — Inspection Form */}
          <div className="space-y-4">
            {/* Rental Info */}
            <div className="space-y-4">
              {rental.listing_image && (
                <img src={rental.listing_image} alt={rental.listing_title} className="[width:80px] [height:70px] [border-radius:12px] object-cover shrink-0" />
              )}
              <div>
                <p className="[font-size:0.73rem] [color:#a78bfa] uppercase [letter-spacing:0.5px] [margin:0_0_4px]">{rental.listing_category}</p>
                <h2 className="[font-size:1rem] font-bold [color:#f3f4f6] [margin:0_0_4px]">{rental.listing_title}</h2>
                <p className="[font-size:0.82rem] [color:#9ca3af] m-0">Rented by: <strong>{rental.borrower_name}</strong></p>
              </div>
            </div>

            {/* Condition Check */}
            {isOwner ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <h3 className="[font-size:1rem] font-bold [color:#e2d9f3] m-0">📋 Condition Inspection</h3>
                <p className="[font-size:0.85rem] [color:#9ca3af] m-0 [line-height:1.5]">Confirm the returned condition.</p>

                <div className="flex [gap:12px]">
                  <button
                    type="button"
                    className={`flex-1 flex flex-col items-center [gap:4px] [padding:18px_12px] [border-radius:14px] [background:rgba(255,_255,_255,_0.05)] [border:2px_solid_rgba(139,_92,_246,_0.2)] [color:#9ca3af] cursor-pointer [transition:all_0.2s] ${!isDamaged ? '[background:rgba(16,_185,_129,_0.1)] [border-color:rgba(16,_185,_129,_0.5)] [color:#34d399] [box-shadow:0_0_16px_rgba(16,_185,_129,_0.15)]' : ''}`}
                    onClick={() => setIsDamaged(false)}
                  >
                    <span>✅</span>
                    <span>Good Condition</span>
                    <small>Refund 100% deposit</small>
                  </button>
                  <button
                    type="button"
                    className={`flex-1 flex flex-col items-center [gap:4px] [padding:18px_12px] [border-radius:14px] [background:rgba(255,_255,_255,_0.05)] [border:2px_solid_rgba(139,_92,_246,_0.2)] [color:#9ca3af] cursor-pointer [transition:all_0.2s] ${isDamaged ? '[background:rgba(239,_68,_68,_0.1)] [border-color:rgba(239,_68,_68,_0.5)] [color:#fca5a5] [box-shadow:0_0_16px_rgba(239,_68,_68,_0.12)]' : ''}`}
                    onClick={() => setIsDamaged(true)}
                  >
                    <span>⚠️</span>
                    <span>Damaged / Issues</span>
                    <small>Partial refund after deduction</small>
                  </button>
                </div>

                {isDamaged && (
                  <div className="flex flex-col [gap:16px]">
                    <div className="flex flex-col [gap:6px]">
                      <label htmlFor="damage-desc">Damage Description *</label>
                      <textarea
                        id="damage-desc"
                        rows={4}
                        placeholder="Describe the damage in detail (scratches, broken parts, stains, etc.)"
                        value={damageDesc}
                        onChange={(e) => setDamageDesc(e.target.value)}
                        required={isDamaged}
                      />
                    </div>
                    <div className="flex flex-col [gap:6px]">
                      <label htmlFor="damage-amt">Estimated Damage Cost (₹)</label>
                      <input
                        id="damage-amt"
                        type="number"
                        min="0"
                        max={deposit}
                        step="1"
                        placeholder="e.g. 150"
                        value={damageAmount}
                        onChange={(e) => setDamageAmount(e.target.value)}
                      />
                      <small className="[font-size:0.75rem] [color:#6b7280]">Maximum deductible: {formatCurrency(deposit)}</small>
                    </div>
                  </div>
                )}

                {error && <div className="[background:rgba(239,_68,_68,_0.1)] [border:1px_solid_rgba(239,_68,_68,_0.3)] [color:#fca5a5] [padding:10px_14px] [border-radius:10px] [font-size:0.88rem]">{error}</div>}

                <button type="submit" className="[background:linear-gradient(135deg,_#7c3aed,_#4f46e5)] [color:white] border-0 [padding:16px] [border-radius:14px] [font-size:1rem] font-bold cursor-pointer [transition:all_0.25s] [box-shadow:0_4px_20px_rgba(124,_58,_237,_0.4)] disabled:[opacity:0.5] disabled:[cursor:not-allowed]" disabled={submitting}>
                  {submitting ? 'Processing…' : 'Confirm Return & Process Refund'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="[font-size:3rem] [margin-bottom:16px] block">📦</div>
                <h3>Return in Progress</h3>
                <p>Inspection in progress.</p>
              </div>
            )}
          </div>

          {/* Right — Refund Preview */}
          <div className="space-y-4">
            <div className="[background:rgba(255,_255,_255,_0.04)] [border:1px_solid_rgba(139,_92,_246,_0.2)] [border-radius:20px] [padding:24px] [backdrop-filter:blur(8px)]">
              <h3 className="[font-size:0.95rem] font-bold [color:#e2d9f3] [margin:0_0_18px]">💰 Refund Preview</h3>
              <div className="flex flex-col [gap:12px]">
                <div className="flex justify-between [font-size:0.9rem] [color:#9ca3af]"><span>Security Deposit</span><span>{formatCurrency(deposit)}</span></div>
                <div className="flex justify-between [font-size:0.9rem] [color:#9ca3af]"><span>Damage Deduction</span><span className="[color:#fca5a5] font-semibold">
                  {isDamaged ? `- ${formatCurrency(deduction)}` : '—'}
                </span></div>
                <div className="border-0 [border-top:1px_solid_rgba(139,_92,_246,_0.15)]" />
                <div className="flex justify-between [font-size:0.9rem] [color:#9ca3af] [font-size:1.05rem] font-bold [color:#f3f4f6]">
                  <span>Estimated Refund</span>
                  <span className="[color:#34d399] [font-size:1.2rem] font-extrabold">{formatCurrency(estimatedRefund)}</span>
                </div>
              </div>

              <div className="[margin-top:20px] [padding-top:16px] [border-top:1px_solid_rgba(139,_92,_246,_0.1)] flex flex-col [gap:6px]">
                <p>✅ Full refund if no damage is reported.</p>
                <p>⚠️ Partial refund if the owner records a damage deduction.</p>
                <p>🔒 Refunds are processed via the original payment method.</p>
              </div>
            </div>

            {/* Rental Summary */}
            <div className="[background:rgba(255,_255,_255,_0.03)] [border:1px_solid_rgba(139,_92,_246,_0.12)] [border-radius:16px] [padding:20px] flex flex-col [gap:10px]">
              <h4>Rental Summary</h4>
              <div className="flex justify-between [font-size:0.85rem] [color:#9ca3af]"><span>Rental Fee</span><span>{formatCurrency(rental.rental_fee)}</span></div>
              <div className="flex justify-between [font-size:0.85rem] [color:#9ca3af]"><span>Duration</span><span>{rental.rental_days} day{rental.rental_days > 1 ? 's' : ''}</span></div>
              <div className="flex justify-between [font-size:0.85rem] [color:#9ca3af]"><span>Booking Amount</span><span>{formatCurrency(rental.booking_amount)}</span></div>
              <div className="flex justify-between [font-size:0.85rem] [color:#9ca3af]"><span>Status</span><span className="[font-size:0.72rem] [background:rgba(139,_92,_246,_0.15)] [border:1px_solid_rgba(139,_92,_246,_0.3)] [color:#a78bfa] [padding:2px_10px] [border-radius:99px] capitalize [font-weight:600]">{rental.status.replace(/_/g, ' ')}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
