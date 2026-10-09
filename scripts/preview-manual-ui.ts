// Local-only UI fixtures. No real auth, payments or SMS; never deploy this server.
import { createServer } from 'node:http';
const staffId = '11111111-1111-1111-1111-111111111111';
const clientId = '33333333-3333-3333-3333-333333333333';
const now = new Date().toISOString(); const today = now.slice(0, 10);
const profile = { id: staffId, role: 'admin', full_name: 'Test Administrator', phone_number: '233000000000' };
const customer = { id: clientId, full_name: 'Test Customer', phone_number: '233000000001', created_at: now };
let master = { client_id: clientId, unit: 'in', revision: 1, notes: '', updated_at: now, values: { bust: 36, waist: 28 } };
const params = [{ id: 'bust-param', key: 'bust', label: 'Bust', is_active: true, display_order: 1 }, { id: 'waist-param', key: 'waist', label: 'Waist', is_active: true, display_order: 2 }];
const base = { client_id: clientId, client_name: customer.full_name, client_phone: customer.phone_number,
  garment_subtitle: '', fabric_type: 'Cotton', fabric_color: 'Gold', fabric_notes: '', reference_images: [], swatch_image: null,
  assigned_tailor: profile.full_name, assigned_tailor_id: staffId, due_date: '2026-01-01', deposit_paid: 200, total_amount: 1000,
  currency: 'GHS', created_at: now, updated_at: now, work_revision:1,production_cycle:1,stage_history: [],
  measurement_snapshot: { unit: 'in', values: { bust: 36, waist: 28 }, labels: { bust: 'Bust', waist: 'Waist' },
    capturedAt: now, updatedAt: now, revision: 1, source: 'legacy_migration' } };
const orders: any[] = [{ ...base, id: 'UI-ORDER-001', garment_title: 'Test dress', status: 'ready' },
  { ...base, id: 'UI-ORDER-002', garment_title: 'Delivered test suit', status: 'delivered', total_amount: 600 }];
for(let i=0;i<30;i++)orders.push({...base,id:`UI-PAGED-${i}`,client_name:`Paged Test ${i}`,garment_title:'Pagination fixture',status:'pending',total_amount:100,deposit_paid:0});
const fittings:any[]=[];const rework:any[]=[];const quality:any[]=[];const audit:any[]=[];
const payments: any[] = orders.slice(0,2).map((order, i) => ({ id: `payment-${i}`, order_id: order.id, kind: 'receipt', amount: 200,
  currency: 'GHS', method: 'Cash in Atelier', occurred_on: today, reference: '', notes: 'UI fixture only',
  recorded_by: staffId, recorded_at: now, recorded_by_name: profile.full_name, staff: profile, reverses_payment_id: null }));
const notices: any[] = [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', order_id: orders[0].id, stage: 'ready',
  recipient: customer.phone_number, content: 'Test atelier: Your garment is ready for collection. UI fixture only.',
  status: 'pending', created_at: now, sent_at: null, sent_by: null }];
