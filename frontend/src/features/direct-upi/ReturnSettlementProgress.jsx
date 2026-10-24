import { Check, CircleDot } from 'lucide-react';
import { returnSettlementProgress } from '../../lib/rental-status';

export default function ReturnSettlementProgress({ rental, refund }) {
  const steps = returnSettlementProgress(rental, refund);
  return <details className="border-b border-ink/10 py-3" aria-label="Return and deposit refund">
    <summary className="cursor-pointer text-sm font-semibold">Return progress · {steps.every(step => step.done) ? 'Complete' : 'In progress'}</summary>
    <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map(step => <li key={step.key} aria-current={step.current ? 'step' : undefined} className="flex items-start gap-2 text-sm">
        <span className={`mt-0.5 shrink-0 ${step.done || step.current ? 'text-mesh-800' : 'text-ink/60'}`} aria-hidden="true">{step.done ? <Check size={18} /> : <CircleDot size={18} />}</span>
        <span><span className="font-semibold">{step.label}</span><span className="mt-1 block text-xs text-ink/70">{step.done ? step.key === 'sent' && refund?.status !== 'CONFIRMED' ? 'Reported by owner' : 'Confirmed' : step.current ? 'Current step' : 'Pending'}</span></span>
      </li>)}
    </ol>
  </details>;
}
