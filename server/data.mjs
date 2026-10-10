const readable = new Set(['profiles','clients','orders','order_tasks','payments','client_measurements',
  'client_measurement_values','measurement_parameters','app_settings','sms_notifications',
  'fitting_appointments','order_rework','order_quality_checks','order_audit']);
const writable = {
  profiles: ['role','full_name','phone_number'], orders:['due_date'],
  order_tasks:['id','order_id','tailor_id','tailor_name','title','task_description','status','due_date','completed_at'],
  measurement_parameters:['key','label','display_order','is_active'], app_settings:['key','value','updated_at'],
};
const rpcNames = new Set(['advance_order_stage','record_manual_sms','record_payment','reverse_payment',
  'save_client_measurements','save_measurement_draft','apply_order_measurements','create_bespoke_intake',
  'save_fitting','save_rework','record_quality_check','update_order_terms','reopen_order','review_sms',
  'workshop_summary','workshop_order_page','workshop_receipt_page','workshop_client_page','abandoned_sketches']);
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid query field.');
  return `"${value}"`;
};

export async function staffTransaction(pool, userId, run) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
    await db.query("SET LOCAL statement_timeout='15s'");
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

export async function tableQuery(db, spec) {
  if(!spec || typeof spec!=='object' || Array.isArray(spec))throw new Error('Invalid query.');
  const { table, action='select', filters=[], orders=[], values, selection='', single, count, head } = spec;
  if (!readable.has(table) || typeof selection!=='string' || !Array.isArray(filters) || filters.length>20 || !Array.isArray(orders) || orders.length>5) throw new Error('Unsupported query.');
  const params=[];
  const bind=value=> {params.push(value);return `$${params.length}`;};
  const where=filters.map(({column,op,value})=> {
    const field=`t.${identifier(column)}`;
    if (op==='eq') return value===null ? `${field} IS NULL` : `${field}=${bind(value)}`;
    if (op==='gte') return `${field}>=${bind(value)}`;
    if (op==='in' && Array.isArray(value) && value.length<=200) return value.length ? `${field} IN (${value.map(bind).join(',')})` : 'false';
    throw new Error('Unsupported query filter.');
  });
  const predicate=where.length ? ` WHERE ${where.join(' AND ')}` : '';
  let rows;
  let total=null;
  if (action==='select') {
    if (count) total=Number((await db.query(`SELECT count(*) FROM public.${identifier(table)} t${predicate}`,params)).rows[0].count);
    const offset=Number(spec.offset || 0), limit=Number(spec.limit ?? 1000);
    if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>1000) throw new Error('Invalid query page.');
    let extra='';
    // Only the relationships used by the workshop are supported, with RLS on
    // both the base record and joined table. Selection strings never become SQL.
    if (table==='client_measurement_values' && selection.includes('measurement_parameters'))
      extra+=`, (SELECT jsonb_build_object('key',p.key) FROM public.measurement_parameters p WHERE p.id=t.parameter_id) AS measurement_parameters`;
    if (['payments','sms_notifications'].includes(table) && selection.includes('staff:'))
      extra+=`, (SELECT jsonb_build_object('full_name',p.full_name) FROM public.profiles p WHERE p.id=t.${table==='payments'?'recorded_by':'sent_by'}) AS staff`;
    if (table==='sms_notifications' && selection.includes('reviewer:'))
      extra+=`, (SELECT jsonb_build_object('full_name',p.full_name) FROM public.profiles p WHERE p.id=t.reviewed_by) AS reviewer`;
    if (table==='sms_notifications' && selection.includes('orders!'))
      extra+=`, (SELECT jsonb_build_object('id',o.id,'status',o.status,'client_name',o.client_name,'garment_title',o.garment_title,'production_cycle',o.production_cycle) FROM public.orders o WHERE o.id=t.order_id) AS orders`;
    const sorting=orders.map(({column,ascending})=>`t.${identifier(column)} ${ascending===false?'DESC':'ASC'}`).join(',');
    rows=head ? [] : (await db.query(`SELECT t.*${extra} FROM public.${identifier(table)} t${predicate}${sorting?' ORDER BY '+sorting:''} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,params)).rows;
  } else {
    const allowed=writable[table];
    if (!allowed || !values || typeof values!=='object' || Array.isArray(values)) throw new Error('Unsupported write.');
    const keys=Object.keys(values);
    if (!keys.length || keys.some(key=>!allowed.includes(key))) throw new Error('Unsupported write field.');
    if(table==='profiles' && 'role' in values) {
      const target=filters.find(filter=>filter.column==='id' && filter.op==='eq');
      if(filters.length!==1 || !target || !['admin','tailor'].includes(values.role))throw new Error('Change one staff role at a time.');
      if((await db.query('SELECT auth.uid() AS id')).rows[0].id===target.value)throw new Error('You cannot change your own role.');
    }
    if (table==='app_settings' && values.key==='currency' && values.value!=='GHS') throw new Error('Workshop currency is fixed to GHS.');
    const writeValue=key=>table==='app_settings' && key==='value' ? JSON.stringify(values[key]) : values[key];
    if (action==='update') {
      if (!filters.length) throw new Error('A write requires a record filter.');
      const setters=keys.map(key=>`${identifier(key)}=${bind(writeValue(key))}`).join(',');
      rows=(await db.query(`UPDATE public.${identifier(table)} t SET ${setters}${predicate} RETURNING t.*`,params)).rows;
    } else if (action==='insert' || action==='upsert') {
      if (action==='insert' && !['order_tasks','measurement_parameters'].includes(table)) throw new Error('Unsupported insert.');
      if (action==='upsert' && table!=='app_settings') throw new Error('Unsupported upsert.');
      if (filters.length) throw new Error('Unsupported write filter.');
      const conflict=action==='upsert' ? ' ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()' : '';
      rows=(await db.query(`INSERT INTO public.${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(key=>bind(writeValue(key))).join(',')})${conflict} RETURNING *`,params)).rows;
    } else throw new Error('Unsupported query action.');
  }
  if (single && (rows.length>1 || (single==='required' && rows.length!==1))) throw new Error('Record changed or was not found. Refresh before retrying.');
  return {data:single ? rows[0] || null : rows,error:null,count:total};
}

export async function rpcQuery(db, name, args={}) {
  if (!rpcNames.has(name) || !args || typeof args!=='object' || Array.isArray(args)) throw new Error('Unsupported workshop operation.');
  const {rows} = await db.query(`SELECT p.proargnames AS names,
    ARRAY(SELECT format_type(oid,NULL) FROM unnest(p.proargtypes::oid[]) AS oid) AS types
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`,[name]);
  if (rows.length!==1) throw new Error('Workshop operation unavailable. Apply the migrations.');
  const {names,types}=rows[0];
  const keys=Object.keys(args);
  if (keys.some(key=>!names?.includes(key))) throw new Error('Invalid workshop arguments.');
  const params=keys.map(key=>['json','jsonb'].includes(types[names.indexOf(key)]) ? JSON.stringify(args[key]) : args[key]);
  const call=keys.map((key,index)=>`${identifier(key)} => $${index+1}::${types[names.indexOf(key)]}`).join(',');
  return {data:(await db.query(`SELECT public.${identifier(name)}(${call}) AS result`,params)).rows[0].result,error:null};
}
