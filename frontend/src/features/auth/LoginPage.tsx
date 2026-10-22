import Brand from "../../components/Brand";
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getApiError, loginUser } from './auth.service';
import type { AuthLoadingState, LoginFormData } from './auth.types';

export default function LoginPage() {
  const { api, login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<LoginFormData>({ email: '', password: '', remember: false });
  const [showPassword, setShowPassword] = useState(false);
  const [loadingState, setLoadingState] = useState<AuthLoadingState>('idle');
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const loginAttempt = useRef<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const rememberedEmail = localStorage.getItem('cm_remember');
    if (rememberedEmail) setForm(current => ({ ...current, email: rememberedEmail, remember: true }));
  }, []);

  // Leave an in-flight login's destination to its response (including onboarding).
  useEffect(() => {
    if (isAuthenticated && loadingState === 'idle') navigate('/choose-mode', { replace: true });
  }, [isAuthenticated, loadingState, navigate]);

  const update = useCallback(
    (field: keyof LoginFormData, value: string | boolean) => {
      if (field === 'email' || field === 'password') loginAttempt.current = null;
      setForm(current => ({ ...current, [field]: value }));
    },
    [],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || loadingState === 'success') return;
    submitting.current = true;
    setError('');
    setNeedsVerification(false);
    setLoadingState('loading');
    try {
      // Keep this ID after an uncertain response so retrying the same sign-in
      // cannot create another greeting if the server already accepted it.
      loginAttempt.current ??= crypto.randomUUID();
      const data = await loginUser(api, {
        email: form.email, password: form.password,
        login_attempt_id: loginAttempt.current,
      });
      await login(data.token);
      if (form.remember) localStorage.setItem('cm_remember', form.email.trim().toLowerCase());
      else localStorage.removeItem('cm_remember');
      loginAttempt.current = null;
      setLoadingState('success');
      navigate(data.welcomeCallSetupNeeded ? '/reminders?welcome=1' : '/choose-mode');
    } catch (caught: unknown) {
      setError(getApiError(caught, 'Invalid email or password.'));
      setLoadingState('error');
      if (caught && typeof caught === 'object' && 'response' in caught) {
        const response = (caught as { response?: { status?: number } }).response;
        setNeedsVerification(response?.status === 403);
        const status = response?.status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 499)
          loginAttempt.current = null;
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8"><Link to="/" aria-label="CampusMesh home"><Brand /></Link></div>

      <section className="flex justify-center px-5 py-8 sm:py-12">

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .45, delay: .08 }}
          className="panel w-full max-w-[460px] p-6 sm:p-8"
        >
          <span className="text-xs font-medium text-ink/65">Welcome back</span>
          <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight">Sign in</h2>
          <p className="mt-4 text-sm text-ink/48">Use your campus email and password.</p>

          {error && (
            <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
              {needsVerification && (
                <button type="button" onClick={() => navigate('/verify-email', { state: { email: form.email } })} className="mt-2 flex items-center gap-1 font-semibold">
                  Verify email now <ArrowRight size={14} />
                </button>
              )}
            </motion.div>
          )}

          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
            <label className="block">
              <span className="text-xs font-medium text-ink/65 mb-2 block">University email</span>
              <span className="relative block">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input id="login-email" type="email" className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 h-13 rounded-2xl pl-12" placeholder="student@dbit.co.in" autoComplete="email" required disabled={loadingState === 'loading'} value={form.email} onChange={event => update('email', event.target.value)} />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-ink/65">Password</span>
                <Link to="/forgot-password" className="text-xs font-bold text-mesh-700 hover:text-mesh-900">Forgot password?</Link>
              </span>
              <span className="relative block">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/32" size={18} />
                <input id="login-password" type={showPassword ? 'text' : 'password'} className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 h-13 rounded-2xl px-12" placeholder="Enter your password" autoComplete="current-password" required disabled={loadingState === 'loading'} value={form.password} onChange={event => update('password', event.target.value)} />
                <button type="button" onClick={() => setShowPassword(current => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink/38 hover:bg-mesh-50" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label className="flex w-fit items-center gap-2 text-xs font-semibold text-ink/52">
              <input type="checkbox" className="size-4 accent-emerald-700" checked={form.remember} onChange={event => update('remember', event.target.checked)} /> Remember this email
            </label>
            <button id="login-submit" type="submit" disabled={loadingState === 'loading'} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 h-13 w-full rounded-2xl">
              {loadingState === 'loading' ? 'Signing in…' : <>Sign in <ArrowRight size={17} /></>}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-ink/55">
            <Link to="/reminders" className="font-medium text-mesh-700">Enable sign-in calls in Reminders</Link>
            {" "}after signing in.
          </p>
          <p className="mt-7 text-center text-sm text-ink/45">
            New to CampusMesh? <Link to="/signup" className="font-semibold text-mesh-700">Create an account</Link>
          </p>
        </motion.div>
      </section>
    </main>
  );
}
