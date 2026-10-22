import { Link } from 'react-router-dom';

export default function MeshScore({ mesh }) {
  if (!mesh) return null;
  return <section className="panel mb-6 p-5" aria-label="Courier Mesh Score">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Delivery Mesh Score <span className="ml-2 text-mesh-700">{mesh.score === null ? 'New partner' : `${mesh.score}/100`}</span></h2>
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${mesh.eligible ? 'bg-mesh-50 text-mesh-800' : 'bg-amber-50 text-amber-900'}`}>{mesh.eligible ? mesh.provisional ? 'Eligible · provisional' : 'Eligible' : 'Action needed'}</span>
    </div>
    <p className="mt-2 text-sm text-ink/75">{mesh.reason}</p>
    <details className="mt-3 text-xs leading-6 text-ink/65"><summary className="cursor-pointer font-semibold">How your score works</summary>
      <p>{mesh.completed} completed · {mesh.failed} failed. {mesh.formula}.</p>
      <p>After {mesh.minimumHistory} finished tasks, a score of at least {mesh.minimumScore} is required for new deliveries. Declines, cancelled requests and demo items are excluded. This measures delivery history, not personal trustworthiness. Availability and one active delivery are checked separately.</p>
      <Link className="font-semibold text-mesh-700 underline" to="/support">Ask Support to review an incorrect failure</Link>
    </details>
  </section>;
}
