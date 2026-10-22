import { ShoppingBag, Store, Truck, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
export default function ChooseMode() {
  const { user } = useAuth();
  return <main className="page-shell min-h-[80vh]">
    <div className="pb-8 pt-8 sm:pt-14"><p className="mb-3 text-sm text-ink/60">Hi, {user?.name?.split(' ')[0] || 'there'}</p><h1 className="page-title">What would you like to do?</h1><p className="page-copy">One account for renting, lending, and delivering. Switch whenever you need.</p></div>
    <div className="grid gap-5 md:grid-cols-3">{[
      ['/marketplace', ShoppingBag, 'Rent an item', 'Browse campus items, choose your dates, and track your rentals.', 'Browse items'],
      ['/lend', Store, 'Lend your items', 'Add a listing, respond to requests, and manage handovers.', 'Open lending dashboard'],
      ['/delivery', Truck, 'Make deliveries', 'Accept requests along your route and track your earnings.', 'Open delivery dashboard'],
    ].map(([to,Icon,title,copy,cta]) => <Link key={to} to={to} className="panel group p-7 transition hover:border-mesh-400"><span className="grid size-12 place-items-center rounded-xl bg-mesh-50 text-mesh-700"><Icon size={24}/></span><h2 className="mt-7 text-xl font-semibold tracking-tight">{title}</h2><p className="mt-3 text-sm leading-6 text-ink/60">{copy}</p><span className="mt-8 flex items-center justify-between gap-3 text-sm font-semibold text-mesh-700">{cta}<ArrowRight size={17}/></span></Link>)}</div>
  </main>;
}
