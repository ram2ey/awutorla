import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { migrate } from '../migrate.mjs';
import { bootstrapAdmin } from '../accounts.mjs';
import { createHandler } from '../app.mjs';
import { safeFilePath, imageType } from '../security.mjs';
import { tableQuery, staffTransaction } from '../data.mjs';
import { pglitePool } from './pglite-pool.mjs';

let db,pool,server,base,uploadDir,adminId,tailorId,adminCookie,tailorCookie,tempPassword;
const appOrigin='https://atelier.test';
const initialPassword='Initial-test-password-123!';
const permanentPassword='Permanent-test-password-456!';
const query=async(sql,params)=>{
  // Match node-postgres simple-query handling of multi-statement migrations.
  if(params===undefined) {const results=await db.exec(sql);return results.at(-1) || {rows:[]};}
  return db.query(sql,params);
};
async function api(path,{cookie=adminCookie,method='POST',data,origin=appOrigin,raw}={}) {
  const response=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),
    ...(raw?{}:{'Content-Type':'application/json'})},body:method==='GET'?undefined:raw || JSON.stringify(data || {})});
  const type=response.headers.get('content-type');
  const result=type?.includes('application/json')?await response.json():await response.text();
  return {status:response.status,result,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const rpc=(name,args)=>api('/api/rpc',{data:{name,args}});

before(async()=>{
  db=new PGlite({extensions:{pgcrypto,uuid_ossp}});
  pool=pglitePool(db);
  await migrate({query});
  await bootstrapAdmin({query},{BOOTSTRAP_ADMIN_EMAIL:'admin@atelier.test',BOOTSTRAP_ADMIN_PASSWORD:initialPassword});
  adminId=(await query("SELECT id FROM auth.users WHERE email='admin@atelier.test'")).rows[0].id;
  uploadDir=await mkdtemp(join(tmpdir(),'atelier-backend-'));
  server=http.createServer(await createHandler({pool,appOrigin,production:true,uploadDir}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)await db.close();
  if(uploadDir)await rm(uploadDir,{recursive:true,force:true});
});

test('Native migrations are tracked, repeat safely and detect changed applied SQL',async()=>{
  assert.equal(Number((await query('SELECT count(*) FROM public.atelier_migrations')).rows[0].count),9);
  await migrate({query});
  await query("UPDATE public.atelier_migrations SET checksum='changed' WHERE name='08_reports_and_recovery.sql'");
  await assert.rejects(migrate({query}),/Applied migration changed/);
  const {createHash}=await import('node:crypto');
  const sql=await readFile(new URL('../../supabase/migrations/08_reports_and_recovery.sql',import.meta.url),'utf8');
  await query('UPDATE public.atelier_migrations SET checksum=$1 WHERE name=$2',[createHash('sha256').update(sql).digest('hex'),'08_reports_and_recovery.sql']);
});
test('Health and unauthenticated API access behave correctly',async()=>{
  assert.equal((await api('/healthz',{method:'GET',cookie:''})).status,200);
  assert.equal((await api('/api/query',{cookie:'',data:{table:'orders'}})).status,401);
  assert.equal((await api('/api/files?path=test/photo.png',{method:'GET',cookie:''})).status,401);
});
test('Mutations reject an untrusted request origin',async()=>{
  assert.equal((await api('/api/auth/sign-in',{cookie:'',origin:'https://evil.test',data:{email:'admin@atelier.test',password:initialPassword}})).status,403);
});
test('Login issues a secure HttpOnly cookie and never returns a password or session token',async()=>{
  const result=await api('/api/auth/sign-in',{cookie:'',data:{email:'admin@atelier.test',password:initialPassword}});
  assert.equal(result.status,200);adminCookie=result.cookie;
  assert.match(result.headers.get('set-cookie'),/HttpOnly/);assert.match(result.headers.get('set-cookie'),/Secure/);
  assert.match(result.headers.get('set-cookie'),/SameSite=Lax/);assert.ok(adminCookie.startsWith('__Host-atelier_session='));
  assert.equal(result.result.data.user.must_change_password,true);
  assert.equal(result.result.data.user.id,adminId);
  assert.equal(result.result.data.user.password_hash,undefined);assert.equal(result.result.data.token,undefined);
});
test('A temporary login can read its own profile but cannot access workshop data',async()=>{
  const profile=await api('/api/query',{data:{table:'profiles',single:'optional',filters:[{column:'id',op:'eq',value:adminId}]}});
  assert.equal(profile.status,200);assert.equal(profile.result.data.role,'admin');
  assert.equal((await rpc('workshop_summary',{})).status,403);
  assert.equal((await api('/api/query',{data:{table:'orders'}})).status,403);
});
test('Password replacement revokes the old session and allows the workshop',async()=>{
  const oldCookie=adminCookie;
  assert.equal((await api('/api/auth/password',{data:{password:'short'}})).status,400);
  const result=await api('/api/auth/password',{data:{password:permanentPassword}});
  assert.equal(result.status,200);adminCookie=result.cookie;
  assert.equal((await api('/api/auth/session',{method:'GET',cookie:oldCookie})).status,401);
  assert.equal((await rpc('workshop_summary',{})).status,200);
  assert.equal(result.result.data.user.must_change_password,false);
});
test('Only admins create staff; creation does not expose the stored hash',async()=>{
  const result=await api('/api/staff/create',{data:{fullName:'Test Tailor',email:'tailor@atelier.test',role:'tailor'}});
  assert.equal(result.status,200);tailorId=result.result.data.userId;tempPassword=result.result.data.tempPassword;
  assert.ok(tempPassword.length>=12);
  let login=await api('/api/auth/sign-in',{cookie:'',data:{email:'tailor@atelier.test',password:tempPassword}});
  tailorCookie=login.cookie;
  const changed=await api('/api/auth/password',{cookie:tailorCookie,data:{password:'Tailor-permanent-password-789!'}});
  assert.equal(changed.status,200);tailorCookie=changed.cookie;
  assert.equal((await api('/api/staff/create',{cookie:tailorCookie,data:{fullName:'Forbidden',email:'bad@atelier.test',role:'admin'}})).status,403);
  assert.equal((await api('/api/staff/create',{data:{fullName:'Bad',email:'bad@atelier.test',role:'client'}})).status,400);
});
test('Uploads are private and validate image bytes, paths and duplicate writes',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=','base64');
  assert.equal((await api('/api/files?path=TEST/photo.png',{raw:png})).status,201);
  assert.equal((await api('/api/files?path=TEST/photo.png',{raw:png})).status,400);
  assert.equal((await api('/api/files?path=TEST/bad.svg',{raw:Buffer.from('<svg/>')})).status,400);
  assert.equal((await api('/api/files?path=../escape.png',{raw:png})).status,400);
  const image=await fetch(base+'/api/files?path=TEST/photo.png',{headers:{Cookie:adminCookie}});
  assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');
  assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const link=await api('/api/files/url',{data:{path:'TEST/photo.png'}});
  assert.equal(link.result.data.signedUrl,'/api/files?path=TEST%2Fphoto.png');
});
let customerId;
test('Native RPC saves intake with its deposit, tasks, snapshot and SMS atomically',async()=>{
  const payload={id:'NATIVE-ORDER',task_id:'NATIVE-TASK',client_name:'Test Customer',client_phone:'233241234567',
    garment_title:'Test Garment',total_amount:1000,deposit_paid:100,unit:'in',measurement_values:{bust:36},
    tailor_id:tailorId,currency:'GHS',due_date:'2027-01-01',reference_images:['TEST/photo.png'],
    deposit_submission_key:randomUUID(),payment_method:'Cash in Atelier',payment_date:'2026-10-10'};
  const result=await rpc('create_bespoke_intake',{p_payload:payload});
  assert.equal(result.status,200,JSON.stringify(result.result));customerId=result.result.data;
  assert.equal((await rpc('create_bespoke_intake',{p_payload:payload})).status,200);
  const order=await api('/api/query',{data:{table:'orders',single:'required',filters:[{column:'id',op:'eq',value:'NATIVE-ORDER'}]}});
  assert.equal(Number(order.result.data.deposit_paid),100);assert.equal(order.result.data.measurement_snapshot.values.bust,36);
  assert.equal((await api('/api/query',{data:{table:'order_tasks'}})).result.data.length,1);
});
test('Native receipt RPC retries safely and preserves SQL financial guards',async()=>{
  const args={p_order_id:'NATIVE-ORDER',p_submission_key:randomUUID(),p_amount:200,p_method:'Direct MoMo',
    p_occurred_on:'2026-10-10',p_reference:'test-ref',p_notes:'Test receipt',p_allow_credit:false};
  const result=await rpc('record_payment',args);assert.equal(result.status,200,JSON.stringify(result.result));
  assert.equal(Number(result.result.data.order.deposit_paid),300);
  assert.equal((await rpc('record_payment',args)).status,200);
  assert.equal((await rpc('record_payment',{...args,p_amount:201})).status,400);
  assert.equal((await api('/api/query',{data:{table:'orders',action:'update',values:{deposit_paid:999},filters:[{column:'id',op:'eq',value:'NATIVE-ORDER'}]}})).status,400);
  const payments=await api('/api/query',{data:{table:'payments',selection:'*, staff:profiles!payments_recorded_by_fkey(full_name)'}});
  assert.equal(payments.result.data.length,2);assert.equal(payments.result.data[0].staff.full_name,'Workshop Admin');
});
test('Joined measurements, bounded pages and count requests work through the native API',async()=>{
  const staff=await api('/api/query',{data:{table:'profiles',filters:[{column:'role',op:'in',value:['tailor','admin']}]}});
  assert.equal(staff.status,200);assert.equal(staff.result.data.length,2);
  const values=await api('/api/query',{data:{table:'client_measurement_values',selection:'value,measurement_parameters(key)',filters:[{column:'client_id',op:'eq',value:customerId}]}});
  assert.equal(values.status,200);assert.equal(values.result.data[0].measurement_parameters.key,'bust');
  const counted=await api('/api/query',{data:{table:'clients',head:true,count:'exact'}});
  assert.equal(counted.result.count,1);assert.deepEqual(counted.result.data,[]);
  assert.equal((await api('/api/query',{data:{table:'orders',limit:1001}})).status,400);
  assert.equal((await rpc('workshop_order_page',{p_view:'active',p_search:'Test',p_page:0})).status,200);
});
test('Admins can save JSON business settings and tailors are denied by RLS',async()=>{
  const spec={table:'app_settings',action:'upsert',values:{key:'business_name',value:'Native Test Atelier'}};
  assert.equal((await api('/api/query',{data:spec})).status,200);
  const result=await api('/api/query',{data:{table:'app_settings',single:'required',filters:[{column:'key',op:'eq',value:'business_name'}]}});
  assert.equal(result.result.data.value,'Native Test Atelier');
  const denied=await api('/api/query',{cookie:tailorCookie,data:spec});
  assert.equal(denied.status,400);assert.match(denied.result.error.message,/not permitted/);
});
test('Only allowlisted operations/fields are exposed and SQL values are parameterized',async()=>{
  assert.equal((await api('/api/query',{data:{table:'auth.users'}})).status,400);
  assert.equal((await rpc('handle_new_user',{})).status,400);
  assert.equal((await rpc('workshop_summary',{unexpected:'x'})).status,400);
  assert.equal((await api('/api/query',{data:{table:'orders',filters:[{column:'id; DROP TABLE orders;',op:'eq',value:'x'}]}})).status,400);
  const result=await api('/api/query',{data:{table:'orders',filters:[{column:'id',op:'eq',value:"';DROP TABLE orders;--"}]}});
  assert.equal(result.status,200);assert.deepEqual(result.result.data,[]);
  assert.equal((await api('/api/query',{cookie:tailorCookie,data:{table:'app_settings',action:'upsert',values:{key:'business_name',value:'Forbidden'}}})).status,400);
});
test('Staff cannot escalate roles and protected attachments cannot be deleted',async()=>{
  assert.equal((await api('/api/query',{cookie:tailorCookie,data:{table:'profiles',action:'update',values:{role:'admin'},filters:[{column:'id',op:'eq',value:tailorId}]}})).status,400);
  assert.equal((await api('/api/files',{method:'DELETE',data:{paths:['TEST/photo.png']}})).status,403);
  assert.equal((await query("SELECT count(*) FROM storage.objects WHERE name='TEST/photo.png'")).rows[0].count,1);
});
test('Role context does not leak into pooled follow-up requests',async()=>{
  await staffTransaction(pool,tailorId,async db=>{assert.equal((await db.query('SELECT auth.uid() AS id')).rows[0].id,tailorId);});
  assert.equal((await query('SELECT current_user AS role')).rows[0].role,'postgres');
  await assert.rejects(staffTransaction(pool,tailorId,db=>tableQuery(db,{table:'auth.users'})));
  assert.equal((await query('SELECT current_user AS role')).rows[0].role,'postgres');
});
test('Resetting a staff password revokes sessions and requires replacement',async()=>{
  const result=await api('/api/staff/reset-password',{data:{userId:tailorId}});
  assert.equal(result.status,200);
  assert.equal((await api('/api/auth/session',{method:'GET',cookie:tailorCookie})).status,401);
  const login=await api('/api/auth/sign-in',{cookie:'',data:{email:'tailor@atelier.test',password:result.result.data.tempPassword}});
  assert.equal(login.status,200);assert.equal(login.result.data.user.must_change_password,true);
});
test('Login throttling persists in PostgreSQL and expired sessions fail closed',async()=>{
  for(let i=0;i<10;i++)assert.equal((await api('/api/auth/sign-in',{cookie:'',data:{email:'missing@atelier.test',password:'Wrong-test-password-123'}})).status,401);
  assert.equal((await api('/api/auth/sign-in',{cookie:'',data:{email:'missing@atelier.test',password:'Wrong-test-password-123'}})).status,429);
  await query("UPDATE auth.sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[adminId]);
  assert.equal((await api('/api/auth/session',{method:'GET'})).status,401);
  assert.equal((await api('/api/auth/sign-out')).status,200);
});
test('File helpers reject traversal and active document formats',()=>{
  for(const path of ['../x','a/../x','/x','a//x','a\\x','.env','a/.hidden'])assert.throws(()=>safeFilePath(path));
  assert.equal(safeFilePath('ORDER-1/photo.png'),'ORDER-1/photo.png');
  assert.throws(()=>imageType(Buffer.from('<html>fake image</html>')));
});
test('Production static serving, direct links, gzip and cache rules pass the reusable smoke check',async()=>{
  const {spawn}=await import('node:child_process');
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/smoke-container.mjs',base],{stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(output)));
  });
  const compressed=await fetch(base+'/',{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(compressed.headers.get('content-encoding'),'gzip');
  assert.match(await compressed.text(),/id="root"/);
});
