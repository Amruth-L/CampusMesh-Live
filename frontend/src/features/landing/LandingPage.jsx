import { Link } from 'react-router-dom';
import { ArrowRight, ShoppingBag, Store, Truck, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Brand from '../../components/Brand';
import { rentalCategories } from '../../lib/categories';
export default function LandingPage() {
  const { user } = useAuth();
  return <main>
    <section className="border-b border-ink/10 bg-white"><div className="page-shell grid items-center gap-10 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-20">
      <div><p className="flex items-center gap-2 text-sm font-medium text-mesh-700"><MapPin size={16}/> Your DBIT campus</p><h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.13] tracking-[-.045em] sm:text-5xl">Need it for a day?<br/><span className="text-mesh-600">Rent it on campus.</span></h1><p className="mt-5 max-w-md text-base leading-7 text-ink/60">Find useful items from students nearby. Rent what you need, lend what you own, or earn by delivering.</p><div className="mt-7 flex flex-wrap gap-3"><Link to={user ? '/marketplace' : '/signup'} className="brand-button text-sm">Browse campus items <ArrowRight size={17}/></Link><Link to={user ? '/lend' : '/login'} className="secondary-button">List your item</Link></div><p className="mt-6 text-xs text-ink/50">Campus email required · Pickup or student delivery</p></div>
      <div className="panel overflow-hidden"><div className="border-b border-ink/10 px-6 py-4 text-sm font-semibold">Everyday essentials, available to rent</div><div className="grid grid-cols-2 gap-px bg-ink/10">{rentalCategories.slice(0,4).map(([name,Icon]) => <Link key={name} to={user ? `/marketplace?category=${encodeURIComponent(name)}` : '/login'} className="flex min-h-36 flex-col items-center justify-center gap-4 bg-paper transition hover:bg-mesh-50"><Icon size={38} strokeWidth={1.3} className="text-mesh-700"/><span className="text-sm font-medium">{name}</span></Link>)}</div></div>
    </div></section>
    <section className="page-shell py-12"><h2 className="text-2xl font-semibold tracking-tight">Your campus. Three ways to take part.</h2><div className="mt-6 grid gap-5 md:grid-cols-3">{[[ShoppingBag,'Rent','Browse items, send a rental request, and arrange a handover.','/marketplace'],[Store,'Lend','Set your daily price and manage requests for your items.','/lend'],[Truck,'Deliver','Choose your route, accept a delivery, and earn for completed trips.','/delivery']].map(([Icon,title,copy,to]) => <Link key={title} to={user ? to : '/signup'} className="panel p-6 hover:border-mesh-300"><Icon size={23} className="text-mesh-600"/><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-ink/60">{copy}</p><ArrowRight size={17} className="mt-5 text-mesh-600"/></Link>)}</div></section>
    <footer className="border-t border-ink/10 bg-white"><div className="page-shell flex flex-wrap items-center justify-between gap-4 py-6"><Brand/><span className="text-xs text-ink/50">Rent, lend, and deliver within your campus.</span></div></footer>
  </main>;
}
