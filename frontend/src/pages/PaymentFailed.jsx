import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function PaymentFailed() {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    error = 'An error occurred while processing your payment.',
    retryPath = '/'
  } = location.state || {};

  return (
    <div className="space-y-4">
      <div className="[background-color:var(--surface-color)] [border:1px_solid_var(--border-color)] [border-radius:24px] [padding:48px_32px] [max-width:500px] w-full text-center [box-shadow:var(--shadow-lg)]">
        {/* Warning Icon */}
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-red-50 text-red-600">
          <span className="text-4xl">⚠️</span>
        </div>

        <h2 className="[font-size:1.75rem] font-extrabold [color:var(--text-dark)] [margin-bottom:16px]">
          Payment Failed
        </h2>

        <p className="[font-size:1rem] [color:var(--text-muted)] [line-height:1.6] [margin-bottom:32px]">
          {error}
        </p>

        <div className="flex gap-4">
          <button
            onClick={() => navigate(retryPath)}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white hover:bg-mesh-700"
          >
            Try Again
          </button>
          
          <button
            onClick={() => navigate('/')}
            className="flex-1 [background-color:transparent] [color:var(--text-dark)] [border:1px_solid_var(--border-color)] [padding:14px_24px] [border-radius:var(--radius-md)] [font-size:1rem] font-semibold cursor-pointer [transition:all_0.2s_ease] inline-flex items-center justify-center hover:[background-color:rgba(0,_0,_0,_0.02)] hover:[border-color:var(--text-muted)]"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
