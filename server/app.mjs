import { readFile, mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { hashPassword, checkPassword, newToken, tokenHash, normalizeEmail, safeFilePath, imageType } from './security.mjs';
import { createAccount, resetAccount } from './accounts.mjs';
import { staffTransaction, tableQuery, rpcQuery } from './data.mjs';

const compress=promisify(gzip);
const maxUpload=10*1024*1024;
const sessionSeconds=12*60*60;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain'};
class HttpError extends Error { constructor(status,message) {super(message);this.status=status;} }

async function body(req,limit=1024*1024) {
  const chunks=[];let length=0;
  for await (const chunk of req) {
    length+=chunk.length;
    if (length>limit) throw new HttpError(413,'Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415,'Use application/json.');
  try {return JSON.parse((await body(req)).toString());}
  catch(error) {if(error instanceof HttpError) throw error;throw new HttpError(400,'Invalid JSON request.');}
}
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function within(root,path) {const full=resolve(root,path);if(!full.startsWith(resolve(root)+sep)) throw new HttpError(400,'Invalid file path.');return full;}
const sessionData=user=>({user:{id:user.id,email:user.email,must_change_password:user.must_change_password},
  expiresAt:user.expires_at || new Date(Date.now()+sessionSeconds*1000).toISOString(),
  profile:{id:user.id,role:user.role,full_name:user.full_name,phone_number:user.phone_number}});

export async function createHandler({pool,appOrigin,production=true,uploadDir='./uploads',distDir='./dist'}) {
  const origin=new URL(appOrigin).origin;
  const cookieName=production?'__Host-atelier_session':'atelier_session';
  const dummyPassword=await hashPassword(newToken());
  await mkdir(uploadDir,{recursive:true});
  function cookie(res,token,maxAge=sessionSeconds) {
    res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${production?'; Secure':''}`);
  }
  async function currentUser(req) {
    const value=(req.headers.cookie || '').split(';').map(item=>item.trim()).find(item=>item.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401,'Sign in to continue.');
    const {rows}=await pool.query(`SELECT u.id,u.email,u.must_change_password,p.role,p.full_name,p.phone_number,s.expires_at
      FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id JOIN public.profiles p ON p.id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND p.role IN ('admin','tailor')`,[tokenHash(value)]);
    if (!rows.length) throw new HttpError(401,'Your session expired. Sign in again.');
    return {...rows[0],token:value};
  }
  async function limited(key,limit) {
    const {rows}=await pool.query(`INSERT INTO auth.login_limits(key,attempts) VALUES($1,1)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth.login_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE auth.login_limits.attempts+1 END,
      started_at=CASE WHEN auth.login_limits.started_at<now()-interval '15 minutes' THEN now() ELSE auth.login_limits.started_at END RETURNING attempts`,[key]);
    if (Number(rows[0].attempts)>limit) throw new HttpError(429,'Too many sign-in attempts. Try again in 15 minutes.');
  }
  async function signIn(req,res) {
    const input=await jsonBody(req);
    const email=normalizeEmail(input.email);
    // An email limit survives restarts. The socket limit also caps concurrent
    // password hashing behind the private Coolify proxy connection.
    await limited('email:'+tokenHash(email),10);
    await limited('peer:'+tokenHash(req.socket.remoteAddress || 'unknown'),200);
    const {rows}=await pool.query(`SELECT u.*,p.role,p.full_name,p.phone_number FROM auth.users u
      JOIN public.profiles p ON p.id=u.id WHERE lower(u.email)=$1`,[email]);
    const user=rows[0];
    const valid=await checkPassword(input.password,user?.password_hash || dummyPassword);
    if (!valid || !user || !['admin','tailor'].includes(user.role)) throw new HttpError(401,'Email or password is incorrect.');
    const token=newToken();
    await pool.query(`INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[tokenHash(token),user.id]);
    await pool.query('DELETE FROM auth.login_limits WHERE key=$1',['email:'+tokenHash(email)]);
    cookie(res,token);
    json(res,200,{data:sessionData(user),error:null});
  }
  return async function handler(req,res) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    try {
      const url=new URL(req.url,origin);
      const path=url.pathname;
      if (path==='/healthz' && req.method==='GET') {
        await pool.query('SELECT 1 FROM public.atelier_migrations LIMIT 1');
        res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok\n');return;
      }
      if (path.startsWith('/api/')) {
        res.setHeader('Cache-Control','no-store');
        if (!['GET','POST','DELETE'].includes(req.method)) throw new HttpError(405,'Method not allowed.');
        if (req.method!=='GET' && req.headers.origin!==origin) throw new HttpError(403,'Request origin is not allowed.');
        if (path==='/api/auth/sign-in' && req.method==='POST') return await signIn(req,res);
        if (path==='/api/auth/sign-out' && req.method==='POST') {
          // Logout is idempotent, including an expired or revoked session.
          let user;try {user=await currentUser(req);}catch(error){if(error.status!==401)throw error;}
          if(user)await pool.query('DELETE FROM auth.sessions WHERE token_hash=$1',[tokenHash(user.token)]);
          cookie(res,'',0);json(res,200,{data:null,error:null});return;
        }
        const user=await currentUser(req);
        if (path==='/api/auth/session' && req.method==='GET') {json(res,200,{data:sessionData(user),error:null});return;}
        if (path==='/api/auth/password' && req.method==='POST') {
          const {password}=await jsonBody(req);
          if(await checkPassword(password,(await pool.query('SELECT password_hash FROM auth.users WHERE id=$1',[user.id])).rows[0].password_hash))
            throw new HttpError(400,'Choose a different password from your temporary password.');
          const db=await pool.connect();
          try {
            await db.query('BEGIN');
            const live=await db.query(`SELECT u.id FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
              WHERE u.id=$1 AND s.token_hash=$2 AND s.expires_at>now() FOR UPDATE OF u`,[user.id,tokenHash(user.token)]);
            if(!live.rows.length)throw new HttpError(401,'Your session expired. Sign in again.');
            await db.query('UPDATE auth.users SET password_hash=$1,must_change_password=false WHERE id=$2',[await hashPassword(password),user.id]);
            await db.query('DELETE FROM auth.sessions WHERE user_id=$1',[user.id]);
            const token=newToken();
            await db.query("INSERT INTO auth.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[tokenHash(token),user.id]);
            await db.query('COMMIT');cookie(res,token);
          } catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
          json(res,200,{data:sessionData({...user,must_change_password:false}),error:null});return;
        }
        if (path==='/api/query' && req.method==='POST') {
          const spec=await jsonBody(req);
          if(user.must_change_password && !(spec.table==='profiles' && (!spec.action || spec.action==='select') &&
            spec.filters?.some(filter=>filter.column==='id' && filter.op==='eq' && filter.value===user.id)))
            throw new HttpError(403,'Set your new password first.');
          json(res,200,await staffTransaction(pool,user.id,db=>tableQuery(db,spec)));return;
        }
        if(user.must_change_password)throw new HttpError(403,'Set your new password first.');
        if (path==='/api/rpc' && req.method==='POST') {
          const {name,args}=await jsonBody(req);
          json(res,200,await staffTransaction(pool,user.id,db=>rpcQuery(db,name,args)));return;
        }
        if (['/api/staff/create','/api/staff/reset-password'].includes(path) && req.method==='POST') {
          if(user.role!=='admin')throw new HttpError(403,'Admin access required.');
          const input=await jsonBody(req);
          const db=await pool.connect();
          try {
            await db.query('BEGIN');
            const data=path.endsWith('/create') ? await createAccount(db,input) : await resetAccount(db,input.userId);
            await db.query('COMMIT');json(res,200,{data,error:null});
          } catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
          return;
        }
        if (path==='/api/files' && req.method==='POST') {
          const name=safeFilePath(url.searchParams.get('path'));
          const bytes=await body(req,maxUpload);
          const type=imageType(bytes);
          const destination=within(uploadDir,name);
          let created=false;
          try {
            await staffTransaction(pool,user.id,async db=>{
              await db.query("INSERT INTO storage.objects(bucket_id,name,content_type) VALUES('order-sketches',$1,$2)",[name,type]);
              await mkdir(dirname(destination),{recursive:true});
              await writeFile(destination,bytes,{flag:'wx',mode:0o600});created=true;
            });
          } catch(error){if(created)await unlink(destination).catch(()=>{});throw error;}
          json(res,201,{data:{path:name},error:null});return;
        }
        if (path==='/api/files/url' && req.method==='POST') {
          const {path:name}=await jsonBody(req);safeFilePath(name);
          const record=await staffTransaction(pool,user.id,db=>db.query("SELECT name FROM storage.objects WHERE bucket_id='order-sketches' AND name=$1",[name]));
          if(!record.rows.length)throw new HttpError(404,'Attachment was not found.');
          json(res,200,{data:{signedUrl:`/api/files?path=${encodeURIComponent(name)}`},error:null});return;
        }
        if (path==='/api/files' && req.method==='GET') {
          const name=safeFilePath(url.searchParams.get('path'));
          const record=await staffTransaction(pool,user.id,db=>db.query("SELECT content_type FROM storage.objects WHERE bucket_id='order-sketches' AND name=$1",[name]));
          if(!record.rows.length)throw new HttpError(404,'Attachment was not found.');
          const bytes=await readFile(within(uploadDir,name));
          res.writeHead(200,{'Content-Type':record.rows[0].content_type,'Cache-Control':'private, no-store'});res.end(bytes);return;
        }
        if (path==='/api/files' && req.method==='DELETE') {
          const {paths}=await jsonBody(req);
          if(!Array.isArray(paths) || paths.length!==1)throw new HttpError(400,'Delete one reviewed upload at a time.');
          const name=safeFilePath(paths[0]);
          const deleted=await staffTransaction(pool,user.id,db=>db.query("DELETE FROM storage.objects WHERE bucket_id='order-sketches' AND name=$1 RETURNING name",[name]));
          if(!deleted.rows.length)throw new HttpError(403,'Only admins can remove unused uploads older than 48 hours.');
          await unlink(within(uploadDir,name)).catch(error=>{if(error.code!=='ENOENT')console.error('Unused file remains on disk; review storage permissions.');});
          json(res,200,{data:deleted.rows,error:null});return;
        }
        throw new HttpError(404,'Endpoint not found.');
      }
      if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
      let relative;
      try {relative=decodeURIComponent(path).replace(/^\/+/, '');}catch{throw new HttpError(400,'Invalid path.');}
      if(relative.split('/').some(part=>part.startsWith('.')) || relative.includes('\\'))throw new HttpError(404,'Not found.');
      let file=within(distDir,relative || 'index.html');
      try {if(!(await stat(file)).isFile())throw new Error();}
      catch {
        if(relative.startsWith('assets/') || extname(relative) || /^(auth|rest|storage|functions|realtime)(\/|$)/.test(relative))throw new HttpError(404,'Not found.');
        file=within(distDir,'index.html');
      }
      const extension=extname(file);
      let bytes=await readFile(file);
      const noStore=extension==='.html' || relative==='sw.js';
      res.setHeader('Cache-Control',noStore?'no-store':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache');
      res.setHeader('Content-Type',mime[extension] || 'application/octet-stream');
      if(['.html','.js','.css','.json','.svg'].includes(extension)) {
        res.setHeader('Vary','Accept-Encoding');
        if(bytes.length>1024 && /(?:^|,)\s*gzip(?:\s*,|\s*$|\s*;q=(?!0(?:\.0*)?(?:,|$)))/.test(req.headers['accept-encoding'] || '')) {
          bytes=await compress(bytes);res.setHeader('Content-Encoding','gzip');
        }
      }
      res.setHeader('Content-Length',bytes.length);res.statusCode=200;res.end(req.method==='HEAD'?undefined:bytes);
    } catch(error) {
      let status=error.status || (error.code==='ENOENT'?404:400);
      if(error.code==='ECONNREFUSED' || error.code==='57P01' || req.url==='/healthz')status=503;
      if(status>=500)console.error('Backend operation unavailable:',error.code || error.name);
      const message=status>=500?'Service is temporarily unavailable.':error.code==='23505'?'This record already exists.':
        ['42501','23503'].includes(error.code)?'This operation is not permitted or references a missing record.':error.message || 'Request failed.';
      json(res,status,{data:null,error:{message},count:null});
    }
  };
}
