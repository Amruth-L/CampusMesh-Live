import Brand from "../../components/Brand";
import { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, AtSign, Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getApiError, signupUser } from './auth.service';
import type { AuthLoadingState, SignupFieldErrors, SignupFormData } from './auth.types';

type StrengthLevel = 'none' | 'weak' | 'fair' | 'good' | 'strong';

const strengthLevels: StrengthLevel[] = ['weak', 'fair', 'good', 'strong'];

const strengthLabel: Record<StrengthLevel, string> = {
  none: '',
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

const strengthBarClass: Record<StrengthLevel, string> = {
  none: 'bg-ink/10',
  weak: 'bg-red-500',
  fair: 'bg-amber-500',
  good: 'bg-blue-500',
  strong: 'bg-green-500',
};

const strengthTextClass: Record<StrengthLevel, string> = {
  none: 'text-ink/40',
  weak: 'text-red-600',
  fair: 'text-amber-600',
  good: 'text-blue-600',
  strong: 'text-green-600',
};

function getStrength(password: string): StrengthLevel {
  if (!password) return 'none';
  if (password.length < 6) return 'weak';
  if (password.length < 8) return 'fair';
  if (/[A-Z]/.test(password) && /\d/.test(password) && password.length >= 10) return 'strong';
  return 'good';
}

const Signup: React.FC = () => {
  const { api } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<SignupFormData>({
    name: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone_number: '',
  });
  const [loginCallsEnabled, setLoginCallsEnabled] = useState(false);
  const [rentalCallsEnabled, setRentalCallsEnabled] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [globalError, setGlobalError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loadingState, setLoadingState] = useState<AuthLoadingState>('idle');

  const isLoading = loadingState === 'loading';
  const strength = getStrength(form.password);

  const update = useCallback(
    (field: keyof SignupFormData, value: string) => setForm(current => ({ ...current, [field]: value })),
    [],
  );

  const clearFieldError = (field: keyof SignupFieldErrors) => {
    setFieldErrors(current => ({ ...current, [field]: undefined }));
  };

  function validate(): boolean {
    const errors: SignupFieldErrors = {};

    if (!form.name.trim()) {
      errors.name = 'Full name is required.';
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username.trim())) {
      errors.username = 'Username must be 3–20 characters (letters, numbers, underscores only).';
    }

    if (!/^[^\s@]+@dbit\.co\.in$/i.test(form.email.trim())) {
      errors.email = 'Please use your DBIT university email (@dbit.co.in).';
    }

    if (form.password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (form.password !== form.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }
    if (!/^(\+[1-9]\d{7,14}|\d{10})$/.test(form.phone_number.trim().replace(/[\s()-]/g, ''))) {
      errors.phone_number = 'Enter a 10-digit Indian mobile number, or include your country code.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGlobalError('');

    if (!validate()) return;

    setLoadingState('loading');

    try {
      await signupUser(api, {
        name: form.name,
        username: form.username,
        email: form.email,
        password: form.password,
        phone_number: form.phone_number,
        welcome_enabled: false,
        login_calls_enabled: loginCallsEnabled,
        rental_calls_enabled: rentalCallsEnabled,
      });
      const email = form.email.trim().toLowerCase();
      sessionStorage.setItem(`cm:otp:verify:${email}`, String(Date.now() + 60000));
      navigate('/verify-email', { state: { email, codeSent: true } });
    } catch (error: unknown) {
      const message = getApiError(error, 'Failed to create account. Please try again.');
      setLoadingState('error');

      if (error && typeof error === 'object' && 'response' in error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = (error as any).response;
        if (response?.data?.accountCreated || response?.data?.requiresVerification) {
          navigate('/verify-email', { state: { email: form.email.trim().toLowerCase(), error: message, codeSent: false } });
          return;
        }
        if (response?.status === 409) {
          const lowerMessage = message.toLowerCase();
          if (lowerMessage.includes('username')) {
            setFieldErrors(current => ({ ...current, username: message }));
            return;
          }
          if (lowerMessage.includes('email')) {
            setFieldErrors(current => ({ ...current, email: message }));
            return;
          }
        }
      }

      setGlobalError(message);
    }
  };

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8"><Link to="/" aria-label="CampusMesh home"><Brand /></Link></div>

      <section className="flex justify-center px-5 py-8 sm:py-12">


        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="panel w-full max-w-[480px] p-6 sm:p-8"
        >
          <span className="text-xs font-medium text-ink/65">New here?</span>
          <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight">Create your account</h2>
          <p className="mt-4 text-sm text-ink/48">Use your DBIT email. We’ll send a code to verify it.</p>

          {globalError && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
              role="alert"
            >
              {globalError}
            </motion.div>
          )}

          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
            <label className="block" htmlFor="signup-name">
              <span className="mb-2 block text-xs font-medium text-ink/65">Full name</span>
              <span className="relative block">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input
                  id="signup-name"
                  type="text"
                  className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="e.g. Amruth Kumar"
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={event => { update('name', event.target.value); clearFieldError('name'); }}
                />
              </span>
              {fieldErrors.name && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.name}</span>}
            </label>

            <label className="block" htmlFor="signup-username">
              <span className="mb-2 block text-xs font-medium text-ink/65">Username</span>
              <span className="relative block">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input
                  id="signup-username"
                  type="text"
                  className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="e.g. amruth_k"
                  required
                  autoComplete="username"
                  value={form.username}
                  onChange={event => { update('username', event.target.value); clearFieldError('username'); }}
                />
              </span>
              {fieldErrors.username && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.username}</span>}
            </label>

            <label className="block" htmlFor="signup-email">
              <span className="mb-2 block text-xs font-medium text-ink/65">University email</span>
              <span className="relative block">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input
                  id="signup-email"
                  type="email"
                  className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="student@dbit.co.in"
                  required
                  autoComplete="email"
                  value={form.email}
                  onChange={event => { update('email', event.target.value); clearFieldError('email'); }}
                />
              </span>
              {fieldErrors.email && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.email}</span>}
            </label>

            <label className="block" htmlFor="signup-phone">
              <span className="mb-2 block text-xs font-medium text-ink/65">Mobile number</span>
              <span className="relative block">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input id="signup-phone" type="tel" autoComplete="tel" required
                  className="h-13 w-full rounded-2xl border border-mesh-900/15 bg-white px-3 pl-12 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="+91 98765 43210" value={form.phone_number}
                  onChange={event => { update('phone_number', event.target.value); clearFieldError('phone_number'); }} />
              </span>
              {fieldErrors.phone_number && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.phone_number}</span>}
            </label>

            <div>
              <label className="mb-2 block text-xs font-medium text-ink/65" htmlFor="signup-password">Password</label>
              <span className="flex h-13 w-full items-center rounded-2xl border border-mesh-900/15 bg-white px-3 transition focus-within:border-mesh-500 focus-within:ring-4 focus-within:ring-mesh-100">
                <Lock className="shrink-0 text-ink/32" size={18} />
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                  placeholder="At least 6 characters"
                  required
                  autoComplete="new-password"
                  value={form.password}
                  onChange={event => { update('password', event.target.value); clearFieldError('password'); }}
                />
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-xl text-ink/40 transition hover:bg-mesh-50 hover:text-mesh-700 focus:outline-none focus:ring-4 focus:ring-mesh-100"
                  onClick={() => setShowPassword(current => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {form.password && (
                <span className="mt-2 flex items-center gap-1.5" aria-live="polite">
                  <span className="flex flex-1 gap-1">
                    {strengthLevels.map(level => {
                      const active = strengthLevels.indexOf(strength) >= strengthLevels.indexOf(level);
                      return <span key={level} className={`h-1 flex-1 rounded-full transition-colors ${active ? strengthBarClass[strength] : 'bg-ink/10'}`} />;
                    })}
                  </span>
                  <span className={`min-w-11 text-right text-[11px] font-bold ${strengthTextClass[strength]}`}>{strengthLabel[strength]}</span>
                </span>
              )}
              {fieldErrors.password && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.password}</span>}
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-ink/65" htmlFor="signup-confirm">Confirm password</label>
              <span className="flex h-13 w-full items-center rounded-2xl border border-mesh-900/15 bg-white px-3 transition focus-within:border-mesh-500 focus-within:ring-4 focus-within:ring-mesh-100">
                <Lock className="shrink-0 text-ink/32" size={18} />
                <input
                  id="signup-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                  placeholder="Re-enter your password"
                  required
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={event => { update('confirmPassword', event.target.value); clearFieldError('confirmPassword'); }}
                />
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-xl text-ink/40 transition hover:bg-mesh-50 hover:text-mesh-700 focus:outline-none focus:ring-4 focus:ring-mesh-100"
                  onClick={() => setShowConfirm(current => !current)}
                  aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
                  aria-pressed={showConfirm}
                >
                  {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {fieldErrors.confirmPassword && <span className="mt-2 block text-xs font-semibold text-red-600">{fieldErrors.confirmPassword}</span>}
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-4 text-sm">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-green-700" checked={rentalCallsEnabled}
                onChange={event => setRentalCallsEnabled(event.target.checked)} />
              <span><strong className="block font-medium">Call me about my rentals</strong>
                <span className="mt-1 block text-xs leading-5 text-ink/60">Optional. Booking confirmations after payment and return reminders starting four days before the due date. Requires phone verification. Change these settings anytime.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-ink/10 p-4 text-sm">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-green-700" checked={loginCallsEnabled}
                onChange={event => setLoginCallsEnabled(event.target.checked)} />
              <span><strong className="block font-medium">Call me after sign-in</strong>
                <span className="mt-1 block text-xs leading-5 text-ink/60">Optional. Automatic English greetings after successful sign-ins, once your saved number is verified and calling is available. No call button is needed. Calls run 9 am–7 pm India time, at least 30 minutes apart and at most three times a day across all call types. Turn this off anytime in Reminders.</span>
              </span>
            </label>

            <button
              type="submit"
              id="signup-submit"
              className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? (
                <><span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" /> Creating account…</>
              ) : (
                <>Create account <ArrowRight size={17} /></>
              )}
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-ink/45">
            Already have an account? <Link to="/login" className="font-semibold text-mesh-700 hover:text-mesh-900">Sign in</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
};

export default Signup;
