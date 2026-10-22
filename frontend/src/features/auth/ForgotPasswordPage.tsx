import OtpInput from "../../components/OtpInput";
import useOtpCooldown from "./useOtpCooldown";
import Brand from "../../components/Brand";
import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getApiError, requestPasswordReset, resetPassword } from './auth.service';
import type { AuthLoadingState } from './auth.types';

const ForgotPassword: React.FC = () => {
  const { api } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingState, setLoadingState] = useState<AuthLoadingState>('idle');
  const [loadingAction, setLoadingAction] = useState<'request' | 'reset' | null>(null);

  const { remaining, start } = useOtpCooldown(email, 'reset');
  const isLoading = loadingState === 'loading';

  const handleRequestOtp = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (isLoading) return;
    if (remaining > 0) { setStep(2); setSuccess('Use the code already sent to your email.'); return; }
    if (!/^[^\s@]+@dbit\.co\.in$/i.test(email.trim())) { setError('Enter your DBIT email.'); return; }
    setLoadingState('loading');
    setLoadingAction('request');

    try {
      const response = await requestPasswordReset(api, { email: email.trim().toLowerCase() });
      setSuccess(response.message || 'Reset code sent. Check your inbox.');
      setLoadingState('idle');
      setLoadingAction(null);
      setStep(2);
      setOtp('');
      start(response.retryAfter || 60);
    } catch (caught: unknown) {
      const retry = (caught as { response?: { data?: { retryAfter?: number } } })?.response?.data?.retryAfter;
      if (retry) start(retry);
      setError(getApiError(caught, 'Could not send the reset code. Please try again.'));
      setLoadingState('error');
      setLoadingAction(null);
    }
  };

  const handleResetPassword = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoadingState('loading');
    setLoadingAction('reset');

    try {
      const response = await resetPassword(api, {
        email: email.trim().toLowerCase(),
        otp,
        newPassword,
      });
      setSuccess(response.message || 'Password reset successfully!');
      setLoadingState('success');
      setLoadingAction(null);
      window.setTimeout(() => navigate('/login'), 1800);
    } catch (caught: unknown) {
      setError(getApiError(caught, 'Could not reset your password. Check the code and try again.'));
      setLoadingState('error');
      setLoadingAction(null);
    }
  };

  const backToEmail = () => {
    setStep(1);
    setOtp('');
    setNewPassword('');
    setError('');
    setSuccess('');
    setLoadingState('idle');
  };

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8"><Link to="/" aria-label="CampusMesh home"><Brand /></Link></div>

      <section className="flex justify-center px-5 py-8 sm:py-12">


        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="panel w-full max-w-[460px] p-6 sm:p-8"
        >
          <div className="mb-8 flex items-center gap-2" aria-label={`Step ${step} of 2`}>
            <span className={`h-1.5 w-12 rounded-full transition ${step >= 1 ? 'bg-mesh-600' : 'bg-ink/10'}`} />
            <span className={`h-1.5 w-12 rounded-full transition ${step >= 2 ? 'bg-mesh-600' : 'bg-ink/10'}`} />
          </div>

          <span className="text-xs font-medium text-ink/65">
            {step === 1 ? 'Account recovery' : 'New password'}
          </span>
          <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight">
            {step === 1 ? 'Reset your password.' : 'Create a new password.'}
          </h2>
          <p className="mt-4 text-sm leading-6 text-ink/48">
            {step === 1 ? (
              'Enter your university email to receive a reset code.'
            ) : (
              <>Enter the 6-digit code sent to <strong className="break-all text-ink/75">{email}</strong>.</>
            )}
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
              role="alert"
            >
              {error}
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-2xl border border-mesh-200 bg-mesh-50 p-4 text-sm font-semibold text-mesh-700"
              role="status"
            >
              {success}
            </motion.div>
          )}

          {step === 1 ? (
            <form className="mt-8 space-y-5" onSubmit={handleRequestOtp} noValidate>
              <label className="block" htmlFor="fp-email">
                <span className="mb-2 block text-xs font-medium text-ink/65">University email</span>
                <span className="relative block">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                  <input
                    id="fp-email"
                    type="email"
                    className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                    placeholder="student@dbit.co.in"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                  />
                </span>
              </label>

              <button
                type="submit"
                id="fp-send-btn"
                className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-mesh-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                disabled={isLoading}
              >
                {loadingAction === 'request' ? 'Sending…' : <>{remaining > 0 ? 'Enter existing code' : 'Send reset code'} <ArrowRight size={17} /></>}
              </button>

              <button
                type="button"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-semibold text-mesh-700 transition hover:border-mesh-500 hover:bg-mesh-50"
                onClick={() => navigate('/login')}
              >
                <ArrowLeft size={15} /> Back to sign in
              </button>
            </form>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleResetPassword} noValidate>
              <OtpInput value={otp} onChange={(code: string) => { setOtp(code); setError(''); }} disabled={isLoading || loadingState === 'success'} invalid={!!error} autoFocus />
              <button type="button" onClick={handleRequestOtp} disabled={isLoading || remaining > 0 || loadingState === 'success'} className="text-sm font-bold text-mesh-600 disabled:text-ink/40">{remaining > 0 ? `Resend in ${remaining}s` : 'Resend reset code'}</button>

              <label className="block" htmlFor="fp-newpw">
                <span className="mb-2 block text-xs font-medium text-ink/65">New password</span>
                <span className="relative block">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                  <input
                    id="fp-newpw"
                    type={showPassword ? 'text' : 'password'}
                    className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 pr-12 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={event => setNewPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink/40 transition hover:bg-mesh-50 hover:text-mesh-700"
                    onClick={() => setShowPassword(value => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>

              <button
                type="submit"
                id="fp-reset-btn"
                className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-mesh-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                disabled={isLoading || loadingState === 'success' || otp.length !== 6 || newPassword.length < 6}
              >
                {loadingAction === 'reset' ? 'Resetting…' : <>Reset password <ArrowRight size={17} /></>}
              </button>

              <button
                type="button"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-semibold text-mesh-700 transition hover:border-mesh-500 hover:bg-mesh-50"
                onClick={backToEmail}
                disabled={isLoading || loadingState === 'success'}
              >
                <ArrowLeft size={15} /> Use a different email
              </button>
            </form>
          )}

          <p className="mt-7 text-center text-sm text-ink/45">
            Remembered your password? <Link to="/login" className="font-semibold text-mesh-700">Back to sign in</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
};

export default ForgotPassword;
