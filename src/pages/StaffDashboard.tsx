import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Package, Users, TrendingUp, Wallet } from 'lucide-react';
import { fetchOrder, subscribeToOrderChanges } from '../lib/orders';
import { fetchOrderPage, fetchReceiptPage, fetchWorkshopSummary } from '../lib/reports';
import type { WorkshopSummary } from '../lib/reports';
import { PageControls } from '../components/ui/PageControls';
import { ghanaTime } from '../lib/workshopOperations';
import type { OrderView } from '../lib/analytics';
import type { BespokeJobOrder } from '../types/workshop.types';
import { formatGhs, orderBalance } from '../lib/money';
import { useAuth } from '../lib/auth';
import { DigitalJobCard } from '../components/workshop/DigitalJobCard';
import { OrderSmsHistory } from '../components/workshop/OrderSmsHistory';
import { ProgressBadge } from '../components/ui/ProgressBadge';

function StatTile({ icon, label, value, badge }: { icon: ReactNode; label: string; value: string; badge?: string }) {
  return <div className="glass p-5 rounded-2xl flex items-center gap-4 shadow-sm">
    <div className="w-11 h-11 rounded-xl bg-mustard-50 text-charcoal-800 flex items-center justify-center shrink-0">{icon}</div>
    <div className="min-w-0"><p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="text-xl font-bold text-charcoal-950 font-display mt-1 break-words">{value}</p>
      {badge && <p className="text-[11px] text-gray-500 mt-1">{badge}</p>}</div>
  </div>;
}
const VIEWS: { id: OrderView; label: string }[] = [
  { id: 'active', label: 'Active orders' }, { id: 'overdue', label: 'Overdue' },
  { id: 'unpaid', label: 'Unpaid balances' }, { id: 'delivered_unpaid', label: 'Delivered / unpaid' }, { id: 'credit', label: 'Customer credits' },
];
export function StaffDashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [orders, setOrders] = useState<BespokeJobOrder[]>([]);
  const [summary,setSummary]=useState<WorkshopSummary|null>(null);
  const [search,setSearch]=useState(''); const [searchTerm,setSearchTerm]=useState('');
  const [page,setPage]=useState(0); const [receiptPage,setReceiptPage]=useState(0);
  const [orderTotal,setOrderTotal]=useState(0); const [receiptTotal,setReceiptTotal]=useState(0);
  const [receipts,setReceipts]=useState<Awaited<ReturnType<typeof fetchReceiptPage>>['records']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<OrderView>('active');
  const [selected,setSelected]=useState<BespokeJobOrder|null>(null);
  const selectedId=selected?.id;
  useEffect(()=>{const timer=setTimeout(()=>{setSearchTerm(search);setPage(0);},250);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>subscribeToOrderChanges(()=>setRefresh(v=>v+1)),[]);
  useEffect(()=>{const refreshOnFocus=()=>setRefresh(v=>v+1);window.addEventListener('focus',refreshOnFocus);window.addEventListener('online',refreshOnFocus);
    return()=>{window.removeEventListener('focus',refreshOnFocus);window.removeEventListener('online',refreshOnFocus);};},[]);
  useEffect(()=>{let active=true;setLoading(true);
    Promise.all([fetchWorkshopSummary(),fetchOrderPage(view,searchTerm,page),isAdmin ? fetchReceiptPage(receiptPage) : Promise.resolve({records:[],total:0})])
      .then(([stats,result,ledger])=>{if(!active)return;setSummary(stats);setOrders(result.orders);setOrderTotal(result.total);setReceipts(ledger.records);setReceiptTotal(ledger.total);setError(null);
        if(page>0 && page*25>=result.total)setPage(Math.max(0,Math.ceil(result.total/25)-1));
        if(receiptPage>0 && receiptPage*25>=ledger.total)setReceiptPage(Math.max(0,Math.ceil(ledger.total/25)-1));})
      .catch(err=>{if(active)setError(err instanceof Error ? err.message : 'Could not load workshop records.');})
      .finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[refresh,view,searchTerm,page,receiptPage,isAdmin]);
  useEffect(()=>{if(!selectedId)return;let active=true;
    fetchOrder(selectedId).then(fresh=>{if(active)setSelected(fresh);}).catch(()=>{if(active)setError('Could not refresh the open order. Reload it before recording changes.');});
    return()=>{active=false;};
  },[refresh,selectedId]);
  async function openOrder(id:string) {try{setSelected(await fetchOrder(id));}catch(err){setError(err instanceof Error ? err.message : 'Could not load the order.');}}
  const stages=['pending','cutting','fitting','finishing','ready','delivered'] as const;
  const stageLabels=['Received','Cutting','Fitting','Finishing','Ready','Delivered'];
  const counts=stages.map((stage,index)=>({stage,label:stageLabels[index],count:summary?.statuses[stage] || 0}));
  const total=counts.reduce((sum,item)=>sum+item.count,0);
  const visible=orders;
  if (loading && !summary) return <p className="p-16 text-center text-sm text-gray-500">Loading atelier dashboard…</p>;
  return <div className="max-w-6xl mx-auto space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-3xl font-display font-semibold text-charcoal-950">Workshop dashboard</h2>
        <p className="text-sm text-gray-500 mt-2">{isAdmin ? 'Production, receipts and customer balances across the atelier.' : 'Your assigned orders and the atelier SMS queue.'}</p></div>
      <button onClick={() => setRefresh((value) => value + 1)} className="rounded-xl px-4 py-2 bg-white border text-xs font-semibold">Refresh workshop</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">Could not refresh workshop records. Displayed records may be out of date. {error}</p>}
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : ''} gap-4`}>
      <StatTile icon={<Package size={20} />} label="Active orders" value={String(summary?.views.active || 0)} />
      {isAdmin && <>
        <StatTile icon={<Users size={20} />} label="New customers" value={String(summary?.newCustomers || 0)} badge="This month" />
        <StatTile icon={<TrendingUp size={20} />} label="Net receipts" value={formatGhs(Number(summary?.receipts || 0))} badge="This month · receipt dates" />
        <StatTile icon={<Wallet size={20} />} label="Outstanding" value={formatGhs(Number(summary?.outstanding || 0))} badge="Includes delivered / unpaid" />
      </>}
    </div>
    {total > 0 && <div className="glass rounded-2xl p-5 flex flex-wrap justify-center gap-5">{counts.map((item, index) =>
      <ProgressBadge key={item.stage} label={item.label} percentage={item.count / total * 100} variant={index % 2 ? 'charcoal' : 'mustard'} />)}</div>}
    <section className="glass rounded-2xl p-5 space-y-4 border border-gray-200">
      <h3 className="text-lg font-semibold font-display">Orders needing attention</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Order view">{VIEWS.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id}
        onClick={() => {setView(item.id);setPage(0);}} className={`px-3 py-2 rounded-lg text-xs font-semibold border ${view === item.id ? 'bg-charcoal-950 text-white' : 'bg-white'}`}>
        {item.label} ({summary?.views[item.id] || 0})</button>)}</div>
      <label className="text-xs block">Search orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer, phone, garment or order ID" className="block mt-1 w-full border rounded-lg p-2 text-sm"/></label>
      {loading && <p className="text-xs text-gray-500">Refreshing records…</p>}
      {!visible.length ? <p className="text-sm text-gray-500">No orders in this view.</p> : <div className="overflow-x-auto">
        <table className="w-full text-sm text-left"><thead className="text-xs text-gray-500"><tr>
          <th scope="col" className="py-3 pr-3">Customer / garment</th><th scope="col" className="py-3 pr-3">Due date</th>
          <th scope="col" className="py-3 pr-3">Stage</th><th scope="col" className="py-3">Balance / credit</th>
        </tr></thead><tbody>{visible.map((order) => <tr key={order.id} className="border-t border-gray-200">
          <td className="py-3 pr-3"><button className="text-left underline decoration-gray-300 font-semibold" onClick={() => void openOrder(order.id)}>{order.clientName}</button>
            <p className="text-xs text-gray-500 mt-1">{order.garmentTitle}</p></td>
          <td className="py-3 pr-3 whitespace-nowrap">{order.dueDate || 'Not set'}</td><td className="py-3 pr-3 capitalize">{order.stage}</td>
          <td className="py-3 whitespace-nowrap">{orderBalance(order).credit ? `${formatGhs(orderBalance(order).credit)} credit` : `${formatGhs(orderBalance(order).due)} due`}</td>
        </tr>)}</tbody></table>
      </div>}
      <PageControls page={page} total={orderTotal} onChange={setPage} label="Orders"/>
    </section>
    {!!summary?.fittings?.length && <section className="glass rounded-2xl p-5 space-y-3"><h3 className="text-lg font-semibold font-display">Upcoming fittings</h3><p className="text-xs text-gray-500">Next 10 scheduled appointments · Ghana time</p>{summary.fittings.map(f=><p key={f.id} className="text-sm"><button className="underline" onClick={()=>void openOrder(f.order_id)}>{f.client_name} · {f.garment_title}</button> · {ghanaTime(f.starts_at)} · {f.duration_minutes} minutes</p>)}</section>}
    <section className="glass rounded-2xl p-5 border border-gray-200"><OrderSmsHistory key={refresh} stage={String(refresh)} /></section>
    {isAdmin && <section className="glass rounded-2xl p-5 space-y-4 border border-gray-200">
      <h3 className="font-semibold text-lg font-display">This month's receipt ledger</h3>
      <p className="text-xs text-gray-500">Net receipts use payment dates in Ghana, including corrections on the original receipt date. Imported opening balances are excluded because their receipt dates are unknown.</p>
      {!receipts.length ? <p className="text-sm text-gray-500">No dated receipt entries this month.</p> : <div className="overflow-x-auto">
        <table className="w-full text-sm text-left"><thead className="text-xs text-gray-500"><tr>
          <th scope="col" className="py-2 pr-3">Date</th><th scope="col" className="py-2 pr-3">Customer</th>
          <th scope="col" className="py-2 pr-3">Method / entry</th><th scope="col" className="py-2">Amount</th>
        </tr></thead><tbody>{receipts.map((entry) => <tr key={entry.id} className="border-t border-gray-200">
          <td className="py-3 pr-3 whitespace-nowrap">{entry.occurredOn}</td><td className="py-3 pr-3"><button onClick={() => void openOrder(entry.orderId)} className="underline">{entry.clientName || entry.orderId}</button></td>
          <td className="py-3 pr-3 text-xs">{entry.method}{entry.kind === 'reversal' && ' · Correction'}</td><td className="py-3 whitespace-nowrap">{formatGhs(entry.amount)}</td>
        </tr>)}</tbody></table>
      </div>}
      <PageControls page={receiptPage} total={receiptTotal} onChange={setReceiptPage} label="Receipts"/>
      <p className="text-xs text-gray-500">Imported opening balances: {formatGhs(Number(summary?.opening || 0))} before any corrections.</p>
    </section>}
    {isAdmin && <section className="glass rounded-2xl p-5 space-y-3 border border-gray-200"><h3 className="font-semibold text-lg font-display">Tailor workload</h3>
      {(summary?.loads || []).map((tailor) => <p className="text-sm flex justify-between" key={tailor.assigned_tailor_id || tailor.name}><span>{tailor.name}</span><span>{tailor.active} active · {tailor.delivered} delivered</span></p>)}
    </section>}
    <DigitalJobCard order={selected} isOpen={!!selected} onClose={() => setSelected(null)}
      onOrderUpdated={(updated) => {setSelected(updated);setRefresh(v=>v+1);}} />
  </div>;
}
export default StaffDashboard;
