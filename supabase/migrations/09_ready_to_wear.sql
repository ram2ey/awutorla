-- Dedicated shop data. Only explicit server endpoints access these tables;
-- neither the anonymous nor generic authenticated workshop role has RLS policies.
CREATE TABLE public.shop_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  business_name TEXT NOT NULL DEFAULT 'Awutorla', contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '', momo_number TEXT NOT NULL DEFAULT '',
  momo_name TEXT NOT NULL DEFAULT '', pickup_details TEXT NOT NULL DEFAULT '',
  shop_open BOOLEAN NOT NULL DEFAULT true, checkout_enabled BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO public.shop_settings(id) VALUES(true);
CREATE TABLE public.shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
  size_guide TEXT NOT NULL DEFAULT '', price_pesewas INTEGER NOT NULL CHECK(price_pesewas>0 AND price_pesewas<=100000000),
  published BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.shop_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.shop_products(id),
  sku TEXT NOT NULL UNIQUE, size TEXT NOT NULL, colour TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 1000000), active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(product_id,size,colour)
);
CREATE TABLE public.shop_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.shop_products(id),
  filename TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference TEXT NOT NULL UNIQUE,
  submission_key UUID NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
  fulfilment TEXT NOT NULL CHECK(fulfilment IN ('pickup','delivery')),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('momo','cash')),
  subtotal INTEGER NOT NULL CHECK(subtotal>0), delivery_fee INTEGER CHECK(delivery_fee BETWEEN 0 AND 100000000),
  status TEXT NOT NULL DEFAULT 'awaiting_confirmation' CHECK(status IN ('awaiting_confirmation','confirmed','ready','fulfilled','cancelled','expired')),
  reserved_until TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1, is_test BOOLEAN NOT NULL DEFAULT false,
  CHECK(fulfilment='pickup' OR payment_method='momo'),
  CHECK(fulfilment='delivery' OR delivery_fee=0)
);
CREATE INDEX shop_order_queue ON public.shop_orders(status,created_at DESC);
CREATE INDEX shop_reservation_expiry ON public.shop_orders(reserved_until) WHERE status='awaiting_confirmation';
CREATE TABLE public.shop_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.shop_orders(id),
  variant_id UUID NOT NULL REFERENCES public.shop_variants(id), title TEXT NOT NULL,
  description TEXT NOT NULL, sku TEXT NOT NULL, size TEXT NOT NULL, colour TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100), unit_price INTEGER NOT NULL CHECK(unit_price>0),
  UNIQUE(order_id,variant_id)
);
CREATE TABLE public.shop_allocations (
  order_id UUID NOT NULL REFERENCES public.shop_orders(id), variant_id UUID NOT NULL REFERENCES public.shop_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  released_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ,
  PRIMARY KEY(order_id,variant_id), CHECK(released_at IS NULL OR consumed_at IS NULL)
);
CREATE INDEX shop_active_allocations ON public.shop_allocations(variant_id) WHERE released_at IS NULL AND consumed_at IS NULL;
CREATE TABLE public.shop_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES public.shop_orders(id),
  submission_key UUID NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('receipt','reversal','refund')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000), method TEXT NOT NULL CHECK(method IN ('momo','cash')),
  occurred_on DATE NOT NULL, reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  reverses_id UUID UNIQUE REFERENCES public.shop_payments(id), recorded_by UUID NOT NULL REFERENCES public.profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((kind='reversal')=(reverses_id IS NOT NULL))
);
CREATE TABLE public.shop_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID REFERENCES public.shop_orders(id),
  actor_id UUID REFERENCES public.profiles(id), action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.shop_request_limits (
  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['shop_settings','shop_products','shop_variants','shop_images','shop_orders','shop_order_items','shop_allocations','shop_payments','shop_audit','shop_request_limits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
  END LOOP;
END $$;
