import { useState } from 'react';
import { workshopOperation } from '../../lib/workshopOperations';
import { supabase } from '../../lib/supabase';
import { ghanaTime } from '../../lib/workshopOperations';
export function AbandonedUploads() {
  const [files,setFiles]=useState<{path:string;createdAt:string}[]>([]);const [loaded,setLoaded]=useState(false);
  const [confirm,setConfirm]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function load(){setBusy(true);setError('');try{setFiles(await workshopOperation('abandoned_sketches',{}));setLoaded(true);}catch(err){setError(err instanceof Error ? err.message : 'Could not load uploads.');}finally{setBusy(false);}}
  async function remove(path:string){setBusy(true);setError('');try{
    // RLS and a storage-row trigger recheck age and committed references at deletion.
    const {data,error:failed}=await supabase.storage.from('order-sketches').remove([path]);
    if(failed)throw failed;if(!data?.some(file=>file.name===path || file.name===path.split('/').pop()))throw new Error('Deletion was not confirmed. The file may now belong to a saved order. Refresh the list.');
    setConfirm(null);await load();
  }catch(err){setError(err instanceof Error ? err.message : 'Could not delete this upload. Refresh first.');}finally{setBusy(false);}}
  return <div className="space-y-4"><p className="text-sm">Review unused intake images older than 48 hours. Files referenced by saved orders are excluded and protected from deletion.</p>
    <button type="button" disabled={busy} onClick={()=>void load()} className="text-sm underline">{busy ? 'Checking…' : 'Find abandoned uploads'}</button>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}{loaded && !files.length && <p className="text-sm">No abandoned uploads found.</p>}
    {files.map(file=><div key={file.path} className="border rounded-xl p-4 space-y-2"><p className="text-sm break-all">{file.path}</p><p className="text-xs text-gray-500">Uploaded {ghanaTime(file.createdAt)}</p>
      {confirm===file.path ? <div className="space-y-2"><p className="text-sm text-rose-700">Permanently delete this unused image? This cannot be undone.</p><button disabled={busy} onClick={()=>void remove(file.path)} className="text-xs rounded-lg bg-rose-700 text-white p-2">Confirm permanent deletion</button><button disabled={busy} onClick={()=>setConfirm(null)} className="text-xs ml-3 underline">Keep image</button></div>
        : <button disabled={busy} onClick={()=>setConfirm(file.path)} className="text-xs text-rose-700 underline">Review deletion</button>}
    </div>)}
    {files.length===100 && <p className="text-xs text-gray-500">Showing the oldest 100 candidates. Refresh after cleanup to see the next batch.</p>}
  </div>;
}
