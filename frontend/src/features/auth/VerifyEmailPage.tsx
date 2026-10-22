import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Mail, Pencil, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Brand from '../../components/Brand';
import OtpInput from '../../components/OtpInput';
import useOtpCooldown from './useOtpCooldown';
import { getApiError, resendOtp, verifyEmail } from './auth.service';

export default function VerifyEmailPage() {
  const { api } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const initial = location.state as { email?: string; error?: string; codeSent?: boolean } | null;
  const [email, setEmail] = useState(initial?.email?.trim().toLowerCase() || '');
  const [codeSent, setCodeSent] = useState(initial?.codeSent === true);
  const [editing, setEditing] = useState(!initial?.email);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(initial?.error || '');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [verified, setVerified] = useState(false);
  const { remaining, start } = useOtpCooldown(email, 'verify');
  const validEmail = /^[^\s@]+@dbit\.co\.in$/i.test(email.trim());
  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || verified || otp.length !== 6 || !validEmail) return;
    setBusy('verify'); setError(''); setSuccess('');
    try {
      await verifyEmail(api, { email: email.trim().toLowerCase(), otp });
      setVerified(true);
      setSuccess('Welcome to CampusMesh! We’re happy you’re here. Sign in to borrow, lend, or earn by delivering.');
    } catch (caught) { setError(getApiError(caught)); }
    finally { setBusy(null); }
  };
  const handleResend = async () => {
    if (busy || remaining || verified) return;
    if (!validEmail) { setError('Enter your DBIT email (@dbit.co.in).'); return; }
    setBusy('resend'); setError(''); setSuccess('');
    try {
      const result = await resendOtp(api, { email: email.trim().toLowerCase() });
      start(result.retryAfter || 60); setOtp(''); setEditing(false); setCodeSent(true);
      setSuccess('New code sent. Check your inbox and spam folder.');
    } catch (caught) {
      const retry = (caught as { response?: { data?: { retryAfter?: number } } })?.response?.data?.retryAfter;
      if (retry) start(retry);
      setError(getApiError(caught));
    } finally { setBusy(null); }
  };
  return <main className="auth-scene min-h-screen bg-paper">
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-10">
      <Link to="/" aria-label="CampusMesh home"><Brand /></Link>
      <div className="mx-auto max-w-[460px] py-8 sm:py-12">

        <section className="panel p-6 sm:p-8">
          <span className="grid size-14 place-items-center rounded-2xl bg-mesh-50 text-mesh-700">{verified ? <Check size={28} /> : <Mail size={28} />}</span>
          <p className="eyebrow mt-7">{verified ? 'ALL SET' : 'EMAIL VERIFICATION'}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">{verified ? 'Email verified' : 'Verify your email'}</h2>
          {!verified && <>
            <p className="mt-3 text-sm leading-6 text-ink/65">{codeSent ? 'Enter the code sent to' : 'Enter your email code, or request a new one for'}<br /><strong className="break-all text-ink">{email || 'your DBIT email'}</strong></p>
            {!editing && <button onClick={() => { setEditing(true); setOtp(''); setError(''); setSuccess(''); }} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-mesh-600" disabled={!!busy}><Pencil size={13} /> Change email</button>}
          </>}
          {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          {success && <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{success}</p>}
          {verified ? <button onClick={() => navigate('/login')} className="brand-button mt-7 w-full">Continue to sign in <ArrowRight size={18} /></button> : <>
            <form onSubmit={handleVerify} className="mt-7 space-y-6">
              {editing && <label className="block text-sm font-bold">University email<input type="email" required value={email} disabled={!!busy} onChange={event => { setEmail(event.target.value); setOtp(''); setError(''); setSuccess(''); setCodeSent(false); }} placeholder="you@dbit.co.in" autoComplete="email" className="mt-2 h-12 w-full rounded-xl border border-ink/20 px-4" /></label>}
              <OtpInput value={otp} onChange={(code: string) => { setOtp(code); setError(''); }} disabled={!!busy} invalid={!!error} autoFocus={!!email} />
              <button type="submit" disabled={!!busy || otp.length !== 6 || !validEmail} className="brand-button w-full">{busy === 'verify' ? 'Verifying…' : <>Verify & continue <ArrowRight size={18} /></>}</button>
            </form>
            <div className="mt-6 text-center text-sm text-ink/60">Didn’t get it? <button type="button" onClick={handleResend} disabled={!!busy || remaining > 0} className="ml-1 font-semibold text-mesh-600 disabled:text-ink/40">{busy === 'resend' ? 'Sending…' : remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</button></div>
            <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink/55"><ShieldCheck size={15} /> Never share a sign-in or reset code with anyone.</p>
          </>}
          <Link to="/login" className="mt-7 flex items-center justify-center gap-2 text-sm font-bold"><ArrowLeft size={15} /> Back to sign in</Link>
        </section>
      </div>
    </div>
  </main>;
}
