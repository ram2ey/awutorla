import { useRef, useState } from 'react';
import type { BespokeJobOrder } from '../../types/workshop.types';
import { formatGhs } from '../../lib/money';
import { reversePayment } from '../../lib/payments';
import { saveOfflineJobCard } from '../../lib/offlineStore';
import { useAuth } from '../../lib/auth';

export function PaymentLedger({ order, onUpdated }: { order: BespokeJobOrder; onUpdated: (order: BespokeJobOrder) => void }) {
  const { profile } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef('');
  const entries = order.payments || [];
  const reversed = new Set(entries.map((entry) => entry.reversesPaymentId).filter(Boolean));
  async function correct(event: React.FormEvent) {
    event.preventDefault(); if (!selected || busy) return;
    setBusy(true); setError(null);
    try {
      const updated = await reversePayment(order, selected, key.current, reason.trim());
      saveOfflineJobCard(updated); onUpdated(updated); setSelected(null); setReason('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reverse this record.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <h3 className="text-base font-semibold font-display">Payment ledger</h3>
    <p className="text-xs text-gray-500">For incorrect entries, an admin can reverse the record and enter a replacement. The original remains visible. Imported opening balances have unknown receipt dates.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {!entries.length && <p className="text-sm text-gray-500">No payments recorded.</p>}
    <div className="space-y-3">{entries.map((entry) => <div key={entry.id} className="glass border rounded-xl p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm font-semibold">
        <span>{entry.kind === 'opening_balance' ? 'Opening balance' : entry.kind === 'reversal' ? 'Correction / reversal' : 'Payment received'}{reversed.has(entry.id) && ' · Reversed'}</span>
        <span>{formatGhs(entry.amount)}</span>
      </div>
      <p className="text-xs text-gray-600">{entry.occurredOn || 'Receipt date unknown'} · {entry.method} · {entry.recordedByName}</p>
      {entry.reference && <p className="text-xs">Reference: {entry.reference}</p>}
      {entry.notes && <p className="text-xs text-gray-600">{entry.notes}</p>}
      <p className="text-xs text-gray-500">Recorded {new Date(entry.recordedAt).toLocaleString()}</p>
      {profile?.role === 'admin' && entry.kind !== 'reversal' && !reversed.has(entry.id) && <button type="button" disabled={busy}
        onClick={() => { setSelected(entry.id); setReason(''); setError(null); key.current = crypto.randomUUID(); }}
        className="text-xs underline text-rose-700">Reverse incorrect record</button>}
    </div>)}</div>
    {selected && <form onSubmit={correct} className="rounded-xl bg-rose-50 border border-rose-200 p-4 space-y-3">
      <label htmlFor="reversal-reason" className="block text-sm font-semibold">Reason for reversing this record</label>
      <textarea id="reversal-reason" value={reason} onChange={(event) => setReason(event.target.value)} required disabled={busy}
        className="w-full rounded-xl border p-3 text-sm" />
      <p className="text-xs">This correction uses the original receipt date. Record any replacement payment separately.</p>
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-lg bg-rose-700 text-white px-4 py-2 text-xs">{busy ? 'Saving…' : 'Confirm reversal'}</button>
        <button type="button" disabled={busy} onClick={() => setSelected(null)} className="px-4 py-2 text-xs">Cancel</button>
      </div>
    </form>}
  </div>;
}
