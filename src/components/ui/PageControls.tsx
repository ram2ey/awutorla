export function PageControls({page,total,onChange,label='Records',size=25}: {page:number;total:number;onChange:(page:number)=>void;label?:string;size?:number}) {
  if(total<=size)return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 text-xs" aria-label={`${label} pagination`}>
    <span>{page*size+1}–{Math.min((page+1)*size,total)} of {total}</span><div className="flex gap-2">
      <button type="button" disabled={page===0} onClick={()=>onChange(page-1)} className="border rounded-lg p-2 disabled:opacity-40" aria-label={`Previous ${label.toLowerCase()} page`}>Previous</button>
      <button type="button" disabled={(page+1)*size>=total} onClick={()=>onChange(page+1)} className="border rounded-lg p-2 disabled:opacity-40" aria-label={`Next ${label.toLowerCase()} page`}>Next</button>
    </div>
  </div>;
}
