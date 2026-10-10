// Isolated loopback UI fixture. It never connects to a real database.
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pglitePool } from '../server/tests/pglite-pool.mjs';
import { migrate } from '../server/migrate.mjs';
import { bootstrapAdmin } from '../server/accounts.mjs';
import { createHandler } from '../server/app.mjs';
import { rpcQuery,staffTransaction } from '../server/data.mjs';
const db=new PGlite({extensions:{pgcrypto,uuid_ossp}});
const pool=pglitePool(db);
const connection=await pool.connect();
let adminId;
try {
  await migrate(connection);
  await bootstrapAdmin(connection,{BOOTSTRAP_ADMIN_EMAIL:'demo@atelier.test',BOOTSTRAP_ADMIN_PASSWORD:'Demo-workshop-password-123!'});
  adminId=(await connection.query("SELECT id FROM auth.users WHERE email='demo@atelier.test'")).rows[0].id;
  await connection.query('UPDATE auth.users SET must_change_password=false');
}finally{connection.release();}
await staffTransaction(pool,adminId,sql=>rpcQuery(sql,'create_bespoke_intake',{p_payload:{
  id:'DEMO-ORDER',task_id:'DEMO-TASK',client_name:'Demo Customer',client_phone:'233241234567',
  garment_title:'Demo tailored jacket',total_amount:1000,deposit_paid:100,currency:'GHS',
  unit:'in',measurement_values:{bust:36},tailor_id:adminId,deposit_submission_key:randomUUID(),
  payment_method:'Cash in Atelier',payment_date:new Date().toISOString().slice(0,10)}}));
const uploadDir=await mkdtemp(join(tmpdir(),'atelier-ui-fixture-'));
// Fake ready-to-wear catalogue for local UI checks only; never production data.
await pool.query(`UPDATE public.shop_settings SET contact_phone='233241234567',momo_number='233241234567',
  momo_name='UI fixture only',pickup_details='Demo studio in Accra. UI fixture only; no real collections.' WHERE id=true`);
await mkdir(join(uploadDir,'shop-products'),{recursive:true});
const fixturePhoto=await readFile(new URL('../src/assets/hero.png',import.meta.url));
for(const [slug,title,colour] of [['demo-wrap-dress','Demo wrap dress','Gold'],['demo-linen-set','Demo linen set','Cream']]) {
  const id=randomUUID(),imageId=randomUUID();
  await pool.query(`INSERT INTO public.shop_products(id,slug,title,description,category,size_guide,price_pesewas,published)
    VALUES($1,$2,$3,'UI fixture garment. Replace with your real collection before launch.','Demo collection','M: bust 36 inches. L: bust 40 inches.',25000,true)`,[id,slug,title]);
  for(const size of ['M','L'])await pool.query('INSERT INTO public.shop_variants(product_id,sku,size,colour,stock) VALUES($1,$2,$3,$4,10)',[id,slug+'-'+size,size,colour]);
  await writeFile(join(uploadDir,'shop-products',imageId+'.png'),fixturePhoto);
  await pool.query('INSERT INTO public.shop_images(id,product_id,filename,content_type,alt) VALUES($1,$2,$3,$4,$5)',[imageId,id,imageId+'.png','image/png','Atelier preview image, UI fixture only']);
}
const server=http.createServer(await createHandler({pool,appOrigin:'http://localhost:5173',production:false,uploadDir}));
server.listen(3000,'127.0.0.1',()=>console.log('Fake shop/workshop API on 127.0.0.1:3000. Shop: http://localhost:5173. Staff: http://localhost:5173/staff. Login: demo@atelier.test / Demo-workshop-password-123!'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{
  await db.close();await rm(uploadDir,{recursive:true,force:true});process.exit(0);
}));
