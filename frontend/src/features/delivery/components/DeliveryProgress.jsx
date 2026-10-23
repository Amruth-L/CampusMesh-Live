import { Check, CircleDot } from 'lucide-react';
import { deliveryProgress } from '../../../lib/delivery-progress';

export default function DeliveryProgress({ rental, delivery, error }) {
  const progress = deliveryProgress(rental, delivery);
  return <section aria-label={progress.title} className="rounded-xl border border-ink/15 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-bold">{progress.title}</h2>
    <p role="status" className={`mt-2 text-sm leading-6 ${error ? 'text-amber-900' : 'text-ink/75'}`}>
      {error ? 'Tracking could not refresh. These are the last loaded checkpoints; refresh before relying on them.' : progress.summary}
    </p>
    <ol className="mt-6 grid gap-0 lg:grid-flow-col lg:auto-cols-fr" aria-label="Delivery checkpoints">
      {progress.steps.map((step, index) => <li key={step.key} aria-current={step.current ? 'step' : undefined} className="relative flex min-w-0 gap-3 pb-5 last:pb-0 lg:flex-col lg:items-center lg:gap-2 lg:px-1 lg:pb-0 lg:text-center">
        {index < progress.steps.length - 1 && <span aria-hidden="true" className={`absolute bottom-0 left-4 top-8 w-px lg:bottom-auto lg:left-1/2 lg:top-4 lg:h-px lg:w-full ${step.done && progress.steps[index + 1].done ? 'bg-mesh-600' : 'bg-ink/15'}`} />}
        <span aria-hidden="true" className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${step.done ? 'border-mesh-700 bg-mesh-700 text-white' : step.current ? 'border-mesh-700 bg-white text-mesh-800' : 'border-ink/20 bg-paper text-ink/65'}`}>
          {step.done ? <Check size={16} /> : step.current ? <CircleDot size={16} /> : index + 1}
        </span>
        <div className="min-w-0 pt-0.5 lg:pt-0">
          <p className={`text-sm font-semibold ${step.current ? 'text-mesh-800' : 'text-ink'}`}>{step.label}</p>
          <p className="mt-1 text-xs leading-5 text-ink/70">{step.done ? step.completedText : step.current ? 'Current step' : 'Pending'}</p>
        </div>
      </li>)}
    </ol>
  </section>;
}
