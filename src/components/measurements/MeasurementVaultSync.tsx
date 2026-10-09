import { useEffect, useRef, useState } from 'react';
import type { ClientBodyMeasurements, MeasurementParameter } from '../../types/workshop.types';
import { supabase } from '../../lib/supabase';
import { fetchMeasurementParameters } from '../../lib/measurementParameters';
import { cacheClientMeasurements, getOfflineMeasurements, getMeasurementDrafts, isOnline, saveMeasurementDraft } from '../../lib/offlineStore';

export function MeasurementVaultSync({ targetClientId }: { targetClientId: string }) {
  const [parameters, setParameters] = useState<MeasurementParameter[]>([]);
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  const [values, setValues] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [clientName, setClientName] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [draftSaved,setDraftSaved]=useState(false);
  const submission=useRef<{id:string;request:string}|null>(null);
  useEffect(()=>{
    const changed=()=>setDraftSaved(getMeasurementDrafts().some(draft=>draft.clientId===targetClientId));changed();
    window.addEventListener('workshop-drafts-changed',changed);
    return()=>window.removeEventListener('workshop-drafts-changed',changed);
  },[targetClientId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setLoadFailed(false); setSuccess(false);
    async function load() {
      try {
        const [params, header, measurements, customer] = await Promise.all([
          fetchMeasurementParameters(),
          supabase.from('client_measurements').select('*').eq('client_id', targetClientId).maybeSingle(),
          supabase.from('client_measurement_values').select('value, measurement_parameters(key)').eq('client_id', targetClientId),
          supabase.from('clients').select('full_name, phone_number').eq('id', targetClientId).maybeSingle(),
        ]);
        if (header.error) throw header.error;
        if (measurements.error) throw measurements.error;
        if (customer.error) throw customer.error;
        if (!customer.data) throw new Error('Customer record is unavailable.');
        if (!active) return;
        const record = header.data as any;
        setParameters(params); setUnit(record?.unit === 'cm' ? 'cm' : 'in'); setRevision(Number(record?.revision || 0));
        setNotes(record?.notes || ''); setClientName((customer.data as any).full_name || 'Customer');
        const next: Record<string, number> = {};
        for (const row of (measurements.data || []) as any[]) if (row.measurement_parameters?.key) next[row.measurement_parameters.key] = Number(row.value);
        setValues(next);
        cacheClientMeasurements(targetClientId,{clientId:targetClientId,clientName:(customer.data as any).full_name,clientPhone:(customer.data as any).phone_number,
          unit:record?.unit || 'in',values:next,notes:record?.notes || '',revision:Number(record?.revision || 0),updatedAt:record?.updated_at || new Date().toISOString(),labels:Object.fromEntries(params.map(p=>[p.key,p.label]))});
      } catch (err) { if (active) {
        const cached=!isOnline() ? getOfflineMeasurements(targetClientId) : null;
        if(cached?.labels){setUnit(cached.unit);setValues(cached.values);setNotes(cached.notes || '');setRevision(cached.revision || 0);setClientName(cached.clientName);setParameters(Object.entries(cached.labels).map(([key,label],index)=>({id:key,key,label,isActive:true,displayOrder:index})));setError('Offline: showing cached measurements. Save changes as a draft for review when online.');}
        else {setLoadFailed(true);setError(err instanceof Error ? err.message : 'Could not load measurements. Reload before editing.');}
      } }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, [targetClientId, reload]);
  function changeUnit(next: 'in' | 'cm') {
    if (next === unit) return;
    const factor = next === 'cm' ? 2.54 : 1 / 2.54;
    setValues((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, Number((value * factor).toFixed(2))])));
    setUnit(next); setSuccess(false);
  }
  async function save(event: React.FormEvent, retainDraft=false) {
    event.preventDefault(); if (loadFailed || busy) return;
    const activeValues = Object.fromEntries(Object.entries(values).filter(([key]) => parameters.some((parameter) => parameter.key === key)));
    if (Object.values(activeValues).some((value) => !Number.isFinite(value) || value <= 0)) { setError('Use positive measurements. Leave a field blank to remove it.'); return; }
    setBusy(true); setSuccess(false); setError(null);
    try {
      const args={p_client_id:targetClientId,p_expected_revision:revision,p_unit:unit,p_values:activeValues,p_notes:notes.trim()};
      const request=JSON.stringify(args);if(submission.current?.request!==request)submission.current={id:crypto.randomUUID(),request};
      if(retainDraft || !isOnline()){saveMeasurementDraft({id:submission.current.id,clientId:targetClientId,clientName,expectedRevision:revision,unit,values:activeValues,notes:notes.trim(),createdAt:new Date().toISOString()});setDraftSaved(true);return;}
      const { data, error: saveError } = await (supabase as any).rpc('save_measurement_draft', {p_id:submission.current.id,...args});
      if (saveError) throw new Error(saveError.message || 'Could not confirm the save. Reload before trying again.');
      const confirmed = data as ClientBodyMeasurements;
      cacheClientMeasurements(targetClientId, {...confirmed,labels:Object.fromEntries(parameters.map(parameter=>[parameter.key,parameter.label]))}); setRevision(Number(confirmed.revision)); setValues(confirmed.values);
      setUnit(confirmed.unit); setNotes(confirmed.notes || ''); setSuccess(true);setDraftSaved(false);submission.current=null;
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save measurements.'); }
    finally { setBusy(false); }
  }
  const inputClass = 'w-full rounded-xl border border-gray-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-mustard-400';
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3">
      <h3 className="font-semibold text-lg font-display">Customer master measurements</h3>
      <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)} className="text-xs underline">Reload measurements</button>
    </div>
    <p className="text-xs text-gray-500">Changes update the master record. Existing order measurements stay unchanged until staff explicitly apply the latest version. Blank fields remove that measurement.</p>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Measurements saved together. Existing job cards retain their saved specifications.</p>}
    {draftSaved && <p role="status" className="text-sm text-amber-800">Offline draft retained on this staff device. Sync and resolve any version conflict through the draft panel when online.</p>}
    {loading ? <p className="text-sm">Loading measurements…</p> : !loadFailed && <form onSubmit={save} className="space-y-5">
      <p className="text-sm font-medium">{clientName} · Version {revision}</p>
      <fieldset disabled={busy} className="space-y-5">
        <div className="flex gap-2" role="group" aria-label="Measurement unit">{(['in', 'cm'] as const).map((item) =>
          <button type="button" key={item} aria-pressed={unit === item} onClick={() => changeUnit(item)}
            className={`rounded-xl px-4 py-2 text-xs border ${unit === item ? 'bg-charcoal-950 text-white' : 'bg-white'}`}>{item === 'in' ? 'Inches' : 'Centimetres'}</button>)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">{parameters.map((parameter) => <label key={parameter.id} htmlFor={`measurement-${parameter.id}`} className="text-xs font-semibold space-y-1">
          {parameter.label} ({unit})
          <input id={`measurement-${parameter.id}`} type="number" min="0.01" max="9999.99" step="0.01" value={values[parameter.key] ?? ''}
            onChange={(event) => { const raw = event.target.value; setSuccess(false); setValues((current) => {
              const next = { ...current }; if (!raw) delete next[parameter.key]; else next[parameter.key] = Number(raw); return next;
            }); }} className={inputClass} />
        </label>)}</div>
        <label htmlFor="measurement-notes" className="block text-xs font-semibold space-y-1">Fit notes
          <textarea id="measurement-notes" rows={3} value={notes} onChange={(event) => { setNotes(event.target.value); setSuccess(false); }} className={inputClass} /></label>
        <button className="rounded-xl bg-charcoal-950 text-white px-6 py-3 text-sm font-semibold">{busy ? 'Saving…' : isOnline() ? 'Save master measurements' : 'Save offline measurement draft'}</button>
        {isOnline() && <button type="button" onClick={event=>void save(event,true)} className="text-xs underline ml-3">Save draft on this device</button>}
      </fieldset>
    </form>}
  </div>;
}
export default MeasurementVaultSync;
