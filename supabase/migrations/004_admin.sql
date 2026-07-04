-- ============================================================
--  NawmeEssences — Admin dashboard: status, audit, locking,
--  admin write policies, and an atomic product-upsert RPC.
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
-- ============================================================

-- ─────────────────────────────────────────
--  1. Fragrance status (draft / published / archived) + audit
-- ─────────────────────────────────────────
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
DO $$ BEGIN
  ALTER TABLE fragrances ADD CONSTRAINT fragrances_status_chk
    CHECK (status IN ('draft','published','archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Auto-bump updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fragrances_set_updated_at ON fragrances;
CREATE TRIGGER fragrances_set_updated_at
  BEFORE UPDATE ON fragrances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
--  2. Positive-value constraints on sizes
-- ─────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE fragrance_sizes ADD CONSTRAINT fragrance_sizes_price_chk CHECK (price > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE fragrance_sizes ADD CONSTRAINT fragrance_sizes_ml_chk CHECK (ml > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────
--  3. Admin allowlist
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read self" ON admins;
CREATE POLICY "admins read self" ON admins FOR SELECT USING (auth.uid() = user_id);

-- helper: is the current user an admin?
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────
--  4. Admin write policies on catalog tables (public-read stays)
-- ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brands','fragrances','fragrance_sizes','fragrance_tags','fragrance_details'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin write %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "admin write %1$s" ON %1$s FOR ALL USING (is_admin()) WITH CHECK (is_admin())', t);
  END LOOP;
END $$;

-- Hide draft/archived fragrances from the public; admins see all.
-- (Replaces the permissive public-read policy from 001.)
DROP POLICY IF EXISTS "public read fragrances" ON fragrances;
CREATE POLICY "public read fragrances" ON fragrances
  FOR SELECT USING (status = 'published' OR is_admin());

-- ─────────────────────────────────────────
--  5. Storage: admins can write to the product-images bucket
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "admin write product-images" ON storage.objects;
CREATE POLICY "admin write product-images" ON storage.objects
  FOR ALL
  USING (bucket_id = 'product-images' AND is_admin())
  WITH CHECK (bucket_id = 'product-images' AND is_admin());

-- ─────────────────────────────────────────
--  6. Atomic product upsert (one transaction) with optimistic lock
--     p_sizes:   jsonb  [{"ml":3,"price":150}, ...]
--     p_tags:    jsonb  ["new","limited"]
--     p_details: jsonb  {"top":[..],"heart":[..],"base":[..],"accords":[..],"family":"","description":""}
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_product(
  p_id                  text,
  p_name                text,
  p_brand_name          text,
  p_collection          text,
  p_in_stock            boolean,
  p_is_bestseller       boolean,
  p_status              text,
  p_sizes               jsonb,
  p_tags                jsonb,
  p_details             jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_brand_id  uuid;
  v_brand_slug text := regexp_replace(lower(p_brand_name), '[^a-z0-9]+', '-', 'g');
  v_current   timestamptz;
  v_result    timestamptz;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;

  -- Optimistic lock: if editing, the caller's loaded timestamp must match.
  SELECT updated_at INTO v_current FROM fragrances WHERE id = p_id;
  IF FOUND AND p_expected_updated_at IS NOT NULL AND v_current <> p_expected_updated_at THEN
    RAISE EXCEPTION 'stale';
  END IF;

  -- Brand upsert
  v_brand_slug := trim(both '-' from v_brand_slug);
  INSERT INTO brands (slug, name) VALUES (v_brand_slug, p_brand_name)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_brand_id;
  IF v_brand_id IS NULL THEN
    SELECT id INTO v_brand_id FROM brands WHERE slug = v_brand_slug;
  END IF;

  -- Fragrance upsert
  INSERT INTO fragrances (id, name, brand_id, collection, in_stock, is_bestseller, status, created_by, updated_by)
  VALUES (p_id, p_name, v_brand_id, p_collection, p_in_stock, p_is_bestseller, p_status, auth.uid(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, brand_id = EXCLUDED.brand_id, collection = EXCLUDED.collection,
    in_stock = EXCLUDED.in_stock, is_bestseller = EXCLUDED.is_bestseller,
    status = EXCLUDED.status, updated_by = auth.uid();

  -- Replace sizes
  DELETE FROM fragrance_sizes WHERE fragrance_id = p_id;
  INSERT INTO fragrance_sizes (fragrance_id, ml, price)
    SELECT p_id, (e->>'ml')::int, (e->>'price')::int FROM jsonb_array_elements(p_sizes) e;

  -- Replace tags
  DELETE FROM fragrance_tags WHERE fragrance_id = p_id;
  INSERT INTO fragrance_tags (fragrance_id, tag)
    SELECT p_id, jsonb_array_elements_text(p_tags);

  -- Upsert details
  INSERT INTO fragrance_details (fragrance_id, top_notes, heart_notes, base_notes, accords, family, description)
  VALUES (p_id,
    COALESCE(p_details->'top','[]'::jsonb), COALESCE(p_details->'heart','[]'::jsonb),
    COALESCE(p_details->'base','[]'::jsonb), COALESCE(p_details->'accords','[]'::jsonb),
    COALESCE(p_details->>'family',''), COALESCE(p_details->>'description',''))
  ON CONFLICT (fragrance_id) DO UPDATE SET
    top_notes = EXCLUDED.top_notes, heart_notes = EXCLUDED.heart_notes, base_notes = EXCLUDED.base_notes,
    accords = EXCLUDED.accords, family = EXCLUDED.family, description = EXCLUDED.description;

  SELECT updated_at INTO v_result FROM fragrances WHERE id = p_id;
  RETURN v_result;
END $$;

-- ─────────────────────────────────────────
--  7. One-time: add yourself as an admin (edit the email, then run)
-- ─────────────────────────────────────────
-- INSERT INTO admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'you@example.com'
--   ON CONFLICT DO NOTHING;
