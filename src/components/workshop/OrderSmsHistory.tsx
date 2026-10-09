import { useEffect, useState } from 'react';
import { canRecordManualSms, fetchManualSms, recordManualSms } from '../../lib/manualSms';
import type { ManualSms } from '../../lib/manualSms';
import { useAuth } from '../../lib/auth';
import { workshopOperation } from '../../lib/workshopOperations';
const STATUS_LABELS: Record<string, string> = { pending: 'SMS to send', failed: 'SMS to send', sending: 'Needs submission review',
  sent_manually: 'Sent manually', superseded: 'Outdated update', submitted: 'Provider submission needs review', reviewed_submitted: 'Verified provider submission' };

export function OrderSmsHistory({ orderId, stage, onRecorded }: { orderId?: string; stage?: string; onRecorded?: () => void }) {
  const { profile } = useAuth();
  const [reviewId,setReviewId] = useState<string | null>(null);
  const [resolution,setResolution] = useState('confirmed_submitted');
  const [evidence,setEvidence] = useState('');
  const [notifications, setNotifications] = useState<ManualSms[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchManualSms(orderId).then((records) => {
      if (active) { setNotifications(records); setError(null); }
    }).catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, stage, revision]);
  async function markSent(id: string) {
    setBusy(id); setError(null);
    try {
      await recordManualSms(id);
      setMessage('Manual send recorded.'); setRevision((value) => value + 1); onRecorded?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not record the SMS.'); }
    finally { setBusy(null); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMessage('Copied. Send it using your phone, then record the send below.'); }
    catch { setError('Could not copy. Select and copy the message text.'); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-base font-display">{orderId ? 'Progress SMS records' : 'SMS to send'}</h3>
      <button type="button" onClick={() => setRevision((value) => value + 1)} className="text-xs underline">Refresh SMS records</button>
    </div>
    <p className="text-xs text-gray-500">Send messages using your phone. Mark them sent only after you have sent the SMS. No messages are sent automatically.</p>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {message && <p role="status" className="text-xs text-emerald-800">{message}</p>}
    {loading ? <p className="text-xs text-gray-500">Loading SMS records…</p> : !error && !notifications.length && <p className="text-xs text-gray-500">{orderId ? 'No progress SMS records yet.' : 'No outstanding progress SMS.'}</p>}
    {notifications.map((notice) => <div key={notice.id} className="glass rounded-xl p-4 space-y-3 border border-gray-200">
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <span className="font-semibold">{STATUS_LABELS[notice.status] || notice.status} · {notice.stage}</span>
        <time>{new Date(notice.created_at).toLocaleString()}</time>
      </div>
      {!orderId && <p className="text-xs font-medium break-words">{notice.orders.client_name} · {notice.orders.garment_title} · {notice.order_id}</p>}
      <p className="text-sm font-mono">{notice.recipient}</p>
      <p className="text-sm text-gray-700 select-text break-words">{notice.content}</p>
      {notice.sent_at && <p className="text-xs text-emerald-800">Recorded by {notice.staff?.full_name || 'Staff'} · {new Date(notice.sent_at).toLocaleString()}</p>}
      {notice.reviewed_at && <p className="text-xs text-gray-600">Reviewed by {notice.reviewer?.full_name || 'Admin'} · {new Date(notice.reviewed_at).toLocaleString()} · {notice.review_notes}</p>}
      {notice.status === 'sending' && <p className="text-xs text-amber-800">Check the previous provider report before sending again; the earlier submission is unconfirmed.</p>}
      {profile?.role === 'admin' && ['sending','submitted'].includes(notice.status) && (reviewId === notice.id ? <form className="space-y-2" onSubmit={async event=>{
        event.preventDefault();setBusy(notice.id);setError(null);
        try {await workshopOperation('review_sms',{p_id:notice.id,p_expected_status:notice.status,p_resolution:resolution,p_notes:evidence});setReviewId(null);setEvidence('');setRevision(v=>v+1);setMessage('Submission review recorded.');}
        catch(err){setError(err instanceof Error ? err.message : 'Could not confirm the review.');}finally{setBusy(null);}
      }}><label className="text-xs block">Verified result<select value={resolution} onChange={e=>setResolution(e.target.value)} className="block border rounded-lg p-2 w-full"><option value="confirmed_submitted">Provider report confirms submission — close review</option><option value="confirmed_not_sent">Verified never submitted — allow current update to be sent manually</option></select></label>
        <label className="text-xs block">Supporting evidence / report reference<textarea required value={evidence} onChange={e=>setEvidence(e.target.value)} className="block border rounded-lg p-2 w-full"/></label>
        <button disabled={loading || busy !== null} className="text-xs px-3 py-2 rounded-lg bg-charcoal-950 text-white">Save verified review</button><button type="button" disabled={busy !== null} onClick={()=>setReviewId(null)} className="text-xs ml-3 underline">Cancel review</button>
      </form> : <button type="button" onClick={()=>{setReviewId(notice.id);setEvidence('');setResolution('confirmed_submitted');}} className="text-xs underline">Review previous submission</button>)}
      {canRecordManualSms(notice) && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => copy(notice.recipient)} className="rounded-lg px-3 py-2 border text-xs">Copy phone</button>
        <button type="button" onClick={() => copy(notice.content)} className="rounded-lg px-3 py-2 border text-xs">Copy message</button>
        <button type="button" disabled={loading || busy !== null} onClick={() => markSent(notice.id)}
          className="rounded-lg px-3 py-2 bg-charcoal-950 text-white text-xs font-semibold disabled:opacity-50">
          {busy === notice.id ? 'Saving…' : 'I sent this SMS'}
        </button>
      </div>}
    </div>)}
  </div>;
}
