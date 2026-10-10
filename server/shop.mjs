import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tokenHash, imageType } from './security.mjs';

class ShopError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail=(message,status=400)=>{throw new ShopError(status,message);};
const text=(value,label,max=200,required=true)=>{
  if(typeof value!=='string' || value.trim().length>max || (required && !value.trim())) fail(`Enter ${label}.`);
  return value.trim();
};
const integer=(value,label,min=0,max=100000000)=>{
  if(!Number.isSafeInteger(value) || value<min || value>max)fail(`Enter a valid ${label}.`);return value;
};
const uuid=value=>{if(typeof value!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('Invalid identifier.');return value;};
const phone=value=>{let digits=text(value,'Ghanaian phone number',30).replace(/[\s()+-]/g,'');
  if(/^0\d{9}$/.test(digits))digits='233'+digits.slice(1);
  if(!/^233\d{9}$/.test(digits))fail('Enter a Ghanaian phone number, for example 0241234567.');return digits;};
const hash=value=>tokenHash(JSON.stringify(value));
const admin=user=>{if(user.role!=='admin')fail('Admin access required.',403);};
const allocationPredicate="a.released_at IS NULL AND a.consumed_at IS NULL AND o.status IN ('awaiting_confirmation','confirmed','ready') AND (o.status<>'awaiting_confirmation' OR o.reserved_until>now())";
const availableSql=`v.stock-COALESCE((SELECT sum(a.quantity) FROM public.shop_allocations a JOIN public.shop_orders o ON o.id=a.order_id WHERE a.variant_id=v.id AND ${allocationPredicate}),0)`;

// Every stock-changing transaction takes the same advisory lock before row locks.
// This also prevents expiry, cancellation and stock edits acquiring locks in
// opposing orders. The shop is small; transactions never include external work.
async function transaction(pool,run) {
  const db=await pool.connect();
  try {await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(735218402)');
    const result=await run(db);await db.query('COMMIT');return result;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
async function expire(db) {
  await db.query("DELETE FROM public.shop_request_limits WHERE started_at<now()-interval '1 day'");
  const {rows}=await db.query(`UPDATE public.shop_orders SET status='expired',version=version+1,updated_at=now()
    WHERE status='awaiting_confirmation' AND reserved_until<=now() RETURNING id`);
  for(const order of rows) {
    await db.query('UPDATE public.shop_allocations SET released_at=now() WHERE order_id=$1 AND released_at IS NULL AND consumed_at IS NULL',[order.id]);
    await audit(db,null,'reservation_expired',{},order.id);
  }
  return rows.length;
}
export const expireShopOrders=pool=>transaction(pool,expire);
async function audit(db,actor,action,details,orderId=null) {
  await db.query('INSERT INTO public.shop_audit(actor_id,action,details,order_id) VALUES($1,$2,$3,$4)',[actor,action,JSON.stringify(details),orderId]);
}
async function settings(db) {return (await db.query('SELECT * FROM public.shop_settings WHERE id=true')).rows[0];}
function ready(config) {return !!(config.contact_phone && config.momo_number && config.momo_name && config.pickup_details);}
async function product(db,id,staff=false) {
  const {rows}=await db.query(`SELECT p.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'alt',i.alt,'position',i.position) ORDER BY i.position,i.id)
    FROM public.shop_images i WHERE i.product_id=p.id),'[]') AS images,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'size',v.size,'colour',v.colour,
      'active',v.active,'stock',${staff?'v.stock':'NULL'},'available',${availableSql}) ORDER BY v.size,v.colour)
      FROM public.shop_variants v WHERE v.product_id=p.id ${staff?'':'AND v.active'}),'[]') AS variants
    FROM public.shop_products p WHERE p.id=$1 ${staff?'':'AND p.published'}`,[id]);
  if(!rows.length)fail('Product was not found.',404);return rows[0];
}
async function orderDetails(db,id,staff=false) {
  const order=(await db.query('SELECT * FROM public.shop_orders WHERE id=$1',[id])).rows[0];
  if(!order)fail('Order was not found.',404);
  const items=(await db.query('SELECT title,description,sku,size,colour,quantity,unit_price FROM public.shop_order_items WHERE order_id=$1 ORDER BY id',[id])).rows;
  const payments=(await db.query(`SELECT p.id,p.kind,p.amount,p.method,p.occurred_on,p.reference,p.notes,p.reverses_id,p.recorded_at,
    s.full_name AS recorded_by_name FROM public.shop_payments p JOIN public.profiles s ON s.id=p.recorded_by WHERE p.order_id=$1 ORDER BY p.recorded_at,p.id`,[id])).rows;
  const paid=payments.reduce((sum,p)=>sum+(p.kind==='receipt'?p.amount:-p.amount),0);
  const config=await settings(db);
  const result={id:order.id,reference:order.reference,customer_name:order.customer_name,phone:order.phone,
    address:order.address,fulfilment:order.fulfilment,payment_method:order.payment_method,subtotal:order.subtotal,
    delivery_fee:order.delivery_fee,total:order.delivery_fee===null?null:order.subtotal+order.delivery_fee,
    status:order.status,reserved_until:order.reserved_until,created_at:order.created_at,version:order.version,is_test:order.is_test,
    paid,items,contact_phone:config.contact_phone,pickup_details:config.pickup_details,
    payment_instructions:['confirmed','ready'].includes(order.status) && order.payment_method==='momo'
      ? {number:config.momo_number,name:config.momo_name}:null};
  if(staff) {
    result.payments=payments;
    result.audit=(await db.query(`SELECT a.action,a.details,a.created_at,s.full_name AS actor FROM public.shop_audit a
      LEFT JOIN public.profiles s ON s.id=a.actor_id WHERE order_id=$1 ORDER BY a.created_at,a.id`,[id])).rows;
  }
  return result;
}
function checkoutInput(input) {
  const submission_key=uuid(input.submission_key);
  if(typeof input.access_token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(input.access_token))fail('Invalid order access token.');
  if(!['pickup','delivery'].includes(input.fulfilment) || !['momo','cash'].includes(input.payment_method))fail('Choose collection and payment options.');
  if(input.fulfilment==='delivery' && input.payment_method!=='momo')fail('Delivery orders require mobile money payment.');
  if(!Array.isArray(input.items) || !input.items.length || input.items.length>30)fail('Choose between 1 and 30 items.');
  const items=input.items.map(item=>({variant_id:uuid(item.variant_id),quantity:integer(item.quantity,'quantity',1,100),unit_price:integer(item.unit_price,'price',1)})).sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
  if(new Set(items.map(i=>i.variant_id)).size!==items.length)fail('Combine duplicate cart items.');
  return {submission_key,access_token:input.access_token,customer_name:text(input.customer_name,'customer name',120),phone:phone(input.phone),
    fulfilment:input.fulfilment,payment_method:input.payment_method,address:input.fulfilment==='delivery'?text(input.address,'Ghana delivery address',1000):'',items};
}
async function createOrder(pool,input,isTest) {
  const request=checkoutInput(input), requestHash=hash({...request,is_test:isTest});
  return transaction(pool,async db=>{
    await expire(db);
    const previous=(await db.query('SELECT id,request_hash FROM public.shop_orders WHERE submission_key=$1',[request.submission_key])).rows[0];
    if(previous) {if(previous.request_hash!==requestHash)fail('This submission was already used with different details.',409);return orderDetails(db,previous.id);}
    const config=await settings(db);
    if(!ready(config))fail('Checkout is awaiting the shop contact and payment details.',503);
    if(!isTest && (!config.shop_open || !config.checkout_enabled))fail('Checkout is currently closed.',503);
    const variants=[];let subtotal=0;
    for(const item of request.items) {
      const variant=(await db.query(`SELECT v.*,p.title,p.description,p.price_pesewas,p.published,${availableSql} AS available
        FROM public.shop_variants v JOIN public.shop_products p ON p.id=v.product_id WHERE v.id=$1 FOR UPDATE OF v`,[item.variant_id])).rows[0];
      if(!variant || !variant.active || !variant.published)fail('An item is no longer available. Review your cart.',409);
      if(item.unit_price!==variant.price_pesewas)fail(`${variant.title} has a new price. Review your cart before retrying.`,409);
      if(Number(variant.available)<item.quantity)fail(`Only ${variant.available} of ${variant.title} (${variant.size}, ${variant.colour}) are available. Review your cart.`,409);
      subtotal+=item.quantity*variant.price_pesewas;variants.push({...variant,quantity:item.quantity});
    }
    integer(subtotal,'order total',1);
    const id=randomUUID(), reference='RTW-'+id.replaceAll('-','').slice(0,12).toUpperCase();
    await db.query(`INSERT INTO public.shop_orders(id,reference,submission_key,token_hash,request_hash,customer_name,phone,address,fulfilment,payment_method,subtotal,delivery_fee,is_test)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,reference,request.submission_key,tokenHash(request.access_token),requestHash,
      request.customer_name,request.phone,request.address,request.fulfilment,request.payment_method,subtotal,request.fulfilment==='pickup'?0:null,isTest]);
    for(const v of variants) {
      await db.query(`INSERT INTO public.shop_order_items(order_id,variant_id,title,description,sku,size,colour,quantity,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,v.id,v.title,v.description,v.sku,v.size,v.colour,v.quantity,v.price_pesewas]);
      await db.query('INSERT INTO public.shop_allocations(order_id,variant_id,quantity) VALUES($1,$2,$3)',[id,v.id,v.quantity]);
    }
    await audit(db,null,isTest?'test_order_created':'order_created',{},id);
    return orderDetails(db,id);
  });
}
async function mutateOrder(pool,user,id,input) {
  const action=text(input.action,'action',40);
  if(['reversal','refund'].includes(action))admin(user);
  return transaction(pool,async db=>{
    await expire(db);
    let requestHash;
    if(['receipt','reversal','refund'].includes(action)) {
      uuid(input.submission_key);requestHash=hash({id,...input});
      const prior=(await db.query('SELECT request_hash FROM public.shop_payments WHERE submission_key=$1',[input.submission_key])).rows[0];
      if(prior) {if(prior.request_hash!==requestHash)fail('Payment submission details changed.',409);return orderDetails(db,id,true);}
    }
    const order=(await db.query('SELECT * FROM public.shop_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!order)fail('Order was not found.',404);
    if(order.version!==input.version)fail('This order changed. Refresh before retrying.',409);
    const details=await orderDetails(db,id,true), total=details.total;
    if(action==='confirm') {
      if(order.status!=='awaiting_confirmation')fail('Only a live, unconfirmed order can be confirmed.',409);
      const fee=order.fulfilment==='pickup'?0:integer(input.delivery_fee,'agreed delivery fee');
      if(order.fulfilment==='delivery' && input.fee_agreed!==true)fail('Confirm the customer has agreed the delivery fee.');
      integer(order.subtotal+fee,'order total',1);
      await db.query("UPDATE public.shop_orders SET status='confirmed',delivery_fee=$2 WHERE id=$1",[id,fee]);
    }else if(action==='ready') {
      if(order.status!=='confirmed')fail('Confirm the order before preparing it.',409);
      if(order.fulfilment==='delivery' && details.paid!==total)fail('Verify full payment before preparing a delivery order.');
      await db.query("UPDATE public.shop_orders SET status='ready' WHERE id=$1",[id]);
    }else if(action==='fulfil') {
      if(order.status!=='ready' || details.paid!==total)fail('The order must be ready and fully paid before fulfilment.');
      const allocations=(await db.query('SELECT * FROM public.shop_allocations WHERE order_id=$1 ORDER BY variant_id',[id])).rows;
      for(const a of allocations) {
        if(a.released_at || a.consumed_at)fail('Stock allocation is no longer active.',409);
        await db.query('SELECT id FROM public.shop_variants WHERE id=$1 FOR UPDATE',[a.variant_id]);
        const changed=await db.query('UPDATE public.shop_variants SET stock=stock-$2 WHERE id=$1 AND stock>=$2 RETURNING id',[a.variant_id,a.quantity]);
        if(!changed.rows.length)fail('Stock changed. Resolve inventory before fulfilling.',409);
      }
      await db.query('UPDATE public.shop_allocations SET consumed_at=now() WHERE order_id=$1',[id]);
      await db.query(`UPDATE public.shop_products SET version=version+1 WHERE id IN
        (SELECT product_id FROM public.shop_variants WHERE id IN (SELECT variant_id FROM public.shop_allocations WHERE order_id=$1))`,[id]);
      await db.query("UPDATE public.shop_orders SET status='fulfilled' WHERE id=$1",[id]);
    }else if(action==='cancel') {
      if(['cancelled','expired'].includes(order.status))return details;
      if(order.status==='fulfilled')fail('Fulfilled orders cannot be cancelled.');
      text(input.notes,'cancellation reason',1000);
      if(details.paid>0)admin(user);
      await db.query("UPDATE public.shop_orders SET status='cancelled' WHERE id=$1",[id]);
      await db.query('UPDATE public.shop_allocations SET released_at=now() WHERE order_id=$1 AND released_at IS NULL AND consumed_at IS NULL',[id]);
    }else if(['receipt','reversal','refund'].includes(action)) {
      let amount,method,date,reverses=null;
      const notes=text(input.notes ?? '',action==='receipt'?'notes':'a reason',1000,action!=='receipt');
      const reference=text(input.reference ?? '','transaction reference',200,false);
      if(action==='reversal') {
        reverses=uuid(input.reverses_id);
        const payment=details.payments.find(p=>p.id===reverses && p.kind==='receipt');
        if(!payment || details.payments.some(p=>p.reverses_id===reverses))fail('Choose an unreversed receipt.');
        amount=payment.amount;method=payment.method;date=payment.occurred_on;
        if(details.paid<amount)fail('This receipt has already been refunded.');
        if(order.status==='fulfilled')fail('Fulfilled receipts cannot be corrected here. Record an external refund instead.');
      }else {
        amount=integer(input.amount,'receipt amount',1);method=input.method;
        if(!['momo','cash'].includes(method) || (action==='receipt' && method!==order.payment_method))fail('Use the order payment method.');
        date=text(input.occurred_on,'receipt date',10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date || date>new Date().toISOString().slice(0,10))fail('Use a valid receipt date that is not in the future.');
        if(method==='momo' && !reference)fail('Enter the mobile money transaction reference.');
        if(action==='receipt' && (!['confirmed','ready'].includes(order.status) || total===null || details.paid+amount>total))fail('Confirm the order first and record no more than its remaining balance. Expired orders need a fresh order and stock allocation.');
        if(action==='refund' && amount>details.paid)fail('A refund cannot exceed net payments received.');
      }
      await db.query(`INSERT INTO public.shop_payments(order_id,submission_key,request_hash,kind,amount,method,occurred_on,reference,notes,reverses_id,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,input.submission_key,requestHash,action,amount,method,date,reference,notes,reverses,user.id]);
      // A correction/refund can invalidate a delivery's readiness.
      if(order.status==='ready' && order.fulfilment==='delivery')await db.query("UPDATE public.shop_orders SET status='confirmed' WHERE id=$1",[id]);
    }else fail('Unknown shop operation.');
    await db.query('UPDATE public.shop_orders SET version=version+1,updated_at=now() WHERE id=$1',[id]);
    const after=await orderDetails(db,id,true);
    await audit(db,user.id,action,{before_status:order.status,after_status:after.status,delivery_fee:after.delivery_fee,notes:input.notes || '',submission_key:input.submission_key || null},id);
    return orderDetails(db,id,true);
  });
}

export function createShopHandler({pool,uploadDir,currentUser,json,jsonBody,body}) {
  const imageRoot=join(uploadDir,'shop-products');
  async function limit(req,scope,max=200,identity) {
    const peer=identity || tokenHash(req.socket.remoteAddress || 'unknown');
    const {rows}=await pool.query(`INSERT INTO public.shop_request_limits(key,attempts) VALUES($1,1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN shop_request_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE shop_request_limits.attempts+1 END,
      started_at=CASE WHEN shop_request_limits.started_at<now()-interval '15 minutes' THEN now() ELSE shop_request_limits.started_at END RETURNING attempts`,[scope+':'+peer]);
    if(rows[0].attempts>max)fail('Too many shop requests. Try again in 15 minutes.',429);
  }
  return async(req,res,url)=>{
    const path=url.pathname;
    const send=data=>json(res,200,{data,error:null});
    if(path==='/api/shop/config' && req.method==='GET') {
      const c=await settings(pool);return send({business_name:c.business_name,contact_phone:c.contact_phone,contact_email:c.contact_email,
        pickup_details:c.pickup_details,shop_open:c.shop_open,checkout_enabled:c.shop_open && c.checkout_enabled && ready(c)});
    }
    if(path==='/api/shop/products' && req.method==='GET') {
      const c=await settings(pool);if(!c.shop_open)return send({products:[],total:0,categories:[]});
      const page=integer(Number(url.searchParams.get('page') || 0),'page',0,100000);
      const search=text(url.searchParams.get('search') || '','search',100,false);
      const category=text(url.searchParams.get('category') || '','category',100,false);
      const params=['%'+search+'%',category];
      const predicate="published AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2)";
      const ids=(await pool.query(`SELECT id FROM public.shop_products WHERE ${predicate} ORDER BY created_at DESC,id LIMIT 24 OFFSET $3`,[...params,page*24])).rows;
      const products=[];for(const p of ids)products.push(await product(pool,p.id));
      const total=Number((await pool.query(`SELECT count(*) FROM public.shop_products WHERE ${predicate}`,params)).rows[0].count);
      const categories=(await pool.query("SELECT DISTINCT category FROM public.shop_products WHERE published AND category<>'' ORDER BY category")).rows.map(c=>c.category);
      return send({products,total,categories});
    }
    if(path.startsWith('/api/shop/products/') && req.method==='GET') {
      if(!(await settings(pool)).shop_open)fail('The shop is currently closed.',404);
      const slug=decodeURIComponent(path.slice('/api/shop/products/'.length));
      const p=(await pool.query('SELECT id FROM public.shop_products WHERE slug=$1 AND published',[slug])).rows[0];
      if(!p)fail('Product was not found.',404);return send(await product(pool,p.id));
    }
    if(path==='/api/shop/orders' && req.method==='POST') {
      await limit(req,'checkout',1000);
      const input=await jsonBody(req);
      // Additional phone limit reduces repeated reservations without trusting proxy headers.
      const key='phone:'+tokenHash(phone(input.phone));
      const {rows}=await pool.query(`INSERT INTO public.shop_request_limits(key,attempts) VALUES($1,1)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN shop_request_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE shop_request_limits.attempts+1 END,
        started_at=CASE WHEN shop_request_limits.started_at<now()-interval '15 minutes' THEN now() ELSE shop_request_limits.started_at END RETURNING attempts`,[key]);
      if(rows[0].attempts>10)fail('Too many order attempts for this phone number. Try again in 15 minutes.',429);
      return send(await createOrder(pool,input,false));
    }
    if(path==='/api/shop/orders/status' && req.method==='GET') {
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token))fail('Order link was not found.',404);
      await limit(req,'status-peer',10000);
      await limit(req,'status-token',60,tokenHash(token));
      await expireShopOrders(pool);
      const o=(await pool.query('SELECT id FROM public.shop_orders WHERE token_hash=$1',[tokenHash(token)])).rows[0];
      if(!o)fail('Order link was not found.',404);return send(await orderDetails(pool,o.id));
    }
    const publicImage=path.match(/^\/api\/shop\/images\/([a-f0-9-]+)$/);
    if(publicImage && req.method==='GET')return await imageResponse(publicImage[1],false);
    // No other public routes exist; staff identity and password replacement remain mandatory.
    const user=await currentUser(req);
    if(user.must_change_password)fail('Set your new password first.',403);
    if(path==='/api/shop/admin/test-order' && req.method==='POST') {admin(user);return send(await createOrder(pool,await jsonBody(req),true));}
    if(path==='/api/shop/staff/orders' && req.method==='GET') {
      await expireShopOrders(pool);
      const page=integer(Number(url.searchParams.get('page') || 0),'page',0,100000);
      const status=url.searchParams.get('status') || 'awaiting_confirmation';
      if(!['all','awaiting_confirmation','confirmed','ready','fulfilled','cancelled','expired'].includes(status))fail('Choose an order filter.');
      const rows=(await pool.query(`SELECT id,reference,customer_name,phone,status,fulfilment,subtotal,delivery_fee,is_test,created_at,reserved_until
        FROM public.shop_orders WHERE ($1='all' OR status=$1) ORDER BY created_at DESC,id LIMIT 25 OFFSET $2`,[status,page*25])).rows;
      const counts=(await pool.query('SELECT status,count(*)::integer AS count FROM public.shop_orders GROUP BY status')).rows;
      return send({orders:rows,counts:Object.fromEntries(counts.map(c=>[c.status,c.count])),total:status==='all'?counts.reduce((s,c)=>s+c.count,0):counts.find(c=>c.status===status)?.count || 0});
    }
    const staffOrder=path.match(/^\/api\/shop\/staff\/orders\/([a-f0-9-]+)$/);
    if(staffOrder) {
      const id=uuid(staffOrder[1]);
      if(req.method==='GET'){await expireShopOrders(pool);return send(await orderDetails(pool,id,true));}
      if(req.method==='POST')return send(await mutateOrder(pool,user,id,await jsonBody(req)));
    }
    if(!path.startsWith('/api/shop/admin/'))fail('Shop endpoint was not found.',404);
    admin(user);
    const adminImage=path.match(/^\/api\/shop\/admin\/images\/([a-f0-9-]+)$/);
    if(adminImage && req.method==='GET')return await imageResponse(adminImage[1],true);
    if(adminImage && req.method==='DELETE') {
      const id=uuid(adminImage[1]);
      await transaction(pool,async db=>{
        const image=(await db.query('SELECT product_id FROM public.shop_images WHERE id=$1',[id])).rows[0];
        if(!image)fail('Photo was not found.',404);
        const p=(await db.query('SELECT published FROM public.shop_products WHERE id=$1',[image.product_id])).rows[0];
        const count=Number((await db.query('SELECT count(*) FROM public.shop_images WHERE product_id=$1',[image.product_id])).rows[0].count);
        if(p.published && count===1)fail('Unpublish the product before removing its last photo.');
        await db.query('DELETE FROM public.shop_images WHERE id=$1',[id]);await audit(db,user.id,'product_image_removed',{image_id:id});
      });
      // Keep immutable bytes; existing cached image URLs cannot point to replacement content.
      return send(null);
    }
    if(path==='/api/shop/admin/settings') {
      if(req.method==='GET') {
        const c=await settings(pool);const tested=(await pool.query("SELECT EXISTS(SELECT 1 FROM public.shop_orders WHERE is_test AND status='fulfilled') AS tested")).rows[0].tested;
        return send({...c,test_order_complete:tested});
      }
      if(req.method==='POST') {
        const input=await jsonBody(req);
        const c={business_name:text(input.business_name,'business name',120),contact_phone:input.contact_phone?phone(input.contact_phone):'',
          contact_email:text(input.contact_email || '','contact email',254,false),momo_number:input.momo_number?phone(input.momo_number):'',
          momo_name:text(input.momo_name || '','mobile money account name',120,false),pickup_details:text(input.pickup_details || '','pickup details',1000,false),
          shop_open:input.shop_open===true,checkout_enabled:input.checkout_enabled===true};
        if(c.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contact_email))fail('Enter a valid contact email.');
        return send(await transaction(pool,async db=>{
          const previous=await settings(db);if(previous.version!==input.version)fail('Shop settings changed. Reload before saving.',409);
          if(c.checkout_enabled) {
            if(!ready(c) || !c.shop_open)fail('Complete contact, MoMo and pickup details and open the shop before enabling checkout.');
            const tested=(await db.query("SELECT EXISTS(SELECT 1 FROM public.shop_orders WHERE is_test AND status='fulfilled') AS tested")).rows[0].tested;
            if(!tested)fail('Complete a test checkout and fulfil its order before enabling checkout.');
            const stocked=(await db.query(`SELECT EXISTS(SELECT 1 FROM public.shop_variants v JOIN public.shop_products p ON p.id=v.product_id
              WHERE p.published AND v.active AND ${availableSql}>0 AND EXISTS(SELECT 1 FROM public.shop_images i WHERE i.product_id=p.id)) AS stocked`)).rows[0].stocked;
            if(!stocked)fail('Publish a photographed product with available stock first.');
          }
          await db.query(`UPDATE public.shop_settings SET business_name=$1,contact_phone=$2,contact_email=$3,momo_number=$4,momo_name=$5,pickup_details=$6,
            shop_open=$7,checkout_enabled=$8,version=version+1 WHERE id=true`,Object.values(c));
          await audit(db,user.id,'shop_settings_saved',{before:previous,after:c});return settings(db);
        }));
      }
    }
    if(path==='/api/shop/admin/products' && req.method==='GET') {
      const ids=(await pool.query('SELECT id FROM public.shop_products ORDER BY created_at DESC,id')).rows;
      const products=[];for(const p of ids)products.push(await product(pool,p.id,true));return send(products);
    }
    if(path==='/api/shop/admin/products' && req.method==='POST') {
      const input=await jsonBody(req);
      const id=input.id?uuid(input.id):randomUUID();
      const slug=text(input.slug,'product URL name',100);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail('Use lowercase letters, numbers and hyphens for the URL name.');
      const title=text(input.title,'product title',160),description=text(input.description || '','description',5000,false);
      const category=text(input.category || '','category',100,false),sizeGuide=text(input.size_guide || '','size guide',3000,false);
      const price=integer(input.price_pesewas,'price in pesewas',1),published=input.published===true;
      if(!Array.isArray(input.variants) || !input.variants.length || input.variants.length>100)fail('Add 1–100 variants.');
      const variants=input.variants.map(v=>({id:v.id?uuid(v.id):randomUUID(),sku:text(v.sku,'SKU',100),size:text(v.size,'size',60),colour:text(v.colour,'colour',60),stock:integer(v.stock,'stock quantity',0,1000000),active:v.active!==false}));
      if(new Set(variants.map(v=>v.id)).size!==variants.length || new Set(variants.map(v=>v.sku)).size!==variants.length || new Set(variants.map(v=>v.size+'\0'+v.colour)).size!==variants.length)fail('Variant sizes, colours and SKUs must be unique.');
      return send(await transaction(pool,async db=>{
        await expire(db);
        const previous=(await db.query('SELECT * FROM public.shop_products WHERE id=$1',[id])).rows[0];
        if(input.id && (!previous || previous.version!==input.version))fail('Product changed. Reload before saving.',409);
        if(published && (!description || !sizeGuide || !variants.some(v=>v.active)))fail('Add a description, size guide and active variant before publishing.');
        if(published && !(await db.query('SELECT id FROM public.shop_images WHERE product_id=$1 LIMIT 1',[id])).rows.length)fail('Save the draft and upload a product photo before publishing.');
        await db.query(`INSERT INTO public.shop_products(id,slug,title,description,category,size_guide,price_pesewas,published)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,title=EXCLUDED.title,description=EXCLUDED.description,
          category=EXCLUDED.category,size_guide=EXCLUDED.size_guide,price_pesewas=EXCLUDED.price_pesewas,published=EXCLUDED.published,version=shop_products.version+1`,[id,slug,title,description,category,sizeGuide,price,published]);
        for(const v of variants.sort((a,b)=>a.id.localeCompare(b.id))) {
          const old=(await db.query(`SELECT v.*,${availableSql} AS available FROM public.shop_variants v WHERE id=$1 FOR UPDATE`,[v.id])).rows[0];
          if(old && old.product_id!==id)fail('Variant belongs to another product.');
          const reserved=old ? old.stock-Number(old.available) : 0;
          if(old && v.stock<reserved)fail(`${v.sku}: stock cannot be below reserved quantities.`,409);
          if(reserved>0 && (old.sku!==v.sku || old.size!==v.size || old.colour!==v.colour))fail('A reserved variant cannot change its SKU, size or colour. Add a new variant instead.',409);
          await db.query(`INSERT INTO public.shop_variants(id,product_id,sku,size,colour,stock,active) VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,size=EXCLUDED.size,colour=EXCLUDED.colour,stock=EXCLUDED.stock,active=EXCLUDED.active`,[v.id,id,v.sku,v.size,v.colour,v.stock,v.active]);
        }
        // Omitted variants remain for historical orders but leave the catalogue.
        await db.query('UPDATE public.shop_variants SET active=false WHERE product_id=$1 AND NOT(id=ANY($2::uuid[]))',[id,variants.map(v=>v.id)]);
        await audit(db,user.id,'product_saved',{id,before:previous || null,after:{slug,title,price,published,variants}});
        return product(db,id,true);
      }));
    }
    const imageUpload=path.match(/^\/api\/shop\/admin\/products\/([a-f0-9-]+)\/images$/);
    if(imageUpload && req.method==='POST') {
      const id=uuid(imageUpload[1]);await product(pool,id,true);
      const bytes=await body(req,10*1024*1024),type=imageType(bytes);
      if(!['image/png','image/jpeg','image/webp'].includes(type))fail('Use a PNG, JPEG or WebP product photo.');
      const imageId=randomUUID(),filename=imageId+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type]);
      const alt=text(url.searchParams.get('alt') || '','photo description',200,false);
      await mkdir(imageRoot,{recursive:true});await writeFile(join(imageRoot,filename),bytes,{flag:'wx',mode:0o600});
      try {await transaction(pool,async db=>{
        const count=Number((await db.query('SELECT count(*) FROM public.shop_images WHERE product_id=$1',[id])).rows[0].count);
        if(count>=8)fail('Use up to eight photos per product.');
        await db.query('INSERT INTO public.shop_images(id,product_id,filename,content_type,alt,position) VALUES($1,$2,$3,$4,$5,$6)',[imageId,id,filename,type,alt,count]);
        await audit(db,user.id,'product_image_added',{product_id:id,image_id:imageId});
      });}catch(error){await unlink(join(imageRoot,filename));throw error;}
      return send(await product(pool,id,true));
    }
    fail('Shop endpoint was not found.',404);

    async function imageResponse(id,isAdmin) {
      uuid(id);
      const image=(await pool.query(`SELECT i.* FROM public.shop_images i JOIN public.shop_products p ON p.id=i.product_id
        WHERE i.id=$1 ${isAdmin?'':"AND p.published AND (SELECT shop_open FROM public.shop_settings WHERE id=true)"}`,[id])).rows[0];
      if(!image)fail('Photo was not found.',404);
      const bytes=await readFile(join(imageRoot,image.filename));
      res.writeHead(200,{'Content-Type':image.content_type,'Cache-Control':'no-store','Content-Length':bytes.length});res.end(bytes);
    }
  };
}
