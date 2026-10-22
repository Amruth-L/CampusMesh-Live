import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const empty = { beneficiary_name: '', phone: '', pan: '', account_number: '', account_number_confirmation: '', ifsc: '', confirm: false, tnc_accepted: false };
const fields = [
  ['beneficiary_name', 'Full legal name', 'text', 120, undefined, 'Use the name on your PAN and bank account.'],
  ['phone', 'Mobile number', 'tel', 16, undefined, 'Indian mobile number, including +91.'],
  ['pan', 'Individual PAN', 'text', 10, '[A-Za-z]{3}[Pp][A-Za-z][0-9]{4}[A-Za-z]', 'Required by Razorpay to verify the recipient.'],
  ['ifsc', 'IFSC code', 'text', 11, '[A-Za-z]{4}0[A-Za-z0-9]{6}', 'Find this on your bank statement or banking app.'],
  ['account_number', 'Bank account number', 'password', 18, '[0-9]{9,18}'],
  ['account_number_confirmation', 'Re-enter bank account number', 'text', 18, '[0-9]{9,18}'],
];

export default function BankOnboardingForm({ busy, retry, onSubmit }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (form.account_number !== form.account_number_confirmation) {
      setError('The account numbers do not match. Check both entries.');
      return;
    }
    setError('');
    if (await onSubmit(form)) setForm(empty);
  }
  return (
    <section aria-labelledby="bank-setup-title" className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6">
      <h2 id="bank-setup-title" className="text-xl font-semibold">{retry ? 'Complete your bank setup' : 'Add and verify your bank account'}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/70">
        Set this up once for your rental and delivery earnings. Use an Indian bank account in your own name.
        Razorpay verifies your details; submitting this form does not move money.
      </p>
      {retry && <p className="mt-3 text-sm leading-6 text-amber-900">Your earlier submission needs confirmation. Re-enter the same details to safely resume it. Contact support if those details need changing.</p>}
      <form onSubmit={submit} className="mt-6">
        <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
          <legend className="sr-only">Recipient and bank details</legend>
          {fields.map(([key, label, type, maxLength, pattern, hint]) => (
            <label key={key} className="block min-w-0 text-sm font-semibold text-ink">
              {label}
              <input required name={key} type={type} maxLength={maxLength} pattern={pattern}
                minLength={key === 'beneficiary_name' ? 4 : undefined}
                inputMode={key.startsWith('account_number') ? 'numeric' : key === 'phone' ? 'tel' : 'text'}
                autoComplete="off" spellCheck={false} value={form[key]}
                aria-describedby={hint ? `${key}-hint` : undefined}
                onChange={(event) => setForm({ ...form, [key]: ['pan', 'ifsc'].includes(key) ? event.target.value.toUpperCase() : event.target.value })}
                className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-ink/20 bg-white px-3 text-base font-normal text-ink focus:border-mesh-700 disabled:bg-paper" />
              {hint && <span id={`${key}-hint`} className="mt-1.5 block text-xs font-normal leading-5 text-ink/70">{hint}</span>}
            </label>
          ))}
          <div className="space-y-3 sm:col-span-2">
            <label className="flex items-start gap-3 text-sm leading-6 text-ink/80">
              <input required type="checkbox" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} className="mt-1 size-5 shrink-0 accent-mesh-700" />
              <span>I own this bank account and have checked the details.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6 text-ink/80">
              <input required type="checkbox" checked={form.tnc_accepted} onChange={(e) => setForm({ ...form, tnc_accepted: e.target.checked })} className="mt-1 size-5 shrink-0 accent-mesh-700" />
              <span>I accept <a href="https://razorpay.com/terms/" target="_blank" rel="noreferrer" className="font-semibold text-mesh-800 underline">Razorpay’s terms</a> and authorise CampusMesh to send these details to Razorpay for recipient and bank verification.</span>
            </label>
          </div>
          {error && <p role="alert" className="text-sm text-red-800 sm:col-span-2">{error}</p>}
          <div className="space-y-3 sm:col-span-2">
            <button className="brand-button w-full disabled:opacity-50 sm:w-auto" disabled={busy}>
              {busy ? 'Submitting securely…' : retry ? 'Resume bank verification' : 'Submit bank details for verification'}
            </button>
            <p className="flex max-w-2xl items-start gap-2 text-xs leading-5 text-ink/70">
              <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              CampusMesh does not save your PAN or full bank account number. Never enter a UPI PIN, card PIN, or banking password here.
            </p>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
