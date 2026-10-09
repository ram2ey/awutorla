import { useEffect, useRef, useState } from 'react';
import { Receipt } from 'lucide-react';
import type { BespokeJobOrder } from '../../types/workshop.types';
import { fetchOrder } from '../../lib/orders';
import { recordPayment, PAYMENT_METHODS } from '../../lib/payments';
import { formatGhs, orderBalance, todayGhana } from '../../lib/money';
import { saveOfflineJobCard } from '../../lib/offlineStore';
import { Modal } from '../ui/Modal';

interface Props { order: BespokeJobOrder | null; isOpen: boolean; onClose: () => void; onPaymentRecorded: (order: BespokeJobOrder) => void }
export function RecordPaymentModal({ order, isOpen, onClose, onPaymentRecorded }: Props) {
  const [current, setCurrent] = useState<BespokeJobOrder | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [date, setDate] = useState(todayGhana());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [allowCredit, setAllowCredit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BespokeJobOrder | null>(null);
  const submission = useRef('');
  const id = order?.id;
  useEffect(() => {
    if (!isOpen || !id) return;
    let active = true;
    setLoading(true); setError(null); setSaved(null); setCurrent(null); setBusy(false);
    setMethod(PAYMENT_METHODS[0]); setDate(todayGhana()); setReference(''); setNotes(''); setAllowCredit(false);
    submission.current = crypto.randomUUID();
    fetchOrder(id).then((fresh) => {
      if (active) { setCurrent(fresh); setAmount(orderBalance(fresh).due.toFixed(2)); }
    }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isOpen]);
  if (!isOpen || !order) return null;
  const balance = current ? orderBalance(current) : { due: 0, credit: 0 };
  const proposed = current ? orderBalance({ totalAmount: current.totalAmount, depositPaid: current.depositPaid + Number(amount || 0) }) : balance;
  const inputClass = 'w-full rounded-xl border border-gray-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-mustard-400';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current || busy) return;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Enter a positive payment amount.'); return; }
    setBusy(true); setError(null);
    try {
      const confirmed = await recordPayment(current, { submissionKey: submission.current, amount: Number(amount), method,
        date, reference: reference.trim(), notes: notes.trim(), allowCredit });
      saveOfflineJobCard(confirmed); setSaved(confirmed); setCurrent(confirmed); onPaymentRecorded(confirmed);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not confirm this payment. Review the ledger before recording another.'); }
    finally { setBusy(false); }
  }
  return <Modal isOpen={isOpen} onClose={onClose} title="Record payment" subtitle={order.clientName}
    icon={<Receipt size={18} />} maxWidth="max-w-xl">
    <div className="p-6 space-y-4">
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="text-sm">Loading current ledger…</p> : saved ? <div className="space-y-4" role="status">
        <h3 className="font-semibold text-emerald-800">Payment recorded</h3>
        <p className="text-sm">{formatGhs(Number(amount))} · {method} · {date}</p>
        <p className="text-sm font-semibold">{orderBalance(saved).credit ? `Customer credit: ${formatGhs(orderBalance(saved).credit)}` : `Balance due: ${formatGhs(orderBalance(saved).due)}`}</p>
        <button onClick={onClose} className="rounded-xl bg-charcoal-950 text-white px-5 py-3 text-sm">Close</button>
      </div> : current && <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-xs rounded-xl bg-mustard-50 p-4">
          <div>Total<p className="font-semibold mt-1">{formatGhs(current.totalAmount)}</p></div>
          <div>Paid<p className="font-semibold mt-1">{formatGhs(current.depositPaid)}</p></div>
          <div>{balance.credit ? 'Credit' : 'Due'}<p className="font-semibold mt-1">{formatGhs(balance.credit || balance.due)}</p></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-xs font-semibold space-y-1" htmlFor="payment-amount">Amount received (GHS)
            <input id="payment-amount" type="number" required min="0.01" step="0.01" value={amount} disabled={busy}
              onChange={(event) => setAmount(event.target.value)} className={inputClass} /></label>
          <label className="text-xs font-semibold space-y-1" htmlFor="payment-date">Receipt date (Ghana)
            <input id="payment-date" type="date" required max={todayGhana()} value={date} disabled={busy}
              onChange={(event) => setDate(event.target.value)} className={inputClass} /></label>
        </div>
        <div className="space-y-1"><label className="block text-xs font-semibold" htmlFor="payment-method">Payment method</label>
          <select id="payment-method" value={method} disabled={busy} onChange={(event) => setMethod(event.target.value)} className={inputClass}>
            {PAYMENT_METHODS.map((item) => <option key={item}>{item}</option>)}
          </select></div>
        <label className="block text-xs font-semibold space-y-1" htmlFor="payment-reference">Receipt / transaction reference
          <input id="payment-reference" value={reference} disabled={busy} onChange={(event) => setReference(event.target.value)} className={inputClass} /></label>
        <label className="block text-xs font-semibold space-y-1" htmlFor="payment-notes">Notes
          <textarea id="payment-notes" rows={2} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} className={inputClass} /></label>
        <p className="text-sm">After recording: {proposed.credit ? `customer credit ${formatGhs(proposed.credit)}` : `balance due ${formatGhs(proposed.due)}`}</p>
        {proposed.credit > 0 && <label className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 text-sm">
          <input type="checkbox" checked={allowCredit} required disabled={busy} onChange={(event) => setAllowCredit(event.target.checked)} className="mt-1" />
          I confirm the excess payment should be recorded as customer credit.
        </label>}
        <button disabled={busy} className="w-full rounded-xl bg-charcoal-950 text-white p-3 text-sm font-semibold disabled:opacity-50">{busy ? 'Recording…' : 'Record payment'}</button>
      </form>}
    </div>
  </Modal>;
}
