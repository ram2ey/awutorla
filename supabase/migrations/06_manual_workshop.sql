-- Phases 1-4: manual SMS, payment ledger, measurement snapshots, GHS reporting.
-- Apply after 05. Legacy money is an opening balance with an unknown receipt date.
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE currency <> 'GHS' OR deposit_paid < 0 OR total_amount < 0) THEN
    RAISE EXCEPTION 'Review non-GHS or negative legacy amounts before applying migration 06. No currency conversion is inferred.';
  END IF;
END $$;

ALTER TABLE public.sms_notifications DROP CONSTRAINT IF EXISTS sms_notifications_status_check;
ALTER TABLE public.sms_notifications ADD CONSTRAINT sms_notifications_status_check
  CHECK (status IN ('pending', 'sending', 'submitted', 'failed', 'sent_manually', 'superseded'));
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
-- The old sender can no longer claim notifications, even if an old function remains deployed.
DROP FUNCTION IF EXISTS public.claim_progress_sms(UUID);
UPDATE public.sms_notifications n SET status = 'superseded', updated_at = now()
  FROM public.orders o WHERE o.id = n.order_id AND o.status <> n.stage AND n.status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION public.queue_progress_sms()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE shop_name TEXT; stage_text TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  UPDATE public.sms_notifications SET status = 'superseded', updated_at = now()
    WHERE order_id = NEW.id AND status IN ('pending', 'failed');
  SELECT value #>> '{}' INTO shop_name FROM public.app_settings WHERE key = 'business_name';
  stage_text := CASE NEW.status
    WHEN 'cutting' THEN 'Cutting has started.'
    WHEN 'fitting' THEN 'Your garment is ready for fitting. Please contact the atelier to arrange a time.'
    WHEN 'finishing' THEN 'Your garment is in final finishing.'
    WHEN 'ready' THEN 'Your garment is ready for collection.'
    WHEN 'delivered' THEN 'Your garment has been delivered. Thank you.'
    ELSE 'Your order has been received.' END;
  INSERT INTO public.sms_notifications (order_id, stage, recipient, content)
    VALUES (NEW.id, NEW.status, NEW.client_phone, COALESCE(NULLIF(shop_name, ''), 'Awutorla') ||
      ': Order ' || NEW.id || '. ' || stage_text) ON CONFLICT (order_id, stage) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.record_manual_sms(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE notice public.sms_notifications; job public.orders;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO notice FROM public.sms_notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = notice.order_id FOR UPDATE;
  SELECT * INTO notice FROM public.sms_notifications WHERE id = p_notification_id FOR UPDATE;
  IF notice.status = 'sent_manually' THEN RETURN to_jsonb(notice); END IF;
  IF notice.stage <> job.status OR notice.status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'This SMS is outdated, already submitted, or needs review. Refresh the queue.';
  END IF;
  UPDATE public.sms_notifications SET status = 'sent_manually', sent_by = auth.uid(), sent_at = now(),
    last_error = NULL, updated_at = now() WHERE id = notice.id RETURNING * INTO notice;
  RETURN to_jsonb(notice);
END $$;
REVOKE ALL ON FUNCTION public.record_manual_sms(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_manual_sms(UUID) TO authenticated;

ALTER TABLE public.client_measurements ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS measurement_snapshot JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS intake_request JSONB;

CREATE OR REPLACE FUNCTION public.capture_measurements(p_client_id UUID, p_source TEXT)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('clientId', c.id, 'clientName', c.full_name, 'clientPhone', c.phone_number,
    'unit', COALESCE(h.unit, 'in'), 'values', COALESCE(v.vals, '{}'::jsonb),
    'labels', COALESCE(v.labels, '{}'::jsonb), 'notes', h.notes,
    'revision', COALESCE(h.revision, 0), 'updatedAt', COALESCE(h.updated_at, c.updated_at),
    'capturedAt', now(), 'source', p_source)
  FROM public.clients c LEFT JOIN public.client_measurements h ON h.client_id = c.id
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(p.key, v.value) AS vals, jsonb_object_agg(p.key, p.label) AS labels
    FROM public.client_measurement_values v JOIN public.measurement_parameters p ON p.id = v.parameter_id
    WHERE v.client_id = c.id
  ) v ON true WHERE c.id = p_client_id;
$$;
REVOKE ALL ON FUNCTION public.capture_measurements(UUID, TEXT) FROM PUBLIC, anon, authenticated;

UPDATE public.orders SET measurement_snapshot = COALESCE(public.capture_measurements(client_id, 'legacy_migration'),
  jsonb_build_object('unit', 'in', 'values', '{}'::jsonb, 'labels', '{}'::jsonb,
    'revision', 0, 'capturedAt', now(), 'source', 'legacy_migration')) WHERE measurement_snapshot IS NULL;

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  submission_key UUID NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'reversal', 'opening_balance')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
  currency TEXT NOT NULL DEFAULT 'GHS' CHECK (currency = 'GHS'),
  method TEXT NOT NULL,
  occurred_on DATE,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  recorded_by UUID REFERENCES public.profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverses_payment_id UUID UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  allow_credit BOOLEAN NOT NULL DEFAULT false,
  CHECK ((kind = 'reversal' AND amount < 0 AND reverses_payment_id IS NOT NULL) OR
    (kind IN ('receipt', 'opening_balance') AND amount > 0 AND reverses_payment_id IS NULL)),
  CHECK (kind = 'opening_balance' OR recorded_by IS NOT NULL),
  CHECK (kind <> 'receipt' OR occurred_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS payments_occurred_on_idx ON public.payments(occurred_on);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_read_payments ON public.payments;
CREATE POLICY staff_read_payments ON public.payments FOR SELECT TO authenticated USING (public.is_tailor());
GRANT SELECT ON public.payments TO authenticated;
-- Idempotent backfill. History prose is not parsed into invented receipt dates.
INSERT INTO public.payments (order_id, submission_key, kind, amount, method, notes)
  SELECT o.id, gen_random_uuid(), 'opening_balance', o.deposit_paid, 'Legacy balance',
    'Balance imported during migration; original receipt dates and methods are unknown.'
  FROM public.orders o WHERE o.deposit_paid > 0 AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = o.id);

