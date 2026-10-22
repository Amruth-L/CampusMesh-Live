import { useId, useState } from 'react';

// One real input preserves native paste, selection and one-time-code autofill.
export default function OtpInput({ value, onChange, disabled = false, invalid = false, autoFocus = false }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return <div>
    <label htmlFor={id} className="mb-3 block text-sm font-bold">6-digit verification code</label>
    <div className="relative">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, index) => <span key={index}
          className={`grid h-14 place-items-center rounded-xl border-2 bg-white text-2xl font-extrabold sm:h-16 ${invalid ? 'border-red-400' : focused && index === Math.min(value.length, 5) ? 'border-mesh-600 ring-4 ring-mesh-100' : value[index] ? 'border-mesh-300' : 'border-ink/10'}`}>
          {value[index] || <span className="size-1.5 rounded-full bg-ink/15" />}
        </span>)}
      </div>
      <input id={id} aria-invalid={invalid} aria-describedby={`${id}-hint`} type="text" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" maxLength={6} required value={value} disabled={disabled} autoFocus={autoFocus}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        onPaste={event => { event.preventDefault(); onChange(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)); }}
        className="absolute inset-0 size-full cursor-text opacity-0 disabled:cursor-wait" />
    </div>
    <p id={`${id}-hint`} className="mt-3 text-xs text-ink/55">You can paste the full code. It expires in 10 minutes.</p>
  </div>;
}
