-- Phase 5 and manual Phase 6: fittings, rework, quality, audit and SMS review.
BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS work_revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS production_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS production_cycle INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.sms_notifications ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE public.sms_notifications DROP CONSTRAINT IF EXISTS sms_notifications_order_id_stage_key;
CREATE UNIQUE INDEX IF NOT EXISTS sms_cycle_key ON public.sms_notifications(order_id, stage, production_cycle);
ALTER TABLE public.sms_notifications DROP CONSTRAINT IF EXISTS sms_notifications_status_check;
ALTER TABLE public.sms_notifications ADD CONSTRAINT sms_notifications_status_check CHECK
  (status IN ('pending','sending','submitted','failed','sent_manually','superseded','reviewed_submitted'));

CREATE TABLE IF NOT EXISTS public.order_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  event TEXT NOT NULL, details JSONB NOT NULL, actor_id UUID REFERENCES public.profiles(id),
  actor_name TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fitting_appointments (
  id UUID PRIMARY KEY, order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  tailor_id UUID NOT NULL REFERENCES public.profiles(id), starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  status TEXT NOT NULL CHECK (status IN ('scheduled','completed','cancelled','missed')),
  notes TEXT NOT NULL DEFAULT '', revision BIGINT NOT NULL DEFAULT 1,
  last_request JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.order_rework (
  id UUID PRIMARY KEY, order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0), status TEXT NOT NULL CHECK (status IN ('open','completed','cancelled')),
  notes TEXT NOT NULL DEFAULT '', revision BIGINT NOT NULL DEFAULT 1,
  last_request JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.order_quality_checks (
  id UUID PRIMARY KEY, order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  work_revision BIGINT NOT NULL, checks JSONB NOT NULL, notes TEXT NOT NULL DEFAULT '',
  checked_by UUID NOT NULL REFERENCES public.profiles(id), checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (checks @> '{"fit":true,"measurements":true,"seams":true,"finish":true}'::jsonb)
);
CREATE INDEX IF NOT EXISTS order_audit_order_idx ON public.order_audit(order_id, recorded_at);
CREATE INDEX IF NOT EXISTS fitting_order_idx ON public.fitting_appointments(order_id);
CREATE INDEX IF NOT EXISTS fitting_staff_time_idx ON public.fitting_appointments(tailor_id, starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS rework_order_idx ON public.order_rework(order_id);
CREATE INDEX IF NOT EXISTS quality_order_idx ON public.order_quality_checks(order_id, work_revision);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['order_audit','fitting_appointments','order_rework','order_quality_checks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS staff_read ON public.%I', t);
    EXECUTE format('CREATE POLICY staff_read ON public.%I FOR SELECT TO authenticated USING (public.is_tailor())', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.append_order_audit(p_order_id TEXT, p_event TEXT, p_details JSONB)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.order_audit(order_id, event, details, actor_id, actor_name)
    VALUES (p_order_id, p_event, p_details, auth.uid(),
      COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'System'));
$$;
REVOKE ALL ON FUNCTION public.append_order_audit(TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_workshop_management()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.assigned_tailor_id IS DISTINCT FROM OLD.assigned_tailor_id
      OR NEW.assigned_tailor IS DISTINCT FROM OLD.assigned_tailor THEN
      RAISE EXCEPTION 'Only an admin can change price or assignment through the audited operation.';
    END IF;
    IF NEW.work_revision <> OLD.work_revision OR NEW.production_cycle <> OLD.production_cycle
      OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.client_phone <> OLD.client_phone OR NEW.client_name <> OLD.client_name THEN
      RAISE EXCEPTION 'Order identity and production versions are managed by workshop operations.';
    END IF;
  END IF;
  IF NEW.measurement_snapshot IS DISTINCT FROM OLD.measurement_snapshot OR NEW.fabric_notes <> OLD.fabric_notes
    OR NEW.fabric_type <> OLD.fabric_type OR NEW.fabric_color <> OLD.fabric_color
    OR NEW.garment_title <> OLD.garment_title OR NEW.garment_subtitle <> OLD.garment_subtitle
    OR NEW.reference_images IS DISTINCT FROM OLD.reference_images OR NEW.swatch_image IS DISTINCT FROM OLD.swatch_image THEN
    NEW.work_revision := OLD.work_revision + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_guard_workshop_management ON public.orders;
CREATE TRIGGER a_guard_workshop_management BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_workshop_management();

CREATE OR REPLACE FUNCTION public.audit_order_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changes JSONB := '{}'::jsonb; k TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['status','total_amount','assigned_tailor_id','assigned_tailor','due_date','measurement_snapshot','work_revision','production_cycle'] LOOP
    IF to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k THEN
      changes := changes || jsonb_build_object(k, jsonb_build_object('before',to_jsonb(OLD)->k,'after',to_jsonb(NEW)->k));
    END IF;
  END LOOP;
  IF changes <> '{}'::jsonb THEN PERFORM public.append_order_audit(NEW.id, 'Order updated', changes); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_order_changes ON public.orders;
CREATE TRIGGER audit_order_changes AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_order_changes();

CREATE OR REPLACE FUNCTION public.invalidate_task_quality()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job_id TEXT;
BEGIN
  job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN RAISE EXCEPTION 'Tasks cannot move between orders.'; END IF;
  PERFORM 1 FROM public.orders WHERE id = job_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = job_id AND status = 'delivered') THEN
    RAISE EXCEPTION 'Reopen the delivered order before changing production tasks.';
  END IF;
  UPDATE public.orders SET work_revision = work_revision + 1 WHERE id = job_id;
  PERFORM public.append_order_audit(job_id, 'Task ' || lower(TG_OP),
    jsonb_build_object('before', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      'after', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS invalidate_task_quality ON public.order_tasks;
CREATE TRIGGER invalidate_task_quality BEFORE INSERT OR UPDATE OR DELETE ON public.order_tasks
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_task_quality();

CREATE OR REPLACE FUNCTION public.check_order_readiness()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('ready','delivered') THEN
    IF EXISTS (SELECT 1 FROM public.order_tasks WHERE order_id = NEW.id AND status <> 'completed')
      OR EXISTS (SELECT 1 FROM public.order_rework WHERE order_id = NEW.id AND status = 'open')
      OR EXISTS (SELECT 1 FROM public.fitting_appointments WHERE order_id = NEW.id AND status = 'scheduled') THEN
      RAISE EXCEPTION 'Complete tasks, close rework and resolve scheduled fittings before Ready or Delivered.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_quality_checks WHERE order_id = NEW.id AND work_revision = NEW.work_revision) THEN
      RAISE EXCEPTION 'Record a passing quality check for the current work version first.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS check_order_readiness ON public.orders;
CREATE TRIGGER check_order_readiness BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.check_order_readiness();

CREATE OR REPLACE FUNCTION public.save_fitting(p_order_id TEXT, p_id UUID, p_expected_revision BIGINT, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; prior public.fitting_appointments; entry public.fitting_appointments;
  start_time TIMESTAMPTZ; minutes INTEGER; artisan UUID; state TEXT;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_id IS NULL THEN RAISE EXCEPTION 'Order and submission ID required.'; END IF;
  SELECT * INTO prior FROM public.fitting_appointments WHERE id = p_id;
  IF FOUND AND prior.order_id <> p_order_id THEN RAISE EXCEPTION 'Fitting belongs to another order.'; END IF;
  IF prior.id IS NOT NULL AND prior.last_request = p_payload AND prior.revision = p_expected_revision + 1 THEN RETURN to_jsonb(prior); END IF;
  IF COALESCE(prior.revision,0) IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Fitting changed. Refresh before saving.'; END IF;
  state := p_payload->>'status'; artisan := (p_payload->>'tailor_id')::uuid;
  start_time := (p_payload->>'starts_at')::timestamptz; minutes := (p_payload->>'duration_minutes')::integer;
  IF state IS NULL OR state NOT IN ('scheduled','completed','cancelled','missed') OR start_time IS NULL OR NOT isfinite(start_time)
    OR minutes IS NULL OR minutes NOT BETWEEN 15 AND 240 OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = artisan AND role IN ('tailor','admin')) THEN
    RAISE EXCEPTION 'Enter a valid fitting time, duration, status and staff member.';
  END IF;
  IF job.status = 'delivered' OR (prior.id IS NOT NULL AND prior.status <> 'scheduled') THEN RAISE EXCEPTION 'This fitting is archived. Create a new appointment on an active order.'; END IF;
  IF prior.id IS NULL AND state <> 'scheduled' THEN RAISE EXCEPTION 'New fittings must be scheduled first.'; END IF;
  IF prior.id IS NOT NULL AND state <> 'scheduled' AND (start_time IS DISTINCT FROM prior.starts_at OR artisan IS DISTINCT FROM prior.tailor_id OR minutes IS DISTINCT FROM prior.duration_minutes) THEN
    RAISE EXCEPTION 'Record the outcome for the original appointment. Reschedule first if its time or staff was incorrect.';
  END IF;
  IF state = 'scheduled' AND start_time < now() THEN RAISE EXCEPTION 'Schedule a future fitting time.'; END IF;
  IF state IN ('completed','missed') AND start_time > now() THEN RAISE EXCEPTION 'A future fitting cannot be completed or missed.'; END IF;
  IF state <> 'scheduled' AND NULLIF(btrim(p_payload->>'notes'),'') IS NULL THEN RAISE EXCEPTION 'Record an outcome or cancellation reason.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fitting:' || artisan::text,0));
  IF state = 'scheduled' AND EXISTS (SELECT 1 FROM public.fitting_appointments WHERE tailor_id = artisan AND status = 'scheduled' AND id <> p_id
    AND starts_at < start_time + minutes * interval '1 minute' AND starts_at + duration_minutes * interval '1 minute' > start_time) THEN
    RAISE EXCEPTION 'This staff member already has an overlapping fitting.';
  END IF;
  INSERT INTO public.fitting_appointments(id,order_id,tailor_id,starts_at,duration_minutes,status,notes,revision,last_request)
    VALUES(p_id,p_order_id,artisan,start_time,minutes,state,COALESCE(p_payload->>'notes',''),p_expected_revision+1,p_payload)
    ON CONFLICT(id) DO UPDATE SET tailor_id=EXCLUDED.tailor_id, starts_at=EXCLUDED.starts_at, duration_minutes=EXCLUDED.duration_minutes,
      status=EXCLUDED.status,notes=EXCLUDED.notes,revision=EXCLUDED.revision,last_request=EXCLUDED.last_request,updated_at=now() RETURNING * INTO entry;
  UPDATE public.orders SET work_revision = work_revision + 1 WHERE id = job.id;
  PERFORM public.append_order_audit(job.id,'Fitting ' || state,to_jsonb(entry) - 'last_request');
  RETURN to_jsonb(entry);
END $$;

CREATE OR REPLACE FUNCTION public.save_rework(p_order_id TEXT, p_id UUID, p_expected_revision BIGINT, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.orders; prior public.order_rework; entry public.order_rework; state TEXT; reason TEXT;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR p_id IS NULL THEN RAISE EXCEPTION 'Order and submission ID required.'; END IF;
  SELECT * INTO prior FROM public.order_rework WHERE id=p_id;
  IF FOUND AND prior.order_id <> p_order_id THEN RAISE EXCEPTION 'Rework belongs to another order.'; END IF;
  IF prior.id IS NOT NULL AND prior.last_request=p_payload AND prior.revision=p_expected_revision+1 THEN RETURN to_jsonb(prior); END IF;
  IF COALESCE(prior.revision,0) IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Rework changed. Refresh before saving.'; END IF;
  state := p_payload->>'status'; reason := btrim(p_payload->>'reason');
  IF state IS NULL OR state NOT IN ('open','completed','cancelled') OR NULLIF(reason,'') IS NULL
    OR (prior.id IS NULL AND state <> 'open') THEN RAISE EXCEPTION 'New rework needs a reason and open status.'; END IF;
  IF job.status = 'delivered' THEN RAISE EXCEPTION 'An admin must reopen the delivered order first.'; END IF;
  IF prior.id IS NOT NULL AND prior.status <> 'open' THEN RAISE EXCEPTION 'Closed rework is archived. Add a new record.'; END IF;
  IF state <> 'open' AND NULLIF(btrim(p_payload->>'notes'),'') IS NULL THEN RAISE EXCEPTION 'Record the rework outcome or cancellation reason.'; END IF;
  INSERT INTO public.order_rework(id,order_id,reason,status,notes,revision,last_request)
    VALUES(p_id,p_order_id,reason,state,COALESCE(p_payload->>'notes',''),p_expected_revision+1,p_payload)
    ON CONFLICT(id) DO UPDATE SET reason=EXCLUDED.reason,status=EXCLUDED.status,notes=EXCLUDED.notes,
      revision=EXCLUDED.revision,last_request=EXCLUDED.last_request,updated_at=now() RETURNING * INTO entry;
  UPDATE public.orders SET work_revision=work_revision+1,
    production_cycle=production_cycle+CASE WHEN status='ready' AND state='open' THEN 1 ELSE 0 END,
    status=CASE WHEN status='ready' AND state='open' THEN 'finishing'::public.order_status ELSE status END,
    stage_history=stage_history || jsonb_build_array(jsonb_build_object('stage',CASE WHEN status='ready' AND state='open' THEN 'finishing'::public.order_status ELSE status END,'completedAt',now(),
      'completedBy',(SELECT full_name FROM public.profiles WHERE id=auth.uid()),'notes','Rework: ' || reason || ' (' || state || ')')) WHERE id=job.id;
  PERFORM public.append_order_audit(job.id,'Rework ' || state,to_jsonb(entry) - 'last_request');
  RETURN to_jsonb(entry);
END $$;

CREATE OR REPLACE FUNCTION public.record_quality_check(p_order_id TEXT,p_id UUID,p_expected_work_revision BIGINT,p_checks JSONB,p_notes TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.orders; entry public.order_quality_checks;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR p_id IS NULL THEN RAISE EXCEPTION 'Order and submission ID required.'; END IF;
  SELECT * INTO entry FROM public.order_quality_checks WHERE id=p_id;
  IF FOUND THEN
    IF entry.order_id <> p_order_id OR entry.work_revision IS DISTINCT FROM p_expected_work_revision OR entry.checks IS DISTINCT FROM p_checks OR entry.notes <> COALESCE(p_notes,'') THEN RAISE EXCEPTION 'Submission was already saved with different details.'; END IF;
    RETURN to_jsonb(entry);
  END IF;
  IF job.status NOT IN ('finishing','ready') OR job.work_revision IS DISTINCT FROM p_expected_work_revision THEN
    RAISE EXCEPTION 'Check the current finishing or Ready work version. Refresh first.';
  END IF;
  IF p_checks IS NULL OR NOT (p_checks @> '{"fit":true,"measurements":true,"seams":true,"finish":true}'::jsonb) THEN RAISE EXCEPTION 'Confirm all four quality checks.'; END IF;
  IF EXISTS(SELECT 1 FROM public.order_tasks WHERE order_id=job.id AND status<>'completed')
    OR EXISTS(SELECT 1 FROM public.order_rework WHERE order_id=job.id AND status='open')
    OR EXISTS(SELECT 1 FROM public.fitting_appointments WHERE order_id=job.id AND status='scheduled') THEN RAISE EXCEPTION 'Complete tasks and resolve fittings/rework before the quality check.'; END IF;
  INSERT INTO public.order_quality_checks(id,order_id,work_revision,checks,notes,checked_by)
    VALUES(p_id,job.id,job.work_revision,p_checks,COALESCE(p_notes,''),auth.uid()) RETURNING * INTO entry;
  PERFORM public.append_order_audit(job.id,'Quality passed',to_jsonb(entry)); RETURN to_jsonb(entry);
END $$;

CREATE OR REPLACE FUNCTION public.update_order_terms(p_order_id TEXT,p_expected_updated_at TIMESTAMPTZ,p_total NUMERIC,p_tailor_id UUID,p_reason TEXT,p_allow_credit BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.orders; artisan TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required to change price or assignment.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR job.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Order changed. Refresh before editing terms.'; END IF;
  IF job.status='delivered' OR NULLIF(btrim(p_reason),'') IS NULL OR p_total IS NULL OR p_total<0 OR p_total<>round(p_total,2) OR p_total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Active order, valid GHS price and a reason required.'; END IF;
  SELECT full_name INTO artisan FROM public.profiles WHERE id=p_tailor_id AND role IN ('admin','tailor');
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active staff member.'; END IF;
  IF p_total < job.deposit_paid AND NOT COALESCE(p_allow_credit,false) THEN RAISE EXCEPTION 'Confirm the customer credit created by this lower price.'; END IF;
  UPDATE public.orders SET total_amount=p_total,assigned_tailor_id=p_tailor_id,assigned_tailor=COALESCE(artisan,'Staff') WHERE id=job.id RETURNING * INTO job;
  PERFORM public.append_order_audit(job.id,'Terms changed',jsonb_build_object('reason',btrim(p_reason),'total',p_total,'tailorId',p_tailor_id)); RETURN to_jsonb(job);
END $$;

CREATE OR REPLACE FUNCTION public.reopen_order(p_order_id TEXT,p_expected_stage public.order_status,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.orders;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only an admin can reopen an order.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR job.status IS DISTINCT FROM p_expected_stage OR job.status NOT IN ('ready','delivered') OR NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Refresh a Ready or Delivered order and enter the reopening reason.'; END IF;
  UPDATE public.orders SET status='finishing',work_revision=work_revision+1,production_cycle=production_cycle+1,
    stage_history=stage_history || jsonb_build_array(jsonb_build_object('stage','finishing','completedAt',now(),
      'completedBy',(SELECT full_name FROM public.profiles WHERE id=auth.uid()),'notes','Reopened: ' || btrim(p_reason))) WHERE id=job.id RETURNING * INTO job;
  PERFORM public.append_order_audit(job.id,'Order reopened',jsonb_build_object('reason',btrim(p_reason))); RETURN to_jsonb(job);
END $$;

CREATE OR REPLACE FUNCTION public.queue_progress_sms()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE shop_name TEXT; stage_text TEXT;
BEGIN
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  UPDATE public.sms_notifications SET status='superseded',updated_at=now() WHERE order_id=NEW.id AND status IN ('pending','failed');
  SELECT value #>> '{}' INTO shop_name FROM public.app_settings WHERE key='business_name';
  stage_text := CASE NEW.status WHEN 'cutting' THEN 'Cutting has started.' WHEN 'fitting' THEN 'Your garment is ready for fitting. Please contact the atelier to arrange a time.'
    WHEN 'finishing' THEN 'Your garment is in final finishing.' WHEN 'ready' THEN 'Your garment is ready for collection.'
    WHEN 'delivered' THEN 'Your garment has been delivered. Thank you.' ELSE 'Your order has been received.' END;
  INSERT INTO public.sms_notifications(order_id,stage,production_cycle,recipient,content) VALUES(NEW.id,NEW.status,NEW.production_cycle,NEW.client_phone,
    COALESCE(NULLIF(shop_name,''),'Awutorla') || ': Order ' || NEW.id || '. ' || stage_text) ON CONFLICT(order_id,stage,production_cycle) DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.record_manual_sms(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE notice public.sms_notifications; job public.orders;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  SELECT * INTO notice FROM public.sms_notifications WHERE id=p_notification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id=notice.order_id FOR UPDATE;
  SELECT * INTO notice FROM public.sms_notifications WHERE id=p_notification_id FOR UPDATE;
  IF notice.status='sent_manually' THEN RETURN to_jsonb(notice); END IF;
  IF notice.stage<>job.status OR notice.production_cycle<>job.production_cycle OR notice.status NOT IN ('pending','failed') THEN RAISE EXCEPTION 'Outdated or previously submitted SMS. Refresh or request a review.'; END IF;
  UPDATE public.sms_notifications SET status='sent_manually',sent_by=auth.uid(),sent_at=now(),last_error=NULL,updated_at=now() WHERE id=notice.id RETURNING * INTO notice;
  PERFORM public.append_order_audit(job.id,'SMS recorded manually',jsonb_build_object('notificationId',notice.id)); RETURN to_jsonb(notice);
END $$;

CREATE OR REPLACE FUNCTION public.review_sms(p_id UUID,p_expected_status TEXT,p_resolution TEXT,p_notes TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE notice public.sms_notifications; job public.orders; new_state TEXT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only an admin can review uncertain SMS submissions.'; END IF;
  SELECT * INTO notice FROM public.sms_notifications WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SMS not found.'; END IF;
  SELECT * INTO job FROM public.orders WHERE id=notice.order_id FOR UPDATE;
  SELECT * INTO notice FROM public.sms_notifications WHERE id=p_id FOR UPDATE;
  IF notice.status IS DISTINCT FROM p_expected_status OR notice.status NOT IN ('sending','submitted') THEN RAISE EXCEPTION 'SMS changed or was already reviewed. Refresh first.'; END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('confirmed_submitted','confirmed_not_sent') OR NULLIF(btrim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Record a verified resolution and supporting evidence.'; END IF;
  new_state := CASE WHEN p_resolution='confirmed_submitted' THEN 'reviewed_submitted'
    WHEN notice.stage=job.status AND notice.production_cycle=job.production_cycle THEN 'pending' ELSE 'superseded' END;
  UPDATE public.sms_notifications SET status=new_state,reviewed_by=auth.uid(),reviewed_at=now(),review_notes=btrim(p_notes),updated_at=now() WHERE id=p_id RETURNING * INTO notice;
  PERFORM public.append_order_audit(job.id,'SMS submission reviewed',jsonb_build_object('notificationId',p_id,'resolution',p_resolution,'evidence',btrim(p_notes))); RETURN to_jsonb(notice);
END $$;

REVOKE ALL ON FUNCTION public.save_fitting(TEXT,UUID,BIGINT,JSONB), public.save_rework(TEXT,UUID,BIGINT,JSONB),
  public.record_quality_check(TEXT,UUID,BIGINT,JSONB,TEXT), public.update_order_terms(TEXT,TIMESTAMPTZ,NUMERIC,UUID,TEXT,BOOLEAN),
  public.reopen_order(TEXT,public.order_status,TEXT), public.review_sms(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_fitting(TEXT,UUID,BIGINT,JSONB), public.save_rework(TEXT,UUID,BIGINT,JSONB),
  public.record_quality_check(TEXT,UUID,BIGINT,JSONB,TEXT), public.update_order_terms(TEXT,TIMESTAMPTZ,NUMERIC,UUID,TEXT,BOOLEAN),
  public.reopen_order(TEXT,public.order_status,TEXT), public.review_sms(UUID,TEXT,TEXT,TEXT) TO authenticated;
COMMIT;
