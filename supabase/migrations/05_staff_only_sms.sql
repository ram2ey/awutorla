-- Separate customer records from login accounts, preserve existing data, and
-- revoke client access. Run after migrations 01-04. No auth users are deleted.
BEGIN;

CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone_number TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preserve IDs so existing orders and measurements keep their relationships.
INSERT INTO public.clients (id, full_name, phone_number, created_at, updated_at)
SELECT p.id, COALESCE(p.full_name, 'Client'), p.phone_number, p.created_at, p.updated_at
FROM public.profiles p
WHERE p.role = 'client'
  OR EXISTS (SELECT 1 FROM public.orders o WHERE o.client_id = p.id)
  OR EXISTS (SELECT 1 FROM public.client_measurements m WHERE m.client_id = p.id)
  OR EXISTS (SELECT 1 FROM public.client_measurement_values v WHERE v.client_id = p.id)
ON CONFLICT (id) DO NOTHING;

-- Recover orders previously saved without an attached client account.
INSERT INTO public.clients (full_name, phone_number)
SELECT DISTINCT ON (client_phone) COALESCE(NULLIF(client_name, ''), 'Client'), client_phone
FROM public.orders WHERE client_id IS NULL AND client_phone <> ''
ORDER BY client_phone, created_at DESC
ON CONFLICT (phone_number) DO NOTHING;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_client_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;
UPDATE public.orders o SET client_id = c.id
FROM public.clients c WHERE o.client_id IS NULL AND o.client_phone = c.phone_number;
ALTER TABLE public.client_measurements DROP CONSTRAINT IF EXISTS client_measurements_client_id_fkey;
ALTER TABLE public.client_measurements ADD CONSTRAINT client_measurements_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.client_measurement_values DROP CONSTRAINT IF EXISTS client_measurement_values_client_id_fkey;
ALTER TABLE public.client_measurement_values ADD CONSTRAINT client_measurement_values_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;
DROP TRIGGER IF EXISTS set_clients_updated_at ON public.clients;
CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_tailor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
UPDATE public.orders o SET assigned_tailor_id = p.id FROM public.profiles p
WHERE o.assigned_tailor_id IS NULL AND p.role IN ('tailor', 'admin') AND p.full_name = o.assigned_tailor
  AND (SELECT count(*) FROM public.profiles other WHERE other.role IN ('tailor', 'admin') AND other.full_name = p.full_name) = 1;

CREATE TABLE IF NOT EXISTS public.sms_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage public.order_status NOT NULL,
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'submitted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, stage)
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT ON public.sms_notifications TO authenticated;

-- Remove all legacy client/owner policies: no old client account may read or
-- write workshop data, even by calling the database API directly.
DO $$ DECLARE policy_record RECORD;
BEGIN
  FOR policy_record IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'profiles', 'clients', 'orders', 'order_tasks', 'client_measurements',
      'client_measurement_values', 'measurement_parameters', 'app_settings', 'sms_notifications'
    )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, policy_record.tablename);
  END LOOP;
END $$;

CREATE POLICY staff_read_profiles ON public.profiles FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY staff_update_own_profile ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_tailor() AND auth.uid() = id) WITH CHECK (public.is_tailor() AND auth.uid() = id);
CREATE POLICY admin_update_profiles ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY staff_manage_clients ON public.clients FOR ALL TO authenticated
  USING (public.is_tailor()) WITH CHECK (public.is_tailor());
CREATE POLICY staff_read_orders ON public.orders FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY staff_insert_orders ON public.orders FOR INSERT TO authenticated WITH CHECK (public.is_tailor());
CREATE POLICY staff_update_orders ON public.orders FOR UPDATE TO authenticated
  USING (public.is_tailor()) WITH CHECK (public.is_tailor());
CREATE POLICY staff_read_tasks ON public.order_tasks FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY staff_insert_tasks ON public.order_tasks FOR INSERT TO authenticated WITH CHECK (public.is_tailor());
CREATE POLICY staff_update_tasks ON public.order_tasks FOR UPDATE TO authenticated
  USING (public.is_tailor()) WITH CHECK (public.is_tailor());
