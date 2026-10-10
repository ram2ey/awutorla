import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import pg from 'pg';
import { pglitePool } from './pglite-pool.mjs';
import { migrate } from '../migrate.mjs';
import { bootstrapAdmin } from '../accounts.mjs';
import { createHandler } from '../app.mjs';
import { newToken, tokenHash } from '../security.mjs';
import { expireShopOrders } from '../shop.mjs';

let pool,db,server,base,uploadDir,adminCookie,tailorCookie,temporaryCookie;
const origin='https://atelier.test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKZkAAAAASUVORK5CYII=','base64');
const real=process.env.SHOP_TEST_DATABASE_URL;
async function api(path,{method='POST',data,cookie=adminCookie,token,raw,requestOrigin=origin}={}) {
  const response=await fetch(base+path,{method,headers:{Origin:requestOrigin,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(!raw?{'Content-Type':'application/json'}:{})},body:method==='GET'?undefined:raw || JSON.stringify(data || {})});
  const result=await response.json();return {status:response.status,data:result.data,error:result.error?.message,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
const ok=result=>{assert.equal(result.status,200,result.error);return result.data;};
async function getSettings(){return ok(await api('/api/shop/admin/settings',{method:'GET'}));}
async function configure(values={}) {const s=await getSettings();return ok(await api('/api/shop/admin/settings',{data:{...s,business_name:'Test Awutorla',contact_phone:'0241234567',momo_number:'0241234567',momo_name:'Test shop',pickup_details:'Test studio, Accra. Monday–Friday 9–5.',...values}}));}
async function makeProduct(stock=10) {
  const suffix=randomUUID().slice(0,8);
  let p=ok(await api('/api/shop/admin/products',{data:{slug:'piece-'+suffix,title:'Test dress '+suffix,description:'Test garment description',category:'Dresses',size_guide:'M: bust 36 inches',price_pesewas:25000,variants:[{sku:'SKU-'+suffix,size:'M',colour:'Gold',stock}]}}));
  assert.equal((await api('/api/shop/products/'+p.slug,{cookie:'',method:'GET'})).status,404);
  p=ok(await api(`/api/shop/admin/products/${p.id}/images`,{raw:png}));
  const privatePhoto=await fetch(base+'/api/shop/images/'+p.images[0].id);assert.equal(privatePhoto.status,404);
  p=ok(await api('/api/shop/admin/products',{data:{...p,published:true}}));return p;
}
function payload(p,values={}) {return {submission_key:randomUUID(),access_token:newToken(),customer_name:'Shop Customer',phone:'0241234567',fulfilment:'pickup',payment_method:'cash',items:[{variant_id:p.variants[0].id,quantity:1,unit_price:p.price_pesewas}],...values};}
async function create(p,values={},isTest=false) {const input=payload(p,values);const o=ok(await api(isTest?'/api/shop/admin/test-order':'/api/shop/orders',{data:input,cookie:isTest?adminCookie:''}));return {...o,input};}
async function mutate(o,action,values={}) {return ok(await api('/api/shop/staff/orders/'+o.id,{data:{action,version:o.version,...values}}));}
function receipt(o,values={}) {return {action:'receipt',version:o.version,submission_key:randomUUID(),amount:o.total,method:o.payment_method,occurred_on:'2026-10-10',reference:o.payment_method==='momo'?'MOMO-TEST':'',notes:'Test receipt',...values};}
async function available(p) {return Number(ok(await api('/api/shop/products/'+p.slug,{cookie:'',method:'GET'})).variants[0].available);}

before(async()=>{
  if(real) {
    if(process.env.ALLOW_DISPOSABLE_SMOKE_TEST!=='1' || !/test/i.test(new URL(real).pathname))throw new Error('Real shop tests require an explicitly disposable database whose name includes test.');
    pg.types.setTypeParser(1082,value=>value);pool=new pg.Pool({connectionString:real,max:8});
    if((await pool.query("SELECT to_regclass('public.atelier_migrations') AS existing")).rows[0].existing)throw new Error('Use an empty disposable test database. Existing data will never be reset.');
  }else{db=new PGlite({extensions:{pgcrypto,uuid_ossp}});pool=pglitePool(db);}
  const connection=await pool.connect();try {
    await migrate(connection);await bootstrapAdmin(connection,{BOOTSTRAP_ADMIN_EMAIL:'shop-admin@atelier.test',BOOTSTRAP_ADMIN_PASSWORD:'Shop-admin-initial-password-123!'});
    await connection.query('UPDATE auth.users SET must_change_password=false');
  }finally{connection.release();}
  uploadDir=await mkdtemp(join(tmpdir(),'awutorla-shop-test-'));
  server=http.createServer(await createHandler({pool,appOrigin:origin,production:true,uploadDir}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  adminCookie=(await api('/api/auth/sign-in',{cookie:'',data:{email:'shop-admin@atelier.test',password:'Shop-admin-initial-password-123!'}})).cookie;
  const staff=ok(await api('/api/staff/create',{data:{fullName:'Shop Tailor',email:'shop-tailor@atelier.test',role:'tailor'}}));
  temporaryCookie=(await api('/api/auth/sign-in',{cookie:'',data:{email:'shop-tailor@atelier.test',password:staff.tempPassword}})).cookie;
  tailorCookie=(await api('/api/auth/password',{cookie:temporaryCookie,data:{password:'Shop-tailor-permanent-password-123!'}})).cookie;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.close();else if(pool)await pool.end();if(uploadDir)await rm(uploadDir,{recursive:true,force:true});});

test('Shop starts disabled; staff settings and product controls stay protected',async()=>{
  const c=ok(await api('/api/shop/config',{method:'GET',cookie:''}));assert.equal(c.checkout_enabled,false);assert.equal(c.momo_number,undefined);
  assert.equal((await api('/api/shop/admin/settings',{method:'GET',cookie:''})).status,401);
  assert.equal((await api('/api/shop/admin/settings',{method:'GET',cookie:tailorCookie})).status,403);
  assert.equal((await api('/api/shop/admin/products',{method:'GET',cookie:tailorCookie})).status,403);
  assert.equal((await api('/api/shop/staff/orders',{method:'GET',cookie:temporaryCookie})).status,401);
  assert.equal((await api('/api/shop/orders',{data:{},cookie:'',requestOrigin:'https://evil.test'})).status,403);
  const c2=await configure();assert.equal((await api('/api/shop/admin/settings',{data:{...c2,checkout_enabled:true}})).status,400);
});
test('Only admins can create products, edit stock, publish or manage shop photos',async()=>{
  const p=await makeProduct(5);
  const attempts=[
    {path:'/api/shop/admin/products',data:{title:'Unauthorized dress',slug:'unauthorized-dress',price_pesewas:1000,variants:[{sku:'UNAUTHORIZED',size:'M',colour:'Gold',stock:5}]}},
    {path:'/api/shop/admin/products',data:{...p,title:'Unauthorized edit',price_pesewas:1000,published:false,variants:p.variants.map(v=>({...v,stock:100}))}},
    {path:`/api/shop/admin/products/${p.id}/images`,raw:png},
    {path:`/api/shop/admin/images/${p.images[0].id}`,method:'DELETE'},
  ];
  for(const {path,...options} of attempts) {
    assert.equal((await api(path,{...options,cookie:tailorCookie})).status,403,path);
    assert.equal((await api(path,{...options,cookie:''})).status,401,path);
  }
  const unchanged=ok(await api('/api/shop/products/'+p.slug,{cookie:'',method:'GET'}));
  assert.equal(unchanged.title,p.title);assert.equal(unchanged.price_pesewas,p.price_pesewas);
  assert.equal(Number(unchanged.variants[0].available),5);assert.equal(unchanged.images.length,1);
  const products=ok(await api('/api/shop/admin/products',{method:'GET'}));
  assert.ok(!products.some(product=>product.slug==='unauthorized-dress'));
});

test('A complete admin test order is required to launch checkout',async()=>{
  const p=await makeProduct();
  assert.equal((await api('/api/shop/orders',{data:payload(p),cookie:''})).status,503);
  assert.equal((await api('/api/shop/admin/test-order',{data:payload(p),cookie:tailorCookie})).status,403);
  let o=await create(p,{},true);assert.equal(await available(p),9);o=await mutate(o,'confirm');o=await mutate(o,'ready');
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{action:'fulfil',version:o.version}})).status,400);
  o=ok(await api('/api/shop/staff/orders/'+o.id,{data:receipt(o)}));o=await mutate(o,'fulfil');assert.equal(o.status,'fulfilled');
  await configure({checkout_enabled:true});assert.equal(ok(await api('/api/shop/config',{cookie:'',method:'GET'})).checkout_enabled,true);
  assert.equal(await available(p),9);
  assert.equal((await api('/api/shop/admin/products',{data:{...p,variants:p.variants.map(v=>({...v,stock:100}))}})).status,409,'fulfilment invalidates stale stock edits');
});
test('Catalogue and public images expose only published shop records',async()=>{
  const p=await makeProduct();const result=ok(await api('/api/shop/products?category=Dresses',{cookie:'',method:'GET'}));assert.ok(result.products.some(v=>v.id===p.id));
  const image=await fetch(base+'/api/shop/images/'+p.images[0].id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal((await api('/api/shop/admin/images/'+p.images[0].id,{method:'DELETE'})).status,400,'last photo is protected');
  assert.equal((await api('/api/files?path=private/photo.png',{cookie:'',method:'GET'})).status,401);
  assert.equal((await api('/api/query',{cookie:'',data:{table:'shop_orders'}})).status,401);
  assert.equal((await api('/api/query',{data:{table:'shop_orders'}})).status,400);
  const connection=await pool.connect();try {await connection.query('BEGIN');await connection.query('SET LOCAL ROLE authenticated');assert.equal((await connection.query('SELECT * FROM public.shop_orders')).rows.length,0);await connection.query('ROLLBACK');}finally{connection.release();}
});
test('Checkout retries create one allocation; changed retries and forged prices fail',async()=>{
  const p=await makeProduct(3),input=payload(p);const first=ok(await api('/api/shop/orders',{cookie:'',data:input}));
  assert.equal(ok(await api('/api/shop/orders',{cookie:'',data:input})).id,first.id);assert.equal(await available(p),2);
  assert.equal((await api('/api/shop/orders',{cookie:'',data:{...input,customer_name:'Changed'}})).status,409);
  assert.equal((await api('/api/shop/orders',{cookie:'',data:payload(p,{items:[{variant_id:p.variants[0].id,quantity:1,unit_price:1}]})})).status,409);
  assert.equal(await available(p),2);
  const row=(await pool.query('SELECT token_hash FROM public.shop_orders WHERE id=$1',[first.id])).rows[0];assert.equal(row.token_hash,tokenHash(input.access_token));
  const status=await api('/api/shop/orders/status',{cookie:'',method:'GET',token:input.access_token});assert.equal(status.status,200);assert.equal(status.headers.get('cache-control'),'no-store');assert.equal(status.data.payments,undefined);assert.equal(status.data.audit,undefined);assert.equal(status.data.payment_instructions,null);
  assert.equal((await api('/api/shop/orders/status',{cookie:'',method:'GET',token:newToken()})).status,404);
});
test('Competing checkouts cannot oversell the last item',async()=>{
  const p=await makeProduct(1);
  // With SHOP_TEST_DATABASE_URL this runs against multiple real pg connections.
  const responses=await Promise.all([api('/api/shop/orders',{cookie:'',data:payload(p,{phone:'0241234568'})}),api('/api/shop/orders',{cookie:'',data:payload(p,{phone:'0241234569'})})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(await available(p),0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM public.shop_allocations WHERE variant_id=$1',[p.variants[0].id])).rows[0].count),1);
});
test('Ghana delivery requires an agreed quote and verified full payment',async()=>{
  const p=await makeProduct(),input=payload(p,{phone:'0241234570',fulfilment:'delivery',payment_method:'momo',address:'Test street, Accra, Greater Accra, Ghana'});
  let o=ok(await api('/api/shop/orders',{cookie:'',data:input}));assert.equal(o.delivery_fee,null);assert.equal(o.total,null);
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{action:'confirm',version:o.version,delivery_fee:2000}})).status,400);
  o=await mutate(o,'confirm',{delivery_fee:2000,fee_agreed:true});assert.equal(o.total,27000);assert.equal(o.paid,0);assert.ok(o.payment_instructions.number);
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{action:'ready',version:o.version}})).status,400);
  const entry=receipt(o);o=ok(await api('/api/shop/staff/orders/'+o.id,{cookie:tailorCookie,data:entry}));
  assert.equal(ok(await api('/api/shop/staff/orders/'+o.id,{cookie:tailorCookie,data:entry})).payments.length,1);
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{cookie:tailorCookie,data:{...entry,amount:1}})).status,409);
  o=await mutate(o,'ready');o=await mutate(o,'fulfil');assert.equal(o.status,'fulfilled');assert.equal(await available(p),9);
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{action:'cancel',version:o.version,notes:'Cannot cancel'}})).status,400);
});
test('Expired reservations release once across handler restarts; late receipts need a fresh order',async()=>{
  const p=await makeProduct(1);const o=await create(p,{phone:'0241234571'});
  await pool.query("UPDATE public.shop_orders SET reserved_until=now()-interval '1 minute' WHERE id=$1",[o.id]);
  assert.equal(await available(p),1,'availability ignores expired holds before maintenance');
  assert.equal(await expireShopOrders(pool),1);assert.equal(await expireShopOrders(pool),0);
  await new Promise(resolve=>server.close(resolve));server=http.createServer(await createHandler({pool,appOrigin:origin,production:true,uploadDir}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  const expired=ok(await api('/api/shop/orders/status',{cookie:'',method:'GET',token:o.input.access_token}));assert.equal(expired.status,'expired');
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:receipt(expired,{amount:25000})})).status,400);
  const fresh=await create(p,{phone:'0241234572'});assert.notEqual(fresh.id,o.id);assert.equal(await available(p),0);
});
test('Stock edits cannot remove reserved units; confirmed orders outlive the original 24-hour deadline',async()=>{
  const p=await makeProduct(2);let o=await create(p,{phone:'0241234573'});
  assert.equal((await api('/api/shop/admin/products',{data:{...p,variants:p.variants.map(v=>({...v,stock:0}))}})).status,409);
  o=await mutate(o,'confirm');await pool.query("UPDATE public.shop_orders SET reserved_until=now()-interval '1 day' WHERE id=$1",[o.id]);await expireShopOrders(pool);assert.equal(await available(p),1);
  o=await mutate(o,'cancel',{notes:'Customer cancelled'});assert.equal(await available(p),2);
  assert.equal((await mutate(o,'cancel',{notes:'Retry'})).status,'cancelled');assert.equal(await available(p),2);
});
test('Admin corrections/refunds are audited, bounded and separate from bespoke payments',async()=>{
  const p=await makeProduct();let o=await create(p,{phone:'0241234574'});o=await mutate(o,'confirm');o=ok(await api('/api/shop/staff/orders/'+o.id,{data:receipt(o)}));
  const reverse={action:'reversal',version:o.version,submission_key:randomUUID(),reverses_id:o.payments[0].id,notes:'Incorrect receipt'};
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{cookie:tailorCookie,data:reverse})).status,403);
  o=ok(await api('/api/shop/staff/orders/'+o.id,{data:reverse}));assert.equal(o.paid,0);assert.equal(o.payments[1].occurred_on,o.payments[0].occurred_on);
  o=ok(await api('/api/shop/staff/orders/'+o.id,{data:receipt(o)}));
  o=await mutate(o,'cancel',{notes:'Paid cancellation; external refund arranged'});assert.equal(await available(p),10);
  const refund=receipt(o,{action:'refund',notes:'Cash returned in person',amount:25000});
  o=ok(await api('/api/shop/staff/orders/'+o.id,{data:refund}));assert.equal(o.paid,0);assert.ok(o.audit.some(a=>a.action==='refund'));
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{...refund,submission_key:randomUUID(),version:o.version,amount:1}})).status,400);
  assert.equal(Number((await pool.query('SELECT count(*) FROM public.payments')).rows[0].count),0);
});
test('Public submission limits persist in PostgreSQL',async()=>{
  const p=await makeProduct();const key='phone:'+tokenHash('233241234575');
  await pool.query('INSERT INTO public.shop_request_limits(key,attempts) VALUES($1,10)',[key]);
  assert.equal((await api('/api/shop/orders',{cookie:'',data:payload(p,{phone:'0241234575'})})).status,429);
  assert.equal((await api('/api/shop/admin/products/'+p.id+'/images',{raw:Buffer.from('<svg/>')})).status,400);
});
test('Multi-item validation rolls back the complete checkout and snapshots survive product changes',async()=>{
  const first=await makeProduct(2),second=await makeProduct(1);
  const request=payload(first,{phone:'0241234576',items:[
    {variant_id:first.variants[0].id,quantity:1,unit_price:first.price_pesewas},
    {variant_id:second.variants[0].id,quantity:2,unit_price:second.price_pesewas},
  ]});
  assert.equal((await api('/api/shop/orders',{cookie:'',data:request})).status,409);
  assert.equal(await available(first),2);assert.equal(await available(second),1);
  assert.equal(Number((await pool.query('SELECT count(*) FROM public.shop_orders WHERE submission_key=$1',[request.submission_key])).rows[0].count),0);
  const o=await create(first,{phone:'0241234577'});
  assert.equal((await api('/api/shop/admin/products',{data:{...first,variants:first.variants.map(v=>({...v,size:'XL'}))}})).status,409);
  ok(await api('/api/shop/admin/products',{data:{...first,title:'Renamed piece',description:'Edited garment text',price_pesewas:30000,published:false}}));
  const status=ok(await api('/api/shop/orders/status',{cookie:'',method:'GET',token:o.input.access_token}));
  assert.equal(status.items[0].title,first.title);assert.equal(status.items[0].description,first.description);assert.equal(status.subtotal,25000);
  assert.equal((await api('/api/shop/products/'+first.slug,{cookie:'',method:'GET'})).status,404);
  assert.equal((await fetch(base+'/api/shop/images/'+first.images[0].id)).status,404,'previously published photos become private');
});
test('Financial guards reject overpayment, invalid dates and stale order edits',async()=>{
  const p=await makeProduct();let o=await create(p,{phone:'0241234578'});const before=o.version;o=await mutate(o,'confirm');
  for(const values of [{amount:25001},{occurred_on:'2026-02-30'},{occurred_on:'2099-01-01'},{amount:0},{amount:1.1},{method:'momo'}])
    assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:receipt(o,values)})).status,400,JSON.stringify(values));
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{data:{action:'ready',version:before}})).status,409);
  assert.equal((await api('/api/shop/staff/orders/'+o.id,{method:'GET'})).data.paid,0);
  o=await mutate(o,'cancel',{notes:'Guard test complete'});assert.equal(await available(p),10);
});
