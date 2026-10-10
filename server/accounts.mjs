import { randomUUID } from 'node:crypto';
import { hashPassword, newToken, normalizeEmail, validPassword } from './security.mjs';

export async function createAccount(db, {fullName,email,role,phone}, password=newToken()) {
  email=normalizeEmail(email);
  if (!['admin','tailor'].includes(role) || typeof fullName!=='string' || !fullName.trim() || fullName.length>150 ||
      (phone && (typeof phone!=='string' || !/^\+?[0-9]{9,15}$/.test(phone)))) throw new Error('Enter valid staff details.');
  const id=randomUUID();
  await db.query(`INSERT INTO auth.users(id,email,phone,password_hash,raw_user_meta_data,raw_app_meta_data)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,email,phone || null,await hashPassword(password),
    JSON.stringify({full_name:fullName.trim()}),JSON.stringify({role})]);
  return {userId:id,tempPassword:password};
}

export async function resetAccount(db,id) {
  const password=newToken();
  const changed=await db.query('UPDATE auth.users SET password_hash=$1,must_change_password=true WHERE id=$2 RETURNING id',
    [await hashPassword(password),id]);
  if (!changed.rows.length) throw new Error('Staff account not found.');
  await db.query('DELETE FROM auth.sessions WHERE user_id=$1',[id]);
  return {userId:id,tempPassword:password};
}

export async function bootstrapAdmin(db, env=process.env) {
  if (!env.BOOTSTRAP_ADMIN_EMAIL && !env.BOOTSTRAP_ADMIN_PASSWORD) return;
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(735218402)');
    const existing=await db.query('SELECT id FROM auth.users LIMIT 1');
    if (!existing.rows.length) {
      if(!env.BOOTSTRAP_ADMIN_EMAIL || !validPassword(env.BOOTSTRAP_ADMIN_PASSWORD))
        throw new Error('First admin setup requires BOOTSTRAP_ADMIN_EMAIL and a password of 12–256 characters.');
      await createAccount(db,{fullName:env.BOOTSTRAP_ADMIN_NAME || 'Workshop Admin',email:env.BOOTSTRAP_ADMIN_EMAIL,role:'admin'},env.BOOTSTRAP_ADMIN_PASSWORD);
      console.log('Initial admin created. Remove BOOTSTRAP_ADMIN_PASSWORD from deployment settings.');
    }
    await db.query('COMMIT');
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
