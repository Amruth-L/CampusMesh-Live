import { Check, CircleDot } from 'lucide-react';
import { returnSettlementProgress } from '../../lib/rental-status';

export default function ReturnSettlementProgress({ rental, refund }) {
  const steps = returnSettlementProgress(rental, refund);
  return <section className="rounded-xl border border-ink/15 bg-white p-5" aria-label="Return and deposit refund">
    <h3 className="font-bold">Return & deposit refund</h3>
    <p className="mt-2 text-sm leading-6 text-ink/75">The owner approves the item condition, sends the refund, and the renter confirms bank receipt. The rental closes after that confirmation.</p>
    <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map(step => <li key={step.key} aria-current={step.current ? 'step' : undefined} className="flex items-start gap-2 text-sm">
        <span className={`mt-0.5 shrink-0 ${step.done || step.current ? 'text-mesh-800' : 'text-ink/60'}`} aria-hidden="true">{step.done ? <Check size={18} /> : <CircleDot size={18} />}</span>
        <span><span className="font-semibold">{step.label}</span><span className="mt-1 block text-xs text-ink/70">{step.done ? step.key === 'sent' && refund?.status !== 'CONFIRMED' ? 'Reported by owner' : 'Confirmed' : step.current ? 'Current step' : 'Pending'}</span></span>
      </li>)}
    </ol>
  </section>;
}
