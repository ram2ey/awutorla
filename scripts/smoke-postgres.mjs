// Writes fake records only to a disposable loopback test stack. Never run against
// a workshop's live database. CI uses this to exercise the actual pg driver.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:3000';
const password='Disposable-permanent-password-456!';
const statePath=new URL('../.postgres-smoke.local',import.meta.url);
if(process.env.ALLOW_DISPOSABLE_SMOKE_TEST!=='1')throw new Error('Set ALLOW_DISPOSABLE_SMOKE_TEST=1 only for a disposable test database.');
let cookie;
async function api(path,data,method='POST',raw) {
  const response=await fetch(base+path,{method,signal:AbortSignal.timeout(20000),
    headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(raw?{}:{'Content-Type':'application/json'})},
    body:method==='GET'?undefined:raw || JSON.stringify(data || {})});
  const result=await response.json();
  assert.ok(response.ok,`API request ${path} failed: ${result.error?.message}`);
  cookie=response.headers.get('set-cookie')?.split(';')[0] || cookie;
  return result.data;
}
const rpc=(name,args)=>api('/api/rpc',{name,args});
const persisted=process.argv.includes('--verify-persistence');
const session=await api('/api/auth/sign-in',{email:process.env.BOOTSTRAP_ADMIN_EMAIL,
  password:persisted?password:process.env.BOOTSTRAP_ADMIN_PASSWORD});
if(!persisted) {
  assert.equal(session.user.must_change_password,true);
  await api('/api/auth/password',{password});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=','base64');
  await api('/api/files?path=CI-ORDER/photo.png',undefined,'POST',png);
  const payload={id:'CI-ORDER',task_id:'CI-TASK',client_name:'CI Customer',client_phone:'233241234567',
    garment_title:'CI Garment',total_amount:1000,deposit_paid:100,unit:'in',measurement_values:{bust:36},
    tailor_id:session.user.id,currency:'GHS',reference_images:['CI-ORDER/photo.png'],
    deposit_submission_key:randomUUID(),payment_method:'Cash in Atelier',payment_date:'2026-10-10'};
  const customerId=await rpc('create_bespoke_intake',{p_payload:payload});
  assert.equal(await rpc('create_bespoke_intake',{p_payload:payload}),customerId);
  const args={p_order_id:'CI-ORDER',p_submission_key:randomUUID(),p_amount:200,p_method:'Direct MoMo',
    p_occurred_on:'2026-10-10',p_reference:'CI',p_notes:'Fake test receipt',p_allow_credit:false};
  assert.equal(Number((await rpc('record_payment',args)).order.deposit_paid),300);
  assert.equal(Number((await rpc('record_payment',args)).order.deposit_paid),300);
  await writeFile(statePath,JSON.stringify({customerId}));
} else assert.equal(session.user.must_change_password,false);
const state=JSON.parse(await readFile(statePath,'utf8'));
const staff=await api('/api/query',{table:'profiles',filters:[{column:'role',op:'in',value:['admin','tailor']}]});
assert.ok(staff.length>0);
await api('/api/query',{table:'app_settings',action:'upsert',values:{key:'business_name',value:'Disposable CI Atelier'}});
const order=await api('/api/query',{table:'orders',single:'required',filters:[{column:'id',op:'eq',value:'CI-ORDER'}]});
assert.equal(order.client_id,state.customerId);assert.equal(Number(order.deposit_paid),300);
assert.equal(order.measurement_snapshot.values.bust,36);
const payments=await api('/api/query',{table:'payments',filters:[{column:'order_id',op:'eq',value:'CI-ORDER'}]});
assert.equal(payments.length,2);
assert.ok(payments.every(payment=>payment.occurred_on==='2026-10-10'));
const values=await api('/api/query',{table:'client_measurement_values',selection:'value,measurement_parameters(key)',filters:[{column:'client_id',op:'eq',value:state.customerId}]});
assert.equal(values[0].measurement_parameters.key,'bust');
const image=await fetch(base+'/api/files?path=CI-ORDER/photo.png',{headers:{Cookie:cookie}});
assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
await image.arrayBuffer();
await api('/api/auth/sign-out');
console.log(persisted?'Actual PostgreSQL and private upload persistence verified.':'Actual PostgreSQL login, image upload and transactional payments verified.');
