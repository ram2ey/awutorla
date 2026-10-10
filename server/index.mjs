import http from 'node:http';
import { resolve } from 'node:path';
import pg from 'pg';
import { migrate } from './migrate.mjs';
import { bootstrapAdmin } from './accounts.mjs';
import { createHandler } from './app.mjs';
import { expireShopOrders } from './shop.mjs';

// Keep calendar dates independent of the server's timezone and API timestamps.
pg.types.setTypeParser(1082,value=>value);

if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL to the private PostgreSQL connection URL.');
const production=process.env.NODE_ENV==='production';
const port=Number(process.env.PORT || 3000);
const appOrigin=process.env.APP_ORIGIN || (!production?'http://localhost:5173':null);
if(!appOrigin || (production && new URL(appOrigin).protocol!=='https:'))throw new Error('Set APP_ORIGIN to the public HTTPS app origin.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,
  idleTimeoutMillis:30000,statement_timeout:20000});
const db=await pool.connect();
try {await migrate(db);await bootstrapAdmin(db);}finally{db.release();}
const handler=await createHandler({pool,appOrigin,production,uploadDir:resolve(process.env.UPLOAD_DIR || './uploads'),distDir:resolve('./dist')});
const server=http.createServer(handler);
server.requestTimeout=30000;
server.headersTimeout=15000;
server.listen(port,'0.0.0.0',()=>console.log(`Awutorla is listening on port ${port}.`));
await expireShopOrders(pool);
const shopCleanup=setInterval(()=>expireShopOrders(pool).catch(()=>console.error('Shop reservation maintenance failed.')),60000);
shopCleanup.unref();
const cleanup=setInterval(()=>pool.query("DELETE FROM auth.sessions WHERE expires_at<now(); DELETE FROM auth.login_limits WHERE started_at<now()-interval '1 day'").catch(()=>console.error('Session maintenance failed.')),60*60*1000);
cleanup.unref();
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{
  clearInterval(cleanup);
  clearInterval(shopCleanup);
  server.close(async()=>{await pool.end();process.exit(0);});
  setTimeout(()=>process.exit(1),10000).unref();
});
