import { lazy, Suspense, useEffect, useState } from 'react';
import { shopRequest } from '../../lib/shop';
import { ShopOrders } from './ShopOrders';
const StaffDashboard = lazy(() => import('../../pages/StaffDashboard'));

export default function ShopDashboard() {
  const [view, setView] = useState<'workshop' | 'shop'>('workshop');
  const [count, setCount] = useState(0);
  useEffect(() => { let alive = true; const update = () => shopRequest<{ counts: { awaiting_confirmation?: number } }>('staff/orders').then(q => { if (alive) setCount(q.counts.awaiting_confirmation || 0); }).catch(() => {});
    void update(); const timer = setInterval(update, 30000); window.addEventListener('focus', update);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', update); }; }, []);
  return <div className="space-y-7"><div className="flex gap-2" role="group" aria-label="Dashboard workspace"><button className={`rounded-full px-4 py-2.5 text-sm ${view === 'workshop' ? 'bg-charcoal-950 text-white' : 'bg-white border'}`} aria-pressed={view === 'workshop'} onClick={() => setView('workshop')}>Workshop</button><button className={`rounded-full px-4 py-2.5 text-sm ${view === 'shop' ? 'bg-charcoal-950 text-white' : 'bg-white border'}`} aria-pressed={view === 'shop'} onClick={() => setView('shop')}>Shop Orders {count > 0 && <span className="ml-2 rounded-full bg-mustard-400 text-charcoal-950 px-2 py-0.5 text-xs">{count} new</span>}</button></div>
    <Suspense fallback={<p className="text-sm">Loading dashboard…</p>}>{view === 'workshop' ? <StaffDashboard /> : <ShopOrders onCount={setCount} />}</Suspense></div>;
}
