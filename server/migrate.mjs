import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const migrations = ['01_schema.sql','02_measurement_parameters.sql','03_storage_buckets.sql',
  '04_security_hardening.sql','05_staff_only_sms.sql','06_manual_workshop.sql',
  '07_workshop_operations.sql','08_reports_and_recovery.sql','09_ready_to_wear.sql'];

export async function migrate(db) {
  // One connection owns this session lock until every migration has finished.
  await db.query('SELECT pg_advisory_lock(735218401)');
  try {
    const existing=await db.query("SELECT to_regclass('public.orders') AS orders,to_regclass('public.atelier_migrations') AS history");
    if(existing.rows[0].orders && !existing.rows[0].history)
      throw new Error('This database already contains workshop tables without native migration history. Use an empty database or a reviewed data import; do not replay historical migrations.');
    await db.query(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    await db.query(`CREATE TABLE IF NOT EXISTS public.atelier_migrations
      (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const name of migrations) {
      const sql = await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await db.query('SELECT checksum FROM public.atelier_migrations WHERE name=$1',[name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}. Restore it; use a new migration for changes.`);
        continue;
      }
      await db.query('BEGIN');
      try {
        // Historic files have their own outer transaction. The runner owns it
        // so recording success and changing the schema commit together.
        await db.query(sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
        await db.query('INSERT INTO public.atelier_migrations(name,checksum) VALUES ($1,$2)',[name,checksum]);
        await db.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) { await db.query('ROLLBACK'); throw error; }
    }
    await db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT INSERT,UPDATE ON public.order_tasks,public.measurement_parameters TO authenticated;
      GRANT UPDATE ON public.profiles,public.orders TO authenticated;
      GRANT INSERT,UPDATE ON public.app_settings TO authenticated;
      REVOKE ALL ON public.atelier_migrations FROM authenticated,anon;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC,authenticated,anon;`);
    // Needed when the migration owner is a non-superuser with CREATEROLE.
    await db.query('GRANT authenticated TO CURRENT_USER');
  } finally { await db.query('SELECT pg_advisory_unlock(735218401)'); }
}
