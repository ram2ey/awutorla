import { useEffect, useState } from 'react';
import { getMeasurementDrafts,getAllOfflineJobCards,removeMeasurementDraft,cacheClientMeasurements,isOnline,listenNetworkStatus } from '../../lib/offlineStore';
import { workshopOperation } from '../../lib/workshopOperations';
import { api } from '../../lib/api';
import { formatGhs,orderBalance } from '../../lib/money';
export function OfflineWorkspace() {
  const [online,setOnline]=useState(isOnline);const [revision,setRevision]=useState(0);
  const [error,setError]=useState('');const [busy,setBusy]=useState<string|null>(null);
  const [conflict,setConflict]=useState<{id:string;revision:number;unit:string;values:Record<string,number>}|null>(null);
  const drafts=getMeasurementDrafts();const cards=getAllOfflineJobCards();
  useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener('workshop-drafts-changed',refresh);const stop=listenNetworkStatus(setOnline);
    return()=>{window.removeEventListener('workshop-drafts-changed',refresh);stop();};},[]);
  async function sync(id:string) {
    const draft=drafts.find(entry=>entry.id===id);if(!draft)return;setBusy(id);setError('');setConflict(null);
    try {
      const confirmed=await workshopOperation('save_measurement_draft',{p_id:draft.id,p_client_id:draft.clientId,p_expected_revision:draft.expectedRevision,p_unit:draft.unit,p_values:draft.values,p_notes:draft.notes});
      cacheClientMeasurements(draft.clientId,confirmed);removeMeasurementDraft(id);
    } catch(err) {
      setError(err instanceof Error ? err.message : 'Draft was not confirmed.');
      try {
        const [header,values]=await Promise.all([api.from('client_measurements').select('revision,unit').eq('client_id',draft.clientId).maybeSingle(),api.from('client_measurement_values').select('value,measurement_parameters(key)').eq('client_id',draft.clientId)]);
        if(!header.error && !values.error && header.data)setConflict({id,revision:Number((header.data as any).revision),unit:(header.data as any).unit,values:Object.fromEntries((values.data as any[]).map(row=>[row.measurement_parameters?.key,Number(row.value)]).filter(([key])=>key))});
      } catch { /* Retain the draft when the latest version cannot be read. */ }
    } finally{setBusy(null);setRevision(v=>v+1);}
  }
  if(online && !drafts.length)return null;
  return <section className="border rounded-xl bg-mustard-50 p-4 mb-6 space-y-3" data-revision={revision}>
    <h2 className="font-semibold">{online ? 'Measurement drafts awaiting sync' : 'Offline workshop'}</h2>
    <p className="text-xs">Cached job cards are for reading. Measurement drafts sync only when you choose; newer server measurements cannot be overwritten. Payments and SMS require an online confirmation.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {drafts.map(draft=><details key={draft.id} className="bg-white border rounded-lg p-3"><summary className="text-sm">{draft.clientName} · Draft based on version {draft.expectedRevision}</summary>
      <p className="text-xs my-2">{draft.unit} · {draft.notes}</p><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(draft.values,null,2)}</pre>
      {conflict?.id===draft.id && <div className="border-t mt-3 pt-3 text-xs"><p>Current saved version {conflict.revision} ({conflict.unit})</p><pre className="whitespace-pre-wrap">{JSON.stringify(conflict.values,null,2)}</pre><p>Compare these records, reload the customer measurements, then enter the intended changes. Discard this draft after resolving it.</p></div>}
      <div className="flex gap-3 mt-3"><button type="button" disabled={!online || !!busy} onClick={()=>void sync(draft.id)} className="bg-charcoal-950 text-white rounded-lg px-3 py-2 text-xs disabled:opacity-50">{busy===draft.id ? 'Syncing…' : 'Sync measurement draft'}</button>
        <button type="button" disabled={!!busy} onClick={()=>{removeMeasurementDraft(draft.id);setError('');setConflict(null);}} className="text-xs underline">Discard draft</button></div>
    </details>)}
    {!online && <details><summary className="text-sm">Cached job cards ({cards.length})</summary>{cards.map(card=><details key={card.id} className="border-t py-2 text-sm"><summary>{card.clientName} · {card.garmentTitle} · {card.stage}</summary>
      <p className="text-xs">{card.id} · Due {card.dueDate || 'Not set'} · {formatGhs(orderBalance(card).due)} due</p><p className="text-xs">Saved measurements ({card.measurements.unit})</p><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(card.measurements.values,null,2)}</pre>
    </details>)}</details>}
  </section>;
}
