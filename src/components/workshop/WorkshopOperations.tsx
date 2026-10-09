import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { BespokeJobOrder } from '../../types/workshop.types';
import { useAuth } from '../../lib/auth';
import { fetchStaffMembers } from '../../lib/clients';
import type { StaffMember } from '../../lib/clients';
import { fetchOperations, workshopOperation, QUALITY_LABELS, ghanaTime } from '../../lib/workshopOperations';
import type { Fitting, Rework } from '../../lib/workshopOperations';
import { fetchOrder } from '../../lib/orders';
import { saveOfflineJobCard } from '../../lib/offlineStore';
import { formatGhs } from '../../lib/money';

const field = 'w-full bg-white border rounded-lg p-2 text-sm';
const button = 'rounded-lg px-3 py-2 bg-charcoal-950 text-white text-xs font-semibold disabled:opacity-50';
type Records = Awaited<ReturnType<typeof fetchOperations>>;
export function WorkshopOperations({order,onUpdated}: {order:BespokeJobOrder;onUpdated:(order:BespokeJobOrder)=>void}) {
  const { profile } = useAuth(); const admin = profile?.role === 'admin';
  const [records,setRecords]=useState<Records>({fittings:[],rework:[],quality:[],audit:[]});
  const [staff,setStaff]=useState<StaffMember[]>([]);
  const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false);
  const [error,setError]=useState(''); const [message,setMessage]=useState(''); const [refresh,setRefresh]=useState(0);
  const [fitting,setFitting]=useState<Fitting|null>(null); const [fittingId,setFittingId]=useState<string>(()=>crypto.randomUUID());
  const [time,setTime]=useState(''); const [minutes,setMinutes]=useState('60'); const [tailor,setTailor]=useState(order.assignedTailorId || '');
  const [fittingStatus,setFittingStatus]=useState<Fitting['status']>('scheduled'); const [fittingNotes,setFittingNotes]=useState('');
  const [rework,setRework]=useState<Rework|null>(null); const [reworkId,setReworkId]=useState<string>(()=>crypto.randomUUID());
  const [reason,setReason]=useState(''); const [reworkStatus,setReworkStatus]=useState<Rework['status']>('open'); const [outcome,setOutcome]=useState('');
  const [checks,setChecks]=useState<Record<string,boolean>>({}); const [qualityNotes,setQualityNotes]=useState(''); const [qualityId,setQualityId]=useState(()=>crypto.randomUUID());
  const [price,setPrice]=useState(String(order.totalAmount)); const [assignment,setAssignment]=useState(order.assignedTailorId || '');
  const [termsReason,setTermsReason]=useState(''); const [allowCredit,setAllowCredit]=useState(false); const [reopenReason,setReopenReason]=useState('');
  useEffect(()=>{let active=true; setLoading(true);
    Promise.all([fetchOperations(order.id),fetchStaffMembers()]).then(([data,members])=>{if(active){setRecords(data);setStaff(members);setError('');}})
      .catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[order.id,order.workRevision,order.stage,refresh]);
  useEffect(()=>{setPrice(String(order.totalAmount));setAssignment(order.assignedTailorId || '');setAllowCredit(false);},[order.totalAmount,order.assignedTailorId]);
  async function save(name:string,args:Record<string,unknown>,after:()=>void) {
    setBusy(true);setError('');setMessage(''); let committed=false;
    try {
      await workshopOperation(name,args); committed=true;
      const fresh=await fetchOrder(order.id); saveOfflineJobCard(fresh);onUpdated(fresh);
      after();setRefresh(value=>value+1);setMessage('Workshop change confirmed.');
    } catch(err) {setError(committed ? 'The change was saved, but the updated order could not be loaded. Refresh before making another change.' : err instanceof Error ? err.message : 'Could not save.');}
    finally{setBusy(false);}
  }
  function editFitting(entry:Fitting|null) {
    setFitting(entry);setFittingId(entry?.id || crypto.randomUUID());setTime(entry ? new Date(entry.starts_at).toISOString().slice(0,16) : '');setMinutes(String(entry?.duration_minutes || 60));
    setTailor(entry?.tailor_id || order.assignedTailorId || '');setFittingStatus(entry?.status || 'scheduled');setFittingNotes(entry?.notes || '');
  }
  function editRework(entry:Rework|null) {setRework(entry);setReworkId(entry?.id || crypto.randomUUID());setReason(entry?.reason || '');setReworkStatus(entry?.status || 'open');setOutcome(entry?.notes || '');}
  function submitFitting(event:FormEvent) {event.preventDefault();
    // Read the calendar's submitted value, including native picker edits.
    const appointmentTime=String(new FormData(event.currentTarget as HTMLFormElement).get('starts_at') || '');
    if(!appointmentTime){setError('Enter the fitting date and time.');return;}
    void save('save_fitting',{p_order_id:order.id,p_id:fittingId,p_expected_revision:fitting?.revision || 0,
      p_payload:{tailor_id:tailor,starts_at:new Date(`${appointmentTime}Z`).toISOString(),duration_minutes:Number(minutes),status:fittingStatus,notes:fittingNotes}},()=>editFitting(null));
  }
  function submitRework(event:FormEvent) {event.preventDefault();
    void save('save_rework',{p_order_id:order.id,p_id:reworkId,p_expected_revision:rework?.revision || 0,p_payload:{reason,status:reworkStatus,notes:outcome}},()=>editRework(null));
  }
  const currentQuality=records.quality.find(entry=>Number(entry.work_revision)===(order.workRevision || 1));
  const disabled=busy || loading || !!error;
  return <div className="space-y-6">
    <div className="flex justify-between gap-3"><div><h3 className="font-display text-lg font-semibold">Fittings, rework & quality</h3><p className="text-xs text-gray-500">Work version {order.workRevision || 1} · Production cycle {order.productionCycle || 1}</p></div>
      <button type="button" disabled={busy} onClick={()=>{setError('');setRefresh(v=>v+1);}} className="text-xs underline">Refresh operations</button></div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}{message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {loading && <p className="text-sm text-gray-500">Loading workshop records…</p>}
    <fieldset disabled={disabled} className="space-y-6 disabled:opacity-60">
      <section className="border rounded-xl p-4 space-y-3"><h4 className="font-semibold">Fitting appointments</h4><p className="text-xs text-gray-500">All appointment times are Ghana time (GMT). Overlapping bookings for the same staff member are blocked.</p>
        {records.fittings.map(entry=><div key={entry.id} className="border-t pt-3 text-sm"><p>{ghanaTime(entry.starts_at)} · {entry.duration_minutes} minutes · {staff.find(s=>s.id===entry.tailor_id)?.full_name || 'Staff'} · {entry.status}</p><p className="text-xs text-gray-600">{entry.notes}</p>
          {entry.status==='scheduled' && order.stage!=='delivered' && <button type="button" className="text-xs underline" onClick={()=>editFitting(entry)}>Edit / record outcome</button>}</div>)}
        {order.stage!=='delivered' && <form onSubmit={submitFitting} className="space-y-3 border-t pt-3"><p className="text-sm font-semibold">{fitting ? 'Update fitting' : 'Schedule fitting'}</p>
          <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs space-y-1 block">Fitting date and time (Ghana)<input name="starts_at" type="datetime-local" required value={time} onChange={e=>setTime(e.target.value)} className={field}/></label>
            <label className="text-xs space-y-1 block">Duration (minutes)<input type="number" required min="15" max="240" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)} className={field}/></label>
            <label className="text-xs space-y-1 block">Fitting staff<select required value={tailor} onChange={e=>setTailor(e.target.value)} className={field}><option value="">Select staff</option>{staff.map(s=><option key={s.id} value={s.id}>{s.full_name || 'Staff'}</option>)}</select></label>
            <label className="text-xs space-y-1 block">Fitting status<select value={fittingStatus} onChange={e=>setFittingStatus(e.target.value as Fitting['status'])} className={field}><option value="scheduled">Scheduled</option>{fitting && <><option value="completed">Completed</option><option value="missed">Missed</option><option value="cancelled">Cancelled</option></>}</select></label></div>
          <label className="text-xs block">Fitting notes / outcome<textarea required={fittingStatus!=='scheduled'} value={fittingNotes} onChange={e=>setFittingNotes(e.target.value)} className={field}/></label>
          <button className={button}>Save fitting</button>{fitting && <button type="button" onClick={()=>editFitting(null)} className="ml-3 text-xs underline">Cancel edit</button>}
        </form>}
      </section>
      <section className="border rounded-xl p-4 space-y-3"><h4 className="font-semibold">Alterations and rework</h4>
        {records.rework.map(entry=><div key={entry.id} className="border-t pt-3 text-sm"><p>{entry.reason} · {entry.status}</p><p className="text-xs text-gray-600">{entry.notes}</p>{entry.status==='open' && order.stage!=='delivered' && <button type="button" className="text-xs underline" onClick={()=>editRework(entry)}>Record rework outcome</button>}</div>)}
        {order.stage!=='delivered' && <form onSubmit={submitRework} className="space-y-3 border-t pt-3"><p className="text-xs text-gray-500">Opening rework on a Ready order returns it to Finishing and requires a new quality check.</p>
          <label className="text-xs block">Rework reason<input required value={reason} onChange={e=>setReason(e.target.value)} className={field}/></label>
          <label className="text-xs block">Rework status<select value={reworkStatus} onChange={e=>setReworkStatus(e.target.value as Rework['status'])} className={field}><option value="open">Open</option>{rework && <><option value="completed">Completed</option><option value="cancelled">Cancelled</option></>}</select></label>
          <label className="text-xs block">Rework outcome / notes<textarea required={reworkStatus!=='open'} value={outcome} onChange={e=>setOutcome(e.target.value)} className={field}/></label>
          <button className={button}>Save rework</button>{rework && <button type="button" onClick={()=>editRework(null)} className="ml-3 text-xs underline">Cancel edit</button>}
        </form>}
      </section>
      <section className="border rounded-xl p-4 space-y-3"><h4 className="font-semibold">Quality before collection</h4>
        <p className={`text-sm ${currentQuality ? 'text-emerald-800' : 'text-amber-800'}`}>{currentQuality ? `Passed for the current work version · ${ghanaTime(currentQuality.checked_at)}` : 'No passing check for the current work version.'}</p>
        <p className="text-xs text-gray-500">Complete all tasks and resolve fittings/rework first. Changes to production work or measurements require another check.</p>
        {['finishing','ready'].includes(order.stage) && <form className="space-y-3" onSubmit={e=>{e.preventDefault();void save('record_quality_check',{p_order_id:order.id,p_id:qualityId,p_expected_work_revision:order.workRevision || 1,p_checks:checks,p_notes:qualityNotes},()=>{setQualityId(crypto.randomUUID());setChecks({});setQualityNotes('');});}}>
          {Object.entries(QUALITY_LABELS).map(([key,label])=><label key={key} className="flex gap-2 text-sm"><input type="checkbox" required checked={!!checks[key]} onChange={e=>setChecks(prev=>({...prev,[key]:e.target.checked}))}/>{label}</label>)}
          <label className="text-xs block">Quality notes<textarea value={qualityNotes} onChange={e=>setQualityNotes(e.target.value)} className={field}/></label><button className={button}>Record passing quality check</button>
        </form>}
        {records.quality.length>0 && <details><summary className="text-xs cursor-pointer">Previous quality checks ({records.quality.length})</summary>{records.quality.map(q=><p key={q.id} className="text-xs mt-2">Version {q.work_revision} · {ghanaTime(q.checked_at)} · {staff.find(s=>s.id===q.checked_by)?.full_name || 'Staff'} · {q.notes}</p>)}</details>}
      </section>
      {admin && order.stage!=='delivered' && <form className="border rounded-xl p-4 space-y-3" onSubmit={e=>{e.preventDefault();void save('update_order_terms',{p_order_id:order.id,p_expected_updated_at:order.updatedAt,p_total:Number(price),p_tailor_id:assignment,p_reason:termsReason,p_allow_credit:allowCredit},()=>setTermsReason(''));}}>
        <h4 className="font-semibold">Order price and assignment</h4><label className="text-xs block">Order price (GHS)<input type="number" min="0" step="0.01" required value={price} onChange={e=>setPrice(e.target.value)} className={field}/></label>
        <label className="text-xs block">Assigned artisan<select required value={assignment} onChange={e=>setAssignment(e.target.value)} className={field}><option value="">Select staff</option>{staff.map(s=><option key={s.id} value={s.id}>{s.full_name || 'Staff'}</option>)}</select></label>
        <label className="text-xs block">Reason for terms change<textarea required value={termsReason} onChange={e=>setTermsReason(e.target.value)} className={field}/></label>
        {Number(price)<order.depositPaid && <label className="flex gap-2 text-sm"><input type="checkbox" required checked={allowCredit} onChange={e=>setAllowCredit(e.target.checked)}/>Record {formatGhs(order.depositPaid-Number(price))} as customer credit.</label>}
        <button className={button}>Save audited terms</button>
      </form>}
      {admin && ['ready','delivered'].includes(order.stage) && <form className="border rounded-xl p-4 space-y-3" onSubmit={e=>{e.preventDefault();void save('reopen_order',{p_order_id:order.id,p_expected_stage:order.stage,p_reason:reopenReason},()=>setReopenReason(''));}}>
        <h4 className="font-semibold">Reopen for alterations</h4><p className="text-xs text-gray-500">Returns this order to Finishing. Payment records and the original specification are retained; a fresh quality check is required.</p>
        <label className="text-xs block">Reopening reason<textarea required value={reopenReason} onChange={e=>setReopenReason(e.target.value)} className={field}/></label><button className={button}>Reopen order</button>
      </form>}
    </fieldset>
    <section className="border rounded-xl p-4 space-y-3"><h4 className="font-semibold">Order audit trail</h4>
      {!records.audit.length && <p className="text-xs text-gray-500">No audit events recorded since the operations migration.</p>}
      {[...records.audit].sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at)).map(entry=><details key={entry.id} className="border-t pt-2 text-xs"><summary>{entry.event} · {entry.actor_name} · {ghanaTime(entry.recorded_at)}</summary>
        <pre className="whitespace-pre-wrap break-words mt-2 text-gray-600">{JSON.stringify(entry.details,null,2)}</pre></details>)}
    </section>
  </div>;
}