CREATE OR REPLACE FUNCTION public.ledger_result(p_order_id TEXT)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('order', to_jsonb(o), 'payments', COALESCE((
    SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('recorded_by_name', COALESCE(s.full_name, CASE WHEN p.recorded_by IS NULL THEN 'Migration' ELSE 'Staff' END))
      ORDER BY p.recorded_at, p.id) FROM public.payments p LEFT JOIN public.profiles s ON s.id = p.recorded_by
      WHERE p.order_id = o.id), '[]'::jsonb)) FROM public.orders o WHERE o.id = p_order_id;
$$;
REVOKE ALL ON FUNCTION public.ledger_result(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_payment(p_order_id TEXT, p_submission_key UUID,
  p_amount NUMERIC, p_method TEXT, p_occurred_on DATE, p_reference TEXT DEFAULT '',
  p_notes TEXT DEFAULT '', p_allow_credit BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; existing public.payments; paid NUMERIC;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  IF p_submission_key IS NULL OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
    OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') OR p_occurred_on IS NULL OR p_occurred_on > (now() AT TIME ZONE 'UTC')::date
    OR p_method IS NULL OR p_method NOT IN ('Cash in Atelier', 'In-Store POS / Card', 'Direct Bank Transfer', 'Direct MoMo') THEN
    RAISE EXCEPTION 'Enter a positive amount with at most two decimals, a payment method and a non-future receipt date.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || p_submission_key::text, 0));
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  SELECT * INTO existing FROM public.payments WHERE submission_key = p_submission_key;
  IF FOUND THEN
    IF existing.kind <> 'receipt' OR existing.order_id <> p_order_id OR existing.amount <> p_amount
      OR existing.method <> p_method OR existing.occurred_on <> p_occurred_on
      OR existing.reference <> COALESCE(p_reference, '') OR existing.notes <> COALESCE(p_notes, '')
      OR existing.allow_credit <> COALESCE(p_allow_credit, false) THEN
      RAISE EXCEPTION 'This submission was already saved with different details. Refresh the ledger before recording another payment.';
    END IF;
    RETURN public.ledger_result(job.id);
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO paid FROM public.payments WHERE order_id = job.id;
  IF paid + p_amount > job.total_amount AND NOT COALESCE(p_allow_credit, false) THEN
    RAISE EXCEPTION 'This payment exceeds the current balance. Refresh it or explicitly record the excess as customer credit.';
  END IF;
  INSERT INTO public.payments (order_id, submission_key, kind, amount, method, occurred_on,
    reference, notes, recorded_by, allow_credit) VALUES (job.id, p_submission_key, 'receipt', p_amount,
      p_method, p_occurred_on, COALESCE(p_reference, ''), COALESCE(p_notes, ''), auth.uid(), COALESCE(p_allow_credit, false));
  UPDATE public.orders SET deposit_paid = paid + p_amount WHERE id = job.id;
  RETURN public.ledger_result(job.id);
END $$;
REVOKE ALL ON FUNCTION public.record_payment(TEXT, UUID, NUMERIC, TEXT, DATE, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(TEXT, UUID, NUMERIC, TEXT, DATE, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_payment(p_payment_id UUID, p_submission_key UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE original public.payments; existing public.payments; job public.orders; paid NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins can reverse payment records.'; END IF;
  IF p_submission_key IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A correction reason is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || p_submission_key::text, 0));
  SELECT * INTO original FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND OR original.kind = 'reversal' THEN RAISE EXCEPTION 'Select an original payment record.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = original.order_id FOR UPDATE;
  SELECT * INTO existing FROM public.payments WHERE submission_key = p_submission_key;
  IF FOUND THEN
    IF existing.reverses_payment_id IS DISTINCT FROM original.id OR existing.notes <> btrim(p_reason) THEN
      RAISE EXCEPTION 'This submission key belongs to a different correction.';
    END IF;
    RETURN public.ledger_result(job.id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE reverses_payment_id = original.id) THEN
    RAISE EXCEPTION 'This payment has already been reversed.';
  END IF;
  SELECT COALESCE(sum(amount), 0) - original.amount INTO paid FROM public.payments WHERE order_id = job.id;
  IF paid < 0 THEN RAISE EXCEPTION 'Correction would make the paid balance negative.'; END IF;
  INSERT INTO public.payments (order_id, submission_key, kind, amount, method, occurred_on, notes,
    recorded_by, reverses_payment_id) VALUES (job.id, p_submission_key, 'reversal', -original.amount,
      original.method, original.occurred_on, btrim(p_reason), auth.uid(), original.id);
  UPDATE public.orders SET deposit_paid = paid WHERE id = job.id;
  RETURN public.ledger_result(job.id);
END $$;
REVOKE ALL ON FUNCTION public.reverse_payment(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payment(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_client_measurements(p_client_id UUID, p_expected_revision BIGINT,
  p_unit TEXT, p_values JSONB, p_notes TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_unit TEXT; old_revision BIGINT; measure RECORD;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  IF p_unit IS NULL OR p_unit NOT IN ('in', 'cm') OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Valid units and measurement values are required.';
  END IF;
  PERFORM 1 FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  SELECT unit, revision INTO old_unit, old_revision FROM public.client_measurements WHERE client_id = p_client_id;
  old_revision := COALESCE(old_revision, 0);
  IF p_expected_revision IS DISTINCT FROM old_revision THEN RAISE EXCEPTION 'Measurements changed. Reload before saving.'; END IF;
  FOR measure IN SELECT key, value FROM jsonb_each_text(p_values) LOOP
    IF measure.value IS NULL OR round(measure.value::numeric, 2) <= 0 OR measure.value::numeric::text IN ('NaN', 'Infinity', '-Infinity')
      OR NOT EXISTS (SELECT 1 FROM public.measurement_parameters WHERE key = measure.key AND is_active) THEN
      RAISE EXCEPTION 'Measurements must be positive and use active parameters.';
    END IF;
  END LOOP;
  -- Inactive measurements are retained and converted with the active values.
  IF old_unit IS NOT NULL AND old_unit <> p_unit THEN
    UPDATE public.client_measurement_values SET value = round(value * CASE WHEN p_unit = 'cm' THEN 2.54 ELSE 1 / 2.54 END, 2)
      WHERE client_id = p_client_id;
  END IF;
  DELETE FROM public.client_measurement_values v USING public.measurement_parameters p
    WHERE v.client_id = p_client_id AND v.parameter_id = p.id AND p.is_active AND NOT (p_values ? p.key);
  INSERT INTO public.client_measurements (client_id, unit, notes, revision)
    VALUES (p_client_id, p_unit, NULLIF(btrim(p_notes), ''), old_revision + 1)
    ON CONFLICT (client_id) DO UPDATE SET unit = EXCLUDED.unit, notes = EXCLUDED.notes, revision = EXCLUDED.revision;
  FOR measure IN SELECT key, value FROM jsonb_each_text(p_values) LOOP
    INSERT INTO public.client_measurement_values (client_id, parameter_id, value)
      SELECT p_client_id, id, round(measure.value::numeric, 2) FROM public.measurement_parameters WHERE key = measure.key AND is_active
      ON CONFLICT (client_id, parameter_id) DO UPDATE SET value = EXCLUDED.value;
  END LOOP;
  RETURN public.capture_measurements(p_client_id, 'master');
END $$;
REVOKE ALL ON FUNCTION public.save_client_measurements(UUID, BIGINT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_client_measurements(UUID, BIGINT, TEXT, JSONB, TEXT) TO authenticated;
DROP POLICY IF EXISTS staff_manage_measurements ON public.client_measurements;
DROP POLICY IF EXISTS staff_manage_measurement_values ON public.client_measurement_values;
DROP POLICY IF EXISTS staff_read_measurements ON public.client_measurements;
DROP POLICY IF EXISTS staff_read_measurement_values ON public.client_measurement_values;
CREATE POLICY staff_read_measurements ON public.client_measurements FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY staff_read_measurement_values ON public.client_measurement_values FOR SELECT TO authenticated USING (public.is_tailor());

CREATE OR REPLACE FUNCTION public.apply_order_measurements(p_order_id TEXT, p_expected_capture TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; actor TEXT;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR job.client_id IS NULL THEN RAISE EXCEPTION 'Order has no customer record.'; END IF;
  IF job.status = 'delivered' THEN RAISE EXCEPTION 'Delivered order specifications are archived.'; END IF;
  IF (job.measurement_snapshot->>'capturedAt') IS DISTINCT FROM p_expected_capture THEN
    RAISE EXCEPTION 'Order measurements changed. Refresh before applying.';
  END IF;
  SELECT full_name INTO actor FROM public.profiles WHERE id = auth.uid();
  UPDATE public.orders SET measurement_snapshot = public.capture_measurements(job.client_id, 'applied'),
    stage_history = stage_history || jsonb_build_array(jsonb_build_object('stage', job.status,
      'completedAt', now(), 'completedBy', COALESCE(actor, 'Staff'), 'notes', 'Latest customer measurements explicitly applied to this order.'))
    WHERE id = job.id RETURNING * INTO job;
  RETURN to_jsonb(job);
END $$;
REVOKE ALL ON FUNCTION public.apply_order_measurements(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_measurements(TEXT, TEXT) TO authenticated;

-- Protect derived money and specifications even if a caller bypasses the UI.
CREATE OR REPLACE FUNCTION public.guard_order_records()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE paid NUMERIC;
BEGIN
  IF NEW.currency <> 'GHS' OR NEW.total_amount < 0 THEN RAISE EXCEPTION 'Orders use GHS and a non-negative price.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deposit_paid <> 0 THEN RAISE EXCEPTION 'Record payments through the payment ledger.'; END IF;
    NEW.measurement_snapshot := COALESCE(public.capture_measurements(NEW.client_id, 'intake'),
      jsonb_build_object('unit', 'in', 'values', '{}'::jsonb, 'labels', '{}'::jsonb, 'revision', 0, 'capturedAt', now(), 'source', 'intake'));
  ELSE
    IF NEW.deposit_paid IS DISTINCT FROM OLD.deposit_paid THEN
      SELECT COALESCE(sum(amount), 0) INTO paid FROM public.payments WHERE order_id = NEW.id;
      IF NEW.deposit_paid <> paid THEN RAISE EXCEPTION 'Paid total must match the payment ledger.'; END IF;
    END IF;
    IF current_user IN ('authenticated', 'anon') AND (NEW.measurement_snapshot IS DISTINCT FROM OLD.measurement_snapshot
      OR NEW.intake_request IS DISTINCT FROM OLD.intake_request OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.stage_history IS DISTINCT FROM OLD.stage_history) THEN
      RAISE EXCEPTION 'Use workshop operations to change stages or specifications.';
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.due_date <> '' THEN
      IF NEW.due_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Due date must use YYYY-MM-DD.'; END IF;
      PERFORM NEW.due_date::date;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_order_records ON public.orders;
CREATE TRIGGER guard_order_records BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_records();

CREATE OR REPLACE FUNCTION public.create_bespoke_intake(p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE customer_id UUID; staff_name TEXT; header public.client_measurements; prior public.orders;
  phone TEXT; total NUMERIC; deposit NUMERIC; vals JSONB; factor NUMERIC;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  IF NULLIF(p_payload->>'id', '') IS NULL THEN RAISE EXCEPTION 'Intake submission ID required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('intake:' || (p_payload->>'id'), 0));
  SELECT * INTO prior FROM public.orders WHERE id = p_payload->>'id';
  IF FOUND THEN
    IF prior.intake_request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'This intake was already saved with different details. Refresh the customer records.'; END IF;
    RETURN prior.client_id;
  END IF;
  phone := p_payload->>'client_phone'; total := (p_payload->>'total_amount')::numeric; deposit := (p_payload->>'deposit_paid')::numeric;
  IF phone IS NULL OR phone !~ '^233[0-9]{9}$' OR NULLIF(btrim(p_payload->>'client_name'), '') IS NULL
    OR NULLIF(btrim(p_payload->>'garment_title'), '') IS NULL OR total IS NULL OR total <= 0 OR total <> round(total, 2)
    OR deposit IS NULL OR deposit < 0 OR deposit > total OR deposit <> round(deposit, 2)
    OR total::text IN ('NaN', 'Infinity', '-Infinity') OR deposit::text IN ('NaN', 'Infinity', '-Infinity')
    OR (p_payload->>'unit') IS NULL OR (p_payload->>'unit') NOT IN ('in', 'cm')
    OR COALESCE(p_payload->>'currency', 'GHS') <> 'GHS' THEN RAISE EXCEPTION 'Invalid intake details.'; END IF;
  SELECT full_name INTO staff_name FROM public.profiles WHERE id = (p_payload->>'tailor_id')::uuid AND role IN ('tailor', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active staff member.'; END IF;
  IF NULLIF(p_payload->>'due_date', '') IS NOT NULL THEN
    IF (p_payload->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Due date must use YYYY-MM-DD.'; END IF;
    PERFORM (p_payload->>'due_date')::date;
  END IF;
  INSERT INTO public.clients (full_name, phone_number) VALUES (btrim(p_payload->>'client_name'), phone)
    ON CONFLICT (phone_number) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id INTO customer_id;
  SELECT * INTO header FROM public.client_measurements WHERE client_id = customer_id;
  factor := CASE WHEN header.unit IS NULL OR header.unit = p_payload->>'unit' THEN 1
    WHEN p_payload->>'unit' = 'cm' THEN 2.54 ELSE 1 / 2.54 END;
  SELECT COALESCE(jsonb_object_agg(p.key, round(v.value * factor, 2)), '{}'::jsonb) INTO vals
    FROM public.client_measurement_values v JOIN public.measurement_parameters p ON p.id = v.parameter_id
    WHERE v.client_id = customer_id AND p.is_active;
  PERFORM public.save_client_measurements(customer_id, COALESCE(header.revision, 0), p_payload->>'unit',
    vals || COALESCE(p_payload->'measurement_values', '{}'::jsonb), COALESCE(header.notes, ''));
  INSERT INTO public.orders (id, client_id, client_name, client_phone, garment_title, garment_subtitle,
    fabric_type, fabric_color, fabric_notes, reference_images, swatch_image, assigned_tailor,
    due_date, total_amount, currency, assigned_tailor_id, intake_request, stage_history)
  VALUES (p_payload->>'id', customer_id, btrim(p_payload->>'client_name'), phone, p_payload->>'garment_title',
    COALESCE(p_payload->>'garment_subtitle', ''), COALESCE(p_payload->>'fabric_type', ''), COALESCE(p_payload->>'fabric_color', ''),
    COALESCE(p_payload->>'fabric_notes', ''), ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'reference_images', '[]'::jsonb))),
    p_payload->>'swatch_image', COALESCE(staff_name, 'Staff'), COALESCE(p_payload->>'due_date', ''), total, 'GHS',
    (p_payload->>'tailor_id')::uuid, p_payload, jsonb_build_array(jsonb_build_object('stage', 'pending',
      'completedAt', now(), 'completedBy', COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Staff'), 'notes', 'Intake saved.')));
  INSERT INTO public.order_tasks (id, order_id, tailor_id, tailor_name, title) VALUES (p_payload->>'task_id',
    p_payload->>'id', (p_payload->>'tailor_id')::uuid, COALESCE(staff_name, 'Staff'), 'Draft master bespoke pattern for ' || (p_payload->>'garment_title'));
  IF deposit > 0 THEN
    PERFORM public.record_payment(p_payload->>'id', (p_payload->>'deposit_submission_key')::uuid,
      deposit, COALESCE(p_payload->>'payment_method', 'Cash in Atelier'),
      COALESCE((p_payload->>'payment_date')::date, (now() AT TIME ZONE 'UTC')::date), COALESCE(p_payload->>'payment_reference', ''), 'Initial intake deposit', false);
  END IF;
  RETURN customer_id;
END $$;

-- Currency is fixed for this Ghanaian workshop; changing a setting cannot relabel old money.
INSERT INTO public.app_settings (key, value) VALUES ('currency', '"GHS"'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
CREATE OR REPLACE FUNCTION public.guard_workshop_currency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.key = 'currency' AND NEW.value IS DISTINCT FROM '"GHS"'::jsonb THEN RAISE EXCEPTION 'Workshop currency is fixed to GHS.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_workshop_currency ON public.app_settings;
CREATE TRIGGER guard_workshop_currency BEFORE INSERT OR UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.guard_workshop_currency();
CREATE OR REPLACE FUNCTION public.advance_order_stage(p_order_id TEXT, p_expected_stage public.order_status)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; next_stage public.order_status; actor_name TEXT;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF p_expected_stage IS NULL OR job.status <> p_expected_stage THEN RAISE EXCEPTION 'Order changed. Refresh before advancing.'; END IF;
  next_stage := CASE job.status
    WHEN 'pending' THEN 'cutting' WHEN 'cutting' THEN 'fitting' WHEN 'fitting' THEN 'finishing'
    WHEN 'finishing' THEN 'ready' WHEN 'ready' THEN 'delivered' ELSE NULL END;
  IF next_stage IS NULL THEN RAISE EXCEPTION 'Order has already been delivered.'; END IF;
  SELECT full_name INTO actor_name FROM public.profiles WHERE id = auth.uid();
  UPDATE public.orders SET status = next_stage,
    stage_history = stage_history || jsonb_build_array(jsonb_build_object(
      'stage', next_stage, 'completedAt', now(), 'completedBy', COALESCE(actor_name, 'Staff'),
      'notes', 'Production stage advanced.'))
    WHERE id = job.id RETURNING * INTO job;
  RETURN to_jsonb(job);
END $$;
REVOKE ALL ON FUNCTION public.advance_order_stage(TEXT, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_stage(TEXT, public.order_status) TO authenticated;


COMMIT;