notices.push({...notices[0],id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',order_id:'UI-ORDER-002',stage:'delivered',status:'submitted',content:'Old provider submission fixture — verify only.'});
const snapshot = (source: string) => ({ unit: master.unit, values: { ...master.values }, labels: { bust: 'Bust', waist: 'Waist' },
  revision: master.revision, clientId, clientName: customer.full_name, clientPhone: customer.phone_number,
  capturedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source, notes: master.notes });
const result = (order: any) => ({ order, payments: payments.filter((entry) => entry.order_id === order.id) });
createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, x-client-info, x-supabase-api-version, content-type, prefer, accept, accept-profile, content-profile, range, range-unit');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, HEAD, OPTIONS');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Range'); response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (value: any, status = 200) => { response.statusCode = status; response.end(JSON.stringify(value)); };
  if (url.pathname === '/auth/v1/token') {
    const claims = Buffer.from(JSON.stringify({ sub: staffId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    send({ access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.local-ui-fixture`, refresh_token: 'local-ui-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: staffId, email: 'test@atelier.local', role: 'authenticated', app_metadata: { role: 'admin' }, user_metadata: {} } }); return;
  }
  if (url.pathname === '/auth/v1/user') { send({ id: staffId, email: 'test@atelier.local' }); return; }
  if (url.pathname.includes('/rpc/')) {
    const fn = url.pathname.split('/').pop(); const order = orders.find((job) => job.id === body.p_order_id);
    if(fn==='workshop_summary'){
      const match=(view:string)=>orders.filter(o=>view==='active' ? o.status!=='delivered' : view==='overdue' ? o.status!=='delivered' && o.due_date<today : view==='credit' ? o.deposit_paid>o.total_amount : view==='delivered_unpaid' ? o.status==='delivered' && o.total_amount>o.deposit_paid : o.total_amount>o.deposit_paid);
      send({views:Object.fromEntries(['active','overdue','unpaid','delivered_unpaid','credit'].map(view=>[view,match(view).length])),statuses:Object.fromEntries(['pending','cutting','fitting','finishing','ready','delivered'].map(stage=>[stage,orders.filter(o=>o.status===stage).length])),
        loads:[{name:profile.full_name,assigned_tailor_id:staffId,active:match('active').length,delivered:orders.filter(o=>o.status==='delivered').length}],outstanding:orders.reduce((sum,o)=>sum+Math.max(o.total_amount-o.deposit_paid,0),0),receipts:payments.reduce((sum,p)=>sum+p.amount,0),opening:0,newCustomers:1,
        fittings:fittings.filter(f=>f.status==='scheduled').map(f=>({...f,client_name:customer.full_name,garment_title:orders.find(o=>o.id===f.order_id)?.garment_title}))});return;
    }
    if(fn==='workshop_order_page') {const found=orders.filter(o=>(body.p_view==='active' ? o.status!=='delivered' : body.p_view==='overdue' ? o.status!=='delivered' && o.due_date<today : body.p_view==='credit' ? o.deposit_paid>o.total_amount : body.p_view==='delivered_unpaid' ? o.status==='delivered' && o.total_amount>o.deposit_paid : o.total_amount>o.deposit_paid) && `${o.client_name} ${o.client_phone} ${o.id} ${o.garment_title}`.toLowerCase().includes((body.p_search || '').toLowerCase()));send({ids:found.slice(body.p_page*25,(body.p_page+1)*25).map(o=>o.id),total:found.length});return;}
    if(fn==='workshop_receipt_page'){send({records:payments.slice(body.p_page*25,(body.p_page+1)*25).map(p=>({...p,client_name:customer.full_name})),total:payments.length});return;}
    if(fn==='workshop_client_page'){send({records:[customer],total:1});return;}
    if(fn==='abandoned_sketches'){send([]);return;}
    if(fn==='review_sms'){const notice=notices.find(n=>n.id===body.p_id);Object.assign(notice,{status:body.p_resolution==='confirmed_submitted' ? 'reviewed_submitted' : 'pending',reviewed_at:new Date().toISOString(),review_notes:body.p_notes,reviewer:profile});send(notice);return;}
    if(fn==='save_fitting' || fn==='save_rework'){
      const list=fn==='save_fitting' ? fittings : rework;let entry=list.find(r=>r.id===body.p_id);
      if(!entry){entry={id:body.p_id,order_id:order.id};list.push(entry);}Object.assign(entry,body.p_payload,{revision:body.p_expected_revision+1});
      if(fn==='save_rework' && order.status==='ready' && body.p_payload.status==='open'){order.status='finishing';order.production_cycle++;}
      order.work_revision++;order.updated_at=new Date().toISOString();audit.push({id:crypto.randomUUID(),order_id:order.id,event:fn==='save_rework' ? `Rework ${entry.status}` : `Fitting ${entry.status}`,details:entry,actor_name:profile.full_name,recorded_at:new Date().toISOString()});send(entry);return;
    }
    if(fn==='record_quality_check') {const entry={id:body.p_id,order_id:order.id,work_revision:order.work_revision,notes:body.p_notes,checked_at:new Date().toISOString(),checked_by:staffId};quality.push(entry);send(entry);return;}
    if(fn==='update_order_terms'){order.total_amount=body.p_total;order.assigned_tailor_id=body.p_tailor_id;order.updated_at=new Date().toISOString();send(order);return;}
    if(fn==='reopen_order'){order.status='finishing';order.work_revision++;order.production_cycle++;order.updated_at=new Date().toISOString();send(order);return;}
    if (fn === 'record_manual_sms') { const notice = notices.find((entry) => entry.id === body.p_notification_id); Object.assign(notice, { status: 'sent_manually', sent_at: new Date().toISOString(), sent_by: staffId, staff: profile }); send(notice); return; }
    if (fn === 'record_payment') {
      if (order.deposit_paid + body.p_amount > order.total_amount && !body.p_allow_credit) { send({ message: 'Confirm the excess as customer credit.' }, 400); return; }
      if (!payments.some((entry) => entry.submission_key === body.p_submission_key)) {
        payments.push({ ...payments[0], id: crypto.randomUUID(), order_id: order.id, submission_key: body.p_submission_key,
          amount: body.p_amount, method: body.p_method, occurred_on: body.p_occurred_on, reference: body.p_reference, notes: body.p_notes, recorded_at: new Date().toISOString() });
        order.deposit_paid += body.p_amount;
      }
      send(result(order)); return;
    }
    if (fn === 'save_client_measurements' || fn==='save_measurement_draft') { master = { ...master, values: body.p_values, notes: body.p_notes, unit: body.p_unit, revision: master.revision + 1 }; send(snapshot('master')); return; }
    if (fn === 'apply_order_measurements') { order.measurement_snapshot = snapshot('applied'); send(order); return; }
    if (fn === 'advance_order_stage') {
      const stages = ['pending', 'cutting', 'fitting', 'finishing', 'ready', 'delivered'];
      order.status = stages[stages.indexOf(order.status) + 1]; order.stage_history.push({ stage: order.status, completedBy: profile.full_name, completedAt: new Date().toISOString(), notes: 'Stage saved.' });
      for (const notice of notices) if (notice.order_id === order.id && notice.status === 'pending') notice.status = 'superseded';
      notices.push({ ...notices[0], id: crypto.randomUUID(), order_id: order.id, stage: order.status, production_cycle:order.production_cycle,status: 'pending', sent_at: null, sent_by: null, content: 'UI test progress update only.' }); send(order); return;
    }
    send({ message: 'Operation not included in UI fixtures.' }, 400); return;
  }
  const table = url.pathname.split('/').pop();
  let data: any[] = table === 'profiles' ? [profile] : table === 'clients' ? [customer] : table === 'orders' ? orders : table === 'payments' ? payments
    : table === 'order_tasks' ? [] : table === 'measurement_parameters' ? params : table === 'client_measurements' ? [master]
    : table === 'client_measurement_values' ? Object.entries(master.values).map(([key, value]) => ({ client_id: clientId, value, measurement_parameters: { key } }))
    : table === 'app_settings' ? [{ key: 'business_name', value: 'Test atelier' }, { key: 'currency', value: 'GHS' }]
    : table === 'sms_notifications' ? notices.map((notice) => ({ ...notice, orders: orders.find((job) => job.id === notice.order_id) }))
    : table === 'fitting_appointments' ? fittings : table==='order_rework' ? rework : table==='order_quality_checks' ? quality : table==='order_audit' ? audit : [];
  for (const [key, filter] of url.searchParams) {
    if (filter.startsWith('eq.')) data = data.filter((row) => String(row[key]) === filter.slice(3));
    if (filter.startsWith('in.')) { const values = filter.slice(4, -1).replaceAll('"', '').split(','); data = data.filter((row) => values.includes(String(row[key]))); }
  }
  if (request.method === 'PATCH') { for (const row of data) Object.assign(row, body); }
  response.setHeader('Content-Range', `0-${Math.max(0, data.length - 1)}/${data.length}`);
  if (request.method === 'HEAD') { response.end(); return; }
  send(request.headers.accept?.includes('vnd.pgrst.object') ? data[0] || null : data);
}).listen(54329, '127.0.0.1', () => console.log('Local UI fixture backend: http://127.0.0.1:54329; login test@atelier.local / test-password'));
