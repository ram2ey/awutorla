// Recovery through Coolify's app terminal; values come from temporary env vars.
import pg from 'pg';
import { hashPassword, normalizeEmail } from './security.mjs';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
  const email=normalizeEmail(process.env.STAFF_EMAIL);
  const hash=await hashPassword(process.env.STAFF_PASSWORD);
  await db.query('BEGIN');
  const {rows}=await db.query('UPDATE auth.users SET password_hash=$1,must_change_password=true WHERE lower(email)=$2 RETURNING id',[hash,email]);
  if(!rows.length)throw new Error('Staff account not found.');
  await db.query('DELETE FROM auth.sessions WHERE user_id=$1',[rows[0].id]);
  await db.query('COMMIT');console.log('Temporary password set. All previous sessions revoked.');
} catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
