-- ==============================================================================
-- GHANAIAN BESPOKE ATELIER SUPABASE SCHEMA
-- Migration: 01_schema.sql
-- Description: Sets up multi-role profiles, bespoke client measurements,
--              bespoke orders, and tailor task assignments.
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. ENUMS
-- ==============================================================================

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('client', 'tailor', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
        'pending',
        'cutting',
        'fitting',
        'finishing',
        'ready',
        'delivered'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE task_status AS ENUM (
        'pending',
        'in_progress',
        'completed',
        'blocked'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==============================================================================
-- 2. TABLES
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PROFILES / USERS
-- Extends Supabase auth.users with app-specific roles and metadata
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    phone_number TEXT,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'client',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- CLIENT MEASUREMENTS
-- Custom body measurements for bespoke Ghanaian couture & tailoring
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    unit TEXT NOT NULL DEFAULT 'in' CHECK (unit IN ('in', 'cm')),
    bust NUMERIC(5,2),
    waist NUMERIC(5,2),
    hips NUMERIC(5,2),
    neck_to_waist NUMERIC(5,2),
    shoulder NUMERIC(5,2),
    sleeve_length NUMERIC(5,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_client_measurement UNIQUE (client_id)
);

-- ------------------------------------------------------------------------------
-- ORDERS (BESPOKE JOB ORDERS)
-- Full bespoke job card: garment/fabric details, deposit tracking, and stage
-- history — persisted here (rather than kept only in browser localStorage) so
-- every tailor/admin device sees the same live workshop board.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    -- TEXT, not UUID: the app assigns its own human-readable order references
    -- (e.g. ORD-BESPOKE-884) which are used as the durable identifier throughout
    -- the UI, WhatsApp messages, and client-facing tracking links.
    id TEXT PRIMARY KEY,
    -- Nullable: walk-in clients taken on by workshop staff (Quick Intake) may not
    -- have a Maison account (e.g. account creation failed) — client_name/phone
    -- below are always captured regardless of whether an account exists.
    client_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    client_name TEXT NOT NULL DEFAULT '',
    client_phone TEXT NOT NULL DEFAULT '',
    status order_status NOT NULL DEFAULT 'pending',
    garment_title TEXT NOT NULL DEFAULT '',
    garment_subtitle TEXT NOT NULL DEFAULT '',
    fabric_type TEXT NOT NULL DEFAULT '',
    fabric_color TEXT NOT NULL DEFAULT '',
    fabric_notes TEXT NOT NULL DEFAULT '',
    reference_images TEXT[] NOT NULL DEFAULT '{}',
    swatch_image TEXT,
    assigned_tailor TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    deposit_paid NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (deposit_paid >= 0),
    total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'GHS',
    notes TEXT,
    -- Append-only production milestone log: [{ stage, completedAt, completedBy, notes }, ...]
    stage_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- ORDER TASKS (BESPOKE TAILOR ASSIGNMENTS)
-- Granular task tracking assigned to specific workshop tailors
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_tasks (
    -- TEXT, matching orders.id (see note above) rather than a generated UUID.
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    tailor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    -- Denormalized display name, mirroring orders.client_name/client_phone — avoids a
    -- join against profiles just to render "Assigned to: X" in the workshop board.
    tailor_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    task_description TEXT,
    status task_status NOT NULL DEFAULT 'pending',
    due_date TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_client_measurements_client ON public.client_measurements(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_client ON public.orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_order_tasks_order ON public.order_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_order_tasks_tailor ON public.order_tasks(tailor_id);
CREATE INDEX IF NOT EXISTS idx_order_tasks_status ON public.order_tasks(status);

-- ==============================================================================
-- 4. AUTOMATIC TIMESTAMP TRIGGERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_client_measurements_updated_at ON public.client_measurements;
CREATE TRIGGER set_client_measurements_updated_at
    BEFORE UPDATE ON public.client_measurements
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_orders_updated_at ON public.orders;
CREATE TRIGGER set_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_order_tasks_updated_at ON public.order_tasks;
CREATE TRIGGER set_order_tasks_updated_at
    BEFORE UPDATE ON public.order_tasks
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 5. AUTH USER CREATION PROFILE TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, phone_number, avatar_url, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        NEW.phone,
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'client'::public.user_role)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Lets the walk-in intake flow recognize a returning client by phone number
-- instead of creating a duplicate account on their next visit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
    ON public.profiles(phone_number) WHERE phone_number IS NOT NULL;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tasks ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- Helper function to check if user is tailor
CREATE OR REPLACE FUNCTION public.is_tailor()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('tailor', 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- PROFILES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles are viewable by authenticated users"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Lets admins manage staff/client roles from the app (Team Roles panel).
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Row ownership alone isn't enough: without this, "Users can update own profile"
-- above would let anyone call the API directly and set their own role to 'admin'.
-- This blocks changing `role` unless the actor already is an admin, regardless of
-- which of the two policies above let the UPDATE statement through.
CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only admins can change a profile role.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS prevent_self_role_escalation ON public.profiles;
CREATE TRIGGER prevent_self_role_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_escalation();

-- ------------------------------------------------------------------------------
-- CLIENT MEASUREMENTS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can view their own measurements" ON public.client_measurements;
CREATE POLICY "Clients can view their own measurements"
    ON public.client_measurements FOR SELECT
    TO authenticated
    USING (auth.uid() = client_id OR public.is_tailor());

DROP POLICY IF EXISTS "Clients can insert or update their own measurements" ON public.client_measurements;
CREATE POLICY "Clients can insert or update their own measurements"
    ON public.client_measurements FOR ALL
    TO authenticated
    USING (auth.uid() = client_id OR public.is_tailor())
    WITH CHECK (auth.uid() = client_id OR public.is_tailor());

-- ------------------------------------------------------------------------------
-- ORDERS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can view their own orders" ON public.orders;
CREATE POLICY "Clients can view their own orders"
    ON public.orders FOR SELECT
    TO authenticated
    USING (auth.uid() = client_id OR public.is_tailor());

DROP POLICY IF EXISTS "Clients can create their own orders" ON public.orders;
CREATE POLICY "Clients can create their own orders"
    ON public.orders FOR INSERT
    TO authenticated
    -- Clients can create their own (e.g. RTW checkout); tailors/admins can create bespoke
    -- walk-in orders on behalf of clients who have no account yet (client_id left null).
    WITH CHECK (auth.uid() = client_id OR public.is_tailor());

DROP POLICY IF EXISTS "Tailors and admins can update orders" ON public.orders;
CREATE POLICY "Tailors and admins can update orders"
    ON public.orders FOR UPDATE
    TO authenticated
    USING (public.is_tailor());

-- ------------------------------------------------------------------------------
-- ORDER TASKS POLICIES
-- ------------------------------------------------------------------------------
-- All tailors/admins see the full shared workshop board, not just their own
-- assignments — the Kanban view is a shared floor, not a personal to-do list.
DROP POLICY IF EXISTS "Tailors can view assigned tasks" ON public.order_tasks;
DROP POLICY IF EXISTS "Tailors and admins can view all tasks" ON public.order_tasks;
CREATE POLICY "Tailors and admins can view all tasks"
    ON public.order_tasks FOR SELECT
    TO authenticated
    USING (public.is_tailor());

DROP POLICY IF EXISTS "Tailors can update assigned task status" ON public.order_tasks;
DROP POLICY IF EXISTS "Tailors and admins can update any task" ON public.order_tasks;
CREATE POLICY "Tailors and admins can update any task"
    ON public.order_tasks FOR UPDATE
    TO authenticated
    USING (public.is_tailor());

DROP POLICY IF EXISTS "Tailors and admins can create tasks" ON public.order_tasks;
CREATE POLICY "Tailors and admins can create tasks"
    ON public.order_tasks FOR INSERT
    TO authenticated
    -- Assigning artisan sub-tasks is a normal workshop-floor action, not admin-only.
    WITH CHECK (public.is_tailor());

DROP POLICY IF EXISTS "Only admins can delete tasks" ON public.order_tasks;
CREATE POLICY "Only admins can delete tasks"
    ON public.order_tasks FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- ==============================================================================
-- 7. REALTIME
-- ==============================================================================
-- Lets every signed-in tailor/admin's Workshop board update live when any
-- device creates/updates an order or task, instead of only on next page load.
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_tasks;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
