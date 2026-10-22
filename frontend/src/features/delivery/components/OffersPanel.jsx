import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import DeliveryOfferCard from './DeliveryOfferCard';
export default function OffersPanel({ offers, onAccept, onDecline, online, reason, connection, busyId, active, className = '' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); }, []);
  const pending = offers.filter(offer => new Date(offer.offer_expires_at).getTime() > now);
  return <section className={className}>
    <div className="mb-5"><h2 className="text-lg font-semibold">Pending requests <span className="ml-1 rounded-md bg-mesh-100 px-2 py-1 text-xs text-mesh-800">{pending.length}</span></h2><p className="page-copy">Review the item and delivery details before accepting.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">{pending.map(offer => <DeliveryOfferCard key={offer.offer_id} offer={offer} now={now} onAccept={onAccept} onDecline={onDecline} busyId={busyId} disabled={!online || connection === 'offline' || !!active}/>)}</div>
    {!pending.length && <div className="panel px-6 py-14 text-center"><Bell size={27} className="mx-auto text-ink/30"/><h3 className="mt-4 text-sm font-semibold">{connection === 'offline' ? 'Requests are temporarily unavailable' : active ? 'You have a delivery in progress' : !online ? 'Go online to receive requests' : reason === 'NO_ROUTE_MATCH' ? 'No requests along this route yet' : 'You’re ready for your next delivery'}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink/60">{connection === 'offline' ? 'Check your connection and try refreshing.' : active ? 'Finish your current delivery to receive new requests.' : !online ? 'Set your availability and go online. No starting point or destination is required.' : 'New requests will appear here and in your notifications.'}</p></div>}
  </section>;
}
