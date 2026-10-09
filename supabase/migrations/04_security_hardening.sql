-- ==============================================================================
-- GHANAIAN BESPOKE ATELIER SUPABASE SCHEMA
-- Migration: 04_security_hardening.sql
-- Description: Fixes from the 2026-08-22 security audit:
--   1. profiles SELECT policy was USING (true) for every authenticated user,
--      letting any signed-in client (including a walk-in client who only ever
--      proved a 6-character SMS access code) read every other user's name,
--      phone number, and role — not just staff, as the UI implied.
--   2. orders UPDATE policy had no WITH CHECK, so a tailor/admin update could
--      also silently reassign client_id to a different client in the same
--      statement.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PROFILES: scope "view any profile" to staff; clients see only themselves.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Tailors and admins can view all profiles" ON public.profiles;
CREATE POLICY "Tailors and admins can view all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (public.is_tailor());

-- ------------------------------------------------------------------------------
-- ORDERS: require the update to still land on a row a tailor/admin may see,
-- matching the USING clause instead of leaving updates uncosntrained.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Tailors and admins can update orders" ON public.orders;
CREATE POLICY "Tailors and admins can update orders"
    ON public.orders FOR UPDATE
    TO authenticated
    USING (public.is_tailor())
    WITH CHECK (public.is_tailor());
