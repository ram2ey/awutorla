-- Bounded reports/search, durable measurement retry receipts and protected uploads.
BEGIN;
CREATE OR REPLACE FUNCTION public.workshop_due_date(p_value TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE value DATE;
BEGIN
  IF p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN p_value::date; END IF;
  IF upper(p_value) ~ '^[A-Z]{3} [0-9]{1,2}, [0-9]{4}$' THEN
    value := to_date(upper(p_value),'MON DD, YYYY');
    IF upper(to_char(value,'MON FMDD, YYYY')) = upper(p_value) THEN RETURN value; END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
CREATE INDEX IF NOT EXISTS orders_created_id_idx ON public.orders(created_at DESC,id);
CREATE INDEX IF NOT EXISTS orders_assigned_stage_idx ON public.orders(assigned_tailor_id,status);

CREATE OR REPLACE FUNCTION public.workshop_summary()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB; month_start DATE := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  WITH scoped AS (SELECT * FROM public.orders WHERE public.is_admin() OR assigned_tailor_id=auth.uid()),
    counts AS (SELECT status,count(*) AS count FROM scoped GROUP BY status),
    loads AS (SELECT o.assigned_tailor_id,max(COALESCE(p.full_name,o.assigned_tailor,'Unassigned')) AS name,
      count(*) FILTER(WHERE o.status<>'delivered') AS active,count(*) FILTER(WHERE o.status='delivered') AS delivered
      FROM scoped o LEFT JOIN public.profiles p ON p.id=o.assigned_tailor_id
      GROUP BY o.assigned_tailor_id,CASE WHEN o.assigned_tailor_id IS NULL THEN o.assigned_tailor END)
  SELECT jsonb_build_object('views',jsonb_build_object('active',count(*) FILTER(WHERE status<>'delivered'),
    'overdue',count(*) FILTER(WHERE status<>'delivered' AND public.workshop_due_date(due_date)<(now() AT TIME ZONE 'UTC')::date),
    'unpaid',count(*) FILTER(WHERE total_amount>deposit_paid),'delivered_unpaid',count(*) FILTER(WHERE status='delivered' AND total_amount>deposit_paid),
    'credit',count(*) FILTER(WHERE deposit_paid>total_amount)),
    'statuses',COALESCE((SELECT jsonb_object_agg(status,count) FROM counts),'{}'::jsonb),
    'loads',COALESCE((SELECT jsonb_agg(to_jsonb(loads) ORDER BY active DESC,name) FROM loads),'[]'::jsonb),
    'fittings',COALESCE((SELECT jsonb_agg(to_jsonb(future) ORDER BY starts_at) FROM
      (SELECT f.id,f.order_id,f.starts_at,f.duration_minutes,o.client_name,o.garment_title FROM public.fitting_appointments f
        JOIN public.orders o ON o.id=f.order_id WHERE f.status='scheduled' AND f.starts_at>=now()
          AND (public.is_admin() OR f.tailor_id=auth.uid()) ORDER BY f.starts_at LIMIT 10) AS future),'[]'::jsonb),
    'outstanding',CASE WHEN public.is_admin() THEN COALESCE(sum(greatest(total_amount-deposit_paid,0)),0) END,
    'opening',CASE WHEN public.is_admin() THEN (SELECT COALESCE(sum(amount),0) FROM public.payments WHERE kind='opening_balance') END,
    'receipts',CASE WHEN public.is_admin() THEN (SELECT COALESCE(sum(amount),0) FROM public.payments WHERE kind<>'opening_balance'
      AND occurred_on>=month_start AND occurred_on<month_start+interval '1 month') END,
    'newCustomers',CASE WHEN public.is_admin() THEN (SELECT count(*) FROM public.clients WHERE created_at>=month_start::timestamp AT TIME ZONE 'UTC'
      AND created_at<(month_start+interval '1 month') AT TIME ZONE 'UTC') END) INTO result FROM scoped;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.workshop_order_page(p_view TEXT DEFAULT 'active',p_search TEXT DEFAULT '',p_page INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  IF p_view IS NULL OR p_view NOT IN ('active','overdue','unpaid','delivered_unpaid','credit') OR p_page IS NULL OR p_page<0 THEN RAISE EXCEPTION 'Invalid report view or page.'; END IF;
  WITH filtered AS (SELECT * FROM public.orders WHERE (public.is_admin() OR assigned_tailor_id=auth.uid())
    AND (COALESCE(p_search,'')='' OR strpos(lower(client_name || ' ' || client_phone || ' ' || id || ' ' || garment_title),lower(p_search))>0)
    AND CASE p_view WHEN 'unpaid' THEN total_amount>deposit_paid WHEN 'delivered_unpaid' THEN status='delivered' AND total_amount>deposit_paid
      WHEN 'credit' THEN deposit_paid>total_amount WHEN 'overdue' THEN status<>'delivered' AND public.workshop_due_date(due_date)<(now() AT TIME ZONE 'UTC')::date ELSE status<>'delivered' END),
    page AS (SELECT id,created_at FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_page::bigint*25)
  SELECT jsonb_build_object('ids',COALESCE((SELECT jsonb_agg(id ORDER BY created_at DESC,id) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered)) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.workshop_receipt_page(p_page INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB; month_start DATE := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required for atelier financial reports.'; END IF;
  IF p_page IS NULL OR p_page<0 THEN RAISE EXCEPTION 'Invalid receipt page.'; END IF;
  WITH filtered AS (SELECT p.*,o.client_name FROM public.payments p JOIN public.orders o ON o.id=p.order_id
    WHERE p.kind<>'opening_balance' AND p.occurred_on>=month_start AND p.occurred_on<month_start+interval '1 month'),
    page AS (SELECT * FROM filtered ORDER BY occurred_on DESC,recorded_at DESC,id LIMIT 25 OFFSET p_page::bigint*25)
  SELECT jsonb_build_object('records',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY occurred_on DESC,recorded_at DESC,id) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered)) INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.workshop_client_page(p_search TEXT DEFAULT '',p_page INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  IF p_page IS NULL OR p_page<0 THEN RAISE EXCEPTION 'Invalid customer page.'; END IF;
  WITH filtered AS (SELECT id,full_name,phone_number FROM public.clients WHERE COALESCE(p_search,'')=''
    OR strpos(lower(full_name || ' ' || phone_number),lower(p_search))>0),
    page AS (SELECT * FROM filtered ORDER BY full_name,id LIMIT 25 OFFSET p_page::bigint*25)
  SELECT jsonb_build_object('records',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY full_name,id) FROM page),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered)) INTO result; RETURN result;
