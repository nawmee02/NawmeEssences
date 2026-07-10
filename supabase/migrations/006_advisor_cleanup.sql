-- ============================================================
--  NawmeEssences — 006 advisor cleanup
--  Clears the "Public Can Execute SECURITY DEFINER Function"
--  advisor warnings for is_admin() (anon) and rls_auto_enable().
--
--  The trick: anon currently evaluates is_admin() on every catalog
--  SELECT, because the admin-write policies are FOR ALL with no role
--  restriction (FOR ALL includes SELECT) and the fragrances read
--  policy is `status='published' OR is_admin()`. So we first scope
--  every is_admin() policy TO authenticated and split the fragrances
--  read into a function-free public rule + an admin-only draft rule.
--  ONLY THEN can we revoke anon's EXECUTE without breaking reads.
--
--  Unaffected: the `public read <table> USING (true)` policies from
--  001 stay, so anon keeps reading brands/sizes/tags/details.
--  Run in Supabase Dashboard → SQL Editor. Re-runnable.
-- ============================================================

-- ─────────────────────────────────────────
--  1. Admin write policies → scope TO authenticated
--     (were implicitly all roles, so anon SELECT hit is_admin()).
-- ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brands','fragrances','fragrance_sizes','fragrance_tags','fragrance_details'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin write %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "admin write %1$s" ON %1$s FOR ALL TO authenticated '
      'USING (is_admin()) WITH CHECK (is_admin())', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────
--  2. fragrances SELECT → published for everyone (no function call),
--     drafts/archived for admins only (authenticated).
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "public read fragrances"      ON fragrances;
DROP POLICY IF EXISTS "read published fragrances"   ON fragrances;
DROP POLICY IF EXISTS "admin read draft fragrances" ON fragrances;

CREATE POLICY "read published fragrances" ON fragrances
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "admin read draft fragrances" ON fragrances
  FOR SELECT TO authenticated
  USING (is_admin());

-- ─────────────────────────────────────────
--  3. Storage admin-write → scope TO authenticated.
--     (Public image serving uses the /public/ endpoint, which
--      bypasses RLS, so anon reads are unaffected.)
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "admin write product-images" ON storage.objects;
CREATE POLICY "admin write product-images" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'product-images' AND is_admin())
  WITH CHECK (bucket_id = 'product-images' AND is_admin());

-- ─────────────────────────────────────────
--  4. Now anon never evaluates is_admin(); revoke its EXECUTE so it
--     is no longer callable via /rest/v1/rpc/is_admin. authenticated
--     keeps it (admin policies + upsert_product need it).
--     The `authenticated` advisor warning for is_admin() is expected
--     and acceptable — it only ever returns the caller's own status.
-- ─────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ─────────────────────────────────────────
--  5. rls_auto_enable(): not called by the app. Remove REST exposure.
--     Wrapped so it is a no-op if the function doesn't exist / differs.
--     (Inspect + drop later if confirmed unused — see the query below.)
-- ─────────────────────────────────────────
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public;
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'rls_auto_enable() not found with () signature — inspect manually';
END $$;

-- ─── Inspect the mystery function (optional) ───────────────────
-- SELECT proname, proowner::regrole AS owner, prosrc
-- FROM pg_proc WHERE proname = 'rls_auto_enable';
-- If nothing depends on it:  DROP FUNCTION public.rls_auto_enable();

-- ─── Verify ────────────────────────────────────────────────────
-- Anon read still works (published only):
--   set role anon; SELECT count(*) FROM fragrances; reset role;
-- Anon can no longer call is_admin (should error):
--   set role anon; SELECT public.is_admin(); reset role;