CREATE POLICY admin_delete_tasks ON public.order_tasks FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY staff_manage_measurements ON public.client_measurements FOR ALL TO authenticated
  USING (public.is_tailor()) WITH CHECK (public.is_tailor());
CREATE POLICY staff_manage_measurement_values ON public.client_measurement_values FOR ALL TO authenticated
  USING (public.is_tailor()) WITH CHECK (public.is_tailor());
CREATE POLICY staff_read_parameters ON public.measurement_parameters FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY admin_manage_parameters ON public.measurement_parameters FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY staff_read_settings ON public.app_settings FOR SELECT TO authenticated USING (public.is_tailor());
CREATE POLICY admin_manage_settings ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY staff_read_sms ON public.sms_notifications FOR SELECT TO authenticated USING (public.is_tailor());

-- Role grants come from server-controlled app metadata, never signup metadata.
-- Existing staff roles remain unchanged; unknown signups have no staff access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone_number, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.phone,
    CASE WHEN NEW.raw_app_meta_data->>'role' IN ('tailor', 'admin')
      THEN (NEW.raw_app_meta_data->>'role')::public.user_role ELSE 'client'::public.user_role END);
  RETURN NEW;
END $$;

DELETE FROM public.app_settings WHERE key = 'whatsapp_delivery_message';
-- Client files are available only to staff. Invoices are downloaded locally.
UPDATE storage.buckets SET public = false WHERE id IN ('invoices', 'order-sketches');
DROP POLICY IF EXISTS staff_read_workshop_files ON storage.objects;
CREATE POLICY staff_read_workshop_files ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('invoices', 'order-sketches') AND public.is_tailor());

-- Each committed stage change produces one durable, server-authored SMS record.
CREATE OR REPLACE FUNCTION public.queue_progress_sms()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE shop_name TEXT; stage_text TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT value #>> '{}' INTO shop_name FROM public.app_settings WHERE key = 'business_name';
  shop_name := COALESCE(NULLIF(shop_name, ''), 'Awutorla');
  stage_text := CASE NEW.status
    WHEN 'cutting' THEN 'Cutting has started.'
    WHEN 'fitting' THEN 'Your garment is ready for fitting. Please contact the atelier to arrange a time.'
    WHEN 'finishing' THEN 'Your garment is in final finishing.'
    WHEN 'ready' THEN 'Your garment is ready for collection.'
    WHEN 'delivered' THEN 'Your garment has been delivered. Thank you.'
    ELSE 'Your order has been received.' END;
  INSERT INTO public.sms_notifications (order_id, stage, recipient, content)
  VALUES (NEW.id, NEW.status, NEW.client_phone, shop_name || ': Order ' || NEW.id || '. ' || stage_text)
  ON CONFLICT (order_id, stage) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS queue_progress_sms ON public.orders;
CREATE TRIGGER queue_progress_sms AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.queue_progress_sms();

CREATE OR REPLACE FUNCTION public.advance_order_stage(p_order_id TEXT, p_expected_stage public.order_status)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; next_stage public.order_status; actor_name TEXT;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF job.status <> p_expected_stage THEN RAISE EXCEPTION 'Order changed. Refresh before advancing.'; END IF;
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