END $$;

CREATE TABLE IF NOT EXISTS public.measurement_submissions (
  id UUID PRIMARY KEY, actor_id UUID NOT NULL REFERENCES public.profiles(id),
  request JSONB NOT NULL, result JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.measurement_submissions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.save_measurement_draft(p_id UUID,p_client_id UUID,p_expected_revision BIGINT,p_unit TEXT,p_values JSONB,p_notes TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior public.measurement_submissions; request JSONB; result JSONB;
BEGIN
  IF NOT public.is_tailor() OR p_id IS NULL THEN RAISE EXCEPTION 'Staff and submission ID required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('measurements:' || p_id::text,0));
  request := jsonb_build_object('client',p_client_id,'revision',p_expected_revision,'unit',p_unit,'values',p_values,'notes',COALESCE(p_notes,''));
  SELECT * INTO prior FROM public.measurement_submissions WHERE id=p_id;
  IF FOUND THEN
    IF prior.actor_id<>auth.uid() OR prior.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'Submission already belongs to another edit.'; END IF;
    RETURN prior.result;
  END IF;
  result := public.save_client_measurements(p_client_id,p_expected_revision,p_unit,p_values,p_notes);
  INSERT INTO public.measurement_submissions(id,actor_id,request,result) VALUES(p_id,auth.uid(),request,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.order_sketch_path(p_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_value LIKE '%/storage/v1/object/public/order-sketches/%' THEN split_part(split_part(p_value,'/storage/v1/object/public/order-sketches/',2),'?',1)
    WHEN p_value LIKE '%/storage/v1/object/sign/order-sketches/%' THEN split_part(split_part(p_value,'/storage/v1/object/sign/order-sketches/',2),'?',1)
    WHEN p_value !~ '^https?://' THEN p_value END;
$$;
CREATE OR REPLACE FUNCTION public.sketch_is_referenced(p_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_setting('role',true) IN ('authenticated','anon') AND NOT public.is_tailor() THEN RAISE EXCEPTION 'Staff access required.'; END IF;
  RETURN EXISTS(SELECT 1 FROM public.orders o WHERE public.order_sketch_path(o.swatch_image)=p_path
    OR EXISTS(SELECT 1 FROM unnest(o.reference_images) AS image WHERE public.order_sketch_path(image)=p_path));
END;
$$;
REVOKE ALL ON FUNCTION public.sketch_is_referenced(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sketch_is_referenced(TEXT) TO authenticated;
-- The delete trigger rechecks after acquiring the storage row lock. Intake takes
-- a row lock too, so an upload cannot be deleted while its order is committing.
CREATE OR REPLACE FUNCTION public.protect_order_attachments()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE path TEXT;
BEGIN
  IF TG_TABLE_SCHEMA='storage' THEN
    IF OLD.bucket_id='order-sketches' AND public.sketch_is_referenced(OLD.name) THEN RAISE EXCEPTION 'Attachment belongs to a saved order.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND NEW.reference_images IS NOT DISTINCT FROM OLD.reference_images AND NEW.swatch_image IS NOT DISTINCT FROM OLD.swatch_image THEN RETURN NEW; END IF;
  FOR path IN SELECT DISTINCT public.order_sketch_path(image) FROM unnest(NEW.reference_images || ARRAY[NEW.swatch_image]) AS image ORDER BY 1 LOOP
    IF path IS NULL THEN CONTINUE; END IF;
    PERFORM 1 FROM storage.objects WHERE bucket_id='order-sketches' AND name=path FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Uploaded attachment is missing. Upload it again before saving intake.'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_order_attachments ON public.orders;
CREATE TRIGGER protect_order_attachments BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.protect_order_attachments();
DROP TRIGGER IF EXISTS protect_referenced_sketch ON storage.objects;
CREATE TRIGGER protect_referenced_sketch BEFORE DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.protect_order_attachments();
DROP POLICY IF EXISTS "Tailors and admins can delete order sketches" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete abandoned sketches" ON storage.objects;
CREATE POLICY "Admins can delete abandoned sketches" ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id='order-sketches' AND public.is_admin() AND created_at<now()-interval '48 hours' AND NOT public.sketch_is_referenced(name));
DROP POLICY IF EXISTS "Tailors and admins can update order sketches" ON storage.objects;
-- Uploaded sketches are immutable; replacement uses a new path.
CREATE OR REPLACE FUNCTION public.abandoned_sketches()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required.'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('path',name,'createdAt',created_at) ORDER BY created_at)
    FROM (SELECT name,created_at FROM storage.objects WHERE bucket_id='order-sketches' AND created_at<now()-interval '48 hours'
      AND NOT public.sketch_is_referenced(name) ORDER BY created_at LIMIT 100) AS candidates),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.workshop_summary(),public.workshop_order_page(TEXT,TEXT,INTEGER),public.workshop_receipt_page(INTEGER),public.workshop_client_page(TEXT,INTEGER),
  public.save_measurement_draft(UUID,UUID,BIGINT,TEXT,JSONB,TEXT),public.abandoned_sketches() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_summary(),public.workshop_order_page(TEXT,TEXT,INTEGER),public.workshop_receipt_page(INTEGER),public.workshop_client_page(TEXT,INTEGER),
  public.save_measurement_draft(UUID,UUID,BIGINT,TEXT,JSONB,TEXT),public.abandoned_sketches() TO authenticated;
COMMIT;
