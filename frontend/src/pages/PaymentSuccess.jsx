import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

export default function PaymentSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Destructure custom success state
  const {
    message = 'Your payment has been successfully processed!',
    actionText = 'Go to Dashboard',
    nextPath = '/',
    rentals = []
  } = location.state || {};

  return (
    <div className="space-y-4">
      <div className={`${rentals.length > 0 ? 'max-w-[600px]' : 'max-w-[500px]'} w-full rounded-3xl border border-ink/10 bg-white px-8 py-12 text-center shadow-lg`}>
        {/* Animated Checkmark Circle */}
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-mesh-50 text-mesh-700">
          <span className="text-4xl">✓</span>
        </div>

        <h2 className="[font-size:1.75rem] font-extrabold [color:var(--text-dark)] [margin-bottom:16px]">
          Payment Successful!
        </h2>

        <p className="[font-size:1rem] [color:var(--text-muted)] [line-height:1.6] [margin-bottom:32px]">
          {message}
        </p>

        {/* QR Codes Section */}
        {rentals.length > 0 && (
          <div className="space-y-4">
            <h3 className="[font-size:1.15rem] font-bold [color:var(--text-dark)] [margin:0_0_6px] [letter-spacing:-0.01em]">Your Booking QR Codes</h3>
            <p className="[font-size:0.85rem] [color:var(--text-muted)] [margin:0_0_20px] [line-height:1.4]">
              Show these QR codes to the item owner during handover for verification
            </p>
            
            <div className="flex flex-wrap [gap:16px] justify-center">
              {rentals.map((rental, index) => (
                <div key={rental.rental_id || index} className="[background:var(--surface-color)] [border:1px_solid_var(--border-color)] [border-radius:var(--radius-lg)] [padding:20px_16px_16px] flex flex-col items-center [gap:10px] [min-width:200px] [max-width:240px] flex-1 [box-shadow:var(--shadow-sm)] [transition:transform_0.2s_ease,_box-shadow_0.2s_ease] hover:[transform:translateY(-3px)] hover:[box-shadow:var(--shadow-md)]">
                  <div className="[background:#ffffff] [border-radius:var(--radius-md)] [padding:8px] [border:2px_solid_rgba(16,_185,_129,_0.15)] flex items-center justify-center">
                    <QRCodeSVG
                      value={JSON.stringify({
                        rental_id: rental.rental_id,
                        hash: rental.qr_code_hash,
                        platform: 'CampusMesh'
                      })}
                      size={160}
                      level="H"
                      includeMargin={true}
                      bgColor="#ffffff"
                      fgColor="#1f2937"
                    />
                  </div>
                  <p className="[font-size:0.9rem] font-semibold [color:var(--text-dark)] m-0 text-center [line-height:1.3] [max-width:100%] overflow-hidden [text-overflow:ellipsis] whitespace-nowrap">{rental.listing_title || 'Rental Item'}</p>
                  <span className="[font-size:0.72rem] font-medium [color:var(--text-muted)] [background:rgba(16,_185,_129,_0.06)] [padding:3px_10px] [border-radius:99px] [letter-spacing:0.02em] [font-family:'Courier_New',_monospace]">ID: {rental.rental_id?.slice(0, 8)}...</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => navigate(nextPath)}
          className="disabled:[opacity:0.6] disabled:[cursor:not-allowed] disabled:[transform:none]"
        >
          {actionText}
        </button>
      </div>
    </div>
  );
}
