-- ============================================================
--  NawmeEssences — 005 hardening
--  S-1: pin search_path on SECURITY DEFINER / trigger / RPC funcs
--       (clears Supabase's function_search_path_mutable warning)
--  S-2: interim CHECK constraints on orders / order_items so the
--       public anon-insert path can't write junk or fake prices
--       (the full server-side validation is the Edge Function,
--        which is a separate task).
--  Run in Supabase Dashboard → SQL Editor. Re-runnable (idempotent).
-- ============================================================

-- ─────────────────────────────────────────
--  S-1  ·  Pin search_path (schema-qualify admins)
-- ─────────────────────────────────────────
-- NOTE: we deliberately do NOT REVOKE EXECUTE on is_admin() from anon.
-- The public-read policy on `fragrances` is `status='published' OR is_admin()`,
-- so an anon query touching any draft/archived row evaluates is_admin(); without
-- EXECUTE that raises "permission denied" and breaks public reads. is_admin()
-- returns false for anon (auth.uid() is null), so leaving it callable leaks nothing.
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- upsert_product is SECURITY INVOKER (admin RLS applies); pinning search_path
-- anyway is good hygiene and clears the advisor for this function too.
ALTER FUNCTION upsert_product(
  text, text, text, text, boolean, boolean, text, jsonb, jsonb, jsonb, timestamptz
) SET search_path = public, pg_temp;

-- ─── OPTIONAL (S-4): require TOTP MFA to be an admin ────────────
-- ⚠  DO NOT run this until you have ENROLLED TOTP on your admin account,
--     or you will lock yourself out of every catalog write.
-- CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
-- LANGUAGE sql STABLE SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
--   SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid())
--      AND coalesce((auth.jwt() -> 'amr' -> 0 ->> 'method') = 'totp', false);
-- $$;

-- ─────────────────────────────────────────
--  S-2  ·  Order integrity constraints
--  Added NOT VALID: they enforce every NEW insert (the anon attack
--  surface) without validating pre-existing / test rows, so the
--  ALTER can never fail on legacy data. Run
--    ALTER TABLE orders VALIDATE CONSTRAINT <name>;
--  later, once you've confirmed old rows comply.
-- ─────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_name_len
    CHECK (char_length(buyer_name) BETWEEN 2 AND 100) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_phone_len
    CHECK (char_length(buyer_phone) BETWEEN 6 AND 20) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_address_len
    CHECK (char_length(buyer_address) BETWEEN 10 AND 500) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_subtotal_pos
    CHECK (subtotal > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_delivery_nonneg
    CHECK (delivery_charge >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_total_consistent
    CHECK (total = subtotal + delivery_charge) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_qty
    CHECK (qty BETWEEN 1 AND 20) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_price_pos
    CHECK (price > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_ml_pos
    CHECK (ml > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────
--  NOT DONE HERE: rate-limiting the anon insert.
--  The obvious policy — WITH CHECK ((SELECT count(*) FROM orders
--  WHERE created_at > now() - interval '1 minute') < N) — does NOT
--  work: orders has no SELECT policy, so the anon subquery counts 0
--  rows and never trips. Real rate-limiting lives in the create-order
--  Edge Function (separate task).
-- ─────────────────────────────────────────

-- ─── Verify (S-1) ──────────────────────────────────────────────
-- SELECT proname, prosecdef, proconfig FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname IN ('is_admin','set_updated_at','upsert_product');
-- Each proconfig must contain: {"search_path=public, pg_temp"}