-- Claim atomically so repeated clicks cannot submit the same notification twice.
-- An interrupted/uncertain provider request is held for staff review, not auto-retried.
CREATE OR REPLACE FUNCTION public.claim_progress_sms(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE notification public.sms_notifications;
BEGIN
  UPDATE public.sms_notifications SET status = 'sending', attempts = attempts + 1,
    updated_at = now(), last_error = NULL
    WHERE id = p_notification_id AND status IN ('pending', 'failed')
    RETURNING * INTO notification;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(notification);
END $$;
REVOKE ALL ON FUNCTION public.claim_progress_sms(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_progress_sms(UUID) TO service_role;

-- Intake creates a customer, order, initial task and measurements in one transaction.
CREATE OR REPLACE FUNCTION public.create_bespoke_intake(p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE customer_id UUID; staff_name TEXT; old_unit TEXT; requested_unit TEXT;
  phone TEXT; total NUMERIC; deposit NUMERIC; measure RECORD;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  phone := p_payload->>'client_phone';
  requested_unit := p_payload->>'unit';
  total := (p_payload->>'total_amount')::numeric;
  deposit := (p_payload->>'deposit_paid')::numeric;
  IF phone IS NULL OR phone !~ '^233[0-9]{9}$' OR NULLIF(btrim(p_payload->>'client_name'), '') IS NULL
    OR NULLIF(btrim(p_payload->>'garment_title'), '') IS NULL
    OR total IS NULL OR total <= 0 OR deposit IS NULL OR deposit < 0 OR deposit > total
    OR requested_unit IS NULL OR requested_unit NOT IN ('in', 'cm') THEN
    RAISE EXCEPTION 'Invalid intake details.';
  END IF;
  SELECT full_name INTO staff_name FROM public.profiles
    WHERE id = (p_payload->>'tailor_id')::uuid AND role IN ('tailor', 'admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active staff member.'; END IF;
  INSERT INTO public.clients (full_name, phone_number)
    VALUES (btrim(p_payload->>'client_name'), phone)
    ON CONFLICT (phone_number) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id INTO customer_id;
  SELECT unit INTO old_unit FROM public.client_measurements WHERE client_id = customer_id FOR UPDATE;
  IF old_unit IS NOT NULL AND old_unit <> requested_unit THEN
    UPDATE public.client_measurement_values SET value = round(value *
      CASE WHEN requested_unit = 'cm' THEN 2.54 ELSE 1 / 2.54 END, 2)
      WHERE client_id = customer_id;
  END IF;
  INSERT INTO public.client_measurements (client_id, unit) VALUES (customer_id, requested_unit)
    ON CONFLICT (client_id) DO UPDATE SET unit = EXCLUDED.unit;
  FOR measure IN SELECT key, value FROM jsonb_each_text(COALESCE(p_payload->'measurement_values', '{}'::jsonb)) LOOP
    IF measure.value::numeric <= 0 THEN RAISE EXCEPTION 'Measurements must be positive.'; END IF;
    INSERT INTO public.client_measurement_values (client_id, parameter_id, value)
      SELECT customer_id, id, measure.value::numeric FROM public.measurement_parameters
      WHERE key = measure.key AND is_active
      ON CONFLICT (client_id, parameter_id) DO UPDATE SET value = EXCLUDED.value;
  END LOOP;
  INSERT INTO public.orders (id, client_id, client_name, client_phone, garment_title, garment_subtitle,
    fabric_type, fabric_color, fabric_notes, reference_images, swatch_image, assigned_tailor,
    due_date, deposit_paid, total_amount, currency, assigned_tailor_id, stage_history)
  VALUES (p_payload->>'id', customer_id, btrim(p_payload->>'client_name'), phone,
    p_payload->>'garment_title', COALESCE(p_payload->>'garment_subtitle', ''),
    COALESCE(p_payload->>'fabric_type', ''), COALESCE(p_payload->>'fabric_color', ''),
    COALESCE(p_payload->>'fabric_notes', ''),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'reference_images', '[]'::jsonb))),
    p_payload->>'swatch_image', COALESCE(staff_name, 'Staff'), p_payload->>'due_date', deposit, total,
    COALESCE(p_payload->>'currency', 'GHS'), (p_payload->>'tailor_id')::uuid, jsonb_build_array(jsonb_build_object(
      'stage', 'pending', 'completedAt', now(), 'completedBy', 'Reception', 'notes', 'Intake saved.')));
  INSERT INTO public.order_tasks (id, order_id, tailor_id, tailor_name, title)
    VALUES (p_payload->>'task_id', p_payload->>'id', (p_payload->>'tailor_id')::uuid,
      COALESCE(staff_name, 'Staff'), 'Draft master bespoke pattern for ' || (p_payload->>'garment_title'));
  RETURN customer_id;
END $$;
REVOKE ALL ON FUNCTION public.create_bespoke_intake(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bespoke_intake(JSONB) TO authenticated;

COMMIT;
