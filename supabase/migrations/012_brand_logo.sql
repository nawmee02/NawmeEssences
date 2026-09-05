-- ============================================================
--  NawmeEssences — brand logo images
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on 004_admin.sql (set_updated_at).
--
--  Brands are shown as a typographic monogram (initials in a gold
--  circle). This adds an optional real logo per brand, uploaded
--  from the admin's Brands tab and stored at
--    product-images/brands/{slug}/{size}.webp
--  — the same bucket + path-prefix trick blog covers already use,
--  so NO new bucket and NO new storage policy are needed (the
--  policy from 006 is bucket-wide: bucket_id = 'product-images'
--  AND is_admin()).
--
--  `logo` is just a presence flag; the URL is derived from the
--  slug, exactly like blog_posts.cover.
-- ============================================================

-- ─────────────────────────────────────────
--  1. New columns on brands
-- ─────────────────────────────────────────
ALTER TABLE brands ADD COLUMN IF NOT EXISTS logo boolean NOT NULL DEFAULT false;

-- updated_at is REQUIRED, not cosmetic: every image URL is cache-busted with
-- ?v=<unix updated_at> and the files upload with a 1-year immutable cache
-- (see imageVersion() in scripts/lib/catalog.js). brands only had created_at,
-- so without this a replaced logo would stay stale in the CDN for a year.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────
--  2. Auto-bump updated_at, reusing the function from 004
-- ─────────────────────────────────────────
DROP TRIGGER IF EXISTS brands_set_updated_at ON brands;
CREATE TRIGGER brands_set_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
--  3. No RLS change needed.
--     "public read brands"  = FOR SELECT USING (true)      (001)
--     "admin write brands"  = FOR ALL TO authenticated
--                             USING/WITH CHECK is_admin()  (006)
--     Policies are row-level, so new columns are covered already.
--     upsert_product is likewise untouched — it only ever writes
--     brands(slug, name), and both new columns have defaults.
-- ─────────────────────────────────────────
