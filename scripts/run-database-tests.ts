import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

// Real PostgreSQL execution, with only Supabase-owned auth/storage scaffolding stubbed.
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
const adminId = '11111111-1111-1111-1111-111111111111';
const tailorId = '22222222-2222-2222-2222-222222222222';
const clientId = '33333333-3333-3333-3333-333333333333';
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log(`PASS: ${name}`);
}
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
async function actAs(id: string, role = 'authenticated') {
  await db.exec(`RESET ROLE; SET ROLE ${role};`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function root() { await db.exec('RESET ROLE;'); }

try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY, phone TEXT,
      raw_user_meta_data JSONB DEFAULT '{}', raw_app_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN,
      file_size_limit BIGINT, allowed_mime_types TEXT[]);
    CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT, created_at TIMESTAMPTZ DEFAULT now());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE PUBLICATION supabase_realtime;
  `);
  await db.exec(migration('01_schema.sql'));
  await db.exec(migration('02_measurement_parameters.sql'));
  await db.exec(migration('03_storage_buckets.sql'));
  await db.exec(migration('04_security_hardening.sql'));
  await db.query(`INSERT INTO auth.users (id, phone, raw_user_meta_data) VALUES
    ($1, '233201234567', '{"role":"admin","full_name":"Admin"}'),
    ($2, '233501234567', '{"role":"tailor","full_name":"Tailor"}'),
    ($3, '233241234567', '{"role":"client","full_name":"Existing customer"}')`, [adminId, tailorId, clientId]);
  await db.query("INSERT INTO public.orders (id, client_id, client_name, client_phone, total_amount, assigned_tailor) VALUES ('LEGACY', $1, 'Existing customer', '233241234567', 1000, 'Tailor')", [clientId]);
  await db.query("INSERT INTO public.client_measurements (client_id, unit) VALUES ($1, 'in')", [clientId]);
  await db.query("INSERT INTO public.client_measurement_values (client_id, parameter_id, value) SELECT $1, id, 36 FROM public.measurement_parameters WHERE key = 'bust'", [clientId]);
  await db.exec("INSERT INTO public.orders (id, client_name, client_phone, total_amount) VALUES ('ORPHAN', 'Customer without account', '233271234567', 500)");
  await test('Staff-only migration executes and can be reapplied without losing data', async () => {
    await db.exec(migration('05_staff_only_sms.sql'));
    await db.exec(migration('05_staff_only_sms.sql'));
    const customer = await db.query<{ id: string }>('SELECT id FROM public.clients WHERE phone_number = $1', ['233241234567']);
    assert.equal(customer.rows[0].id, clientId);
    const legacy = await db.query<{ client_id: string }>("SELECT client_id FROM public.orders WHERE id = 'LEGACY'");
    assert.equal(legacy.rows[0].client_id, clientId);
    const orphan = await db.query<{ client_id: string | null }>("SELECT client_id FROM public.orders WHERE id = 'ORPHAN'");
    assert.ok(orphan.rows[0].client_id);
    const measurements = await db.query<{ value: string }>('SELECT value FROM public.client_measurement_values WHERE client_id = $1', [clientId]);
    assert.equal(Number(measurements.rows[0].value), 36);
  });
  // Supabase grants API roles table privileges. Assert denial comes from RLS,
  // rather than accidentally testing a missing table grant.
  await db.exec(`GRANT USAGE ON SCHEMA public, storage TO authenticated, anon, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON storage.objects TO authenticated;`);
  await test('Legacy client accounts cannot read any workshop or customer table', async () => {
    await actAs(clientId);
    for (const table of ['profiles', 'clients', 'orders', 'order_tasks', 'client_measurements', 'client_measurement_values', 'measurement_parameters', 'app_settings', 'sms_notifications']) {
      assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0, table);
    }
    await assert.rejects(db.query("INSERT INTO public.orders (id, client_id, total_amount) VALUES ('FORGED', $1, 0)", [clientId]));
    await assert.rejects(db.query("SELECT public.advance_order_stage('LEGACY', 'pending')"));
    await root();
  });
  await test('Anonymous users cannot read orders or invoke staff progress operations', async () => {
    await actAs('', 'anon');
    assert.equal((await db.query('SELECT * FROM public.orders')).rows.length, 0);
    await assert.rejects(db.query("SELECT public.advance_order_stage('LEGACY', 'pending')"));
    await root();
  });
  await test('Signup metadata cannot grant an admin role', async () => {
    const id = '44444444-4444-4444-4444-444444444444';
    await db.query(`INSERT INTO auth.users (id, raw_user_meta_data) VALUES ($1, '{"role":"admin"}')`, [id]);
    const result = await db.query<{ role: string }>('SELECT role FROM public.profiles WHERE id = $1', [id]);
    assert.equal(result.rows[0].role, 'client');
  });
  await test('Server-controlled app metadata grants staff roles', async () => {
    const id = '55555555-5555-5555-5555-555555555555';
    await db.query(`INSERT INTO auth.users (id, raw_app_meta_data) VALUES ($1, '{"role":"tailor"}')`, [id]);
    assert.equal((await db.query<{ role: string }>('SELECT role FROM public.profiles WHERE id = $1', [id])).rows[0].role, 'tailor');
  });
  await test('Intake creates an independent customer and assigns the selected staff ID', async () => {
    await actAs(adminId);
    const payload = { id: 'NEW', task_id: 'task-new', client_name: 'New customer', client_phone: '233551234567',
      garment_title: 'Dress', tailor_id: tailorId, due_date: '2026-10-30', total_amount: 1000,
      deposit_paid: 200, unit: 'in', measurement_values: { bust: 35 }, reference_images: [] };
    const result = await db.query<{ id: string }>('SELECT public.create_bespoke_intake($1::jsonb) AS id', [JSON.stringify(payload)]);
    assert.ok(result.rows[0].id);
    const task = await db.query<{ tailor_id: string }>("SELECT tailor_id FROM public.order_tasks WHERE id = 'task-new'");
    assert.equal(task.rows[0].tailor_id, tailorId);
    await root();
    assert.equal((await db.query('SELECT * FROM auth.users WHERE id = $1', [result.rows[0].id])).rows.length, 0);
  });
  await test('Invalid intake rolls back customer and order creation together', async () => {
    await actAs(adminId);
    const payload = { id: 'INVALID', task_id: 'task-invalid', client_name: 'Invalid', client_phone: '233591234567',
      garment_title: 'Dress', tailor_id: tailorId, total_amount: 1000, deposit_paid: 200, unit: 'in', measurement_values: { bust: -1 } };
    await assert.rejects(db.query('SELECT public.create_bespoke_intake($1::jsonb)', [JSON.stringify(payload)]));
    assert.equal((await db.query("SELECT * FROM public.clients WHERE phone_number = '233591234567'")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM public.orders WHERE id = 'INVALID'")).rows.length, 0);
    await root();
  });
  await test('Progress changes save history and queue exactly one SMS with no portal link', async () => {
    await actAs(tailorId);
    await db.query("SELECT public.advance_order_stage('NEW', 'pending')");
    await assert.rejects(db.query("SELECT public.advance_order_stage('NEW', 'pending')"));
    const result = await db.query<{ content: string }>("SELECT content FROM public.sms_notifications WHERE order_id = 'NEW'");
    assert.equal(result.rows.length, 1);
    assert.match(result.rows[0].content, /Cutting has started/);
    assert.doesNotMatch(result.rows[0].content, /https?:|code|portal|track=/i);
    await root();
  });
  await test('Ready orders can be marked Delivered', async () => {
    await actAs(tailorId);
    for (const stage of ['cutting', 'fitting', 'finishing', 'ready']) {
      await db.query('SELECT public.advance_order_stage($1, $2::public.order_status)', ['NEW', stage]);
    }
    assert.equal((await db.query<{ status: string }>("SELECT status FROM public.orders WHERE id = 'NEW'")).rows[0].status, 'delivered');
    assert.equal((await db.query("SELECT * FROM public.sms_notifications WHERE order_id = 'NEW'")).rows.length, 5);
    await root();
  });
  await test('Staff cannot claim SMS directly; service claims are idempotent', async () => {
    const id = (await db.query<{ id: string }>("SELECT id FROM public.sms_notifications WHERE order_id = 'NEW' LIMIT 1")).rows[0].id;
    await actAs(tailorId);
    await assert.rejects(db.query('SELECT public.claim_progress_sms($1)', [id]));
    await root();
    await db.exec('SET ROLE service_role;');
    assert.ok((await db.query<{ result: unknown }>('SELECT public.claim_progress_sms($1) AS result', [id])).rows[0].result);
    assert.equal((await db.query<{ result: unknown }>('SELECT public.claim_progress_sms($1) AS result', [id])).rows[0].result, null);
    await root();
  });
  await test('Workshop storage buckets are private after migration', async () => {
    const result = await db.query<{ public: boolean }>('SELECT public FROM storage.buckets');
    assert.ok(result.rows.every((bucket) => bucket.public === false));
  });
  console.log(`${passed} PostgreSQL migration and permission checks passed.`);
  await test('Manual workshop migration preserves opening balances and freezes legacy measurements', async () => {
    await db.exec("UPDATE public.orders SET deposit_paid = 350 WHERE id = 'LEGACY'");
    await db.exec(migration('06_manual_workshop.sql'));
    await db.exec(migration('06_manual_workshop.sql'));
    const result = await db.query<{ amount: string; occurred_on: string | null }>("SELECT amount, occurred_on FROM public.payments WHERE order_id = 'LEGACY'");
    assert.equal(Number(result.rows[0].amount), 350); assert.equal(result.rows[0].occurred_on, null); assert.equal(result.rows.length, 1);
    const snapshot = (await db.query<{ measurement_snapshot: any }>("SELECT measurement_snapshot FROM public.orders WHERE id = 'LEGACY'")).rows[0].measurement_snapshot;
    assert.equal(snapshot.source, 'legacy_migration'); assert.equal(Number(snapshot.values.bust), 36);
    await db.exec('GRANT ALL ON public.payments TO authenticated;');
  });
  await test('Manual SMS logging is staff-only, idempotent and records the sender', async () => {
    const notice = (await db.query<{ id: string }>("SELECT id FROM public.sms_notifications WHERE order_id = 'NEW' AND stage = 'delivered'")).rows[0].id;
    await actAs(clientId); await assert.rejects(db.query('SELECT public.record_manual_sms($1)', [notice]));
    await actAs(tailorId);
    const sent = (await db.query<{ result: any }>('SELECT public.record_manual_sms($1) AS result', [notice])).rows[0].result;
    assert.equal(sent.status, 'sent_manually'); assert.equal(sent.sent_by, tailorId); assert.ok(sent.sent_at);
    await db.query('SELECT public.record_manual_sms($1)', [notice]);
    const old = (await db.query<{ id: string }>("SELECT id FROM public.sms_notifications WHERE order_id = 'NEW' AND stage = 'cutting'")).rows[0].id;
    await assert.rejects(db.query('SELECT public.record_manual_sms($1)', [old]));
    await assert.rejects(db.query('SELECT public.claim_progress_sms($1)', [notice])); await root();
  });
  await test('Payment ledger adds separate receipts and retries never double count', async () => {
    await actAs(tailorId);
    const key = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const record = () => db.query<{ result: any }>("SELECT public.record_payment('LEGACY', $1, 100, 'Direct MoMo', '2026-01-02', 'momo-1', 'Receipt') AS result", [key]);
    const first = (await record()).rows[0].result;
    assert.equal(Number(first.order.deposit_paid), 450); assert.equal(first.payments.length, 2);
    const retry = (await record()).rows[0].result; assert.equal(Number(retry.order.deposit_paid), 450); assert.equal(retry.payments.length, 2);
    const second = (await db.query<{ result: any }>("SELECT public.record_payment('LEGACY', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 100, 'Cash in Atelier', '2026-01-02') AS result")).rows[0].result;
    assert.equal(Number(second.order.deposit_paid), 550); assert.equal(second.payments.length, 3);
    await assert.rejects(db.query("SELECT public.record_payment('LEGACY', $1, 200, 'Direct MoMo', '2026-01-02')", [key]));
    await assert.rejects(db.query("UPDATE public.orders SET deposit_paid = 999 WHERE id = 'LEGACY'"));
    assert.equal((await db.query("UPDATE public.payments SET amount = 999 WHERE order_id = 'LEGACY' RETURNING id")).rows.length, 0);
    assert.equal((await db.query("DELETE FROM public.payments WHERE order_id = 'LEGACY' RETURNING id")).rows.length, 0);
    await root();
  });
  await test('Overpayments need explicit consent and retain a visible customer credit', async () => {
    await actAs(tailorId);
    const query = "SELECT public.record_payment('LEGACY', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 500, 'Cash in Atelier', '2026-01-02', '', '', $1) AS result";
    await assert.rejects(db.query(query, [false]));
    const result = (await db.query<{ result: any }>(query, [true])).rows[0].result;
    assert.equal(Number(result.order.deposit_paid), 1050); await root();
  });
  await test('Admin corrections append reversals without deleting the original or production history', async () => {
    const payment = (await db.query<{ id: string }>("SELECT id FROM public.payments WHERE submission_key = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'")).rows[0].id;
    await actAs(tailorId); await assert.rejects(db.query("SELECT public.reverse_payment($1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Wrong amount')", [payment]));
    await actAs(adminId);
    const query = "SELECT public.reverse_payment($1, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Wrong amount') AS result";
    const result = (await db.query<{ result: any }>(query, [payment])).rows[0].result;
    assert.equal(Number(result.order.deposit_paid), 950); assert.equal(result.payments.length, 5);
    assert.equal(result.payments.find((p: any) => p.reverses_payment_id === payment).occurred_on, '2026-01-02');
    assert.equal((await db.query<{ result: any }>(query, [payment])).rows[0].result.payments.length, 5);
    await assert.rejects(db.query("SELECT public.reverse_payment($1, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Again')", [payment]));
    await root();
  });
  await test('Measurement save is atomic, rejects stale revisions and does not change old job cards', async () => {
    await actAs(tailorId);
    const saved = (await db.query<{ result: any }>("SELECT public.save_client_measurements($1, 1, 'cm', '{\"bust\":100}', 'Updated fit') AS result", [clientId])).rows[0].result;
    assert.equal(saved.revision, 2); assert.equal(saved.unit, 'cm'); assert.equal(Number(saved.values.bust), 100);
    await assert.rejects(db.query("SELECT public.save_client_measurements($1, 1, 'in', '{\"bust\":40}')", [clientId]));
    await assert.rejects(db.query("SELECT public.save_client_measurements($1, 2, 'in', '{\"bust\":0}')", [clientId]));
    const header = (await db.query<{ unit: string; revision: number }>('SELECT unit, revision FROM public.client_measurements WHERE client_id = $1', [clientId])).rows[0];
    assert.equal(header.unit, 'cm'); assert.equal(Number(header.revision), 2);
    const snapshot = (await db.query<{ measurement_snapshot: any }>("SELECT measurement_snapshot FROM public.orders WHERE id = 'LEGACY'")).rows[0].measurement_snapshot;
    assert.equal(Number(snapshot.values.bust), 36); assert.equal(snapshot.unit, 'in');
    assert.equal((await db.query("UPDATE public.client_measurements SET unit = 'in' WHERE client_id = $1 RETURNING id", [clientId])).rows.length, 0);
    const applied = (await db.query<{ result: any }>("SELECT public.apply_order_measurements('LEGACY', $1) AS result", [snapshot.capturedAt])).rows[0].result;
    assert.equal(applied.measurement_snapshot.source, 'applied'); assert.equal(Number(applied.measurement_snapshot.values.bust), 100);
    await db.query("SELECT public.save_client_measurements($1, 2, 'cm', '{}')", [clientId]);
    assert.equal((await db.query('SELECT * FROM public.client_measurement_values WHERE client_id = $1', [clientId])).rows.length, 0);
    await root();
  });
  await test('Transactional intake records its deposit and snapshot once on retry', async () => {
    await actAs(adminId);
    const payload = { id: 'MANUAL-INTAKE', task_id: 'manual-task', client_name: 'Manual customer', client_phone: '233551234560',
      garment_title: 'Dress', tailor_id: tailorId, due_date: '2026-10-30', total_amount: 1000, deposit_paid: 200,
      unit: 'in', measurement_values: { bust: 35 }, deposit_submission_key: 'ffffffff-ffff-ffff-ffff-ffffffffffff', payment_date: '2026-01-01' };
    const query = 'SELECT public.create_bespoke_intake($1::jsonb) AS id';
    const first = (await db.query<{ id: string }>(query, [JSON.stringify(payload)])).rows[0].id;
    assert.equal((await db.query<{ id: string }>(query, [JSON.stringify(payload)])).rows[0].id, first);
    assert.equal((await db.query("SELECT * FROM public.payments WHERE order_id = 'MANUAL-INTAKE'")).rows.length, 1);
    const order = (await db.query<{ measurement_snapshot: any; deposit_paid: string }>("SELECT measurement_snapshot, deposit_paid FROM public.orders WHERE id = 'MANUAL-INTAKE'")).rows[0];
    assert.equal(Number(order.deposit_paid), 200); assert.equal(order.measurement_snapshot.source, 'intake'); assert.equal(Number(order.measurement_snapshot.values.bust), 35);
    await assert.rejects(db.query(query, [JSON.stringify({ ...payload, total_amount: 2000 })])); await root();
  });
  await test('Currency stays GHS and legacy client identities cannot access the ledger or new operations', async () => {
    await actAs(adminId); await assert.rejects(db.query("UPDATE public.app_settings SET value = '\"USD\"' WHERE key = 'currency'"));
    await assert.rejects(db.query("UPDATE public.orders SET currency = 'USD' WHERE id = 'LEGACY'"));
    await actAs(clientId); assert.equal((await db.query('SELECT * FROM public.payments')).rows.length, 0);
    await assert.rejects(db.query("SELECT public.record_payment('LEGACY', '99999999-9999-9999-9999-999999999999', 100, 'Cash in Atelier', '2026-01-01')"));
    await assert.rejects(db.query("SELECT public.save_client_measurements($1, 3, 'in', '{}')", [clientId])); await root();
  });
  await test('Receipts from stale callers add to the current paid total and preserve newer production history', async () => {
    await actAs(tailorId);
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE', 'pending')");
    await assert.rejects(db.query("SELECT public.advance_order_stage('MANUAL-INTAKE', NULL)"));
    const query = "SELECT public.record_payment('MANUAL-INTAKE', $1, 100, 'Cash in Atelier', '2026-01-01')";
    await Promise.all([
      db.query(query, ['10101010-1010-1010-1010-101010101010']),
      db.query(query, ['20202020-2020-2020-2020-202020202020']),
    ]);
    const order = (await db.query<{ deposit_paid: string; stage_history: any[]; status: string }>("SELECT * FROM public.orders WHERE id = 'MANUAL-INTAKE'")).rows[0];
    assert.equal(Number(order.deposit_paid), 400); assert.equal(order.status, 'cutting'); assert.equal(order.stage_history.length, 2);
    await assert.rejects(db.query("UPDATE public.orders SET status = 'ready' WHERE id = 'MANUAL-INTAKE'"));
    await assert.rejects(db.query("UPDATE public.orders SET stage_history = '[]' WHERE id = 'MANUAL-INTAKE'"));
    await root();
  });
  await test('Receipt validation rejects invalid precision and future dates without altering the ledger', async () => {
    await actAs(tailorId);
    const count = (await db.query("SELECT * FROM public.payments WHERE order_id = 'MANUAL-INTAKE'")).rows.length;
    for (const amount of [0, -1, 0.001]) await assert.rejects(db.query("SELECT public.record_payment('MANUAL-INTAKE', '30303030-3030-3030-3030-303030303030', $1, 'Cash in Atelier', '2026-01-01')", [amount]));
    await assert.rejects(db.query("SELECT public.record_payment('MANUAL-INTAKE', '30303030-3030-3030-3030-303030303030', 100, 'Cash in Atelier', '2999-01-01')"));
    assert.equal((await db.query("SELECT * FROM public.payments WHERE order_id = 'MANUAL-INTAKE'")).rows.length, count);
    await assert.rejects(db.query("SELECT public.ledger_result('MANUAL-INTAKE')"));
    await assert.rejects(db.query("UPDATE public.orders SET due_date = '2026-02-30' WHERE id = 'MANUAL-INTAKE'"));
    await root();
  });
  await test('A failed intake deposit rolls back the order, customer and measurements together', async () => {
    await actAs(adminId);
    const payload = { id: 'BAD-DEPOSIT', task_id: 'bad-deposit-task', client_name: 'Bad deposit customer', client_phone: '233551234599',
      garment_title: 'Dress', tailor_id: tailorId, total_amount: 1000, deposit_paid: 100, unit: 'in', measurement_values: { bust: 36 },
      deposit_submission_key: '40404040-4040-4040-4040-404040404040', payment_date: '2999-01-01' };
    await assert.rejects(db.query('SELECT public.create_bespoke_intake($1::jsonb)', [JSON.stringify(payload)]));
    assert.equal((await db.query("SELECT * FROM public.clients WHERE phone_number = '233551234599'")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM public.orders WHERE id = 'BAD-DEPOSIT'")).rows.length, 0);
    await root();
  });
  await test('Operations migration applies twice and preserves the existing ledger and specifications', async () => {
    await db.exec(migration('07_workshop_operations.sql'));
    await db.exec(migration('07_workshop_operations.sql'));
    assert.equal(Number((await db.query<{ deposit_paid: string }>("SELECT deposit_paid FROM public.orders WHERE id='MANUAL-INTAKE'")).rows[0].deposit_paid),400);
  });
  await test('Fittings reject overlapping staff appointments, allow adjacent appointments and protect stale edits', async () => {
    await actAs(tailorId);
    const payload={tailor_id:tailorId,starts_at:'2999-01-01T10:00:00Z',duration_minutes:60,status:'scheduled',notes:'First fitting'};
    const query="SELECT public.save_fitting('MANUAL-INTAKE',$1,0,$2::jsonb) AS result";
    const id='60606060-6060-6060-6060-606060606060';
    await db.query(query,[id,JSON.stringify(payload)]); await db.query(query,[id,JSON.stringify(payload)]);
    assert.equal((await db.query('SELECT * FROM public.fitting_appointments')).rows.length,1);
    await assert.rejects(db.query(query,['61616161-6161-6161-6161-616161616161',JSON.stringify({...payload,starts_at:'2999-01-01T10:30:00Z'})]));
    await db.query(query,['62626262-6262-6262-6262-626262626262',JSON.stringify({...payload,starts_at:'2999-01-01T11:00:00Z'})]);
    await assert.rejects(db.query(query,[id,JSON.stringify({...payload,notes:'Stale edit'})]));
    await assert.rejects(db.query("SELECT public.save_fitting('MANUAL-INTAKE',$1,1,$2::jsonb)",[id,JSON.stringify({...payload,status:'completed',notes:'Too early'})]));
    for(const fittingId of [id,'62626262-6262-6262-6262-626262626262']) {
      const row=(await db.query<{ last_request:any }>('SELECT last_request FROM public.fitting_appointments WHERE id=$1',[fittingId])).rows[0].last_request;
      await db.query("SELECT public.save_fitting('MANUAL-INTAKE',$1,1,$2::jsonb)",[fittingId,JSON.stringify({...row,status:'cancelled',notes:'Customer requested another date'})]);
    }
    await root();
  });
  await test('Quality blocks unfinished tasks and Ready requires a current passing check', async () => {
    await actAs(tailorId);
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','cutting')");
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','fitting')");
    const checks='{"fit":true,"measurements":true,"seams":true,"finish":true}';
    const revision=async()=>Number((await db.query<{ work_revision:number }>("SELECT work_revision FROM public.orders WHERE id='MANUAL-INTAKE'")).rows[0].work_revision);
    await assert.rejects(db.query("SELECT public.record_quality_check('MANUAL-INTAKE','70707070-7070-7070-7070-707070707070',$1,$2::jsonb)",[await revision(),checks]));
    await db.query("UPDATE public.order_tasks SET status='completed' WHERE order_id='MANUAL-INTAKE'");
    await assert.rejects(db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','finishing')"));
    await assert.rejects(db.query("SELECT public.record_quality_check('MANUAL-INTAKE','70707070-7070-7070-7070-707070707070',$1,'{\"fit\":true}')",[await revision()]));
    const rev=await revision();
    await db.query("SELECT public.record_quality_check('MANUAL-INTAKE','70707070-7070-7070-7070-707070707070',$1,$2::jsonb)",[rev,checks]);
    await db.query("SELECT public.record_quality_check('MANUAL-INTAKE','70707070-7070-7070-7070-707070707070',$1,$2::jsonb)",[rev,checks]);
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','finishing')"); await root();
  });
  await test('Rework returns Ready to finishing, invalidates quality and preserves independent SMS cycles', async () => {
    await actAs(tailorId);
    const payload={reason:'Hem needs adjustment',status:'open',notes:''};
    const query="SELECT public.save_rework('MANUAL-INTAKE','80808080-8080-8080-8080-808080808080',0,$1::jsonb)";
    await db.query(query,[JSON.stringify(payload)]); await db.query(query,[JSON.stringify(payload)]);
    const job=(await db.query<{status:string;production_cycle:number;work_revision:number}>("SELECT * FROM public.orders WHERE id='MANUAL-INTAKE'")).rows[0];
    assert.equal(job.status,'finishing'); assert.equal(job.production_cycle,2);
    await assert.rejects(db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','finishing')"));
    await db.query("SELECT public.save_rework('MANUAL-INTAKE','80808080-8080-8080-8080-808080808080',1,$1::jsonb)",[JSON.stringify({...payload,status:'completed',notes:'Hem adjusted and verified'})]);
    const rev=Number((await db.query<{work_revision:number}>("SELECT work_revision FROM public.orders WHERE id='MANUAL-INTAKE'")).rows[0].work_revision);
    await assert.rejects(db.query("SELECT public.record_quality_check('MANUAL-INTAKE','81818181-8181-8181-8181-818181818181',$1,'{\"fit\":true,\"measurements\":true,\"seams\":true,\"finish\":true}')",[rev-1]));
    await db.query("SELECT public.record_quality_check('MANUAL-INTAKE','81818181-8181-8181-8181-818181818181',$1,'{\"fit\":true,\"measurements\":true,\"seams\":true,\"finish\":true}')",[rev]);
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','finishing')");
    assert.equal((await db.query("SELECT * FROM public.sms_notifications WHERE order_id='MANUAL-INTAKE' AND stage='ready'")).rows.length,2);
    await db.query("SELECT public.advance_order_stage('MANUAL-INTAKE','ready')");
    await assert.rejects(db.query("UPDATE public.order_tasks SET status='pending' WHERE order_id='MANUAL-INTAKE'"));
    await assert.rejects(db.query("SELECT public.reopen_order('MANUAL-INTAKE','delivered','Customer alteration')"));
    await actAs(adminId); await db.query("SELECT public.reopen_order('MANUAL-INTAKE','delivered','Customer alteration')");
    await assert.rejects(db.query("SELECT public.reopen_order('MANUAL-INTAKE','delivered','Duplicate')")); await root();
  });
  await test('Price and assignment changes require admin permissions, a reason and a fresh order version', async () => {
    await actAs(tailorId);
    const job=(await db.query<{updated_at:string}>("SELECT updated_at FROM public.orders WHERE id='MANUAL-INTAKE'")).rows[0];
    await assert.rejects(db.query("UPDATE public.orders SET total_amount=2000 WHERE id='MANUAL-INTAKE'"));
    await assert.rejects(db.query("SELECT public.update_order_terms('MANUAL-INTAKE',$1,2000,$2,'Changed design')",[job.updated_at,tailorId]));
    await actAs(adminId);
    await assert.rejects(db.query("SELECT public.update_order_terms('MANUAL-INTAKE',$1,100,$2,'Lowered price')",[job.updated_at,tailorId]));
    await db.query("SELECT public.update_order_terms('MANUAL-INTAKE',$1,100,$2,'Lowered price',true)",[job.updated_at,tailorId]);
    await assert.rejects(db.query("SELECT public.update_order_terms('MANUAL-INTAKE',$1,100,$2,'Stale edit',true)",[job.updated_at,tailorId]));
    assert.ok((await db.query("SELECT * FROM public.order_audit WHERE order_id='MANUAL-INTAKE' AND event='Terms changed'")).rows.length); await root();
  });
  await test('Uncertain SMS review requires admin evidence and never resends a confirmed provider submission', async () => {
    const id=(await db.query<{id:string}>("SELECT id FROM public.sms_notifications WHERE order_id='MANUAL-INTAKE' AND stage='finishing' AND production_cycle=3")).rows[0].id;
    await db.query("UPDATE public.sms_notifications SET status='sending' WHERE id=$1",[id]);
    await actAs(tailorId); await assert.rejects(db.query("SELECT public.review_sms($1,'sending','confirmed_not_sent','Checked report')",[id]));
    await actAs(adminId); await assert.rejects(db.query("SELECT public.review_sms($1,'sending','confirmed_not_sent','')",[id]));
    await db.query("SELECT public.review_sms($1,'sending','confirmed_not_sent','Provider report confirms no submission')",[id]);
    await db.query('SELECT public.record_manual_sms($1)',[id]);
    await assert.rejects(db.query("SELECT public.review_sms($1,'sending','confirmed_not_sent','Again')",[id]));
    await root();
    const old=(await db.query<{id:string}>("SELECT id FROM public.sms_notifications WHERE order_id='NEW' LIMIT 1")).rows[0].id;
    await db.query("UPDATE public.sms_notifications SET status='submitted' WHERE id=$1",[old]); await actAs(adminId);
    await db.query("SELECT public.review_sms($1,'submitted','confirmed_submitted','Verified original report')",[old]);
    await assert.rejects(db.query('SELECT public.record_manual_sms($1)',[old])); await root();
  });
  await test('Audit, quality and operation records deny direct writes and legacy customer access', async () => {
    await db.exec('GRANT ALL ON public.order_audit,public.fitting_appointments,public.order_rework,public.order_quality_checks TO authenticated;');
    await actAs(tailorId);
    assert.equal((await db.query("UPDATE public.order_rework SET reason='Forged' RETURNING id")).rows.length,0);
    assert.equal((await db.query('DELETE FROM public.order_audit RETURNING id')).rows.length,0);
    await assert.rejects(db.query("SELECT public.append_order_audit('MANUAL-INTAKE','Forged','{}')"));
    await actAs(clientId);
    for(const table of ['order_audit','fitting_appointments','order_rework','order_quality_checks']) assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length,0);
    await assert.rejects(db.query("SELECT public.save_rework('MANUAL-INTAKE',gen_random_uuid(),0,'{\"reason\":\"Forged\",\"status\":\"open\"}')")); await root();
  });
  await test('Recovery migration can be reapplied and report totals use ledger dates with scoped staff access', async()=>{
    await db.exec(migration('08_reports_and_recovery.sql'));await db.exec(migration('08_reports_and_recovery.sql'));
    await actAs(adminId);
    const summary=(await db.query<{result:any}>('SELECT public.workshop_summary() AS result')).rows[0].result;
    const expected=Number((await db.query<{total:string}>("SELECT sum(greatest(total_amount-deposit_paid,0)) AS total FROM public.orders")).rows[0].total);
    assert.equal(Number(summary.outstanding),expected);assert.ok(summary.views.credit>=1);
    assert.equal((await db.query<{day:string}>("SELECT public.workshop_due_date('AUG 24, 2026')::text AS day")).rows[0].day,'2026-08-24');
    assert.equal((await db.query<{day:string}>("SELECT public.workshop_due_date('2026-02-30') AS day")).rows[0].day,null);
    await actAs(tailorId);assert.equal((await db.query<{result:any}>('SELECT public.workshop_summary() AS result')).rows[0].result.outstanding,null);
    await assert.rejects(db.query('SELECT public.workshop_receipt_page()'));await actAs(clientId);await assert.rejects(db.query('SELECT public.workshop_summary()'));await root();
  });
  await test('Order search and pagination are bounded and do not hide later records', async()=>{
    for(let i=0;i<31;i++) await db.query("INSERT INTO public.orders(id,client_name,client_phone,total_amount,assigned_tailor_id) VALUES($1,'Pagination customer','233551234501',100,$2)",[`PAGE-${String(i).padStart(2,'0')}`,tailorId]);
    await actAs(tailorId);
    const first=(await db.query<{result:any}>("SELECT public.workshop_order_page('active','Pagination customer',0) AS result")).rows[0].result;
    const second=(await db.query<{result:any}>("SELECT public.workshop_order_page('active','Pagination customer',1) AS result")).rows[0].result;
    assert.equal(first.total,31);assert.equal(first.ids.length,25);assert.equal(second.ids.length,6);assert.equal(new Set([...first.ids,...second.ids]).size,31);
    await assert.rejects(db.query("SELECT public.workshop_order_page('unknown','',0)"));await root();
  });
  await test('Measurement draft retry receipts are idempotent and stale offline edits cannot overwrite current measurements', async()=>{
    await actAs(tailorId);
    const query="SELECT public.save_measurement_draft('90909090-9090-9090-9090-909090909090',$1,3,'cm','{\"bust\":102}','Offline draft') AS result";
    const first=(await db.query<{result:any}>(query,[clientId])).rows[0].result;
    const retry=(await db.query<{result:any}>(query,[clientId])).rows[0].result;
    assert.equal(first.revision,4);assert.deepEqual(retry,first);
    await assert.rejects(db.query("SELECT public.save_measurement_draft('91919191-9191-9191-9191-919191919191',$1,3,'cm','{\"bust\":110}','Stale')",[clientId]));
    await actAs(adminId);await assert.rejects(db.query(query,[clientId]));await root();
  });
  await test('Upload cleanup excludes committed attachments and the database protects referenced or recent files', async()=>{
    await db.exec("INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('order-sketches','UPLOAD/kept.jpg',now()-interval '3 days'),('order-sketches','UPLOAD/abandoned.jpg',now()-interval '3 days'),('order-sketches','UPLOAD/recent.jpg',now())");
    await db.exec("UPDATE public.orders SET reference_images=ARRAY['UPLOAD/kept.jpg'] WHERE id='PAGE-00'");
    await actAs(adminId);const candidates=(await db.query<{result:any[]}>('SELECT public.abandoned_sketches() AS result')).rows[0].result;
    assert.deepEqual(candidates.map(row=>row.path),['UPLOAD/abandoned.jpg']);
    assert.equal((await db.query("DELETE FROM storage.objects WHERE name='UPLOAD/kept.jpg' RETURNING id")).rows.length,0);
    assert.equal((await db.query("DELETE FROM storage.objects WHERE name='UPLOAD/recent.jpg' RETURNING id")).rows.length,0);
    await actAs(tailorId);assert.equal((await db.query("DELETE FROM storage.objects WHERE name='UPLOAD/abandoned.jpg' RETURNING id")).rows.length,0);
    await actAs(adminId);assert.equal((await db.query("DELETE FROM storage.objects WHERE name='UPLOAD/abandoned.jpg' RETURNING id")).rows.length,1);
    await root();await assert.rejects(db.query("DELETE FROM storage.objects WHERE name='UPLOAD/kept.jpg'"));
    await assert.rejects(db.exec("UPDATE public.orders SET reference_images=ARRAY['UPLOAD/missing.jpg'] WHERE id='PAGE-00'"));
  });
  console.log(`${passed} total PostgreSQL checks passed.`);
} finally {
  await db.close();
}
